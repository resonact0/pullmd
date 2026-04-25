---
name: web-reader
description: "Read any web page as clean Markdown using PullMD. Use this skill whenever you need to fetch, read, extract, or summarize content from a URL or website. This includes when the user says 'read this page', 'what does this URL say', 'fetch this article', 'summarize this link', 'get the content from...', or when you need web content as context for another task. Also use this when WebFetch fails or returns poor results — PullMD produces cleaner Markdown than raw HTML parsing. Do NOT use this for GitHub URLs (use gh CLI instead) or for API endpoints that return JSON."
---

# Web Reader — PullMD Integration

Read web pages as clean, structured Markdown via the self-hosted PullMD service. Falls back gracefully to WebFetch if PullMD is unavailable.

## Why PullMD over WebFetch

PullMD uses Mozilla Readability to extract the actual article content — stripping navigation, ads, sidebars, and footers. The result is clean Markdown that's much easier to work with than the raw HTML that WebFetch returns. For sites behind Cloudflare, PullMD can even get native Markdown directly via Cloudflare's `Accept: text/markdown` feature.

## How to use

### Step 1: Fetch via PullMD

Use Bash to curl the PullMD API. This is preferred over WebFetch because it returns clean Markdown directly:

```bash
curl -s "__PULLMD_URL__/api?url=<URL>"
```

The response is `text/markdown` — ready to use as-is.

**Available parameters:**
- `url` (required) — The page to fetch
- `comments=true` — Include the full page without content filtering (useful for forum threads, comment sections)
- `format=text` — Strip Markdown formatting, return plain text
- `nocache=true` — Bypass the 1-hour cache and fetch fresh content

**Example calls:**

```bash
# Read an article
curl -s "__PULLMD_URL__/api?url=https://example.com/article"

# Read a Reddit post with comments
curl -s "__PULLMD_URL__/api?url=https://reddit.com/r/node/comments/abc/title/&comments=true"

# Get fresh (uncached) content
curl -s "__PULLMD_URL__/api?url=https://example.com/news&nocache=true"
```

### Step 2: Check if it worked

If curl returns valid Markdown (starts with `#` or contains readable text), use that content. The `X-Source` response header tells you which extraction method was used:
- `cloudflare` — Native Markdown from Cloudflare
- `readability` — Extracted via Mozilla Readability + Turndown
- `reddit` — Reddit JSON API extraction

### Step 3: Fallback to WebFetch

If PullMD fails (network error, timeout, empty response), fall back to the built-in WebFetch tool:

```
WebFetch(url="<URL>", prompt="Extract the main content of this page")
```

This still works but produces noisier output since it processes raw HTML.

## Decision flow

```
Need to read a web page?
├── Is it a GitHub URL? → Use `gh` CLI instead
├── Is it a JSON API? → Use curl/fetch directly
└── It's a regular web page:
    ├── Try: curl PullMD API
    │   ├── Success (got Markdown) → Use it
    │   └── Failed (error/timeout/empty) → Fallback below
    └── Fallback: WebFetch tool
```

## Tips

- PullMD caches results for 1 hour. Use `nocache=true` if you need the latest version.
- For pages with important comments or discussions (forums, HN, Reddit), add `comments=true` to skip content filtering and get everything.
- The `/api/history` endpoint shows recent conversions — useful for checking what's been fetched: `curl -s "__PULLMD_URL__/api/history?limit=5"`
- Reddit URLs are automatically detected and use a specialized extraction pipeline that handles posts, comments, galleries, and videos.
