import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { assertAllowedUrl } from "@/lib/security/ssrf";

/** Read actual media duration for per-second billing; client duration is untrusted. */
export async function mediaDuration(url: string): Promise<number> {
  assertAllowedUrl(url);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok || !response.body) throw new Error("MEDIA_UNAVAILABLE");
  const limit = 64 * 1024 * 1024;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("MEDIA_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!ffmpegPath || !size) throw new Error("MEDIA_UNAVAILABLE");
  const dir = await mkdtemp(join(tmpdir(), "castora-duration-"));
  try {
    const file = join(dir, "input");
    await writeFile(file, Buffer.concat(chunks));
    let output = "";
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath!, ["-hide_banner", "-i", file, "-t", "0", "-f", "null", "-"]);
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("MEDIA_PROBE_TIMEOUT")); }, 15_000);
      child.stderr.on("data", (c: Buffer) => { output = (output + c.toString()).slice(-12000); });
      child.on("error", e => { clearTimeout(timer); reject(e); });
      child.on("close", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("MEDIA_INVALID")); });
    });
    const match = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    const seconds = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
    if (!seconds || seconds > 300) throw new Error("MEDIA_DURATION_LIMIT");
    return Math.ceil(seconds);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
