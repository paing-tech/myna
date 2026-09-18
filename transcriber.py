"""Speech-to-text core: media file in, same-language transcript out.

Deliberately free of any bot or web framework -- `bot.py` is the only caller
today, but nothing here knows that. Errors are raised as typed exceptions
carrying data, never user-facing prose; presenting them is the caller's job.
"""

from __future__ import annotations

import functools
import json
import logging
import os
import re
import subprocess
import unicodedata
from pathlib import Path

import numpy as np
import torch
from transformers import pipeline

log = logging.getLogger(__name__)

MODELS = {
    "my": os.getenv("BURMESE_ASR_MODEL", "chuuhtetnaing/whisper-medium-myanmar"),
    "en": os.getenv("ENGLISH_ASR_MODEL", "openai/whisper-large-v3-turbo"),
}

SAMPLE_RATE = 16_000
CHUNK_LENGTH_S = 30  # Whisper's native window
STRIDE_LENGTH_S = 5  # overlap per side, used to stitch chunks back together
BATCH_SIZE = 8
MAX_MEDIA_SECONDS = int(os.getenv("MAX_MEDIA_SECONDS", 10 * 60))


class TranscriptionError(Exception):
    """Base for failures the caller is expected to report to a user."""


class MediaTooLong(TranscriptionError):
    def __init__(self, seconds: float) -> None:
        super().__init__(f"{seconds:.0f}s exceeds the {MAX_MEDIA_SECONDS}s limit")
        self.seconds = seconds


class NoAudio(TranscriptionError):
    """The file has no decodable audio track."""


class EmptyTranscript(TranscriptionError):
    """The model returned nothing usable."""


class DownloadFailed(TranscriptionError):
    """yt-dlp could not fetch the URL."""


# --------------------------------------------------------------------------
# Model loading
# --------------------------------------------------------------------------


def _select_device() -> tuple[str, torch.dtype]:
    if torch.cuda.is_available():
        return "cuda", torch.float16
    # Apple Silicon. fp16 still trips NaNs in some MPS attention kernels, so
    # stay in fp32 -- a medium Whisper fits comfortably in unified memory.
    if torch.backends.mps.is_available():
        return "mps", torch.float32
    return "cpu", torch.float32


DEVICE, DTYPE = _select_device()


@functools.lru_cache(maxsize=len(MODELS))
def _asr(language: str):
    """Load a Whisper pipeline on first use and keep it for the process life."""
    model_id = MODELS[language]
    log.info("loading %s on %s (%s)", model_id, DEVICE, DTYPE)
    pipe = pipeline(
        "automatic-speech-recognition", model=model_id, dtype=DTYPE, device=DEVICE
    )
    # Fine-tuned checkpoints often bake forced_decoder_ids into the generation
    # config, which collides with passing `language` explicitly.
    pipe.model.generation_config.forced_decoder_ids = None
    return pipe


def preload(language: str) -> None:
    """Warm a model ahead of the first request."""
    _asr(language)


# --------------------------------------------------------------------------
# Media handling
# --------------------------------------------------------------------------


def probe_duration(path: str | Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(json.loads(result.stdout)["format"]["duration"])


def decode_audio(path: str | Path) -> np.ndarray:
    """Decode any media file to a mono 16 kHz float32 waveform.

    Piped straight out of ffmpeg as raw PCM, which avoids a temporary wav file
    and means Whisper never has to resample.
    """
    try:
        result = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(path),
             "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE),
             "-f", "f32le", "-"],
            capture_output=True, check=True,
        )
    except subprocess.CalledProcessError as exc:
        raise NoAudio(exc.stderr.decode("utf-8", "replace")[:200]) from exc

    audio = np.frombuffer(result.stdout, dtype=np.float32)
    if not audio.size:
        raise NoAudio("decoded zero samples")
    return audio


def download_media(url: str, workdir: str | Path) -> Path:
    """Fetch a video from a public URL with yt-dlp."""
    import yt_dlp

    workdir = Path(workdir)
    options = {
        "outtmpl": str(workdir / "download.%(ext)s"),
        "format": "bestaudio/best",  # only the audio track is ever used
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            ydl.extract_info(url, download=True)
    except Exception as exc:  # noqa: BLE001 -- yt-dlp raises many types
        raise DownloadFailed(str(exc)[:200]) from exc

    # prepare_filename() reports the pre-merge name, which is wrong whenever
    # yt-dlp muxes separate streams into a new container.
    files = sorted(workdir.glob("download.*"), key=lambda p: p.stat().st_size)
    if not files:
        raise DownloadFailed("yt-dlp produced no file")
    return files[-1]


# --------------------------------------------------------------------------
# Transcription
# --------------------------------------------------------------------------


def normalize(text: str) -> str:
    """Whisper emits Unicode Myanmar codepoints; NFC-normalise and tidy spacing."""
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def transcribe(path: str | Path, language: str) -> str:
    """Transcribe a media file into text of the same language.

    Raises MediaTooLong, NoAudio or EmptyTranscript. Blocking and CPU/GPU
    bound -- async callers should run it in a worker thread.
    """
    if language not in MODELS:
        raise ValueError(f"unsupported language {language!r}")

    duration = probe_duration(path)
    if duration > MAX_MEDIA_SECONDS:
        raise MediaTooLong(duration)

    audio = decode_audio(path)
    result = _asr(language)(
        {"raw": audio, "sampling_rate": SAMPLE_RATE},
        chunk_length_s=CHUNK_LENGTH_S,
        stride_length_s=STRIDE_LENGTH_S,
        batch_size=BATCH_SIZE,
        return_timestamps=True,
        # Keep this minimal. no_repeat_ngram_size in particular must NOT be set:
        # Whisper emits Burmese as multi-token UTF-8 byte sequences, and blocking
        # repeated n-grams stops it completing them, producing invalid UTF-8.
        # Measured on OpenSLR-80: 12% CER without it, 70% and mojibake with it.
        generate_kwargs={"language": language, "task": "transcribe"},
    )

    text = normalize(result["text"])
    if not text:
        raise EmptyTranscript("model returned no text")
    return text
