"""Trafilatura HTTP sidecar for PullMD."""
from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
import trafilatura

app = FastAPI(title="trafilatura-sidecar")


class ExtractRequest(BaseModel):
    html: str


@app.get("/health")
def health():
    return {"ok": True, "trafilatura": trafilatura.__version__}


@app.post("/extract", response_class=PlainTextResponse)
def extract(req: ExtractRequest):
    if not req.html:
        raise HTTPException(status_code=400, detail="html field required")
    result = trafilatura.extract(
        req.html,
        output_format="markdown",
        include_comments=False,
        include_tables=True,
        include_links=True,
        include_images=True,
        favor_recall=True,
    )
    return result or ""
