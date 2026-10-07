import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "ffmpeg-static";
import { expect, it } from "vitest";
import { prepareAnalysisVideo } from "@/server/videoAnalysis/prepareVideo";
it("encodes a full moving clip without modifying its original and rejects overlong clips", async () => {
  const dir = await mkdtemp(join(tmpdir(), "castora-encoding-test-"));
  try {
    const file = join(dir, "clip.mp4");
    execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=24", "-t", "2", "-c:v", "libx264", file]);
    const source = await readFile(file), original = Buffer.from(source);
    const result = await prepareAnalysisVideo(source);
    expect(result.duration).toBeCloseTo(2); expect(result.video.length).toBeGreaterThan(100); expect(source.equals(original)).toBe(true);
    execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=blue:size=64x64:rate=1", "-t", "31", "-c:v", "libx264", file]);
    await expect(prepareAnalysisVideo(await readFile(file))).rejects.toThrow("VIDEO_DURATION_LIMIT");
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60_000);
