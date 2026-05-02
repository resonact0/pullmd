import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { createCache } from '../lib/cache.js';
import { createAuth } from '../lib/auth.js';

const fastOpts = { timeCost: 1, memoryCost: 1024, parallelism: 1 };

async function withApp(mode, fn, envExtra = {}) {
  const cache = createCache(':memory:');
  const auth = createAuth({
    db: cache.db, mode,
    env: { PULLMD_ADMIN_EMAIL: 'a@b.c', PULLMD_ADMIN_PASSWORD: 'pw1234567', ...envExtra },
    argon2Opts: fastOpts,
  });
  await auth.runMigration();
  const app = createApp({
    cache,
    auth,
    extractWeb: async () => ({
      markdown: '# x', title: 'x', source: 'readability',
      metadata: { quality: 0.9 },
    }),
  });
  const server = app.listen(0);
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, { auth, cache });
  } finally {
    server.close();
  }
}

describe('integration: auth gating in createApp', () => {
  it('disabled mode: /api works without auth', async () => {
    await withApp('disabled', async (base) => {
      const r = await fetch(base + '/api?url=https://x.com&nocache=1');
      assert.equal(r.status, 200);
    });
  });

  it('multi-user: /api returns 401 without auth', async () => {
    await withApp('multi-user', async (base) => {
      const r = await fetch(base + '/api?url=https://x.com');
      assert.equal(r.status, 401);
    });
  });

  it('multi-user: /api works with API key', async () => {
    await withApp('multi-user', async (base, { auth, cache }) => {
      const adminId = cache.db.prepare("SELECT id FROM users").get().id;
      const { fullKey } = auth.createApiKey(adminId, 'k');
      const r = await fetch(base + '/api?url=https://x.com&nocache=1', {
        headers: { Authorization: `Bearer ${fullKey}` },
      });
      assert.equal(r.status, 200);
    });
  });

  it('multi-user: /api/history returns 401 without auth', async () => {
    await withApp('multi-user', async (base) => {
      const r = await fetch(base + '/api/history');
      assert.equal(r.status, 401);
    });
  });

  it('multi-user: /api/archive returns 401 without auth', async () => {
    await withApp('multi-user', async (base) => {
      const r = await fetch(base + '/api/archive');
      assert.equal(r.status, 401);
    });
  });

  it('multi-user: /mcp returns 401 without auth', async () => {
    await withApp('multi-user', async (base) => {
      const r = await fetch(base + '/mcp', {
        method: 'POST', body: '{}',
        headers: { 'Content-Type': 'application/json' },
      });
      assert.equal(r.status, 401);
    });
  });

  it('share link /s/:id stays public even when auth is on', async () => {
    await withApp('multi-user', async (base, { cache }) => {
      const adminId = cache.db.prepare("SELECT id FROM users").get().id;
      const shareId = cache.put({
        url: 'https://pub.com', title: 'Pub', markdown: '# pub',
        source: 'readability', client: 'api', user_id: adminId,
      });
      const r = await fetch(base + '/s/' + shareId);
      assert.equal(r.status, 200);
    });
  });

  it('static / and /help stay public', async () => {
    await withApp('multi-user', async (base) => {
      const a = await fetch(base + '/');
      assert.equal(a.status, 200);
      const b = await fetch(base + '/help');
      assert.equal(b.status, 200);
    });
  });

  it('aggregate /api/stats and /api/storage stay public', async () => {
    await withApp('multi-user', async (base) => {
      const a = await fetch(base + '/api/stats');
      assert.equal(a.status, 200);
      const b = await fetch(base + '/api/storage');
      assert.equal(b.status, 200);
    });
  });

  it('GET /api/config exposes authMode', async () => {
    await withApp('multi-user', async (base) => {
      const r = await fetch(base + '/api/config');
      assert.equal(r.status, 200);
      const body = await r.json();
      assert.equal(body.authMode, 'multi-user');
    });
  });
});
