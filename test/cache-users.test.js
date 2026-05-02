import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../lib/cache.js';

describe('cache schema for auth', () => {
  let cache;
  beforeEach(() => { cache = createCache(':memory:'); });

  it('creates the users table', () => {
    const cols = cache.db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    assert.deepEqual(cols.sort(), ['created_at', 'email', 'id', 'is_admin', 'password_hash']);
  });

  it('creates the sessions table', () => {
    const cols = cache.db.prepare("PRAGMA table_info(sessions)").all().map(c => c.name);
    assert.deepEqual(cols.sort(), ['created_at', 'expires_at', 'token', 'user_id']);
  });

  it('creates the api_keys table', () => {
    const cols = cache.db.prepare("PRAGMA table_info(api_keys)").all().map(c => c.name);
    assert.deepEqual(cols.sort(), ['created_at', 'id', 'key_hash', 'key_prefix', 'label', 'last_used_at', 'user_id']);
  });

  it('creates the user_fetches table', () => {
    const cols = cache.db.prepare("PRAGMA table_info(user_fetches)").all().map(c => c.name);
    assert.deepEqual(cols.sort(), ['cache_id', 'fetched_at', 'id', 'user_id']);
  });

  it('adds user_id to conversions', () => {
    const cols = cache.db.prepare("PRAGMA table_info(conversions)").all().map(c => c.name);
    assert.ok(cols.includes('user_id'), 'conversions.user_id must exist');
  });

  it('email is unique', () => {
    cache.db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run('a@b.c', 'x');
    assert.throws(
      () => cache.db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run('a@b.c', 'y'),
      /UNIQUE constraint failed: users.email/
    );
  });
});
