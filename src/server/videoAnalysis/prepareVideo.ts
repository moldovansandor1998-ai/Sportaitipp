import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

/** Small analysis copy of the complete clip. Original asset is never modified. */
export async function prepareAnalysisVideo(video: Buffer): Promise<{ video: Buffer; duration: number }> {
  if (!ffmpegPath) throw new Error("FFMPEG_UNAVAILABLE");
  const dir = await mkdtemp(join(tmpdir(), "castora-analysis-"));
  try {
    const input = join(dir, "input.mp4"), output = join(dir, "analysis.mp4");
    await writeFile(input, video);
    let stderr = "";
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath!, ["-hide_banner", "-y", "-i", input, "-map", "0:v:0", "-an", "-t", "30.1",
        "-vf", "scale=w='min(640,iw)':h=-2", "-r", "24", "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "26", "-maxrate", "1500k", "-bufsize", "3000k", "-movflags", "+faststart", output]);
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("VIDEO_ANALYSIS_TIMEOUT")); }, 45_000);
      child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-20_000); });
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("close", code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error("VIDEO_INVALID")); });
    });
    const match = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
    if (!duration || duration > 30.1) throw new Error("VIDEO_DURATION_LIMIT");
    const analysis = await readFile(output);
    if (analysis.length > 10 * 1024 * 1024) throw new Error("VIDEO_ANALYSIS_TOO_LARGE");
    return { video: analysis, duration };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
