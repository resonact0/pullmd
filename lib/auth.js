import argon2 from 'argon2';

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
