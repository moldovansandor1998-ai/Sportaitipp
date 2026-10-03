import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";

/** Pick an early, visible, sharp frame. This avoids using an opening black frame. */
export async function sceneFrame(video: Buffer): Promise<Buffer> {
  const binary = ffmpegPath;
  if (!binary) throw new Error("FFMPEG_UNAVAILABLE");
  const dir = await mkdtemp(join(tmpdir(), "castora-frame-"));
  try {
    const source = join(dir, "source.mp4");
    await writeFile(source, video);
    let best: { score: number; image: Buffer } | undefined;
    for (const second of [0.3, 0.8, 1.5, 2.5, 4]) {
      const destination = join(dir, `frame-${second}.jpg`);
      const code = await new Promise<number>((resolve, reject) => {
        const child = spawn(binary, ["-hide_banner", "-loglevel", "error", "-ss", String(second), "-i", source,
          "-frames:v", "1", "-q:v", "3", "-y", destination]);
        child.on("error", reject);
        child.on("close", (exitCode: number | null) => resolve(exitCode ?? 1));
      });
      if (code !== 0) continue;
      const frame = await readFile(destination).catch(() => null);
      if (!frame) continue;
      const stats = await sharp(frame).resize({ width: 320 }).stats();
      const brightness = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
      const contrast = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0) / 3;
      if (brightness < 28 || contrast < 10) continue;
      // Match the video's opening state: use the first clearly visible frame,
      // instead of a prettier frame several seconds into an action.
      if (brightness >= 45 && contrast >= 20 && (stats.entropy ?? 0) >= 4) return frame;
      const score = contrast + (stats.entropy ?? 0) * 3 - second * 3;
      if (!best || score > best.score) best = { score, image: frame };
    }
    if (!best) throw new Error("NO_VISIBLE_VIDEO_FRAME");
    return best.image;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
