import { afterEach, describe, expect, it, vi } from "vitest";
import { WaveSpeedAdapter } from "@/lib/providers/wavespeed";
import { CreateJobSchema } from "@/lib/security/validation";

afterEach(() => vi.restoreAllMocks());

describe("character motion video", () => {
  it("requires a selected character and an owned video asset identifier", () => {
    const noCharacter = CreateJobSchema.safeParse({ type: "character_motion_video", payload: { videoAssetId: crypto.randomUUID() } });
    const noVideo = CreateJobSchema.safeParse({ type: "character_motion_video", characterId: crypto.randomUUID(), payload: {} });
    expect(noCharacter.success).toBe(false);
    expect(noVideo.success).toBe(false);
  });

  it("requires an approved preview reference before anchored motion", () => {
    const invalid = CreateJobSchema.safeParse({ type: "character_motion_video", characterId: crypto.randomUUID(),
      payload: { videoAssetId: crypto.randomUUID(), motionMethod: "anchored" } });
    expect(invalid.success).toBe(false);
  });

  it("submits motion only when given the selected scene image", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) =>
      new Response(JSON.stringify({ data: { id: "prediction-1" } }), { status: 200 }));
    const adapter = new WaveSpeedAdapter();
    const result = await adapter.submit({
      jobId: "j1", jobType: "character_motion_video", idempotencyKey: "attempt-1",
      payload: { videoUrl: "https://example.com/motion.mp4", characterImageUrl: "https://example.com/model.jpg",
        sceneImageUrl: "https://example.com/approved.jpg", motionMethod: "anchored", quality: "pro" },
    });
    expect(result.providerMeta?.stage).toBe("video");
    expect(String(send.mock.calls[0][0])).toContain("motion-control");
    const body = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ image: "https://example.com/approved.jpg", video: "https://example.com/motion.mp4", character_orientation: "video", keep_original_sound: true });
    send.mockImplementationOnce(async () => new Response(JSON.stringify({ data: { status: "completed", outputs: ["https://example.com/result.mp4"] } }), { status: 200 }));
    const output = await adapter.getResult("prediction-1", result.providerMeta, "character_motion_video");
    expect(output.files).toEqual([{ kind: "video", url: "https://example.com/result.mp4" }]);
  });

  it("finishes a preview as an image without submitting motion", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      data: { status: "completed", outputs: ["https://example.com/preview.jpg"] },
    }), { status: 200 }));
    const adapter = new WaveSpeedAdapter();
    expect(await adapter.getStatus("still-1", { stage: "scene_preview" })).toBe("done");
    expect(send).toHaveBeenCalledTimes(1);
    expect((await adapter.getResult("still-1", { stage: "scene_preview" }, "character_motion_video")).files)
      .toEqual([{ kind: "image", url: "https://example.com/preview.jpg" }]);
    expect((await adapter.estimate("character_motion_video", { motionMethod: "scene_preview" })).credits).toBe(40);
  });
});
