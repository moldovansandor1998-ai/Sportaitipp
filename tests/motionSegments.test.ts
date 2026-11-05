import { describe, expect, it } from "vitest";
import { motionCredits, motionPartFromPath, planMotionSegments } from "@/lib/motionSegments";
import { WaveSpeedAdapter } from "@/lib/providers/wavespeed";

describe("long motion coverage and billing", () => {
  it.each([3, 29.9, 30, 30.01, 31, 32.9, 60, 61, 63.6, 299, 300])("covers all %s seconds without gaps or an invalid short tail", seconds => {
    const segments = planMotionSegments(seconds);
    expect(segments[0].start).toBe(0);
    for (const [i, segment] of segments.entries()) {
      expect(segment.duration).toBeGreaterThanOrEqual(3);
      expect(segment.duration).toBeLessThanOrEqual(30);
      if (i) expect(segment.start).toBeCloseTo(segments[i - 1].start + segments[i - 1].duration, 3);
    }
    expect(segments.reduce((sum, item) => sum + item.duration, 0)).toBeCloseTo(seconds, 3);
  });
  it("preserves the entire reported 63.6-second recording", async () => {
    const motionSegments = planMotionSegments(63.6);
    expect(motionSegments).toEqual([{start:0,duration:30},{start:30,duration:30},{start:60,duration:3.6}]);
    expect(motionCredits(motionSegments, false)).toBe(3226);
    expect(await new WaveSpeedAdapter().estimate("character_motion_video", { motionMethod: "anchored", motionSegments, quality: "pro" }))
      .toEqual({ credits: 3226, secondsExpected: 1800 });
    expect(motionPartFromPath("owner/job/0-resz-02-3.mp4")).toEqual({ index: 2, total: 3, sequence: "job" });
  });
  it.each([0, 2.9, 301, NaN, Infinity])("rejects unsupported duration %s before billing", seconds => {
    expect(() => planMotionSegments(seconds)).toThrow("MOTION_DURATION_LIMIT");
  });
});
