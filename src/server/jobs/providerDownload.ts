import "server-only";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { assertAllowedProviderOutputUrl } from "@/lib/security/ssrf";
import { compactVideoFile } from "./compactVideo";

const MAX_PROVIDER_FILE = 100 * 1024 * 1024;
const MAX_PROVIDER_VIDEO = 256 * 1024 * 1024;

export function isRecoverableVideoStorageError(message: string): boolean {
  return message === "provider file too large" || message.includes("maximum allowed size");
}

/** Bounded, SSRF-protected download. Large videos go to disk before compression. */
export async function downloadProviderFile(
  url: string, provider?: string | null, kind?: string,
): Promise<{ buf: Buffer; contentType: string }> {
  const safe = assertAllowedProviderOutputUrl(url, provider);
  const video = kind === "video";
  const limit = video ? MAX_PROVIDER_VIDEO : MAX_PROVIDER_FILE;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), video ? 120_000 : 60_000);
  let directory: string | undefined;
  try {
    const res = await fetch(safe.toString(), { signal: controller.signal, redirect: "error" });
    if (!res.ok || !res.body) throw new Error(`provider download failed: ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > limit) {
      await res.body.cancel();
      throw new Error("provider file too large");
    }
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    if (video) {
      directory = await mkdtemp(join(tmpdir(), "castora-provider-video-"));
      const input = join(directory, "input.mp4");
      let total = 0;
      const bounded = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          total += chunk.length;
          callback(total > limit ? new Error("provider file too large") : null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
        bounded, createWriteStream(input), { signal: controller.signal });
      clearTimeout(timer);
      const buf = await compactVideoFile(input);
      console.info(JSON.stringify({ scope: "asset.video_compacted", sourceBytes: total, storedBytes: buf.length }));
      return { buf, contentType: buf.length === total ? contentType : "video/mp4" };
    }
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) throw new Error("provider file too large");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return { buf: Buffer.concat(chunks), contentType };
  } finally {
    clearTimeout(timer);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
