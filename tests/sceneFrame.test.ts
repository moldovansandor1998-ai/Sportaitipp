import { describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { sceneFrame } from "@/server/jobs/sceneFrame";
import { ProviderSubmissionRejectedError } from "@/lib/providers/types";
vi.mock("ffmpeg-static", () => ({ default: "/usr/bin/ffmpeg" }));
async function clip(filter: string, duration = "1") {
  const dir = await mkdtemp(join(tmpdir(), "frame-test-"));
  try {
    const path = join(dir, "source.mp4");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("/usr/bin/ffmpeg", ["-v", "error", "-f", "lavfi", "-i", filter,
        "-t", duration, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", path]);
      child.on("error", reject); child.on("close", code => code === 0 ? resolve() : reject(new Error("fixture")));
    });
    return await readFile(path);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
describe("Scene frame selection", () => {
  it("accepts a dark textured scene instead of treating it as black", async () => {
    const frame = await sceneFrame(await clip("testsrc2=s=160x240:r=10,colorchannelmixer=rr=0.22:gg=0.22:bb=0.22"));
    const stats = await sharp(frame).stats();
    expect(stats.channels.slice(0, 3).reduce((n, c) => n + c.mean, 0) / 3).toBeLessThan(28);
    expect((await sharp(frame).metadata()).format).toBe("jpeg");
  });
  it("rejects an entirely black clip as a definite local rejection", async () => {
    await expect(sceneFrame(await clip("color=c=black:s=160x240:r=10")))
      .rejects.toBeInstanceOf(ProviderSubmissionRejectedError);
  });
  it("falls back to the opening frame for clips shorter than 0.3 seconds", async () => {
    expect((await sceneFrame(await clip("testsrc2=s=160x240:r=10", "0.1"))).length).toBeGreaterThan(100);
  });
});
