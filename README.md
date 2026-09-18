# Burmese Speech-to-Text Telegram Bot

Send the bot a voice note, video or link. It replies with the text.

Burmese and English, same language in and out. Built for non-technical users on
phones in Myanmar, which is why it's a Telegram bot rather than a website — no
install, no account, no upload UI to learn, and voice notes are something people
already send every day.

## Why a bot

The obvious build is a web app, and the first version of this was one. A bot is
smaller in every dimension that matters:

- **No frontend at all.** Telegram supplies the recording UI, file upload, progress
  indication and downloads. None of it is ours to write, style or keep working on a
  phone.
- **No GPU required.** Nobody watches a spinner in a chat, so transcription can be
  slow. On plain CPU Whisper runs at roughly 1.1× realtime — a two-minute voice note
  comes back in about two minutes, which is a completely ordinary chat latency. That
  removes GPU hosting, quota systems and the abuse risk of an open inference endpoint.
- **No hosting puzzle.** It's a process that polls an API, not a web service. A cheap
  VPS, a free CPU tier or a laptop all work.

With a GPU it's simply faster: an Apple M3 Pro does 4.9× realtime, so a 10-minute
recording finishes in about two minutes.

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Interface | Telegram Bot API via [`python-telegram-bot`](https://python-telegram-bot.org) | Native recording and file handling; async |
| ASR | `transformers` Whisper pipeline | Runs the Burmese fine-tune; chunked long-form |
| Burmese model | [`chuuhtetnaing/whisper-medium-myanmar`](https://huggingface.co/chuuhtetnaing/whisper-medium-myanmar) | Apache-2.0, 12.5% CER in-domain |
| English model | [`openai/whisper-large-v3-turbo`](https://huggingface.co/openai/whisper-large-v3-turbo) | MIT, fast and strong |
| Audio | `ffmpeg` piped to raw PCM | Any container in, 16 kHz mono float32 out |
| Links | `yt-dlp` | Audio-only download |
| Translation | Google Translate link-out | No model, no API key, no cost |

Five Python dependencies. Both models are permissively licensed, so nothing here
restricts commercial use.

```
transcriber.py   framework-agnostic core: decode, transcribe, normalise
bot.py           Telegram handlers and all user-facing Burmese
```

`transcriber.py` knows nothing about Telegram — it raises typed exceptions
(`MediaTooLong`, `NoAudio`, `EmptyTranscript`, `DownloadFailed`) carrying data, and
`bot.py` decides the wording. Putting a different interface in front of it means
writing a new caller, not touching the core.

## Accuracy

The model card advertises ~49% **word** error rate, which sounds disqualifying and is
misleading — Burmese isn't consistently word-spaced, so WER punishes segmentation
choices a reader wouldn't notice.

Measured directly on five held-out OpenSLR-80 clips, **character error rate is 12.5%**:

```
REF: ကျနော်တို့ ကတော့ အားလုံး ကို ထိုင်ကြည့်နေမှာ မဟုတ်ဘူး
HYP: ကျနော်တို့ ကတော့ အားလုံး ကို ထိုင်းကြည့်နေမှာ မဟုတ်ဘူး   (2.1% CER)
```

Two caveats. That's **in-domain** — OpenSLR-80 is the corpus this model was fine-tuned
on, and it's clean read-aloud studio audio; real phone recordings will be worse. And
it stays a first draft for a human to correct, not a transcript to rely on where a
mistake matters.

### Never set `no_repeat_ngram_size`

Whisper encodes Burmese as multi-token UTF-8 **byte** sequences. Blocking repeated
n-grams stops the model completing those sequences, so it emits invalid UTF-8 that
decodes to `�` mojibake:

| generation settings | CER | corrupt chars |
| --- | --- | --- |
| `language` + `task` only | **12.5%** | 0 |
| plus `no_repeat_ngram_size=4` | 70.4% | 34 |

It looks like a sensible hallucination guard and it silently destroys the output. The
`generate_kwargs` in `transcribe()` are deliberately minimal.

## Telegram's limits

Two caps are enforced by Telegram, not by this code:

- **20 MB downloads.** A bot cannot fetch a larger file from the cloud Bot API. Voice
  notes are tiny (Opus, ~1 MB/minute) so audio is never a problem; long *videos* will
  be refused, and the bot tells users in Burmese to send audio instead. Running a
  [local Bot API server](https://github.com/tdlib/telegram-bot-api) removes the cap.
- **4,096 characters per message.** Longer transcripts are sent as `transcript.txt`
  instead. The API rejects an over-long message outright rather than truncating it.

Media longer than `MAX_MEDIA_SECONDS` (default 10 minutes) is refused before any
decoding happens.

## Translation

There is no translation model. A transcript under 1,500 characters gets an inline
button that opens Google Translate with the text pre-filled, in whichever direction
makes sense.

This is deliberate. Running translation in-process meant shipping NLLB-200: 2.4 GB of
download, GPU time spent whether or not anyone wanted it, and a CC-BY-NC licence that
made the whole project non-commercial. There's no free server-side alternative worth
having either — Google's official API is paid, the unofficial scrapers get IP-banned
from datacentre ranges, and LibreTranslate has no Burmese model at all.

## Running it

Requires Python 3.10+ and `ffmpeg`.

```bash
# macOS
brew install ffmpeg
# Debian/Ubuntu
sudo apt install ffmpeg

python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

export TELEGRAM_BOT_TOKEN="..."   # from @BotFather
python bot.py
```

Talk to [@BotFather](https://t.me/botfather) on Telegram, send `/newbot`, and it gives
you the token.

On first run the app downloads ~3 GB for the Burmese model; the English model is
fetched lazily the first time someone selects it. To try the plumbing without that,
point it at tiny models:

```bash
BURMESE_ASR_MODEL=chuuhtetnaing/whisper-tiny-myanmar \
ENGLISH_ASR_MODEL=openai/whisper-tiny \
python bot.py
```

### Configuration

| Variable | Default |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | *(required)* |
| `BURMESE_ASR_MODEL` | `chuuhtetnaing/whisper-medium-myanmar` |
| `ENGLISH_ASR_MODEL` | `openai/whisper-large-v3-turbo` |
| `MAX_MEDIA_SECONDS` | `600` |

## Testing

```bash
python test_transcriber.py
```

Stubs torch and transformers, so it runs in seconds with no model downloads, and
covers what the models aren't responsible for: ffmpeg probing and decoding, Unicode
normalisation, the duration and empty-transcript guards, and error typing. Needs
`ffmpeg` on PATH. 13 checks; exits non-zero on failure.

It does **not** cover transcription quality — that needs real weights and real Burmese
audio. Check that by hand: send a Burmese voice note and confirm the reply is readable
Burmese rather than boxes; send a video with no audio track; send something over ten
minutes; and send a file over 20 MB. All four should come back with a Burmese message
rather than silence.

## Design notes

**Concurrency.** Transcription is blocking and CPU/GPU bound, so it runs in a worker
thread via `asyncio.to_thread` — otherwise one long recording would freeze the bot for
everyone. A semaphore limits it to one at a time, since parallel transcriptions would
thrash a single device and can exhaust memory. Other users queue.

**Models load lazily** and are cached for the process lifetime, so a Burmese-only
deployment never pays for the English weights.

**Chunking.** Whisper only sees 30-second windows; `stride_length_s=5` overlaps them so
the pipeline can stitch neighbours without dropping words at the seams, and
`batch_size=8` processes them in parallel. Transformers warns that chunked long-form is
"experimental" for seq2seq models and suggests the sequential algorithm instead —
sequential is somewhat more accurate but can't batch, which matters much more on CPU.

**Unicode, not Zawgyi.** Output is standard Unicode Myanmar by construction: the models
were trained on Unicode and their tokenisers only produce Unicode codepoints. There's
no conversion step because there's nothing to convert.

**Why not faster-whisper / CTranslate2.** Everything goes through `transformers` so the
same code runs on CUDA, Apple Metal and CPU without a second runtime. If throughput
becomes a problem, reach for torch-native quantisation first.

## Limitations

- Burmese accuracy on noisy real-world audio is unmeasured.
- Link downloads are unreliable — YouTube and similar block datacentre IPs, so a
  hosted bot will often fail where a laptop succeeds. Sending the file directly always
  works.
- No speaker labels and no timestamps.
- Transcripts over 1,500 characters get no translate button; the text has to be copied
  into Google Translate by hand.

## License

[MIT](LICENSE). The models carry their own permissive licences (Apache-2.0 and MIT).
