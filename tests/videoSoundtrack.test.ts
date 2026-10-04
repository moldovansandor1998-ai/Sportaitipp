import { describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { addVideoSoundtrack } from "../src/server/jobs/videoSoundtrack";

vi.mock("ffmpeg-static", () => ({ default: "/usr/bin/ffmpeg" }));

async function ffmpeg(args: string[]): Promise<void> {
  const binary = ffmpegPath;
  if (!binary) throw new Error("FFMPEG_UNAVAILABLE");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    child.on("error", reject);
    child.on("close", (code: number | null) => code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`)));
  });
}

describe("Nureta soundtrack", () => {
  it("adds the source video's sound to a silent generated clip without changing frames", async () => {
    const directory = await mkdtemp(join(tmpdir(), "castora-audio-test-"));
    try {
      const silent = join(directory, "silent.mp4");
      const audible = join(directory, "audible.mp4");
      const extracted = join(directory, "extracted.wav");
      await ffmpeg(["-f", "lavfi", "-i", "color=c=black:s=160x90:r=10:d=1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", silent]);
      await ffmpeg(["-f", "lavfi", "-i", "color=c=white:s=160x90:r=10:d=1",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-c:a", "aac", "-shortest", audible]);
      const result = await addVideoSoundtrack(await readFile(silent), { sourceVideo: await readFile(audible) });
      const output = join(directory, "output.mp4");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(output, result);
      await ffmpeg(["-i", output, "-map", "0:a:0", "-t", "0.2", extracted]);
      expect((await readFile(extracted)).length).toBeGreaterThan(1000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
