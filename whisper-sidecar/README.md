# PullMD Whisper media sidecar

Self-hosted media ingestion: [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
for speech-to-text, [yt-dlp](https://github.com/yt-dlp/yt-dlp) for pulling audio
out of video/audio URLs from any site yt-dlp supports (YouTube, Twitter/X,
TikTok, Vimeo, SoundCloud, podcast pages, …), not just YouTube.

## API

### `POST /v1/audio/transcriptions` — OpenAI-compatible STT

Drop-in for the pullmd Node app's existing STT adapter
(`lib/llm/stt.js`) — no code changes needed, just point env vars at this
sidecar:

```
PULLMD_STT_BASE_URL=http://whisper:8005/v1
PULLMD_STT_API_KEY=local   # any non-empty value; this sidecar doesn't check it
```

Multipart form fields: `file` (required), `model` (accepted, ignored — this
server always uses `WHISPER_MODEL_SIZE`), `response_format`, `language`
(optional ISO 639-1 code; auto-detected when omitted).

Returns `{"text": "...", "duration": <seconds>|null}`.

### `POST /media` — yt-dlp + Whisper for a source URL

Header `X-Source-Url: <url>`, empty body. Downloads the best audio track via
yt-dlp, transcribes it, and returns the same shape as markitdown-sidecar's
`/youtube` so the two are interchangeable fallback sources:

```json
{
  "markdown": "## Transcript\n\n...",
  "title": "...",
  "transcript_status": "ok" | "none",
  "fields": { "channel": "...", "duration": 754, "views": 12345, "published": "20240101" }
}
```

Used by `lib/web.js` as the fallback when a YouTube page has no scrapable
caption track (`transcript_status: none|error` from the markitdown sidecar),
and as the general entry point for non-YouTube media URLs via `?media=whisper`.

`GET /health` → `{"ok": true, "model": "<configured size>"}`.

## SSRF note

`/media` hands a caller-supplied URL to yt-dlp, which makes its own outbound
request — this never passes through the Node app's `lib/ssrf.js` guard. This
sidecar re-implements an equivalent resolve-then-check guard in `ssrf.py`
(blocks loopback/private/link-local/metadata-range addresses) before invoking
yt-dlp. Same TOCTOU caveat as the Node version: it's a best-effort check, not
a network policy engine.

## Config

| Env var | Default | Purpose |
|---|---|---|
| `WHISPER_MODEL_SIZE` | `base` | faster-whisper model size/repo (`tiny`\|`base`\|`small`\|`medium`\|`large-v3`\|HF repo id) |
| `WHISPER_DEVICE` | `cpu` | `cpu` or `cuda` |
| `WHISPER_COMPUTE_TYPE` | `int8` | ctranslate2 compute type (`int8` for CPU, `float16` typical for GPU) |
| `WHISPER_LANGUAGE` | unset (auto-detect) | Force a transcription language |
| `WHISPER_TRANSCRIBE_TIMEOUT` | `600` | Seconds before an in-flight transcription is aborted |
| `WHISPER_MEDIA_FETCH_TIMEOUT` | `600` | Seconds before an in-flight yt-dlp download+transcribe is aborted |
| `WHISPER_MEDIA_MAX_DURATION_SECONDS` | `5400` | Reject media longer than this before downloading |
| `WHISPER_MEDIA_MAX_BYTES` | `314572800` (300 MB) | yt-dlp `max_filesize` for the extracted audio |

Larger `WHISPER_MODEL_SIZE` values are slower and use more memory; `base` is
a reasonable default for a CPU-only deployment.
