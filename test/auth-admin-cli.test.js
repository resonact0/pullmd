import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../lib/cache.js';
import { createAuth } from '../lib/auth.js';
import { resetPassword, listUsers, makeAdmin } from '../scripts/admin.js';

const fastOpts = { timeCost: 1, memoryCost: 1024, parallelism: 1 };

describe('admin CLI commands', () => {
  let cache, auth;
  beforeEach(async () => {
    cache = createCache(':memory:');
    auth = createAuth({
      db: cache.db, mode: 'multi-user',
      env: { PULLMD_ADMIN_EMAIL: 'a@b.c', PULLMD_ADMIN_PASSWORD: 'pw1234567' },
      argon2Opts: fastOpts,
    });
    await auth.runMigration();
    await auth.createUser({ email: 'other@x.y', password: 'pw1234567' });
  });

  it('listUsers returns all users', () => {
    const users = listUsers({ db: cache.db });
    assert.equal(users.length, 2);
    const emails = users.map(u => u.email).sort();
    assert.deepEqual(emails, ['a@b.c', 'other@x.y']);
  });

  it('resetPassword updates the hash and invalidates sessions', async () => {
    const u = cache.db.prepare("SELECT id FROM users WHERE email = ?").get('other@x.y');
    auth.createSession(u.id);
    assert.equal(cache.db.prepare("SELECT COUNT(*) c FROM sessions WHERE user_id = ?").get(u.id).c, 1);

    const ok = await resetPassword({ db: cache.db, auth }, 'other@x.y', 'newpass1234');
    assert.equal(ok, true);
    assert.equal(await auth.authenticate('other@x.y', 'pw1234567'), null);
    const reauth = await auth.authenticate('other@x.y', 'newpass1234');
    assert.ok(reauth);
    assert.equal(cache.db.prepare("SELECT COUNT(*) c FROM sessions WHERE user_id = ?").get(u.id).c, 0);
  });

  it('resetPassword returns false for unknown email', async () => {
    const ok = await resetPassword({ db: cache.db, auth }, 'ghost@nowhere', 'pw1234567');
    assert.equal(ok, false);
  });

  it('makeAdmin promotes a user', () => {
    const ok = makeAdmin({ db: cache.db }, 'other@x.y');
    assert.equal(ok, true);
    const u = cache.db.prepare("SELECT is_admin FROM users WHERE email = ?").get('other@x.y');
    assert.equal(u.is_admin, 1);
  });
});
