import "server-only";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { promisify } from "node:util";

const run = promisify(execFile);

export const MAX_MEDIA_SECONDS = 60 * 60; // Gemini's limit for one transcription
// Temp files live in RAM on Cloud Run, so the cap doubles as a memory budget
export const MAX_UPLOAD_MB = 100;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const MAX_CONCURRENT_JOBS = 2; // ffmpeg is CPU-heavy; keep a small server responsive

// An error whose message is safe to show the user
export class MediaError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof MediaError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return Response.json({ error: "Transcription failed. Please try again." }, { status: 500 });
}

let activeJobs = 0;

// Runs fn inside a fresh temp folder that is always deleted afterwards,
// and refuses new work when the server is already busy.
export async function runJob<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    throw new MediaError("The server is busy. Please try again in a minute.", 429);
  }
  activeJobs++;
  const dir = await mkdtemp(path.join(tmpdir(), "myna-"));
  try {
    return await fn(dir);
  } finally {
    activeJobs--;
    await rm(dir, { recursive: true, force: true });
  }
}

// Stream the request body to disk (never all in memory), enforcing the size cap
export async function saveUpload(body: ReadableStream<Uint8Array>, dest: string) {
  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_UPLOAD_BYTES) {
        callback(new MediaError(`The file is larger than ${MAX_UPLOAD_MB} MB.`, 413));
      } else {
        callback(null, chunk);
      }
    },
  });
  await pipeline(
    Readable.fromWeb(body as NodeReadableStream<Uint8Array>),
    limit,
    createWriteStream(dest),
  );
}

// Only these sites. Also stops yt-dlp being pointed at internal addresses.
const LINK_HOSTS = ["youtube.com", "youtu.be", "facebook.com", "fb.watch", "instagram.com", "tiktok.com"];

export function parseLink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const allowed = LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  return allowed ? url.toString() : null;
}

// YouTube videos are played through YouTube's own embed, so we never
// download their video track. Returns the video id, or null for other sites.
export function youtubeId(url: string): string | null {
  const { hostname, pathname, searchParams } = new URL(url);
  const host = hostname.toLowerCase().replace(/^www\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = pathname.slice(1);
  else if (host.endsWith("youtube.com")) {
    const [, section, value] = pathname.split("/");
    id = section === "watch" || section === "" ? searchParams.get("v") : value ?? null;
    if (["shorts", "embed", "live", "v"].includes(section)) id = value ?? null;
  }
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
}

// Audio only: the picture would be ~15× larger, slower to fetch, and often
// unavailable from these sites. YouTube shows its video through its own embed.
export async function downloadLink(url: string, dir: string): Promise<string> {
  try {
    await run(
      "yt-dlp",
      [
        "--ignore-config",
        "--no-playlist",
        "--no-progress",
        "-f", "bestaudio/best",
        "--max-filesize", `${MAX_UPLOAD_MB}M`,
        "--match-filter", `duration <= ${MAX_MEDIA_SECONDS}`,
        "-o", path.join(dir, "download.%(ext)s"),
        "--", url,
      ],
      { timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 },
    );
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? "");
    console.error("yt-dlp failed:", stderr || err);
    if (/private|login|sign in|log in|cookies/i.test(stderr)) {
      throw new MediaError("That video is private or needs a login, so it can't be downloaded.");
    }
    throw new MediaError(
      "Couldn't download that link. It may be private, removed, or the site blocked the download. Try uploading the file instead.",
    );
  }

  // yt-dlp exits successfully but writes nothing when --match-filter skips the video
  const file = (await readdir(dir)).find((f) => f.startsWith("download.") && !f.endsWith(".part"));
  if (!file) throw new MediaError(`That video is longer than 1 hour or too large (max ${MAX_UPLOAD_MB} MB).`);
  return path.join(dir, file);
}

// Check the input, then turn it into small mono speech audio for Gemini
export async function extractAudio(input: string, dir: string): Promise<string> {
  let info: { format?: { duration?: string }; streams?: { codec_type?: string }[] };
  try {
    const { stdout } = await run("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type",
      "-of", "json",
      input,
    ]);
    info = JSON.parse(stdout);
  } catch {
    throw new MediaError("That file isn't a video or audio file we can read.");
  }

  if (!info.streams?.some((s) => s.codec_type === "audio")) {
    throw new MediaError("That file has no sound to transcribe.");
  }
  if (Number(info.format?.duration ?? 0) > MAX_MEDIA_SECONDS) {
    throw new MediaError("That recording is longer than 1 hour.");
  }

  // 16 kHz mono Opus at 32 kbps: plenty for speech, ~14 MB per hour
  const output = path.join(dir, "audio.ogg");
  await run(
    "ffmpeg",
    ["-nostdin", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "32k", output],
    { timeout: 10 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 },
  );
  return output;
}

// --- Playback store -------------------------------------------------------
// A link's audio has to outlive the request so the browser can play it back.
// Files live in a temp folder, are served by /api/media/[id], and are deleted
// an hour later.
const PLAYBACK_DIR = path.join(tmpdir(), "myna-playback");
const PLAYBACK_TTL_MS = 15 * 60 * 1000; // short, because these files sit in memory

// Only formats a browser can play, and whose type we can state confidently
const PLAYBACK_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
};

// Returns an id like "3f2a….mp4", or null if the format isn't playable
export async function saveForPlayback(file: string): Promise<string | null> {
  const ext = path.extname(file).toLowerCase();
  if (!PLAYBACK_TYPES[ext]) return null;
  await mkdir(PLAYBACK_DIR, { recursive: true });
  await removeExpiredPlayback();
  const id = `${randomUUID().replace(/-/g, "")}${ext}`;
  await copyFile(file, path.join(PLAYBACK_DIR, id));
  return id;
}

// Resolve an id to a path and type, or null. The id shape check is what
// stops "../../etc/passwd" being used as an id.
export function playbackFile(id: string): { path: string; type: string } | null {
  const match = /^[a-f0-9]{32}(\.[a-z0-9]{2,4})$/.exec(id);
  const type = match ? PLAYBACK_TYPES[match[1]] : undefined;
  return type ? { path: path.join(PLAYBACK_DIR, id), type } : null;
}

async function removeExpiredPlayback() {
  const cutoff = Date.now() - PLAYBACK_TTL_MS;
  const files = await readdir(PLAYBACK_DIR).catch(() => []);
  await Promise.all(
    files.map(async (name) => {
      const file = path.join(PLAYBACK_DIR, name);
      const info = await stat(file).catch(() => null);
      if (info && info.mtimeMs < cutoff) await rm(file, { force: true });
    }),
  );
}
