"""Fast offline checks for the transcription core.

Stubs torch/transformers so it runs in seconds without downloading models, then
drives the real ffmpeg decode path end to end.

    python test_transcriber.py

Requires ffmpeg on PATH. Does not test transcription quality -- only the
plumbing around the model.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import types
from pathlib import Path
from unittest.mock import MagicMock

# --- stub the heavy deps before importing transcriber ---------------------
_torch = types.ModuleType("torch")
_torch.float16, _torch.float32 = "float16", "float32"
_torch.cuda = types.SimpleNamespace(is_available=lambda: False)
_torch.backends = types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: False))
sys.modules["torch"] = _torch

_tf = types.ModuleType("transformers")


def _fake_pipeline(*_a, **_k):
    pipe = MagicMock()
    pipe.model.generation_config.forced_decoder_ids = None
    return pipe


_tf.pipeline = _fake_pipeline
sys.modules["transformers"] = _tf

sys.path.insert(0, str(Path(__file__).parent))
import transcriber  # noqa: E402

passed = failed = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label} {detail}")


def make_media(path: Path, seconds: int, with_audio: bool = True) -> Path:
    cmd = ["ffmpeg", "-y", "-f", "lavfi",
           "-i", f"testsrc=size=320x240:rate=15:duration={seconds}"]
    if with_audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
                "-c:a", "aac"]
    cmd += ["-c:v", "libx264", "-shortest", str(path)]
    subprocess.run(cmd, check=True, capture_output=True)
    return path


tmpdir = Path(tempfile.mkdtemp(prefix="v2t_test_"))

print("\n[1] text normalisation")
check("collapses runs of spaces", "  " not in transcriber.normalize("a  b   c"))
check("trims blank-line runs", "\n\n\n" not in transcriber.normalize("a\n\n\n\n\nb"))
check("strips surrounding space", transcriber.normalize("  x  ") == "x")
burmese = "မြန်မာ  စာသား"
check("preserves Myanmar text", "မြန်မာ" in transcriber.normalize(burmese))

print("\n[2] ffmpeg decode")
video = make_media(tmpdir / "clip.mp4", 6)
check("probes duration", abs(transcriber.probe_duration(video) - 6.0) < 0.5)

audio = transcriber.decode_audio(video)
check("decodes to float32 mono", audio.dtype.name == "float32" and audio.ndim == 1,
      f"({audio.dtype}, ndim={audio.ndim})")
check("decodes at 16 kHz", abs(len(audio) / transcriber.SAMPLE_RATE - 6.0) < 0.5,
      f"({len(audio) / transcriber.SAMPLE_RATE:.2f}s)")

silent = make_media(tmpdir / "silent.mp4", 3, with_audio=False)
try:
    transcriber.decode_audio(silent)
    check("rejects file with no audio track", False, "(no error raised)")
except transcriber.NoAudio:
    check("rejects file with no audio track", True)

print("\n[3] transcribe()")
transcriber._asr.cache_clear()
transcriber._asr = lambda language: (lambda *a, **k: {"text": "  ဟုတ်ကဲ့  ပါ  "})
check("returns normalised text", transcriber.transcribe(video, "my") == "ဟုတ်ကဲ့ ပါ")

try:
    transcriber.transcribe(video, "fr")
    check("rejects unsupported language", False, "(no error raised)")
except ValueError:
    check("rejects unsupported language", True)

long_clip = make_media(tmpdir / "long.mp4", 4)
original_limit = transcriber.MAX_MEDIA_SECONDS
transcriber.MAX_MEDIA_SECONDS = 2
try:
    transcriber.transcribe(long_clip, "my")
    check("rejects over-long media", False, "(no error raised)")
except transcriber.MediaTooLong as exc:
    check("rejects over-long media", exc.seconds > 2)
transcriber.MAX_MEDIA_SECONDS = original_limit

transcriber._asr = lambda language: (lambda *a, **k: {"text": "   "})
try:
    transcriber.transcribe(video, "my")
    check("rejects empty transcript", False, "(no error raised)")
except transcriber.EmptyTranscript:
    check("rejects empty transcript", True)

print("\n[4] errors are typed, not prose")
check("all errors share a base", all(
    issubclass(e, transcriber.TranscriptionError)
    for e in (transcriber.MediaTooLong, transcriber.NoAudio,
              transcriber.EmptyTranscript, transcriber.DownloadFailed)
))

import shutil  # noqa: E402

shutil.rmtree(tmpdir, ignore_errors=True)
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
