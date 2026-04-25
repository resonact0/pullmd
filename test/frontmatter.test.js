import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrontmatter } from '../lib/frontmatter.js';

describe('buildFrontmatter', () => {
  it('emits a YAML block with delimiters and trailing blank line', () => {
    const out = buildFrontmatter({ title: 'Hello', sourceUrl: 'https://example.com' });
    assert.match(out, /^---\n/);
    assert.match(out, /\n---\n\n$/);
  });

  it('includes title, url, source, quality fields when present', () => {
    const out = buildFrontmatter(
      { title: 'My Article', sourceUrl: 'https://example.com/a', quality: 0.85 },
      { source: 'trafilatura' }
    );
    assert.match(out, /title: My Article/);
    assert.match(out, /url: https:\/\/example\.com\/a/);
    assert.match(out, /source: trafilatura/);
    assert.match(out, /quality: 0\.85/);
  });

  it('skips null and undefined fields', () => {
    const out = buildFrontmatter({ title: 'X', author: null, description: undefined });
    assert.match(out, /title: X/);
    assert.doesNotMatch(out, /author:/);
    assert.doesNotMatch(out, /description:/);
  });

  it('quotes strings containing key-separator pattern (: with space)', () => {
    const out = buildFrontmatter({ title: 'X: a Y' });
    assert.match(out, /title: "X: a Y"/);
  });

  it('does not quote URLs (colon without space)', () => {
    const out = buildFrontmatter({ title: 'X', sourceUrl: 'https://example.com/a' });
    assert.match(out, /url: https:\/\/example\.com\/a/);
  });

  it('quotes strings containing quotes', () => {
    const out = buildFrontmatter({ title: 'He said "hi"' });
    assert.match(out, /title: "He said \\"hi\\""/);
  });

  it('quotes YAML keywords like true/false/null', () => {
    const out = buildFrontmatter({ title: 'true' });
    assert.match(out, /title: "true"/);
  });

  it('emits ISO 8601 fetched timestamp', () => {
    const out = buildFrontmatter({ title: 'X' });
    assert.match(out, /fetched: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('returns an empty-fields-only block when metadata has no useful data', () => {
    const out = buildFrontmatter({});
    // still has fetched timestamp
    assert.match(out, /^---\nfetched: /);
  });

  it('falls back from sourceUrl to canonical when sourceUrl missing', () => {
    const out = buildFrontmatter({ canonical: 'https://canonical.example/' });
    assert.match(out, /url: https:\/\/canonical\.example\//);
  });

  it('uses ogDescription when description is null', () => {
    const out = buildFrontmatter({ description: null, ogDescription: 'OG fallback' });
    assert.match(out, /description: OG fallback/);
  });

  it('includes share_id and source from opts', () => {
    const out = buildFrontmatter({ title: 'X' }, { source: 'reddit', shareId: 'abc12345' });
    assert.match(out, /source: reddit/);
    assert.match(out, /share_id: abc12345/);
  });
});
