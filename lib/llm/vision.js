import { imageSize } from 'image-size';
import { resolveProvider, mapUsage, abortController } from './providers.js';
import { ensureOllamaRunning, noteOllamaActivity, isOllamaManaged } from '../docker/ollama-lifecycle.js';

const TIMEOUT_MS = 60_000;
const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const PROMPT = 'Describe this image. If it contains any readable text (e.g. a screenshot, document, sign, or label), transcribe that text verbatim as Markdown, preserving structure (headings, lists, tables) where visible. If there is no legible text, just give a brief description.';

/**
 * Caption an image via an OpenAI-compatible vision chat endpoint.
 * @returns {Promise<{markdown:string, usage:object|null, imageSize:string|null}|null>}
 *          null when no vision provider is configured (caller degrades).
 */
export async function captionImage(buffer, opts = {}) {
  const { mimetype, fetch: fetchFn = globalThis.fetch } = opts;
  const { apiKey, baseUrl, model } = resolveProvider('VISION');
  if (!apiKey) return null;
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('image too large for captioning (max 20 MB)');

  const base = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const resolvedModel = model || DEFAULT_MODEL;
  // Opt-in: pullmd creates/starts/stops its own Ollama container for this
  // request. Runs before the request timeout below, since a first-time
  // model pull can take minutes — much longer than a single caption call.
  if (isOllamaManaged()) await ensureOllamaRunning(base, { signal: opts.signal, model: resolvedModel });

  const mime = (mimetype || '').startsWith('image/') ? mimetype : 'image/jpeg';
  const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
  let size = null;
  try { const d = imageSize(buffer.subarray(0, 4096)); if (d?.width && d?.height) size = `${d.width}x${d.height}`; } catch { size = null; }

  const { signal, cleanup } = abortController(opts, TIMEOUT_MS);
  try {
    const res = await fetchFn(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: resolvedModel,
        messages: [{ role: 'user', content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: dataUri } },
        ] }],
        max_tokens: 500,
      }),
      signal,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text())?.slice(0, 200) || ''; } catch { detail = ''; }
      throw new Error(`captioning failed (${res.status})${detail ? ': ' + detail : ''}`);
    }
    const data = await res.json();
    const caption = (data?.choices?.[0]?.message?.content || '').trim();
    return {
      markdown: caption ? `## Description\n\n${caption}` : '',
      usage: mapUsage(data?.usage, data?.model || resolvedModel),
      imageSize: size,
    };
  } finally {
    cleanup();
    if (isOllamaManaged()) noteOllamaActivity();
  }
}
