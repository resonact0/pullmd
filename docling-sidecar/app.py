"""Docling HTTP sidecar for PullMD: high-quality/complex-document conversion.

Same request/response contract as markitdown-sidecar's /convert so lib/web.js
can treat the two converters as interchangeable engines: POST raw bytes with
an optional X-Filename header, get back {markdown, title}.

Docling trades speed for quality: layout-aware reading order, table structure
recognition, and OCR for scanned pages/images. It is meant as an opt-in
"complex document" mode (?engine=docling), not the default — MarkItDown stays
the default converter because it is faster and has no GPU/model-download
footprint.
"""
import asyncio
import mimetypes
import os
import tempfile
from pathlib import Path
from urllib.parse import unquote

from fastapi import FastAPI, Request, HTTPException

from limits import run_guarded

MAX_BODY_BYTES = 50 * 1024 * 1024  # 50 MB

# Docling conversion (layout model + optional OCR) is much slower than
# markitdown's format parsers, so the default timeout is generous. Still an
# always-on guard against a pathological document pinning the worker.
CONVERT_TIMEOUT = float(os.environ.get("DOCLING_CONVERT_TIMEOUT", "300") or 0)
CONVERT_MEM_MB = int(os.environ.get("DOCLING_MEM_LIMIT_MB", "0") or 0)

# Extensions docling's format registry recognizes out of the box. Anything
# else is rejected up front instead of failing deep inside the child process.
SUPPORTED_EXTENSIONS = {
    ".pdf", ".docx", ".pptx", ".xlsx", ".html", ".htm", ".md", ".csv",
    ".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp", ".xml", ".adoc",
}

app = FastAPI(title="docling-sidecar")


def _guess_extension(mimetype, filename):
    if filename and Path(filename).suffix:
        return Path(filename).suffix.lower()
    if mimetype:
        ext = mimetypes.guess_extension(mimetype.split(";")[0].strip())
        if ext:
            return ext.lower()
    return ""


def _convert_doc(body, suffix):
    """Top-level (picklable) conversion target run inside the guarded child."""
    # Local import: keep the heavy docling/torch import out of the parent
    # uvicorn process entirely, and re-import fresh in every spawned child
    # (see limits.py's _context() for why 'spawn' is required here).
    from docling.document_converter import DocumentConverter

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(body)
        tmp_path = tmp.name
    try:
        converter = DocumentConverter()
        result = converter.convert(tmp_path)
        markdown = result.document.export_to_markdown()
        title = getattr(result.document, "name", None) or None
        return (markdown or "", title)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/convert")
async def convert(request: Request):
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="file too large (max 50 MB)")
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="empty body")
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="file too large (max 50 MB)")

    filename = request.headers.get("x-filename")
    if filename:
        filename = unquote(filename)

    content_type = request.headers.get("content-type")
    mimetype = content_type.split(";")[0].strip() if content_type else None

    suffix = _guess_extension(mimetype, filename)
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"docling cannot handle this document type ({suffix or 'unknown'}); "
                   "falls back to markitdown at the caller",
        )

    try:
        markdown, title = await asyncio.to_thread(
            run_guarded, _convert_doc, (body, suffix),
            timeout=CONVERT_TIMEOUT, mem_mb=CONVERT_MEM_MB,
        )
    except TimeoutError:
        raise HTTPException(status_code=504, detail="conversion timed out")
    except MemoryError:
        raise HTTPException(status_code=413, detail="conversion exceeded the memory limit")
    except RuntimeError as e:  # converter raised inside the child
        raise HTTPException(status_code=422, detail=f"conversion failed: {e}")

    return {"markdown": markdown, "title": title}
