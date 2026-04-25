import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const ORIGINAL_TRAFILATURA_URL = process.env.TRAFILATURA_URL;

describe('extractWeb with trafilatura sidecar', () => {
  before(() => {
    process.env.TRAFILATURA_URL = 'http://mock-trafilatura/extract';
  });

  after(() => {
    if (ORIGINAL_TRAFILATURA_URL === undefined) delete process.env.TRAFILATURA_URL;
    else process.env.TRAFILATURA_URL = ORIGINAL_TRAFILATURA_URL;
  });

  it('uses trafilatura when readability is thin and trafilatura is substantial', async () => {
    // Re-import to pick up new env var
    const { extractWeb } = await import(`../lib/web.js?nano=${Date.now()}`);

    const thinHtml = '<html><head><title>Promptbook</title></head><body><div class="banner">x</div></body></html>';
    const trafilaturaMd = '# Promptbook\n\n' + 'High-quality content. '.repeat(200);

    const fakeFetch = async (url) => {
      if (url.includes('mock-trafilatura')) {
        return { ok: true, text: async () => trafilaturaMd };
      }
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/html']]),
        text: async () => thinHtml,
      };
    };

    const result = await extractWeb('https://example.com/promptbook', { fetch: fakeFetch });
    assert.equal(result.source, 'trafilatura');
    assert.ok(result.markdown.includes('High-quality content'));
    assert.ok(result.metadata.quality > 0);
    assert.match(result.metadata.extractorReason, /readability fell back to body|readability thin/);
  });

  it('falls back to readability when trafilatura sidecar fails', async () => {
    const { extractWeb } = await import(`../lib/web.js?nano=${Date.now()}`);

    const articleHtml = `<html><head><title>Article</title></head><body><article>${'<p>Real article content.</p>'.repeat(50)}</article></body></html>`;

    const fakeFetch = async (url) => {
      if (url.includes('mock-trafilatura')) {
        throw new Error('connection refused');
      }
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/html']]),
        text: async () => articleHtml,
      };
    };

    const result = await extractWeb('https://example.com/article', { fetch: fakeFetch });
    assert.equal(result.source, 'readability');
    assert.ok(result.markdown.includes('Real article content'));
  });

  it('runs without sidecar configured (TRAFILATURA_URL unset)', async () => {
    delete process.env.TRAFILATURA_URL;
    const { extractWeb } = await import(`../lib/web.js?nano=${Date.now()}`);

    const articleHtml = `<html><head><title>Article</title></head><body><article>${'<p>Article content.</p>'.repeat(40)}</article></body></html>`;

    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'text/html']]),
      text: async () => articleHtml,
    });

    const result = await extractWeb('https://example.com/article', { fetch: fakeFetch });
    assert.equal(result.source, 'readability');
    assert.ok(result.markdown.length > 0);

    process.env.TRAFILATURA_URL = 'http://mock-trafilatura/extract';
  });
});
