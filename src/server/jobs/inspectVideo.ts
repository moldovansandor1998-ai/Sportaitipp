import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ffmpegPath from "ffmpeg-static";

/** Verification only: stream presence, duration and a hash of decoded video frames. */
export async function inspectVideo(video: Buffer) {
  if (!ffmpegPath) throw new Error("FFMPEG_UNAVAILABLE");
  const directory = await mkdtemp(join(tmpdir(), "castora-verify-"));
  const file = join(directory, "video.mp4");
  try {
    await writeFile(file, video);
    let stderr = "", stdout = "";
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath!, ["-hide_banner", "-i", file, "-map", "0:v:0", "-f", "hash", "-hash", "sha256", "-"]);
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("VIDEO_INSPECTION_TIMEOUT")); }, 60_000);
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-10_000); });
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("close", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("VIDEO_INSPECTION_FAILED")); });
    });
    const duration = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    return { hasVideo: /Stream.*Video:/.test(stderr), hasAudio: /Stream.*Audio:/.test(stderr),
      durationSeconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null,
      frameHash: stdout.match(/SHA256=([a-f0-9]+)/)?.[1] ?? null };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
