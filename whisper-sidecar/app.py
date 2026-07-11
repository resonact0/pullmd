"""Whisper + yt-dlp media sidecar for PullMD.

Two jobs:

1. `POST /v1/audio/transcriptions` — an OpenAI-compatible speech-to-text
   endpoint. Drop-in replacement for a paid STT provider: point
   PULLMD_STT_BASE_URL at this sidecar and lib/llm/stt.js needs no changes.
   The `model` field of the request is accepted (for API compatibility) but
   ignored — this server always transcribes with whatever WHISPER_MODEL_SIZE
   it was started with.

2. `POST /media` — given a source URL (X-Source-Url header), downloads audio
   via yt-dlp (any site yt-dlp supports: YouTube, Twitter/X, TikTok, Vimeo,
   SoundCloud, podcast pages, …) and transcribes it locally. This is the
   fallback used when a page has no existing captions/transcript to scrape,
   and the general-purpose entry point for non-YouTube video/audio URLs.
"""
import asyncio
import mimetypes
import os
import tempfile
from pathlib import Path
from urllib.parse import unquote

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile

from ssrf import SsrfError, assert_url_allowed

MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB, matches the JS-side STT cap
MAX_MEDIA_DOWNLOAD_BYTES = int(os.environ.get("WHISPER_MEDIA_MAX_BYTES", str(300 * 1024 * 1024)))
MAX_MEDIA_DURATION_SECONDS = int(os.environ.get("WHISPER_MEDIA_MAX_DURATION_SECONDS", "5400"))  # 90 min

TRANSCRIBE_TIMEOUT = float(os.environ.get("WHISPER_TRANSCRIBE_TIMEOUT", "600") or 0)
MEDIA_FETCH_TIMEOUT = float(os.environ.get("WHISPER_MEDIA_FETCH_TIMEOUT", "600") or 0)

WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "base")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
WHISPER_LANGUAGE_DEFAULT = os.environ.get("WHISPER_LANGUAGE") or None

app = FastAPI(title="whisper-sidecar")

_model = None
_model_lock = asyncio.Lock()


def _load_model():
    from faster_whisper import WhisperModel
    return WhisperModel(WHISPER_MODEL_SIZE, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE)


async def _get_model():
    # Loaded lazily (not at import time) so `uvicorn app:app --reload` and
    # basic health checks don't pay the model-load cost, and loaded once,
    # not per-request: unlike docling/markitdown's untrusted-document parsing,
    # re-spawning a fresh interpreter + reloading model weights per request
    # would make this sidecar too slow to be useful.
    global _model
    if _model is None:
        async with _model_lock:
            if _model is None:
                _model = await asyncio.to_thread(_load_model)
    return _model


def _suffix_for(filename, content_type):
    if filename and Path(filename).suffix:
        return Path(filename).suffix.lower()
    if content_type:
        ext = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if ext:
            return ext.lower()
    return ".audio"


def _run_transcribe(model, path, language):
    """Consume faster-whisper's lazy segment generator inside the worker thread."""
    segments, info = model.transcribe(path, language=language, vad_filter=True)
    text = " ".join(seg.text.strip() for seg in segments).strip()
    duration = getattr(info, "duration", None)
    return text, duration


@app.get("/health")
def health():
    return {"ok": True, "model": WHISPER_MODEL_SIZE}


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form(None),          # accepted for OpenAI API compatibility, unused
    response_format: str = Form("json"),
    language: str = Form(None),
):
    body = await file.read()
    if len(body) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio too large (max 25 MB)")
    if not body:
        raise HTTPException(status_code=400, detail="empty file")

    suffix = _suffix_for(file.filename, file.content_type)
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(body)
        tmp_path = tmp.name

    try:
        whisper_model = await _get_model()
        try:
            text, duration = await asyncio.wait_for(
                asyncio.to_thread(_run_transcribe, whisper_model, tmp_path, language or WHISPER_LANGUAGE_DEFAULT),
                timeout=TRANSCRIBE_TIMEOUT,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="transcription timed out")
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"transcription failed: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return {"text": text, "duration": duration}


def _yt_dlp_extract_and_download(url, workdir):
    import yt_dlp

    probe_opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True}
    with yt_dlp.YoutubeDL(probe_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    duration = info.get("duration")
    if MAX_MEDIA_DURATION_SECONDS and duration and duration > MAX_MEDIA_DURATION_SECONDS:
        raise ValueError(f"media duration {duration}s exceeds the {MAX_MEDIA_DURATION_SECONDS}s limit")

    outtmpl = os.path.join(workdir, "%(id)s.%(ext)s")
    dl_opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "max_filesize": MAX_MEDIA_DOWNLOAD_BYTES,
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "128"}],
    }
    with yt_dlp.YoutubeDL(dl_opts) as ydl:
        ydl.download([url])

    audio_path = next((os.path.join(workdir, f) for f in os.listdir(workdir) if f.endswith(".mp3")), None)
    if not audio_path:
        raise RuntimeError("yt-dlp did not produce an audio file")

    return audio_path, {
        "title": info.get("title"),
        "channel": info.get("uploader") or info.get("channel"),
        "duration": duration,
        "views": info.get("view_count"),
        "published": info.get("upload_date"),  # yt-dlp's YYYYMMDD string
    }


def _fetch_and_transcribe(url, workdir, whisper_model, language):
    audio_path, meta = _yt_dlp_extract_and_download(url, workdir)
    text, _ = _run_transcribe(whisper_model, audio_path, language)
    return text, meta


@app.post("/media")
async def media(request: Request):
    source_url = request.headers.get("x-source-url") or ""
    if source_url:
        try:
            source_url = unquote(source_url)
        except Exception:
            pass
    if not source_url:
        raise HTTPException(status_code=400, detail="missing X-Source-Url")

    try:
        assert_url_allowed(source_url)
    except SsrfError as e:
        raise HTTPException(status_code=400, detail=str(e))

    language = request.headers.get("x-whisper-language") or WHISPER_LANGUAGE_DEFAULT
    whisper_model = await _get_model()

    with tempfile.TemporaryDirectory() as workdir:
        try:
            text, meta = await asyncio.wait_for(
                asyncio.to_thread(_fetch_and_transcribe, source_url, workdir, whisper_model, language),
                timeout=MEDIA_FETCH_TIMEOUT,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="media fetch/transcription timed out")
        except ValueError as e:  # duration cap, bad URL for yt-dlp, etc.
            raise HTTPException(status_code=422, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"media transcription failed: {e}")

    if text:
        transcript_md = f"## Transcript\n\n{text}\n"
        status = "ok"
    else:
        transcript_md = "## Transcript\n\n_No speech detected in the audio track._\n"
        status = "none"

    return {
        "markdown": transcript_md.strip(),
        "title": meta.get("title") or "Media",
        "transcript_status": status,
        "fields": {
            "channel": meta.get("channel"),
            "duration": meta.get("duration"),
            "views": meta.get("views"),
            "published": meta.get("published"),
        },
    }
