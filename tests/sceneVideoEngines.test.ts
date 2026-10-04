import { afterEach, describe, expect, it, vi } from "vitest";
import { WaveSpeedAdapter } from "@/lib/providers/wavespeed";
import { NuretaAdapter } from "@/lib/providers/nureta";
import { ProviderRouter } from "@/lib/providers/router";
import { CreateJobSchema } from "@/lib/security/validation";
const payload = { videoEngine: "kling", sceneImageUrl: "https://example.com/approved.jpg", duration: 5,
  prompt: "Smile and make a small natural gesture.", voiceMode: "source", resolution: "480p",
  sceneJobId: crypto.randomUUID(), sceneImageAssetId: crypto.randomUUID() };
afterEach(() => vi.restoreAllMocks());
describe("Approved scene video engines", () => {
  it("requires approval IDs and rejects arbitrary engine names", () => {
    const input = { type: "nureta_scene_video", characterId: crypto.randomUUID(), payload };
    expect(CreateJobSchema.safeParse(input).success).toBe(true);
    expect(CreateJobSchema.safeParse({ ...input, payload: { ...payload, videoEngine: "unknown" } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...input, payload: { ...payload, sceneJobId: undefined } }).success).toBe(false);
  });
  it("pins each selected engine with no paid failover", async () => {
    const nureta = new NuretaAdapter(), wave = new WaveSpeedAdapter();
    const router = new ProviderRouter([nureta, wave], () => "nureta");
    expect(router.candidates("nureta_scene_video", payload).map(a => a.name)).toEqual(["wavespeed"]);
    expect(router.candidates("nureta_scene_video", { ...payload, videoEngine: "nureta" }).map(a => a.name)).toEqual(["nureta"]);
    const submit = vi.spyOn(wave, "submit").mockRejectedValue(new Error("provider down"));
    const other = vi.spyOn(nureta, "submit");
    await expect(router.submit("nureta_scene_video", { jobType: "nureta_scene_video", jobId: "test", payload, idempotencyKey: "test-attempt" })).rejects.toThrow("provider down");
    expect(submit).toHaveBeenCalledOnce(); expect(other).not.toHaveBeenCalled();
  });
  it("submits the same approved frame to Kling and stores its output as a video", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { id: "kling-test" } })));
    const adapter = new WaveSpeedAdapter();
    const result = await adapter.submit({ jobType: "nureta_scene_video", jobId: "test", payload, idempotencyKey: "test-attempt" });
    expect(String(send.mock.calls[0][0])).toContain("kling-v3.0-pro/image-to-video");
    expect(JSON.parse(String(send.mock.calls[0][1]?.body))).toMatchObject({ image: payload.sceneImageUrl, duration: 5, sound: false });
    send.mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "completed", outputs: ["https://cdn.wavespeed.ai/video.mp4"] } })));
    expect((await adapter.getResult("kling-test", result.providerMeta, "nureta_scene_video")).files[0].kind).toBe("video");
    expect((await adapter.estimate("nureta_scene_video", payload)).credits).toBe(185);
  });
});
