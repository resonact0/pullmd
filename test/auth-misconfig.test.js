import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../lib/cache.js';
import { createAuth, detectAuthMisconfig, formatBootstrapError } from '../lib/auth.js';

const fastOpts = { timeCost: 1, memoryCost: 1024, parallelism: 1 };

function captureWarn(fn) {
  const lines = [];
  const result = fn((...args) => lines.push(args.join(' ')));
  return { result, lines };
}

describe('detectAuthMisconfig', () => {
  it('returns false when no PULLMD_AUTH_TOKEN is set', () => {
    assert.equal(detectAuthMisconfig({}), false);
    assert.equal(detectAuthMisconfig({ PULLMD_AUTH_MODE: 'disabled' }), false);
    assert.equal(detectAuthMisconfig({ PULLMD_AUTH_MODE: 'multi-user' }), false);
  });

  it('returns true when PULLMD_AUTH_TOKEN is set but mode is disabled', () => {
    assert.equal(detectAuthMisconfig({ PULLMD_AUTH_TOKEN: 'tok', PULLMD_AUTH_MODE: 'disabled' }), true);
  });

  it('returns true when PULLMD_AUTH_TOKEN is set but mode is missing', () => {
    assert.equal(detectAuthMisconfig({ PULLMD_AUTH_TOKEN: 'tok' }), true);
  });

  it('returns true when PULLMD_AUTH_TOKEN is set but mode is unknown junk', () => {
    assert.equal(detectAuthMisconfig({ PULLMD_AUTH_TOKEN: 'tok', PULLMD_AUTH_MODE: 'wat' }), true);
  });

  it('returns false when PULLMD_AUTH_TOKEN is set and mode is single-admin', () => {
    assert.equal(detectAuthMisconfig({ PULLMD_AUTH_TOKEN: 'tok', PULLMD_AUTH_MODE: 'single-admin' }), false);
  });

  it('returns false when PULLMD_AUTH_TOKEN is set and mode is multi-user', () => {
    assert.equal(detectAuthMisconfig({ PULLMD_AUTH_TOKEN: 'tok', PULLMD_AUTH_MODE: 'multi-user' }), false);
  });
});

describe('createAuth: isMisconfigured + console warning', () => {
  it('exposes isMisconfigured=true and logs the banner when token+disabled', () => {
    const cache = createCache(':memory:');
    const { result: auth, lines } = captureWarn((logger) =>
      createAuth({
        db: cache.db, mode: 'disabled',
        env: { PULLMD_AUTH_TOKEN: 'legacy-tok' },
        argon2Opts: fastOpts,
        warnLogger: logger,
      })
    );
    assert.equal(auth.isMisconfigured, true);
    const joined = lines.join('\n');
    assert.match(joined, /PULLMD_AUTH_TOKEN is set but PULLMD_AUTH_MODE is not/);
    assert.match(joined, /UNAUTHENTICATED/);
    assert.match(joined, /MIGRATION\.md/);
    // Visual ASCII bar must be there to make the warning unmissable in logs.
    assert.match(joined, /={20,}/);
  });

  it('does NOT log or flag in single-admin mode (token is wired up)', () => {
    const cache = createCache(':memory:');
    const { result: auth, lines } = captureWarn((logger) =>
      createAuth({
        db: cache.db, mode: 'single-admin',
        env: { PULLMD_AUTH_TOKEN: 'legacy-tok', PULLMD_ADMIN_EMAIL: 'a@b.c', PULLMD_ADMIN_PASSWORD: 'pw1234567' },
        argon2Opts: fastOpts,
        warnLogger: logger,
      })
    );
    assert.equal(auth.isMisconfigured, false);
    assert.equal(lines.length, 0);
  });

  it('does NOT log or flag when there is no token at all', () => {
    const cache = createCache(':memory:');
    const { result: auth, lines } = captureWarn((logger) =>
      createAuth({
        db: cache.db, mode: 'disabled',
        env: {},
        argon2Opts: fastOpts,
        warnLogger: logger,
      })
    );
    assert.equal(auth.isMisconfigured, false);
    assert.equal(lines.length, 0);
  });
});

describe('formatBootstrapError', () => {
  it('formats single-admin bootstrap error with var names and bar', () => {
    const out = formatBootstrapError('single-admin');
    assert.match(out, /={20,}/);
    assert.match(out, /PULLMD_AUTH_MODE=single-admin requires bootstrap credentials/);
    assert.match(out, /PULLMD_ADMIN_EMAIL/);
    assert.match(out, /PULLMD_ADMIN_PASSWORD/);
    assert.match(out, /min 8 characters/);
    assert.match(out, /MIGRATION\.md/);
  });

  it('formats multi-user bootstrap error with the same shape', () => {
    const out = formatBootstrapError('multi-user');
    assert.match(out, /PULLMD_AUTH_MODE=multi-user requires bootstrap credentials/);
    assert.match(out, /PULLMD_ADMIN_EMAIL/);
    assert.match(out, /PULLMD_ADMIN_PASSWORD/);
  });
});
