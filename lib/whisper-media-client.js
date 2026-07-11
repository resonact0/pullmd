const DEFAULT_TIMEOUT_MS = 600_000; // yt-dlp download + transcription can take a while

/**
 * Transcribe a media URL via the whisper sidecar's /media endpoint (yt-dlp
 * download + faster-whisper transcription). Same {markdown,title,fields,
 * transcriptStatus} shape as convertYoutubeViaSidecar, so the two are
 * interchangeable at the call site: this is used both as the fallback when
 * a YouTube page has no scrapable caption track, and as the general
 * entry point for non-YouTube video/audio URLs (?media=whisper).
 *
 * @param {string} sourceUrl
 * @param {object} [opts]
 * @param {string} [opts.url]            sidecar URL (defaults to WHISPER_MEDIA_URL env)
 * @param {AbortSignal} [opts.signal]    caller cancellation
 * @param {typeof fetch} [opts.fetch]    injectable fetch (tests)
 * @returns {Promise<{markdown:string,title:string|null,fields?:object,transcriptStatus?:string}|null>}
 *          null when unconfigured, unreachable, or the conversion failed.
 */
export async function convertMediaViaWhisper(sourceUrl, opts = {}) {
  const base = opts.url || process.env.WHISPER_MEDIA_URL;
  if (!base || !sourceUrl) return null;

  const fetchFn = opts.fetch || globalThis.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const headers = { 'X-Source-Url': sourceUrl };
    const res = await fetchFn(base, { method: 'POST', headers, signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data.markdown !== 'string') return null;
    return {
      markdown: data.markdown,
      title: data.title || null,
      fields: data.fields || {},
      transcriptStatus: data.transcript_status || null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}
