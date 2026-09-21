import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { playbackFile } from "@/lib/media";

// Serves the audio kept from a link download, so the browser can play it.
// Range requests are required: without them, seeking in the player fails.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const media = playbackFile(id);
  if (!media) return new Response("Not found", { status: 404 });

  const file = media.path;
  const info = await stat(file).catch(() => null);
  if (!info) return new Response("Not found", { status: 404 });

  const range = request.headers.get("range");
  const headers: Record<string, string> = {
    "Content-Type": media.type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=900",
  };

  // "bytes=1000-" or "bytes=1000-2000"
  const match = range?.match(/^bytes=(\d+)-(\d*)$/);
  if (match) {
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (start >= info.size || end < start) {
      return new Response("Range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}` },
      });
    }
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${info.size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, {
    headers: { ...headers, "Content-Length": String(info.size) },
  });
}
