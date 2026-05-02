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

/**
 * Merge additional fields into a markdown document's leading YAML frontmatter
 * block, or prepend a new block if none exists. Keys that already appear in
 * the existing block are skipped (existing values win), so this is safe to
 * call after `buildFrontmatter` has already produced a block.
 *
 * @param {string} markdown            The markdown text, possibly already prefixed with `---\n...---\n\n`
 * @param {Array<[string, *]>} fields  Ordered key/value pairs to add (null/undefined skipped, dedup'd against existing keys)
 * @returns {string} markdown with the merged frontmatter block
 */
export function mergeFrontmatter(markdown, fields = []) {
  const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---\n+/);
  const existingKeys = new Set();
  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const m = line.match(/^([a-zA-Z_][\w-]*)\s*:/);
      if (m) existingKeys.add(m[1]);
    }
  }

  const lines = fields
    .filter(([k]) => !existingKeys.has(k))
    .map(([k, v]) => formatField(k, v))
    .filter(Boolean);

  if (lines.length === 0) return markdown;

  if (fmMatch) {
    const existing = fmMatch[1];
    const after = markdown.slice(fmMatch[0].length);
    return `---\n${existing}\n${lines.join('\n')}\n---\n\n${after}`;
  }
  return `---\n${lines.join('\n')}\n---\n\n${markdown}`;
}
