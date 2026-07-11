FROM python:3.12-slim

LABEL org.opencontainers.image.title="PullMD Docling sidecar"
LABEL org.opencontainers.image.description="Docling high-quality/complex-document converter sidecar for PullMD."
LABEL org.opencontainers.image.source="https://github.com/AeternaLabsHQ/pullmd"
LABEL org.opencontainers.image.url="https://github.com/AeternaLabsHQ/pullmd"
LABEL org.opencontainers.image.documentation="https://github.com/AeternaLabsHQ/pullmd#readme"
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"
LABEL org.opencontainers.image.vendor="Aeterna Labs"

# libgl1/libglib2.0-0: required by opencv (a transitive docling/OCR dependency).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash app

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=app:app app.py limits.py .

USER app

# Prefetch docling's layout/OCR model weights into the image so the first
# real conversion isn't stuck downloading them (and works offline). Must run
# as the app user so the cache lands under its own $HOME, where the sidecar
# will look for it at request time.
RUN docling-tools models download

EXPOSE 8004

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8004"]
