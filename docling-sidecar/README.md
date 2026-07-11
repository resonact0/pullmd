# PullMD Docling sidecar

Converts document **bytes** (PDF, DOCX, PPTX, XLSX, HTML, images, …) to
Markdown via IBM's [Docling](https://github.com/docling-project/docling).

This is the **high-quality/complex-document** engine: layout-aware reading
order, table structure recognition, and OCR for scanned pages or images.
It is opt-in (`?engine=docling` on `/api/file`) and off by default — it is
slower and has a much bigger image (torch + layout/OCR models) than the
default [markitdown-sidecar](../markitdown-sidecar), which handles the
common case.

## API

Same contract as markitdown-sidecar, so `lib/web.js` can swap engines:

- `GET  /health` → `{"ok": true}`
- `POST /convert` — raw file bytes in the body. Optional headers:
  - `Content-Type`: original mimetype (used as an extension hint)
  - `X-Filename`: URI-encoded original file name (extension hint)

  Returns `{"markdown": "...", "title": "..."|null}`. Unsupported file types
  → 422 (the caller falls back to markitdown). Converter failures → 422/504/413.

## Run

```bash
uvicorn app:app --host 0.0.0.0 --port 8004
```

The Docker image prefetches Docling's model weights at build time
(`docling-tools models download`) so the first real request isn't stuck
downloading them. Expect the image to be several GB.

## Resource limits

`DOCLING_CONVERT_TIMEOUT` (seconds, default 300) and `DOCLING_MEM_LIMIT_MB`
(default: unset) bound each conversion, which runs in a disposable child
process (see `limits.py`) so a pathological document can't pin CPU or OOM the
long-lived server.
