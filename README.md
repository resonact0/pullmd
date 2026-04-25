# PullMD

Self-hosted URL-to-Markdown service for humans and AI agents.

PullMD takes any web URL and returns clean, readable Markdown — no
navigation, no ads, no boilerplate. It auto-detects Reddit threads
(with full comment trees), uses Cloudflare's native Markdown when
available, and falls back to Mozilla Readability + Trafilatura for
everything else.

It ships as:

- a **PWA frontend** with dark/paper themes, history, archive, share links
- a **REST API** at `GET /api?url=…`
- an **MCP server** at `POST /mcp` (Streamable-HTTP transport, stateless)
- a **Claude Code skill** as a downloadable zip

Every conversion gets an 8-hex **share id** that works as a stable
live-endpoint: `GET /s/:id` returns the cached markdown and
re-fetches from the source if older than one hour. Use the share id
as a fixed URL that always returns fresh content — useful for
subreddit feeds and similar.

---

## Quick start

```bash
git clone https://github.com/AeternaLabsHQ/pullmd.git
cd pullmd
cp .env.example .env
$EDITOR .env          # set HOST_DOMAIN
docker compose up -d --build
```

The compose file expects an external Traefik network named `proxy`
and routes `https://${HOST_DOMAIN}` to the container. Adjust the
labels in `docker-compose.yml` if you use a different reverse proxy.

For local development without Docker:

```bash
npm install
npm start             # http://localhost:3000
npm test              # node --test
```

---

## Configuration

All variables go in `.env` (copy from `.env.example`):

| Variable               | Required | Purpose                                                                                              |
| ---------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `HOST_DOMAIN`          | yes      | Public hostname without scheme. Used by Traefik routing and as fallback for `PUBLIC_URL`.           |
| `PUBLIC_URL`           | no       | Full public origin embedded in `/help` and the skill zip. Defaults to `https://${HOST_DOMAIN}`.     |
| `REDDIT_CLIENT_ID`     | no       | OAuth credentials for Reddit. Without them, PullMD uses the public JSON API (lower rate limit).     |
| `REDDIT_CLIENT_SECRET` | no       |                                                                                                      |
| `REDDIT_USER_AGENT`    | no       | Reddit requires a unique UA. Default: `PullMD/1.0 (URL-to-Markdown service)`.                       |

`PUBLIC_URL` matters for self-hosting: the help page and downloadable
skill embed it as the canonical endpoint. Set it correctly and your
users get a copy-paste setup that points at *your* instance.

---

## API

| Endpoint               | Returns                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `GET /api?url=…`       | Markdown (or JSON / plain text via `format=`).                                   |
| `GET /s/:id`           | Cached Markdown by share id; refreshes from source if > 1 h old.                 |
| `GET /api/history`     | Recent conversions (JSON).                                                       |
| `GET /api/archive`     | Paginated full archive.                                                          |
| `GET /api/storage`     | Cache size / hit-rate stats.                                                     |
| `GET /api/stats`       | Extraction telemetry (sources, quality, latency).                                |
| `POST /mcp`            | Streamable-HTTP MCP endpoint (3 tools: `read_url`, `get_share`, `list_recent`). |
| `GET /web-reader.zip`  | Claude Code skill bundle, with this instance's URL baked in.                     |
| `GET /help`            | Bilingual user/agent setup guide.                                                |

### `/api` parameters

| Param           | Default | Notes                                                            |
| --------------- | ------- | ---------------------------------------------------------------- |
| `url`           | —       | Required.                                                        |
| `comments`      | `true`  | Include Reddit comments. Ignored for non-Reddit URLs.            |
| `comment_depth` | `3`     | Max nesting depth (1–10).                                        |
| `comment_limit` | `15`    | Max top-level comments.                                          |
| `frontmatter`   | `false` | Prepend YAML metadata.                                           |
| `format`        | `md`    | `text` strips Markdown; `json` returns structured response.      |
| `nocache`       | `false` | Bypass the 1-hour cache.                                         |
| `lang`          | `de`    | Comments-section header language (`de` or `en`).                 |

### Response headers

- `X-Source` — `reddit` · `cloudflare` · `readability` · `trafilatura`
- `X-Quality` — `0.0`–`1.0` extraction confidence
- `X-Share-Id` — the 8-hex permalink id

---

## Cache & TTLs

- **`/api?url=…`** re-fetches from source if the cache row is older than **1 hour**.
- **`/s/:id`** does the same on-demand refresh, so share links double as live endpoints.
- Cache rows are pruned **90 days** after the last write. `/s/:id` hits keep the row alive (since they trigger refresh + write); read-only access does not extend the TTL.
- If the source is unreachable on refresh, the last good snapshot is served — share links keep working even when the original URL dies.

---

## AI-agent integration

Once your instance is running, `https://${HOST_DOMAIN}/help` shows
copy-paste setup boxes for three install paths:

1. **Universal prompt** — drop into any chat agent (ChatGPT, Claude, Gemini, …).
2. **Claude Code skill** — `web-reader.zip`, auto-built with your URL embedded.
3. **MCP server** — point any MCP-capable host at `https://${HOST_DOMAIN}/mcp`.

   ```bash
   claude mcp add --transport http pullmd https://${HOST_DOMAIN}/mcp
   ```

   The MCP server exposes three tools: `read_url`, `get_share`, `list_recent`.

---

## Architecture

- `server.js` — Express app factory (`createApp`) with dependency injection for tests.
- `lib/reddit.js` — Reddit URL normalization, redirect resolution, post + comment extraction.
- `lib/web.js` — General web extraction: tries Cloudflare-Markdown first, then Readability + Trafilatura in parallel, scores both, picks the winner.
- `lib/cache.js` — SQLite cache (`better-sqlite3`) with 90-day TTL and 8-hex share ids.
- `lib/mcp.js` — Stateless MCP server registering the three tools.
- `lib/distrib.js` — Public-URL substitution in `/help` and `/web-reader.zip`.
- `lib/scoring.js` — Quality scoring used to pick between extractors.
- `trafilatura-sidecar/` — Python sidecar (FastAPI) wrapping Trafilatura.
- `public/` — PWA frontend (vanilla JS, dark/paper themes, service worker).
- `skill/web-reader/` — Claude Code skill source (templated with `__PULLMD_URL__`).

---

## License

[GNU AGPL v3](LICENSE) — Copyright © 2026 Aeterna Labs.

PullMD is free software: you can redistribute it and modify it under the
terms of the GNU Affero General Public License as published by the Free
Software Foundation, version 3 or later. If you run a modified version
as a network service, you must make your modifications available to its
users.
