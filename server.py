"""Web app: upload or record audio, get same-language text back via Gemini.

The API key stays server-side -- the browser never sees it, and every request
passes through the rate limiter below.
"""

from __future__ import annotations

import logging
import os
import tempfile
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from google import genai
from google.genai import types

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO
)
log = logging.getLogger("server")

MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-transcribe")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", 50 * 1024 * 1024))

# The API key is billed per minute of audio, so an open endpoint is an abuse
# target. These are per-IP and deliberately conservative.
RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", 20))
RATE_LIMIT_WINDOW_S = int(os.getenv("RATE_LIMIT_WINDOW_S", 3600))

LANGUAGE_CODES = {"my": "my-MM", "en": "en-US"}

STATIC = Path(__file__).parent / "static"

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
app = FastAPI(title="Burmese Speech to Text")

_hits: dict[str, deque[float]] = defaultdict(deque)


def _rate_limited(ip: str) -> bool:
    now = time.monotonic()
    hits = _hits[ip]
    while hits and now - hits[0] > RATE_LIMIT_WINDOW_S:
        hits.popleft()
    if len(hits) >= RATE_LIMIT_REQUESTS:
        return True
    hits.append(now)
    return False


def transcribe(audio: bytes, filename: str, mime_type: str, language: str) -> str:
    """Send audio to Gemini and return the transcript."""
    suffix = Path(filename).suffix or ".bin"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(audio)
        tmp.flush()
        uploaded = client.files.upload(file=tmp.name)

    try:
        interaction = client.interactions.create(
            model=MODEL,
            input=[{
                "type": "audio",
                "uri": uploaded.uri,
                "mime_type": uploaded.mime_type or mime_type,
            }],
            generation_config=types.GenerationConfig(
                audio_transcription_config=types.AudioTranscriptionConfig(
                    language_codes=[LANGUAGE_CODES[language]],
                ),
            ),
        )
        return (interaction.output_text or "").strip()
    finally:
        # Don't leave user audio sitting in Google's file store.
        try:
            client.files.delete(name=uploaded.name)
        except Exception:
            log.warning("could not delete uploaded file", exc_info=False)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.post("/api/transcribe")
async def api_transcribe(
    request: Request,
    file: UploadFile = File(...),
    language: str = Form("my"),
) -> JSONResponse:
    if language not in LANGUAGE_CODES:
        raise HTTPException(400, "unsupported language")

    ip = (request.client.host if request.client else "unknown")
    if _rate_limited(ip):
        raise HTTPException(429, "rate_limited")

    audio = await file.read()
    if not audio:
        raise HTTPException(400, "empty_file")
    if len(audio) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "too_large")

    try:
        text = transcribe(audio, file.filename or "audio", file.content_type or "", language)
    except Exception:
        log.exception("transcription failed")
        raise HTTPException(502, "transcription_failed") from None

    if not text:
        raise HTTPException(422, "empty_transcript")
    return JSONResponse({"text": text})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", 8000)))
