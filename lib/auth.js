import argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';

const PROD_ARGON2_OPTS = {
  type: argon2.argon2id,
  timeCost: 3,
  memoryCost: 65536,
  parallelism: 4,
};

/**
 * Hash a password with Argon2id.
 * @param {string} password
 * @param {object} [opts] override params (used by tests for speed)
 * @returns {Promise<string>} argon2 encoded hash
 */
export async function hashPassword(password, opts = {}) {
  const params = { ...PROD_ARGON2_OPTS, ...opts, type: argon2.argon2id };
  return argon2.hash(password, params);
}

/**
 * Verify a password against an argon2 hash. Returns false (never throws) on malformed hashes.
 */
export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_SLIDE_MIN_MS = 60 * 1000; // bump expiry at most once per minute

function isoFromMs(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '').replace('T', ' ');
}

export function createAuth({ db, mode = 'disabled', env = {}, argon2Opts } = {}) {
  if (!['disabled', 'single-admin', 'multi-user'].includes(mode)) {
    throw new Error(`Invalid PULLMD_AUTH_MODE: ${mode}`);
  }

  const stmts = {
    insertSession: db.prepare(`
      INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)
    `),
    findSession: db.prepare(`
      SELECT s.token, s.user_id, s.expires_at, u.id AS uid, u.email, u.is_admin
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > datetime('now')
    `),
    deleteSession: db.prepare(`DELETE FROM sessions WHERE token = ?`),
    deleteUserSessions: db.prepare(`DELETE FROM sessions WHERE user_id = ?`),
    bumpSession: db.prepare(`UPDATE sessions SET expires_at = ? WHERE token = ?`),
    pruneSessions: db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`),
  };

  const keyStmts = {
    insertKey: db.prepare(`
      INSERT INTO api_keys (user_id, key_hash, key_prefix, label) VALUES (?, ?, ?, ?)
    `),
    findKey: db.prepare(`
      SELECT k.id, u.id AS uid, u.email, u.is_admin
      FROM api_keys k JOIN users u ON u.id = k.user_id
      WHERE k.key_hash = ?
    `),
    bumpKeyUsed: db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`),
    listUserKeys: db.prepare(`
      SELECT id, key_prefix, label, created_at, last_used_at
      FROM api_keys WHERE user_id = ? ORDER BY created_at DESC
    `),
    deleteUserKey: db.prepare(`DELETE FROM api_keys WHERE id = ? AND user_id = ?`),
  };

  function createSession(userId) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = isoFromMs(Date.now() + SESSION_TTL_MS);
    stmts.insertSession.run(token, userId, expiresAt);
    stmts.pruneSessions.run();
    return { token, expiresAt };
  }

  function lookupSession(token) {
    if (!token || typeof token !== 'string') return null;
    const row = stmts.findSession.get(token);
    if (!row) return null;

    // Sliding expiry: if the session has been bumped within the last minute,
    // don't bump again. This avoids a write per request while keeping active
    // users logged in indefinitely.
    const expiresMs = new Date(row.expires_at + 'Z').getTime();
    const remaining = expiresMs - Date.now();
    if (SESSION_TTL_MS - remaining > SESSION_SLIDE_MIN_MS) {
      stmts.bumpSession.run(isoFromMs(Date.now() + SESSION_TTL_MS), token);
    }

    return { id: row.uid, email: row.email, is_admin: !!row.is_admin };
  }

  function deleteSession(token) {
    stmts.deleteSession.run(token);
  }

  function generateKeyBody(len = 32) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = randomBytes(len);
    let out = '';
    for (let i = 0; i < len; i++) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
  }

  function sha256Hex(s) {
    return createHash('sha256').update(s).digest('hex');
  }

  function createApiKey(userId, label = null) {
    const fullKey = 'pmd_' + generateKeyBody(32);
    const keyHash = sha256Hex(fullKey);
    const prefix = fullKey.slice(0, 12);
    keyStmts.insertKey.run(userId, keyHash, prefix, label);
    return { fullKey, prefix };
  }

  function lookupApiKey(fullKey) {
    if (!fullKey || typeof fullKey !== 'string' || !fullKey.startsWith('pmd_')) return null;
    const keyHash = sha256Hex(fullKey);
    const row = keyStmts.findKey.get(keyHash);
    if (!row) return null;
    keyStmts.bumpKeyUsed.run(row.id);
    return { id: row.uid, email: row.email, is_admin: !!row.is_admin };
  }

  function listApiKeys(userId) {
    return keyStmts.listUserKeys.all(userId);
  }

  function revokeApiKey(userId, id) {
    const r = keyStmts.deleteUserKey.run(id, userId);
    return r.changes > 0;
  }

  return {
    mode,
    createSession, lookupSession, deleteSession,
    createApiKey, lookupApiKey, listApiKeys, revokeApiKey,
    _stmts: stmts,
    _keyStmts: keyStmts,
    _argon2Opts: argon2Opts,
  };
}
