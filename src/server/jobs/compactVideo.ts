import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

// Supabase's project upload limit may be 50 MiB even when the bucket has no
// explicit limit. Leave room for metadata and any project-side configuration.
const TARGET_BYTES = 40 * 1024 * 1024;

/** Reduce provider MP4s to a gallery-safe size without regenerating their motion. */
export async function compactVideo(video: Buffer): Promise<Buffer> {
  if (video.length <= TARGET_BYTES) return video;
  const binary = ffmpegPath;
  if (!binary) throw new Error("FFMPEG_UNAVAILABLE");
  const directory = await mkdtemp(join(tmpdir(), "castora-compact-"));
  try {
    const input = join(directory, "input.mp4");
    await writeFile(input, video);
    for (const [index, width, crf] of [[0, 720, 27], [1, 540, 33], [2, 480, 38]]) {
      const output = join(directory, `output-${index}.mp4`);
      await new Promise<void>((resolve, reject) => {
        const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", input,
          "-map", "0:v:0", "-map", "0:a?", "-vf", `scale=w='min(${width},iw)':h=-2`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf),
          "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output];
        const child = spawn(binary, args);
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-1000); });
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`VIDEO_COMPRESSION_FAILED: ${stderr}`)));
      });
      const candidate = await readFile(output);
      if (candidate.length <= TARGET_BYTES) return candidate;
    }
    throw new Error("VIDEO_EXCEEDS_GALLERY_LIMIT_AFTER_COMPRESSION");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
