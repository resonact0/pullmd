"""Playwright HTTP sidecar for PullMD — renders JS-heavy pages on demand."""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from playwright.async_api import async_playwright, TimeoutError as PWTimeout
import importlib.metadata

logging.basicConfig(level=logging.INFO)

# Last updated: 2026-05-02
# Source: https://github.com/WinFuture23/real-world-user-agents
# Update at each release alongside lib/user-agent.js seed pool.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
)
MAX_CONCURRENCY = 4
NAV_TIMEOUT_MS = 15_000
NETWORKIDLE_TIMEOUT_MS = 5_000
HARD_TIMEOUT_S = 20.0

log = logging.getLogger("playwright-sidecar")
state: dict = {"browser": None, "pw": None, "sem": asyncio.Semaphore(MAX_CONCURRENCY)}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    state["pw"] = await async_playwright().start()
    state["browser"] = await state["pw"].chromium.launch(headless=True)
    log.info("playwright launched, chromium ready")
    try:
        yield
    finally:
        await state["browser"].close()
        await state["pw"].stop()


app = FastAPI(title="playwright-sidecar", lifespan=lifespan)


class RenderRequest(BaseModel):
    url: str


@app.get("/health")
def health():
    browser = state.get("browser")
    return {
        "ok": browser is not None,
        "playwright": importlib.metadata.version("playwright"),
        "browser": "chromium" if browser else None,
    }


async def _render(url: str) -> str:
    context = await state["browser"].new_context(user_agent=USER_AGENT)
    try:
        page = await context.new_page()
        await page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
        try:
            await page.wait_for_load_state("networkidle", timeout=NETWORKIDLE_TIMEOUT_MS)
        except PWTimeout:
            log.info("networkidle timeout, returning current DOM: %s", url)
        return await page.content()
    finally:
        await context.close()


@app.post("/render", response_class=PlainTextResponse)
async def render(req: RenderRequest):
    if not req.url:
        raise HTTPException(status_code=400, detail="url field required")

    sem = state["sem"]
    if sem.locked():
        raise HTTPException(status_code=503, detail="render queue saturated", headers={"Retry-After": "5"})

    async with sem:
        try:
            return await asyncio.wait_for(_render(req.url), timeout=HARD_TIMEOUT_S)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail=f"render timeout after {HARD_TIMEOUT_S}s")
        except Exception as exc:
            log.exception("render failed: %s", req.url)
            raise HTTPException(status_code=500, detail=f"render failed: {exc}")
