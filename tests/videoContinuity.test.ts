import { afterEach, expect, it, vi } from "vitest";
import { NuretaAdapter } from "@/lib/providers/nureta";
import { WaveSpeedAdapter } from "@/lib/providers/wavespeed";
import { ANALYZED_MOTION_MAX_LENGTH, VIDEO_CONTINUITY_RULES, withVideoContinuity } from "@/lib/videoContinuity";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it("always sends fixed camera and starting-image identity rules for manually written scene prompts", async () => {
  vi.stubEnv("NURETA_API_KEY", "test");
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ id: "test", data: { id: "test" } }), { headers: { "content-type": "application/json" } }));
  const image = "https://example.com/approved.jpg";
  const params = { jobType: "nureta_scene_video" as const, jobId: "test", idempotencyKey: "test", payload: { prompt: "Turn the head and smile.", sceneImageUrl: image, duration: 5, voiceMode: "source", videoEngine: "kling" } };
  await new NuretaAdapter().submit(params);
  const nureta = JSON.parse(String(fetch.mock.calls[0][1]?.body));
  expect(nureta.content[0].text).toBe(withVideoContinuity(params.payload.prompt));
  expect(nureta.content[1].image_url.url).toBe(image);
  expect(nureta.content[0].text).toContain("No zoom in or out");
  expect(nureta.content[0].text).toContain("exact same person from the starting image");
  await new WaveSpeedAdapter().submit(params);
  const kling = JSON.parse(String(fetch.mock.calls[1][1]?.body));
  expect(kling.prompt.startsWith(VIDEO_CONTINUITY_RULES)).toBe(true);
  expect(kling.image).toBe(image);
});
it("reserves space for continuity in analyzed prompts and does not duplicate rules", () => {
  const prompt = withVideoContinuity("a".repeat(ANALYZED_MOTION_MAX_LENGTH));
  expect(prompt.length).toBe(1500);
  expect(withVideoContinuity(prompt)).toBe(prompt);
  expect(withVideoContinuity("a".repeat(1500)).endsWith("a".repeat(1500))).toBe(true);
});
