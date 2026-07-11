FROM python:3.12-slim

LABEL org.opencontainers.image.title="PullMD Whisper media sidecar"
LABEL org.opencontainers.image.description="Whisper (faster-whisper) + yt-dlp media ingestion sidecar for PullMD."
LABEL org.opencontainers.image.source="https://github.com/AeternaLabsHQ/pullmd"
LABEL org.opencontainers.image.url="https://github.com/AeternaLabsHQ/pullmd"
LABEL org.opencontainers.image.documentation="https://github.com/AeternaLabsHQ/pullmd#readme"
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"
LABEL org.opencontainers.image.vendor="Aeterna Labs"

# ffmpeg: required by yt-dlp's audio-extraction postprocessor and by
# faster-whisper's audio decoding.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash app

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=app:app app.py ssrf.py .

USER app
EXPOSE 8005

# Model weights are NOT prefetched at build time (unlike docling): faster-whisper
# downloads them from Hugging Face on first use and caches them in a named
# volume/bind mount at /home/app/.cache — see docker-compose.yml.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8005"]
