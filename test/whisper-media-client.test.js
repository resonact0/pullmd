import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { convertMediaViaWhisper } from '../lib/whisper-media-client.js';

const okResp = (json) => ({ ok: true, json: async () => json });

describe('convertMediaViaWhisper', () => {
  it('returns null when no URL is configured', async () => {
    const out = await convertMediaViaWhisper('https://x.example/video', { fetch: async () => okResp({}) });
    assert.equal(out, null);
  });

  it('returns null without a sourceUrl', async () => {
    const out = await convertMediaViaWhisper('', { url: 'http://whisper:8005/media', fetch: async () => okResp({}) });
    assert.equal(out, null);
  });

  it('POSTs with X-Source-Url and no body, returns {markdown,title,fields,transcriptStatus}', async () => {
    let captured;
    const fetchFn = async (url, opts) => { captured = { url, opts }; return okResp({
      markdown: '## Transcript\n\nhello world', title: 'A video',
      fields: { channel: 'Some Channel', duration: 120 }, transcript_status: 'ok',
    }); };
    const out = await convertMediaViaWhisper('https://twitter.com/x/status/1', {
      url: 'http://whisper:8005/media', fetch: fetchFn,
    });
    assert.equal(out.title, 'A video');
    assert.equal(out.fields.channel, 'Some Channel');
    assert.equal(out.transcriptStatus, 'ok');
    assert.equal(captured.url, 'http://whisper:8005/media');
    assert.equal(captured.opts.method, 'POST');
    assert.equal(captured.opts.headers['X-Source-Url'], 'https://twitter.com/x/status/1');
    assert.equal(captured.opts.body, undefined);
  });

  it('returns null on a non-ok response', async () => {
    const out = await convertMediaViaWhisper('https://x.example/video', {
      url: 'http://whisper:8005/media', fetch: async () => ({ ok: false, status: 422, json: async () => ({}) }),
    });
    assert.equal(out, null);
  });

  it('returns null when the sidecar throws', async () => {
    const out = await convertMediaViaWhisper('https://x.example/video', {
      url: 'http://whisper:8005/media', fetch: async () => { throw new Error('econnrefused'); },
    });
    assert.equal(out, null);
  });

  it('returns null when the response lacks a markdown string', async () => {
    const out = await convertMediaViaWhisper('https://x.example/video', {
      url: 'http://whisper:8005/media', fetch: async () => okResp({ title: 'x' }),
    });
    assert.equal(out, null);
  });

  it('returns null immediately when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const out = await convertMediaViaWhisper('https://x.example/video', {
      url: 'http://whisper:8005/media',
      signal: ctrl.signal,
      fetch: async () => { throw new Error('should not hang'); },
    });
    assert.equal(out, null);
  });
});
