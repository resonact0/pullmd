import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { captionImage } from '../lib/llm/vision.js';

const save = () => ({ k: process.env.PULLMD_VISION_API_KEY, b: process.env.PULLMD_VISION_BASE_URL, m: process.env.PULLMD_VISION_MODEL, lk: process.env.PULLMD_LLM_API_KEY });
const restore = (s) => {
  for (const [env, v] of [['PULLMD_VISION_API_KEY', s.k], ['PULLMD_VISION_BASE_URL', s.b], ['PULLMD_VISION_MODEL', s.m], ['PULLMD_LLM_API_KEY', s.lk]]) {
    if (v === undefined) delete process.env[env]; else process.env[env] = v;
  }
};
// Every test below stubs ocrFn explicitly so behavior doesn't depend on
// whether the `tesseract` binary happens to be installed on the machine
// running the tests.
const noOcr = async () => null;
// 1x1 PNG
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f3f0000000049454e44ae426082', 'hex');

describe('captionImage', () => {
  it('returns null when no provider is configured', async () => {
    const s = save(); delete process.env.PULLMD_VISION_API_KEY; delete process.env.PULLMD_LLM_API_KEY;
    assert.equal(await captionImage(PNG, { mimetype: 'image/png', fetch: async () => { throw new Error('should not call'); }, ocrFn: noOcr }), null);
    restore(s);
  });

  it('POSTs a vision chat request and returns markdown + usage + imageSize', async () => {
    const s = save();
    process.env.PULLMD_VISION_API_KEY = 'k'; process.env.PULLMD_VISION_BASE_URL = 'https://vis/v1'; delete process.env.PULLMD_VISION_MODEL; delete process.env.PULLMD_LLM_API_KEY;
    let captured;
    const fetchFn = async (url, opts) => { captured = { url, opts }; return { ok: true, json: async () => ({ model: 'gpt-4o-mini', choices: [{ message: { content: 'A red square.' } }], usage: { prompt_tokens: 100, completion_tokens: 8, total_tokens: 108 } }) }; };
    const r = await captionImage(PNG, { mimetype: 'image/png', fetch: fetchFn, ocrFn: noOcr });
    assert.equal(captured.url, 'https://vis/v1/chat/completions');
    assert.equal(captured.opts.headers.Authorization, 'Bearer k');
    const sent = JSON.parse(captured.opts.body);
    assert.equal(sent.model, 'gpt-4o-mini');
    assert.equal(sent.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,'), true);
    assert.equal(r.markdown, '## Description\n\nA red square.');
    assert.deepEqual(r.usage, { model: 'gpt-4o-mini', prompt_tokens: 100, completion_tokens: 8, total_tokens: 108 });
    assert.equal(r.imageSize, '1x1');
    restore(s);
  });

  it('throws on a non-ok response', async () => {
    const s = save(); process.env.PULLMD_VISION_API_KEY = 'k'; delete process.env.PULLMD_LLM_API_KEY;
    await assert.rejects(() => captionImage(PNG, { mimetype: 'image/png', fetch: async () => ({ ok: false, status: 422, json: async () => ({}) }), ocrFn: noOcr }), /captioning failed/);
    restore(s);
  });

  it('returns null without touching Docker when Ollama-managed but no key is set', async () => {
    const s = save(); delete process.env.PULLMD_VISION_API_KEY; delete process.env.PULLMD_LLM_API_KEY;
    process.env.PULLMD_OLLAMA_MANAGED = 'true';
    assert.equal(await captionImage(PNG, { mimetype: 'image/png', fetch: async () => { throw new Error('should not call'); }, ocrFn: noOcr }), null);
    delete process.env.PULLMD_OLLAMA_MANAGED;
    restore(s);
  });

  it('falls back to image/jpeg data-uri when mimetype is missing', async () => {
    const s = save(); process.env.PULLMD_VISION_API_KEY = 'k'; delete process.env.PULLMD_VISION_BASE_URL; delete process.env.PULLMD_VISION_MODEL; delete process.env.PULLMD_LLM_API_KEY;
    let captured;
    const fetchFn = async (url, opts) => { captured = { url, opts }; return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }; };
    await captionImage(PNG, { fetch: fetchFn, ocrFn: noOcr }); // no mimetype
    assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions'); // default base
    const sent = JSON.parse(captured.opts.body);
    assert.ok(sent.messages[0].content[1].image_url.url.startsWith('data:image/jpeg;base64,'));
    restore(s);
  });

  it('returns Tesseract text directly, without ever calling the vision API, when it finds legible text', async () => {
    const s = save(); process.env.PULLMD_VISION_API_KEY = 'k'; delete process.env.PULLMD_LLM_API_KEY;
    const r = await captionImage(PNG, {
      mimetype: 'image/png',
      fetch: async () => { throw new Error('should not call the vision API'); },
      ocrFn: async () => 'HELLO WORLD',
    });
    assert.deepEqual(r, { markdown: '## Extracted text\n\nHELLO WORLD', usage: null, imageSize: '1x1' });
    restore(s);
  });

  it('falls back to the vision model when Tesseract finds nothing', async () => {
    const s = save(); process.env.PULLMD_VISION_API_KEY = 'k'; delete process.env.PULLMD_LLM_API_KEY;
    const fetchFn = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'A photo.' } }] }) });
    const r = await captionImage(PNG, { mimetype: 'image/png', fetch: fetchFn, ocrFn: noOcr });
    assert.equal(r.markdown, '## Description\n\nA photo.');
    restore(s);
  });

  it('skips Tesseract entirely when PULLMD_OCR_TESSERACT=false', async () => {
    const s = save(); process.env.PULLMD_VISION_API_KEY = 'k'; delete process.env.PULLMD_LLM_API_KEY;
    process.env.PULLMD_OCR_TESSERACT = 'false';
    let ocrCalled = false;
    const fetchFn = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'A photo.' } }] }) });
    await captionImage(PNG, { mimetype: 'image/png', fetch: fetchFn, ocrFn: async () => { ocrCalled = true; return 'text'; } });
    assert.equal(ocrCalled, false);
    delete process.env.PULLMD_OCR_TESSERACT;
    restore(s);
  });
});
