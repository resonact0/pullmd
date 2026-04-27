import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { extractMetadata } from './metadata.js';
import { pickBest, qualityScore } from './scoring.js';
import { renderDecision } from './render-decision.js';
import { renderViaSidecar } from './playwright-client.js';

const TRAFILATURA_URL = process.env.TRAFILATURA_URL;
const TRAFILATURA_TIMEOUT_MS = 8_000;

async function runTrafilatura(html, fetchFn = globalThis.fetch) {
  if (!TRAFILATURA_URL) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TRAFILATURA_TIMEOUT_MS);
  try {
    const res = await fetchFn(TRAFILATURA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const nhm = new NodeHtmlMarkdown({
  codeBlockStyle: 'fenced',
  bulletMarker: '-',
});

function extractDate(document) {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="date"]',
    'meta[name="publish_date"]',
    'meta[property="og:published_time"]',
    'time[datetime]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const value = el?.getAttribute('content') || el?.getAttribute('datetime');
    if (value) {
      const d = new Date(value);
      if (!isNaN(d)) {
        return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
      }
    }
  }
  return null;
}

function formatHeader(title, url, date) {
  const domain = new URL(url).hostname.replace(/^www\./, '');
  const now = new Date();
  const fetched = now.toISOString().slice(0, 16).replace('T', ' ');
  let header = `# ${title}\n\n**${domain}** · ${fetched}`;
  if (date) header += ` · ${date}`;
  header += `\n${url}\n\n`;
  return header;
}

const FETCH_TIMEOUT_MS = 15_000;

function withTimeout(fetchFn, timeoutMs = FETCH_TIMEOUT_MS) {
  return async (url, opts = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchFn(url, { ...opts, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

const REMOVE_SELECTORS = [
  'nav', 'header', 'footer', 'aside',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="search"]',
  '.nav', '.navbar', '.menu', '.sidebar', '.breadcrumb', '.breadcrumbs',
  '.search', '.search-form', '.site-header', '.site-footer', '.site-nav',
  '.mega-menu', '.megamenu', '[class*="mega-menu"]', '[class*="megamenu"]',
  '[class*="global-nav"]', '[class*="search-panel"]',
  '#nav', '#header', '#footer', '#sidebar', '#menu',
  '.cookie-banner', '.cookie-notice',
  '.share-buttons', '.social-share', '[class*="share"]',
  '.related-posts', '.recommended',
  '.blog-sidebar', '.mobile-credits', '[id*="blog-name"]',
  '.post-author', '.post-date', '.category-link',
  'style', 'script', 'noscript', 'link', 'meta',
].join(', ');

function cleanDom(document) {
  [...document.querySelectorAll(REMOVE_SELECTORS)].forEach(el => el.remove());
}

async function convertWithReadability(url, html, comments, statusCode, fetchFn) {
  const { document } = parseHTML(html);

  const title = document.querySelector('title')?.textContent?.trim() || new URL(url).hostname;
  const date = extractDate(document);

  const metadata = extractMetadata(html);
  metadata.sourceUrl = url;
  metadata.statusCode = statusCode;

  cleanDom(document);

  // Comments path: skip Readability and Trafilatura, use cleaned body
  if (comments) {
    const contentHtml = document.querySelector('body')?.innerHTML || html;
    const markdown = nhm.translate(contentHtml);
    metadata.quality = qualityScore(markdown, { rawHtml: html });
    return { markdown: formatHeader(title, url, date) + markdown, title, source: 'readability', metadata };
  }

  const reader = new Readability(document);
  const article = reader.parse();

  let readabilityMd;
  let readabilityFellBack = false;
  if (article && article.content && article.content.length >= 200) {
    readabilityMd = nhm.translate(article.content);
  } else {
    const { document: doc2 } = parseHTML(html);
    cleanDom(doc2);
    readabilityMd = nhm.translate(doc2.querySelector('body')?.innerHTML || html);
    readabilityFellBack = true;
  }

  // Run Trafilatura in parallel (sidecar). If unavailable or fails, returns null.
  const trafilaturaMd = await runTrafilatura(html, fetchFn);

  const decision = pickBest(readabilityMd, trafilaturaMd || '', readabilityFellBack);
  const chosenMd = decision.winner === 'trafilatura' ? trafilaturaMd : readabilityMd;
  const source = decision.winner === 'trafilatura'
    ? 'trafilatura'
    : (readabilityFellBack ? 'readability-fallback' : 'readability');

  metadata.quality = qualityScore(chosenMd, { rawHtml: html });
  metadata.extractorReason = decision.reason;

  return {
    markdown: formatHeader(title, url, date) + chosenMd,
    title,
    source,
    metadata,
  };
}

/**
 * Extracts a web page as Markdown via a single HTTP request.
 *
 * Sends Accept: text/markdown to leverage Cloudflare's markdown feature.
 * If the response is markdown, uses it directly. If HTML comes back,
 * reuses that same response for Readability — no second fetch needed.
 */
export async function extractWeb(url, options = {}) {
  const {
    comments = false,
    emit = () => {},
    signal,
    render,                                 // 'force' | 'skip' | undefined
    renderClient = renderViaSidecar,        // injectable for tests
  } = options;
  const rawFetchFn = options.fetch || globalThis.fetch;
  const fetchFn = withTimeout(rawFetchFn);

  const headers = { 'User-Agent': USER_AGENT };
  if (!comments) {
    headers['Accept'] = 'text/markdown, text/html;q=0.9, */*;q=0.8';
  }

  emit('fetching', { url });
  const res = await fetchFn(url, { headers });

  if (!res.ok) {
    throw new Error(`Page fetch failed with status ${res.status}`);
  }

  const statusCode = res.status || 200;
  const ct = res.headers.get('content-type') || '';
  const body = await res.text();

  // Cloudflare returned native markdown
  if (!comments && ct.includes('text/markdown') && body.trim().length >= 20) {
    const titleMatch = body.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;
    const markdown = formatHeader(title, url, null) + body.trim();
    const metadata = {
      title, description: null, canonical: null, author: null,
      publishedTime: null, modifiedTime: null,
      ogTitle: null, ogDescription: null, ogImage: null,
      ogSiteName: null, ogType: null,
      twitterCard: null, twitterTitle: null, twitterDescription: null, twitterImage: null,
      language: null, sourceUrl: url, statusCode,
      quality: qualityScore(body),
    };
    emit('extracting', { source: 'cloudflare' });
    return { markdown, title, source: 'cloudflare', metadata };
  }

  // First pass: static extraction (Readability + Trafilatura + pickBest)
  const result = await convertWithReadability(url, body, comments, statusCode, rawFetchFn);
  emit('extracting', { source: result.source });

  // Decide whether to render via Playwright sidecar
  const decision = renderDecision(result, render);
  if (!decision.yes) return result;

  emit('rendering', { reason: decision.reason });

  // Second pass: render via sidecar, re-extract on rendered HTML
  try {
    const renderedHtml = await renderClient(url, { signal });
    const rendered = await convertWithReadability(url, renderedHtml, comments, statusCode, rawFetchFn);
    rendered.source = 'playwright';
    rendered.metadata.extractorReason = `${decision.reason} → rendered via playwright`;
    emit('extracting', { source: 'playwright' });
    return rendered;
  } catch (err) {
    console.warn('Playwright fallback failed:', err.message);
    const prevReason = result.metadata?.extractorReason || '';
    result.metadata.extractorReason =
      (prevReason ? prevReason + ' | ' : '') + `playwright fallback failed: ${err.message}`;
    return result;
  }
}
