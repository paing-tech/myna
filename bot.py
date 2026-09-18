"""Telegram bot: send a voice note, video or link -- get the text back.

All user-facing Burmese lives here; `transcriber` raises typed errors and this
module decides how to word them.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from pathlib import Path
from urllib.parse import quote

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Update,
    constants,
)
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

import transcriber

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO
)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("bot")

# Telegram's cloud Bot API will not hand a bot a file larger than this.
MAX_FILE_BYTES = 20 * 1024 * 1024
# sendMessage rejects anything longer outright, so bigger transcripts go as files.
MAX_MESSAGE_CHARS = 4000
# Longer than this and the Google Translate URL stops being reliable.
MAX_TRANSLATE_CHARS = 1500

DEFAULT_LANGUAGE = "my"

# One at a time: concurrent transcriptions would thrash a single GPU and can
# exhaust memory. Everyone else waits their turn.
_gpu_lock = asyncio.Semaphore(1)

WELCOME = (
    "မင်္ဂလာပါ! 🎙️\n\n"
    "အသံ သို့မဟုတ် ဗီဒီယို ပို့ပေးပါ — စာသားအဖြစ် ပြောင်းပေးပါမည်။\n\n"
    "• အသံသွင်းပြီး ပို့နိုင်ပါသည် (မိုက်ခလုတ်ကို ဖိထားပါ)\n"
    "• ဗီဒီယို သို့မဟုတ် အသံဖိုင် တင်နိုင်ပါသည်\n"
    "• လင့်ခ် ပေးပို့နိုင်ပါသည်\n\n"
    "ဘာသာစကား ရွေးရန် — /burmese သို့မဟုတ် /english\n"
    f"ယခု: {{current}}"
)

LANGUAGE_NAMES = {"my": "မြန်မာ 🇲🇲", "en": "English 🇬🇧"}

ERRORS = {
    "too_long": (
        "ဖိုင် ရှည်လွန်းပါသည် ({minutes} မိနစ်)။ "
        "{limit} မိနစ်အောက်သာ လက်ခံနိုင်ပါသည်။ အပိုင်းပိုင်း ဖြတ်ပြီး ပို့ပါ။"
    ),
    "too_big": (
        "ဖိုင် ကြီးလွန်းပါသည်။ Telegram က {limit}MB အထိသာ ခွင့်ပြုပါသည်။\n"
        "ဗီဒီယိုအစား အသံသွင်း၍ ပို့ကြည့်ပါ — အရွယ်အစား များစွာ သေးပါသည်။"
    ),
    "no_audio": "အသံ မတွေ့ပါ။ အသံပါသော ဖိုင် ပို့ပါ။",
    "empty": "စာသား မထုတ်နိုင်ပါ။ အသံ ပိုကြည်လင်အောင် ပြန်ကြိုးစားပါ။",
    "download": (
        "လင့်ခ်မှ ဒေါင်းလုဒ် မရပါ။ "
        "ဖိုင်ကို ဖုန်းထဲ သိမ်းပြီး တိုက်ရိုက် ပို့ကြည့်ပါ။"
    ),
    "unknown": "အမှားတစ်ခု ဖြစ်ပွားပါသည်။ ထပ်မံ ကြိုးစားပါ။",
}


class _UserFacing(Exception):
    """An already-worded message to send straight back to the user."""


def _language(context: ContextTypes.DEFAULT_TYPE) -> str:
    return context.user_data.get("language", DEFAULT_LANGUAGE)


def _translate_markup(text: str, language: str) -> InlineKeyboardMarkup | None:
    """A link-out to Google Translate, when the transcript is short enough."""
    if len(text) > MAX_TRANSLATE_CHARS:
        return None
    target = "en" if language == "my" else "my"
    url = (
        f"https://translate.google.com/?op=translate"
        f"&sl={language}&tl={target}&text={quote(text)}"
    )
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("🌐 ဘာသာပြန်ရန် / Translate", url=url)]]
    )


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    current = LANGUAGE_NAMES[_language(context)]
    await update.message.reply_text(WELCOME.format(current=current))


async def set_language(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    language = "my" if update.message.text.startswith("/burmese") else "en"
    context.user_data["language"] = language
    await update.message.reply_text(
        f"ဘာသာစကား သတ်မှတ်ပြီး: {LANGUAGE_NAMES[language]}"
    )


async def _send_transcript(update: Update, text: str, language: str) -> None:
    if len(text) <= MAX_MESSAGE_CHARS:
        await update.message.reply_text(
            text, reply_markup=_translate_markup(text, language)
        )
        return

    # Longer than sendMessage allows, so the whole transcript goes as a file.
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "transcript.txt"
        path.write_text(text, encoding="utf-8")
        await update.message.reply_document(
            document=path,
            filename="transcript.txt",
            caption="စာသား ရှည်သဖြင့် ဖိုင်အဖြစ် ပို့ပါသည်။",
        )


async def _resolve_source(update: Update, tmp: Path) -> Path:
    """Download whatever the user sent -- attachment or link -- to `tmp`."""
    message = update.message
    attachment = (
        message.voice or message.audio or message.video
        or message.video_note or message.document
    )

    if attachment is None:
        url = (message.text or "").strip()
        return await asyncio.to_thread(transcriber.download_media, url, tmp)

    if (attachment.file_size or 0) > MAX_FILE_BYTES:
        raise _UserFacing(ERRORS["too_big"].format(limit=MAX_FILE_BYTES // 1024 // 1024))

    telegram_file = await attachment.get_file()
    path = tmp / "input"
    await telegram_file.download_to_drive(path)
    return path


async def handle_media(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    language = _language(context)
    notice = await update.message.reply_text("⏳ စာသား ထုတ်နေပါသည်... ခဏစောင့်ပါ")

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            source = await _resolve_source(update, tmp)

            await update.message.chat.send_action(constants.ChatAction.TYPING)
            async with _gpu_lock:
                text = await asyncio.to_thread(transcriber.transcribe, source, language)

        await _send_transcript(update, text, language)

    except _UserFacing as exc:
        await update.message.reply_text(str(exc))
    except transcriber.MediaTooLong as exc:
        await update.message.reply_text(
            ERRORS["too_long"].format(
                minutes=round(exc.seconds / 60),
                limit=transcriber.MAX_MEDIA_SECONDS // 60,
            )
        )
    except transcriber.NoAudio:
        await update.message.reply_text(ERRORS["no_audio"])
    except transcriber.EmptyTranscript:
        await update.message.reply_text(ERRORS["empty"])
    except transcriber.DownloadFailed:
        await update.message.reply_text(ERRORS["download"])
    except Exception:
        log.exception("transcription failed")
        await update.message.reply_text(ERRORS["unknown"])
    finally:
        await notice.delete()


def main() -> None:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    app = Application.builder().token(token).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", start))
    app.add_handler(CommandHandler(["burmese", "english"], set_language))
    app.add_handler(
        MessageHandler(
            filters.VOICE | filters.AUDIO | filters.VIDEO | filters.VIDEO_NOTE
            | filters.Document.ALL | filters.Entity("url"),
            handle_media,
        )
    )

    transcriber.preload(DEFAULT_LANGUAGE)
    log.info("bot ready")
    app.run_polling()


if __name__ == "__main__":
    main()
