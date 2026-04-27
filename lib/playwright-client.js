const SIDECAR_TIMEOUT_MS = 25_000;

/**
 * Send a URL to the Playwright sidecar and get back the rendered DOM as HTML.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]  External cancel (e.g. SSE client disconnect)
 * @param {typeof fetch} [opts.fetch]  Injectable for tests
 * @returns {Promise<string>} rendered HTML
 */
export async function renderViaSidecar(url, { signal, fetch: fetchFn = globalThis.fetch } = {}) {
  if (!process.env.PLAYWRIGHT_URL) throw new Error('Playwright sidecar not configured (PLAYWRIGHT_URL env)');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SIDECAR_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  try {
    const res = await fetchFn(process.env.PLAYWRIGHT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Sidecar returned ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
