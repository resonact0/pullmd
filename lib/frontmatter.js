/**
 * Builds a YAML frontmatter block from extraction metadata.
 *
 * Returns a string like:
 *   ---
 *   title: "..."
 *   url: https://...
 *   source: trafilatura
 *   fetched: 2026-04-25T13:53:00Z
 *   quality: 0.85
 *   ---
 *
 * Skips null/undefined fields. Quotes strings that contain YAML special chars.
 * Dates use ISO 8601 (UTC).
 */

function quoteYamlString(s) {
  if (s == null) return '';
  // Quote when truly ambiguous in YAML 1.2: ": " (key separator), " #" (comment),
  // newlines, quotes/backslashes, leading flow/special chars, or YAML keywords.
  if (
    /: |\t| #|\n|"|'|\\/.test(s) ||
    /^[\s>|!&*?{}[\]@`%-]/.test(s) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(s.trim())
  ) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
  }
  return s;
}

function formatField(key, value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || typeof value === 'boolean') return `${key}: ${value}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return `${key}:\n${value.map(v => `  - ${quoteYamlString(String(v))}`).join('\n')}`;
  }
  return `${key}: ${quoteYamlString(String(value))}`;
}

/**
 * @param {object} metadata    The extraction metadata object
 * @param {object} [opts]
 * @param {string} [opts.source]   The extraction source (cloudflare, trafilatura, readability, reddit, ...)
 * @param {string} [opts.shareId]  Optional share id
 * @returns {string} YAML frontmatter block including the surrounding `---` lines, with trailing newline
 */
export function buildFrontmatter(metadata = {}, { source = null, shareId = null } = {}) {
  const fetched = new Date().toISOString();
  const fields = [
    formatField('title', metadata.title),
    formatField('url', metadata.sourceUrl || metadata.canonical),
    formatField('source', source),
    formatField('fetched', fetched),
    formatField('quality', metadata.quality),
    formatField('author', metadata.author),
    formatField('published', metadata.publishedTime),
    formatField('modified', metadata.modifiedTime),
    formatField('description', metadata.description || metadata.ogDescription),
    formatField('language', metadata.language),
    formatField('image', metadata.ogImage || metadata.twitterImage),
    formatField('site', metadata.ogSiteName),
    formatField('extractor_reason', metadata.extractorReason),
    formatField('share_id', shareId),
  ].filter(Boolean);

  return `---\n${fields.join('\n')}\n---\n\n`;
}
