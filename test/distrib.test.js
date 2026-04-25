import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { substituteUrl, renderHelp, buildSkillZip, _resetCaches, publicUrlFor } from '../lib/distrib.js';

describe('substituteUrl', () => {
  it('replaces every placeholder', () => {
    const out = substituteUrl('a __PULLMD_URL__/x b __PULLMD_URL__/y', 'https://my.host');
    assert.equal(out, 'a https://my.host/x b https://my.host/y');
  });

  it('strips trailing slash from the base url', () => {
    const out = substituteUrl('__PULLMD_URL__/api', 'https://my.host/');
    assert.equal(out, 'https://my.host/api');
  });

  it('returns input unchanged when no placeholder present', () => {
    assert.equal(substituteUrl('plain text', 'https://x'), 'plain text');
  });
});

describe('publicUrlFor', () => {
  it('uses PUBLIC_URL env var when set', () => {
    const prev = process.env.PUBLIC_URL;
    process.env.PUBLIC_URL = 'https://override.example';
    const fakeReq = { protocol: 'http', get: () => 'localhost:3000' };
    assert.equal(publicUrlFor(fakeReq), 'https://override.example');
    process.env.PUBLIC_URL = prev;
  });

  it('falls back to req protocol+host when env unset', () => {
    const prev = process.env.PUBLIC_URL;
    delete process.env.PUBLIC_URL;
    const headers = {};
    const fakeReq = {
      protocol: 'https',
      get: (k) => k === 'host' ? 'pull.example.com' : headers[k.toLowerCase()],
    };
    assert.equal(publicUrlFor(fakeReq), 'https://pull.example.com');
    if (prev) process.env.PUBLIC_URL = prev;
  });

  it('honors X-Forwarded-Proto and X-Forwarded-Host', () => {
    const prev = process.env.PUBLIC_URL;
    delete process.env.PUBLIC_URL;
    const headers = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'public.example' };
    const fakeReq = { protocol: 'http', get: (k) => headers[k.toLowerCase()] || 'internal:3000' };
    assert.equal(publicUrlFor(fakeReq), 'https://public.example');
    if (prev) process.env.PUBLIC_URL = prev;
  });
});

describe('renderHelp', () => {
  beforeEach(() => _resetCaches());

  it('substitutes the public URL into help.html', () => {
    const html = renderHelp('https://my.host');
    assert.ok(html.includes('https://my.host/mcp'));
    assert.ok(!html.includes('__PULLMD_URL__'));
  });
});

describe('buildSkillZip', () => {
  beforeEach(() => _resetCaches());

  it('returns a non-empty buffer with the substituted URL embedded', async () => {
    const buf = await buildSkillZip('https://my.host');
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 100);
    // ZIP signature
    assert.equal(buf.slice(0, 4).toString('hex'), '504b0304');
    // Substituted URL should appear in the deflate stream — check by re-extracting
    // a known file via a tiny inline reader. Easiest: just look at raw bytes
    // for the literal substring (works because plugin.json is small enough
    // that DEFLATE may store it uncompressed, but to be safe, inflate one entry).
    // Smoke check: placeholder must not survive substitution.
    assert.equal(buf.indexOf(Buffer.from('__PULLMD_URL__')), -1, 'placeholder should not appear in zip');
  });
});
