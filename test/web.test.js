import { describe, it, beforeEach, afterEach } from 'node:test';
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

describe('extractWeb - charset detection (#8)', () => {
  // Body padded with enough Latin-1 prose so Readability picks the article
  // up as substantial content (>200 chars). The relevant words (für, Rätsel,
  // über) appear in the headline.
  const ger = (charset) => `<!DOCTYPE html><html lang="de"><head><meta charset="${charset}"><title>Test</title></head><body><article><h1>Forscher finden den wahren Grund für das Aussterben der Neandertaler</h1><p>Das Aussterben der Neandertaler gibt der Wissenschaft seit Langem Rätsel auf. Neue Forschungen liefern überraschende Einsichten über das Überleben in Europa und zeigen, dass die Population stärker betroffen war als bisher angenommen. Die Studie liefert Hinweise auf entscheidende Faktoren für den Niedergang.</p></article></body></html>`;

  function bytesResponse(buffer, contentType) {
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? contentType : null) },
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      // .text() intentionally returns mojibake to prove the fix uses arrayBuffer
      text: async () => buffer.toString('utf-8'),
    };
  }

  it('decodes ISO-8859-1 pages without charset header (winfuture.de case)', async () => {
    const html = ger('iso-8859-1');
    const buf = Buffer.from(html, 'latin1'); // raw Latin-1 bytes
    const result = await extractWeb('https://example.com/de', {
      fetch: async () => bytesResponse(buf, 'text/html'),
    });
    assert.ok(result.markdown.includes('für'), 'für must survive (was f�r before fix)');
    assert.ok(result.markdown.includes('Rätsel'), 'Rätsel must survive (was R�tsel before fix)');
    assert.ok(result.markdown.includes('über'), 'über must survive (was �ber before fix)');
    assert.ok(!result.markdown.includes('�'), 'no replacement char in output');
  });

  it('decodes Windows-1252 pages with smart quotes and em-dash', async () => {
    // 0x93 = „"" curly opening, 0x94 = "" curly closing, 0x97 = — em-dash
    const html = `<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>T</title></head><body><article><h1>Headline</h1><p>This is a test \x93smart quote\x94 \x97 with em-dash. It has enough body text to clear the Readability minimum threshold so the extractor commits to this content rather than falling back to the raw page body. Curly punctuation is the canonical Windows-1252 tell.</p></article></body></html>`;
    const buf = Buffer.from(html, 'latin1');
    const result = await extractWeb('https://example.com/win1252', {
      fetch: async () => bytesResponse(buf, 'text/html'),
    });
    assert.ok(result.markdown.includes('“smart quote”'), 'curly quotes must decode correctly');
    assert.ok(result.markdown.includes('—'), 'em-dash must decode correctly');
    assert.ok(!result.markdown.includes('�'), 'no replacement char in output');
  });

  it('respects charset= in Content-Type header over <meta>', async () => {
    // Document declares utf-8 in <meta> but server says iso-8859-1 — header wins.
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>T</title></head><body><article><h1>Café Pâtisserie Belgique</h1><p>Header-declared charset must take precedence over the in-document meta tag. This paragraph exists to give Readability enough body weight that it commits to the article instead of falling back to the raw page.</p></article></body></html>`;
    const buf = Buffer.from(html, 'latin1');
    const result = await extractWeb('https://example.com/fr', {
      fetch: async () => bytesResponse(buf, 'text/html; charset=iso-8859-1'),
    });
    assert.ok(result.markdown.includes('Café'), 'header charset wins → Café decoded as Latin-1');
    assert.ok(result.markdown.includes('Pâtisserie'));
  });

  it('keeps UTF-8 pages working (regression guard)', async () => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>T</title></head><body><article><h1>Über schöne Wörter</h1><p>Standardfall: UTF-8 Bytes mit deutschen Umlauten, weiterhin korrekt dekodiert wie zuvor. Der Absatz ist lang genug, damit Readability ihn als Hauptinhalt erkennt und nicht auf die Roh-HTML-Variante zurückfällt — Standard-Pfad bleibt unangetastet.</p></article></body></html>`;
    const buf = Buffer.from(html, 'utf-8');
    const result = await extractWeb('https://example.com/utf8', {
      fetch: async () => bytesResponse(buf, 'text/html'),
    });
    assert.ok(result.markdown.includes('Über'));
    assert.ok(result.markdown.includes('schöne'));
    assert.ok(result.markdown.includes('Wörter'));
    assert.ok(!result.markdown.includes('�'));
  });

  it('honors UTF-8 BOM when no header or meta is present', async () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head><body><article><h1>München Wörter</h1><p>Kein expliziter Charset, weder im Header noch im Meta-Tag — die UTF-8-BOM am Anfang muss greifen. Der Absatz ist lang genug für Readability, damit der Extractor diesen Text als Hauptinhalt nimmt und nicht auf die Roh-HTML-Variante zurückfällt.</p></article></body></html>`;
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(html, 'utf-8')]);
    const result = await extractWeb('https://example.com/bom', {
      fetch: async () => bytesResponse(buf, 'text/html'),
    });
    assert.ok(result.markdown.includes('München'));
    assert.ok(!result.markdown.includes('�'));
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

describe('extractWeb orchestrator with playwright fallback', () => {
  let originalPlaywrightUrl;
  beforeEach(() => { originalPlaywrightUrl = process.env.PLAYWRIGHT_URL; });
  afterEach(()  => {
    if (originalPlaywrightUrl === undefined) delete process.env.PLAYWRIGHT_URL;
    else process.env.PLAYWRIGHT_URL = originalPlaywrightUrl;
  });

  // Helper: a minimal HTML payload that yields a low-quality static extraction
  // (no <article>, mostly headings, no paragraph content) — triggers renderDecision
  // predicate (iii) low-quality (<0.5).
  function soupHtml() {
    const heads = Array.from({ length: 20 }, (_, i) => `<h2>H${i}</h2>`).join('');
    return `<!doctype html><html><body>${heads}<p>tiny</p></body></html>`;
  }
  function cleanHtml() {
    const paras = Array.from({ length: 10 }, () =>
      '<p>This is a body paragraph that is comfortably long enough for the metrics regex to match it as a real paragraph.</p>'
    ).join('');
    return `<!doctype html><html><body><article><h1>A real article</h1>${paras}</article></body></html>`;
  }
  function fetchWith(body, ct = 'text/html; charset=utf-8') {
    return async () => {
      const headers = { get: (k) => k.toLowerCase() === 'content-type' ? ct : null };
      return { ok: true, status: 200, headers, text: async () => body };
    };
  }

  it('does not call sidecar on a clean article', async () => {
    let sidecarCalls = 0;
    process.env.PLAYWRIGHT_URL = 'http://playwright:8002/render';
    const result = await extractWeb('https://example.com', {
      fetch: fetchWith(cleanHtml()),
      renderClient: async () => { sidecarCalls++; return cleanHtml(); },
    });
    assert.equal(sidecarCalls, 0);
    assert.notEqual(result.source, 'playwright');
  });

  it('calls sidecar and switches source to playwright when static result is low-quality', async () => {
    process.env.PLAYWRIGHT_URL = 'http://playwright:8002/render';
    let sidecarCalls = 0;
    const result = await extractWeb('https://example.com', {
      fetch: fetchWith(soupHtml()),
      renderClient: async () => { sidecarCalls++; return cleanHtml(); },
    });
    assert.equal(sidecarCalls, 1);
    assert.equal(result.source, 'playwright');
    assert.match(result.metadata.extractorReason, /rendered via playwright/);
  });

  it('falls back to original (degraded) when sidecar throws', async () => {
    process.env.PLAYWRIGHT_URL = 'http://playwright:8002/render';
    const result = await extractWeb('https://example.com', {
      fetch: fetchWith(soupHtml()),
      renderClient: async () => { throw new Error('sidecar down'); },
    });
    assert.notEqual(result.source, 'playwright');
    assert.match(result.metadata.extractorReason, /playwright fallback failed/);
  });

  it('honors render=force on a clean page', async () => {
    process.env.PLAYWRIGHT_URL = 'http://playwright:8002/render';
    let sidecarCalls = 0;
    const result = await extractWeb('https://example.com', {
      fetch: fetchWith(cleanHtml()),
      renderClient: async () => { sidecarCalls++; return cleanHtml(); },
      render: 'force',
    });
    assert.equal(sidecarCalls, 1);
    assert.equal(result.source, 'playwright');
  });

  it('honors render=skip on a low-quality page', async () => {
    process.env.PLAYWRIGHT_URL = 'http://playwright:8002/render';
    let sidecarCalls = 0;
    const result = await extractWeb('https://example.com', {
      fetch: fetchWith(soupHtml()),
      renderClient: async () => { sidecarCalls++; return cleanHtml(); },
      render: 'skip',
    });
    assert.equal(sidecarCalls, 0);
    assert.notEqual(result.source, 'playwright');
  });

  it('emits stage events in order on render path', async () => {
    process.env.PLAYWRIGHT_URL = 'http://playwright:8002/render';
    const events = [];
    await extractWeb('https://example.com', {
      fetch: fetchWith(soupHtml()),
      renderClient: async () => cleanHtml(),
      emit: (stage, data) => events.push({ stage, ...data }),
    });
    const stages = events.map(e => e.stage);
    assert.deepEqual(stages, ['fetching', 'extracting', 'rendering', 'extracting']);
  });

  it('emits only fetching+extracting on no-render path', async () => {
    const events = [];
    await extractWeb('https://example.com', {
      fetch: fetchWith(cleanHtml()),
      emit: (stage, data) => events.push({ stage, ...data }),
    });
    assert.deepEqual(events.map(e => e.stage), ['fetching', 'extracting']);
  });
});

describe('cleanDom CMS-pattern preprocessing', () => {
  function fetchHtml(html) {
    return async () => {
      const headers = { get: (k) => k.toLowerCase() === 'content-type' ? 'text/html' : null };
      return { ok: true, status: 200, headers, text: async () => html };
    };
  }

  it('surfaces readonly <input> value as <code> in markdown', async () => {
    const html = `<!doctype html><html><body><article><h1>API Model</h1>
      ${Array.from({ length: 8 }, () => '<p>This is a paragraph that is comfortably long enough to count as a real paragraph for the metrics regex used in scoring and pickBest decisions.</p>').join('')}
      <p>Copy this slug:</p>
      <input type="text" readonly value="mistral-large-latest">
    </article></body></html>`;
    const result = await extractWeb('https://example.com/api', { fetch: fetchHtml(html) });
    assert.match(result.markdown, /`mistral-large-latest`/);
    assert.doesNotMatch(result.markdown, /<input/);
  });

  it('does not transform editable (non-readonly) inputs', async () => {
    const html = `<!doctype html><html><body><article><h1>Form Demo</h1>
      ${Array.from({ length: 8 }, () => '<p>This is a paragraph that is comfortably long enough to count as a real paragraph for the metrics regex used in scoring and pickBest decisions.</p>').join('')}
      <input type="text" value="user@example.com">
    </article></body></html>`;
    const result = await extractWeb('https://example.com/form', { fetch: fetchHtml(html) });
    assert.doesNotMatch(result.markdown, /`user@example\.com`/);
  });

  it('drops UUID alt-text on images, preserves the link', async () => {
    const html = `<!doctype html><html><body><article><h1>Models</h1>
      ${Array.from({ length: 8 }, () => '<p>This is a paragraph that is comfortably long enough to count as a real paragraph for the metrics regex used in scoring and pickBest decisions.</p>').join('')}
      <img alt="9201fe9b-6130-4cfd-8f50-ee8a757ce553" src="https://cms.example.com/asset/9201fe9b-6130-4cfd-8f50-ee8a757ce553">
    </article></body></html>`;
    const result = await extractWeb('https://example.com/models', { fetch: fetchHtml(html) });
    assert.doesNotMatch(result.markdown, /9201fe9b-6130-4cfd-8f50-ee8a757ce553\]/);
    // Image link itself is still present (the URL contains the UUID; that's fine — only the alt was the noise).
    assert.match(result.markdown, /cms\.example\.com\/asset\/9201fe9b-6130-4cfd-8f50-ee8a757ce553/);
  });

  it('preserves descriptive alt-text on images', async () => {
    const html = `<!doctype html><html><body><article><h1>Photos</h1>
      ${Array.from({ length: 8 }, () => '<p>This is a paragraph that is comfortably long enough to count as a real paragraph for the metrics regex used in scoring and pickBest decisions.</p>').join('')}
      <img alt="A red sunset over mountains" src="https://example.com/photo.jpg">
    </article></body></html>`;
    const result = await extractWeb('https://example.com/photos', { fetch: fetchHtml(html) });
    assert.match(result.markdown, /A red sunset over mountains/);
  });
});
