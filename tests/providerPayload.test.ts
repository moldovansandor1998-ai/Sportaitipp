import { describe, it, expect, vi, afterEach } from "vitest";
import { FalAdapter } from "@/lib/providers/fal";

process.env.FAL_KEY = "k";
function stub(body: unknown): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
}
afterEach(() => vi.unstubAllGlobals());

describe("Easy/Expert payload a fal.ai adapterig", () => {
  it("negative_prompt és guidance_scale eljut az adapter inputjába", async () => {
    let sent: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ request_id: "rn" }), { status: 200 });
    }));
    await new FalAdapter().submit({
      jobId: "j", jobType: "image_generation",
      payload: { prompt: "portré", negativePrompt: "rossz kéz, torz arc", guidance: 3.5,
                 loraPath: "https://v3.fal.media/w", numImages: 1 },
      webhookUrl: "https://app/hook", idempotencyKey: "kn",
    });
    expect(sent).toMatchObject({ negative_prompt: "rossz kéz, torz arc", guidance_scale: 3.5 });
  });
  it("motion strength és cfg a kling inputba kerül", async () => {
    let sent: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ request_id: "rm" }), { status: 200 });
    }));
    await new FalAdapter().submit({
      jobId: "j", jobType: "video_from_image",
      payload: { prompt: "mozgás", imageUrl: "https://fal.media/a.png", motionStrength: 120, cfg: 0.5 },
      webhookUrl: "https://app/hook", idempotencyKey: "km",
    });
    expect(sent).toMatchObject({ motion_bucket_id: 120, cfg_scale: 0.5 });
  });
  it("imageSize + numImages átjut az adapter inputjába", async () => {
    let sent: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ request_id: "r1" }), { status: 200 });
    }));
    await new FalAdapter().submit({
      jobId: "j", jobType: "image_generation",
      payload: {
        prompt: "fotorealisztikus, portré", loraPath: "https://v3.fal.media/w",
        imageSize: "portrait_4_3", numImages: 3, seed: 42, steps: 30,
      },
      webhookUrl: "https://app/hook", idempotencyKey: "k1",
    });
    expect(sent).toMatchObject({
      image_size: "portrait_4_3", num_images: 3, seed: 42, num_inference_steps: 30,
      loras: [{ path: "https://v3.fal.media/w", scale: 1 }],
    });
  });
  it("TTS: voice/speed/language a PlayHT-dokumentációs mezőkbe kerül", async () => {
    let sent: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ request_id: "r2" }), { status: 200 });
    }));
    await new FalAdapter().submit({
      jobId: "j", jobType: "tts",
      payload: { text: "Szia", voice: "Jennifer (en)", speed: 1.2, language: "en" },
      webhookUrl: "https://app/hook", idempotencyKey: "k2",
    });
    expect(sent).toMatchObject({ text: "Szia", voice: "Jennifer (en)", speed: 1.2, language: "en" });
  });
  it("submit válasz: request_id + meta URL-ek", async () => {
    stub({ request_id: "r9", status_url: "https://s", response_url: "https://r", cancel_url: "https://c" });
    const r = await new FalAdapter().submit({
      jobId: "j", jobType: "image_generation", payload: {}, webhookUrl: "w", idempotencyKey: "k",
    });
    expect(r.providerJobId).toBe("r9");
    expect(r.providerMeta).toMatchObject({ statusUrl: "https://s", cancelUrl: "https://c" });
  });
});
