import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractWeb } from '../lib/web.js';

// Single-fetch: extractWeb makes exactly ONE request per call.
// The Accept header includes text/markdown preference.
function mockFetch(response) {
  let callCount = 0;
  const fn = async (url, opts) => {
    callCount++;
    if (typeof response === 'function') return response(url, opts);
    return response;
  };
  fn.callCount = () => callCount;
  return fn;
}

describe('extractWeb - Cloudflare markdown', () => {
  it('returns Cloudflare markdown when server responds with text/markdown', async () => {
    const fetcher = mockFetch({
      ok: true,
      headers: { get: (h) => h === 'content-type' ? 'text/markdown; charset=utf-8' : null },
      text: async () => '# Hello World\n\nSome content here.',
    });

    const result = await extractWeb('https://example.com/article', { fetch: fetcher });
    assert.ok(result.markdown.includes('# Hello World'));
    assert.equal(result.source, 'cloudflare');
    assert.ok(result.title);
    assert.equal(fetcher.callCount(), 1, 'should make exactly one fetch');
  });
});

describe('extractWeb - Readability fallback', () => {
  it('falls back to Readability when response is HTML', async () => {
    const html = `
      <html><head><title>Test Article</title></head>
      <body>
        <nav>Menu</nav>
        <article><h1>Test Article</h1><p>Main content paragraph that needs to be long enough for the Readability extraction to consider it substantial content worth keeping. This paragraph contains enough text to exceed the minimum threshold for content extraction, ensuring that the Readability algorithm identifies it as the main article body.</p></article>
        <footer>Footer stuff</footer>
      </body></html>
    `;

    const fetcher = mockFetch({
      ok: true,
      headers: { get: (h) => h === 'content-type' ? 'text/html; charset=utf-8' : null },
      text: async () => html,
    });

    const result = await extractWeb('https://example.com/article', { fetch: fetcher });
    assert.ok(result.markdown.includes('Main content paragraph'));
    assert.equal(result.source, 'readability');
    assert.equal(result.title, 'Test Article');
    assert.equal(fetcher.callCount(), 1, 'should make exactly one fetch');
  });

  it('cleans nav but keeps comments when comments=true', async () => {
    const html = `
      <html><head><title>Page</title></head>
      <body>
        <nav>Navigation</nav>
        <article><p>Content</p></article>
        <div class="comments"><p>A comment</p></div>
        <footer>Footer</footer>
      </body></html>
    `;

    const fetcher = mockFetch({
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => html,
    });

    const result = await extractWeb('https://example.com/page', { comments: true, fetch: fetcher });
    assert.ok(!result.markdown.includes('Navigation'), 'nav should be removed');
    assert.ok(result.markdown.includes('A comment'), 'comments should be kept');
    assert.equal(fetcher.callCount(), 1, 'should make exactly one fetch');
  });

  it('does not send Accept: text/markdown when comments=true', async () => {
    const fetcher = mockFetch((url, opts) => {
      assert.ok(!opts?.headers?.Accept?.includes('text/markdown'),
        'should not request markdown when comments=true');
      return {
        ok: true,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => '<html><head><title>T</title></head><body><p>Hi</p></body></html>',
      };
    });

    await extractWeb('https://example.com/page', { comments: true, fetch: fetcher });
  });
});

describe('extractWeb - error handling', () => {
  it('throws when page cannot be fetched', async () => {
    const fetcher = mockFetch({
      ok: false, status: 404,
      headers: { get: () => null },
      text: async () => '',
    });

    await assert.rejects(
      () => extractWeb('https://example.com/missing', { fetch: fetcher }),
      { message: /failed.*404/i }
    );
  });
});

describe('extractWeb - output format', () => {
  it('includes title and domain in header', async () => {
    const html = `
      <html><head>
        <title>Great Article</title>
        <meta property="article:published_time" content="2026-03-15T10:00:00Z">
      </head>
      <body><article><p>Content here</p></article></body></html>
    `;

    const fetcher = mockFetch({
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => html,
    });

    const result = await extractWeb('https://example.com/article', { fetch: fetcher });
    assert.ok(result.markdown.includes('# Great Article'));
    assert.ok(result.markdown.includes('example.com'));
  });
});

describe('extractWeb - Readability fallback for thin content (P1.3)', () => {
  it('uses readability-fallback source when Readability returns too little', async () => {
    // Page with content only in a generic div — Readability often returns <200 chars
    const html = `
      <html><head><title>Sparse Page</title></head>
      <body>
        <div>
          <p>This is the actual content of the page that should be extracted.</p>
          <p>Second paragraph with more content for the extraction pipeline.</p>
          <p>Third paragraph to ensure enough content in the fallback result.</p>
        </div>
      </body></html>
    `;
    const fetcher = mockFetch({
      ok: true,
      status: 200,
      headers: { get: (h) => h === 'content-type' ? 'text/html; charset=utf-8' : null },
      text: async () => html,
    });

    const result = await extractWeb('https://example.com/sparse', { fetch: fetcher });
    assert.ok(result.markdown.includes('actual content'), 'should include page content');
    assert.ok(result.source === 'readability' || result.source === 'readability-fallback',
      'source should be readability or readability-fallback');
  });
});

describe('extractWeb - metadata', () => {
  it('returns metadata object with HTML extraction', async () => {
    const html = `
      <html lang="de">
      <head>
        <title>Metadata Test</title>
        <meta name="description" content="A description">
        <meta name="author" content="Author Name">
        <meta property="og:title" content="OG Test">
      </head>
      <body><article><p>Content paragraph here.</p></article></body>
      </html>
    `;
    const fetcher = mockFetch({
      ok: true,
      status: 200,
      headers: { get: (h) => h === 'content-type' ? 'text/html; charset=utf-8' : null },
      text: async () => html,
    });

    const result = await extractWeb('https://example.com/article', { fetch: fetcher });
    assert.ok(result.metadata, 'should have metadata object');
    assert.equal(result.metadata.title, 'Metadata Test');
    assert.equal(result.metadata.description, 'A description');
    assert.equal(result.metadata.author, 'Author Name');
    assert.equal(result.metadata.ogTitle, 'OG Test');
    assert.equal(result.metadata.language, 'de');
    assert.equal(result.metadata.sourceUrl, 'https://example.com/article');
    assert.equal(result.metadata.statusCode, 200);
  });

  it('returns metadata with Cloudflare markdown path', async () => {
    const fetcher = mockFetch({
      ok: true,
      status: 200,
      headers: { get: (h) => {
        if (h === 'content-type') return 'text/markdown; charset=utf-8';
        return null;
      }},
      text: async () => '# Cloud Title\n\nContent here for testing.',
    });

    const result = await extractWeb('https://example.com/page', { fetch: fetcher });
    assert.ok(result.metadata, 'should have metadata object');
    assert.equal(result.metadata.title, 'Cloud Title');
    assert.equal(result.metadata.sourceUrl, 'https://example.com/page');
  });
});
