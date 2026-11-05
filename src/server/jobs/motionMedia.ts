import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { MotionSegment } from "@/lib/motionSegments";

async function ffmpeg(args: string[]): Promise<void> {
  const binary = ffmpegPath;
  if (!binary) throw new Error("FFMPEG_UNAVAILABLE");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    let detail = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("MOTION_MEDIA_TIMEOUT")); }, 150_000);
    child.stderr.on("data", (chunk: Buffer) => { detail = (detail + chunk).slice(-1500); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve(); else reject(new Error(`MOTION_MEDIA_INVALID: ${detail}`));
    });
  });
}

/** Accurate cuts, H.264/30fps/AAC and video as stream zero for provider compatibility. */
export async function motionClip(source: Buffer, segment: MotionSegment): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "castora-motion-"));
  try {
    const input = join(dir, "source.mp4"), output = join(dir, "clip.mp4");
    await writeFile(input, source);
    await ffmpeg(["-ss", String(segment.start), "-i", input, "-t", String(segment.duration),
      "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30,setsar=1",
      "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-maxrate", "8M", "-bufsize", "16M", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart", output]);
    const bytes = await readFile(output);
    if (bytes.length > 48 * 1024 * 1024) throw new Error("MOTION_CLIP_TOO_LARGE");
    return bytes;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Decode through EOF: the saved image is the actual last frame, not an early seek frame. */
export async function lastMotionFrame(video: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "castora-last-frame-"));
  try {
    const input = join(dir, "video.mp4"), output = join(dir, "last.jpg");
    await writeFile(input, video);
    await ffmpeg(["-sseof", "-1", "-i", input, "-map", "0:v:0", "-an", "-q:v", "2", "-update", "1", output]);
    return await readFile(output);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
