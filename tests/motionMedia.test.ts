import { describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { motionClip, lastMotionFrame } from "@/server/jobs/motionMedia";
vi.mock("ffmpeg-static", () => ({ default: "/usr/bin/ffmpeg" }));
const run = promisify(execFile);

describe("real motion media processing", () => {
  it("cuts the requested interval with audio and extracts the very last frame", async () => {
    const dir = await mkdtemp(join(tmpdir(), "motion-test-"));
    try {
      const source = join(dir,"source.mp4"), output = join(dir,"part.mp4");
      await run("/usr/bin/ffmpeg", ["-v","error","-f","lavfi","-i","color=red:s=360x640:r=60:d=6",
        "-f","lavfi","-i","sine=frequency=440:duration=6","-vf","drawbox=color=blue:t=fill:enable='gte(t,5.9)'",
        "-map","1:a","-map","0:v","-c:v","libx264","-c:a","aac","-shortest",source]);
      await writeFile(output,await motionClip(await readFile(source),{start:3,duration:3}));
      const probe = JSON.parse((await run("ffprobe",["-v","error","-show_streams","-show_format","-of","json",output])).stdout);
      expect(probe.streams[0]).toMatchObject({codec_name:"h264",codec_type:"video",avg_frame_rate:"30/1",pix_fmt:"yuv420p"});
      expect(probe.streams[1]).toMatchObject({codec_name:"aac",codec_type:"audio"});
      expect(Number(probe.format.duration)).toBeCloseTo(3,1);
      const stats = await sharp(await lastMotionFrame(await readFile(output))).stats();
      expect(stats.channels[2].mean).toBeGreaterThan(230);
      expect(stats.channels[0].mean).toBeLessThan(20);
    } finally { await rm(dir,{recursive:true,force:true}); }
  }, 30_000);
});
