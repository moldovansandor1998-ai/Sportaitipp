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

  it("submits an image and a driving video to Kling Pro, and reads the result as video", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) =>
      new Response(JSON.stringify({ data: { id: "prediction-1" } }), { status: 200 }));
    const adapter = new WaveSpeedAdapter();
    const result = await adapter.submit({
      jobId: "j1", jobType: "character_motion_video", idempotencyKey: "attempt-1",
      payload: { videoUrl: "https://example.com/motion.mp4", characterImageUrl: "https://example.com/model.jpg", quality: "pro" },
    });
    expect(result.providerMeta?.endpoint).toBe("kwaivgi/kling-v3.0-pro/motion-control");
    expect(String(send.mock.calls[0][0])).toContain("kling-v3.0-pro/motion-control");
    const body = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ image: "https://example.com/model.jpg", video: "https://example.com/motion.mp4", character_orientation: "video", keep_original_sound: true });
    send.mockImplementationOnce(async () => new Response(JSON.stringify({ data: { status: "completed", outputs: ["https://example.com/result.mp4"] } }), { status: 200 }));
    const output = await adapter.getResult("prediction-1", result.providerMeta, "character_motion_video");
    expect(output.files).toEqual([{ kind: "video", url: "https://example.com/result.mp4" }]);
  });
});
