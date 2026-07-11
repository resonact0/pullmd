import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractTextTesseract } from '../lib/llm/ocr-tesseract.js';

// A small "HELLO WORLD" PNG, rendered with a bold sans-serif font for
// reliable OCR.
const HELLO_WORLD_PNG = Buffer.from(
  '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',
  'base64',
);

describe('extractTextTesseract', () => {
  it('recognizes clear text from a real image via the tesseract binary', async () => {
    if (!(await hasTesseract())) return; // environment without tesseract installed
    const text = await extractTextTesseract(HELLO_WORLD_PNG);
    assert.match(text || '', /HELLO/i);
    assert.match(text || '', /WORLD/i);
  });

  it('resolves null (never throws) when TESSERACT_BIN points at a nonexistent binary', async () => {
    const prev = process.env.TESSERACT_BIN;
    process.env.TESSERACT_BIN = '/no/such/tesseract-binary';
    const text = await extractTextTesseract(HELLO_WORLD_PNG);
    assert.equal(text, null);
    if (prev === undefined) delete process.env.TESSERACT_BIN; else process.env.TESSERACT_BIN = prev;
  });

  it('resolves null immediately on an already-aborted signal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const text = await extractTextTesseract(HELLO_WORLD_PNG, { signal: ctrl.signal });
    assert.equal(text, null);
  });
});

async function hasTesseract() {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    try {
      const p = spawn(process.env.TESSERACT_BIN || 'tesseract', ['--version'], { stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
    } catch { resolve(false); }
  });
}
