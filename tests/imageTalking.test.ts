import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { CreateJobSchema } from "@/lib/security/validation";
import { ImageTalkingAdapter } from "@/lib/providers/imageTalking";
import { VideoRedubAdapter } from "@/lib/providers/videoRedub";
import { NuretaLipSyncAdapter } from "@/lib/providers/nuretaLipSync";
import { FalAdapter } from "@/lib/providers/fal";
import { ProviderRouter } from "@/lib/providers/router";
import { prepareImageTalking } from "@/server/jobs/imageTalking";
import { imageTalkingPrompt, TALKING_COMMENT_SCRIPT } from "@/lib/imageTalking";
import { redubSpeechText } from "@/lib/videoRedub";

const mocks = vi.hoisted(() => ({ service: vi.fn(), voice: vi.fn(), duration: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: mocks.service }));
vi.mock("@/server/jobs/characterVoice", () => ({ resolveCharacterVoice: mocks.voice }));
vi.mock("@/server/jobs/mediaDuration", () => ({ mediaDuration: mocks.duration }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); mocks.voice.mockReset(); mocks.duration.mockReset(); });
const characterId = "5ef31ec2-58fb-4564-af6d-f3679340db48";
const imageAssetId = "a6368963-29eb-4e97-bc76-18a2c857249f";
const speechJobId = "05274aae-99fa-4352-9181-519f25a54964";
const image = { id: imageAssetId, bucket: "assets", object_path: "owner/photo.png", content_type: "image/png", bytes: 1000, source: "upload" };
const speech = { id: speechJobId, payload: { videoRedubSpeech: true, voiceId: "savedCharacterVoice", delivery: "curious" }, result: { assetIds: ["audio"] } };
function database(rows: unknown[]) {
  const filters: Array<[string, unknown]> = [];
  const from = vi.fn(() => {
    const row = rows.shift();
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      maybeSingle: async () => ({ data: row }), single: async () => ({ data: row }) };
    return q;
  });
  const upload = vi.fn(async (_path: string, _bytes: Buffer) => ({ error: null }));
  const sign = vi.fn(async (path: string) => ({ data: { signedUrl: `https://owned.supabase.co/${path}` } }));
  mocks.service.mockReturnValue({ from, storage: { from: () => ({ upload, createSignedUrl: sign }) } });
  mocks.voice.mockResolvedValue({ voiceId: "savedCharacterVoice" });
  vi.stubEnv("WAVESPEED_API_KEY", "test"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://owned.supabase.co");
  return { filters, sign, upload };
}
describe("image + selected mood + approved model speech", () => {
  it("requires a model, image and completed speech job, and rejects conflicting pipelines", () => {
    const input = { type: "talking_video", characterId, payload: { imageTalking: true, imageAssetId, speechJobId, motion: "natural", resolution: "720p" } };
    expect(CreateJobSchema.safeParse(input).success).toBe(true);
    for (const change of [{ imageAssetId: undefined }, { speechJobId: undefined }, { motion: "wild" }, { resolution: "4k" }, { videoRedub: true }, { nuretaPostprocess: true }])
      expect(CreateJobSchema.safeParse({ ...input, payload: { ...input.payload, ...change } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...input, characterId: undefined }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...input, type: "lip_sync" }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ type: "talking_video", payload: { imageAssetId } }).success).toBe(false);
  });
  it("routes only opted-in image talking jobs and preserves the previous video/TTS providers", () => {
    const router = new ProviderRouter([new ImageTalkingAdapter(), new VideoRedubAdapter(), new NuretaLipSyncAdapter(), new FalAdapter()], () => "fal");
    expect(router.candidates("talking_video", { imageTalking: true }).map(a => a.name)).toEqual(["image_talking"]);
    expect(router.candidates("talking_video", {}).map(a => a.name)).toEqual(["fal"]);
    expect(router.candidates("lip_sync", { videoRedub: true }).map(a => a.name)).toEqual(["video_redub"]);
    expect(router.candidates("lip_sync", { nuretaPostprocess: true }).map(a => a.name)).toEqual(["nureta_lipsync"]);
    expect(router.candidates("tts", { videoRedubSpeech: true }).map(a => a.name)).toEqual(["video_redub"]);
  });
  it("uses the saved speech mood and full measured audio, ignoring injected identity, prompt and timing", async () => {
    const db = database([image, speech, { bucket: "assets", object_path: "owner/speech.mp3" }]);
    mocks.duration.mockResolvedValue(52);
    const result = await prepareImageTalking("owner", characterId, { imageAssetId, speechJobId, motion: "expressive", resolution: "720p",
      imageUrl: "https://evil.invalid", audioUrl: "https://evil.invalid", voiceId: "wrong", billableSeconds: 1,
      prompt: "zoom into another person", delivery: "serious" });
    expect(result.error).toBeUndefined();
    expect(result.payload).toMatchObject({ imageTalking: true, imageUrl: "https://owned.supabase.co/owner/photo.png", audioUrl: "https://owned.supabase.co/owner/speech.mp3",
      delivery: "curious", billableSeconds: 52, motion: "expressive", resolution: "720p", outputCategory: "tiktok" });
    expect(result.payload.prompt).toBe(imageTalkingPrompt("curious", "expressive"));
    expect(db.filters).toEqual(expect.arrayContaining([["owner_id", "owner"], ["character_id", characterId], ["status", "completed"]]));
  });
  it("rejects foreign or absent images before signing", async () => {
    const db = database([null]);
    expect((await prepareImageTalking("owner", characterId, { imageAssetId, speechJobId })).error).toBe("IMAGE_INPUT_REQUIRED");
    expect(db.sign).not.toHaveBeenCalled();
  });
  it("rejects generated images from another character or a deleted gallery entry", async () => {
    const db = database([{ ...image, source: "generation" }, null]);
    expect((await prepareImageTalking("owner", characterId, { imageAssetId, speechJobId })).error).toBe("IMAGE_INPUT_REQUIRED");
    expect(db.filters).toContainEqual(["deleted_at", null]); expect(db.sign).not.toHaveBeenCalled();
  });
  it("rejects old/foreign voice previews and overlong speech instead of truncating", async () => {
    database([image, { ...speech, payload: { videoRedubSpeech: true, voiceId: "old-voice" } }]);
    expect((await prepareImageTalking("owner", characterId, { imageAssetId, speechJobId })).error).toBe("TTS_VOICE_INVALID");
    database([image, speech, { bucket: "assets", object_path: "owner/speech.mp3" }]);
    mocks.duration.mockResolvedValue(181);
    expect((await prepareImageTalking("owner", characterId, { imageAssetId, speechJobId })).error).toBe("REDUB_DURATION_LIMIT");
  });
  it("prices actual speech seconds at the selected quality, including the provider's 3-second minimum", async () => {
    const adapter = new ImageTalkingAdapter();
    expect((await adapter.estimate("talking_video", { billableSeconds: 52, resolution: "720p" })).credits).toBe(Math.ceil(52 * 0.06 * 330));
    expect((await adapter.estimate("talking_video", { billableSeconds: 52, resolution: "480p" })).credits).toBe(Math.ceil(52 * 0.03 * 330));
    expect((await adapter.estimate("talking_video", { billableSeconds: 1, resolution: "480p" })).credits).toBe(Math.ceil(3 * 0.03 * 330));
    await expect(adapter.estimate("talking_video", { billableSeconds: 0 })).rejects.toThrow();
  });
  it("keeps no-zoom identity continuity across every mood and motion setting", () => {
    for (const mood of ["natural", "girly", "energetic", "story", "curious", "serious", "confident"] as const) {
      for (const motion of ["subtle", "natural", "expressive"] as const) {
        const prompt = imageTalkingPrompt(mood, motion);
        expect(prompt).toContain("No zoom in or out"); expect(prompt).toContain("exact same person");
        expect(prompt).toContain("complete speech audio"); expect(prompt).toContain("never mechanical or repetitive");
      }
    }
    expect(redubSpeechText("Ezt mondd ki.", "curious")).toBe("[curious] Ezt mondd ki.");
    expect(TALKING_COMMENT_SCRIPT).toContain("félre is tudjon tenni");
    expect(TALKING_COMMENT_SCRIPT).toContain("DORIKA kódot");
    expect(TALKING_COMMENT_SCRIPT).toContain("Telegramomat");
    expect(TALKING_COMMENT_SCRIPT).toContain("Ott keress privátban");
  });
  it("fits the real input to 9:16 without a new image-generation call and submits full approved audio", async () => {
    const db = database([{ owner_id: "owner" }]);
    const original = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#aa3366" } }).png().toBuffer();
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(original))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "talk-id" } })));
    const output = await new ImageTalkingAdapter().submit({ jobId: "job", jobType: "talking_video", idempotencyKey: "once", payload: {
      imageTalking: true, imageUrl: "https://owned.supabase.co/owner/photo.png", audioUrl: "https://owned.supabase.co/full.mp3",
      prompt: imageTalkingPrompt("curious", "natural"), resolution: "720p", billableSeconds: 52,
    } });
    expect(output.providerJobId).toBe("talk-id");
    const padded = db.upload.mock.calls[0][1] as Buffer;
    expect(await sharp(padded).metadata()).toMatchObject({ width: 720, height: 1280 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[1][0])).toContain("wavespeed-ai/infinitetalk");
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ image: "https://owned.supabase.co/owner/job/talking-start.jpg",
      audio: "https://owned.supabase.co/full.mp3", prompt: imageTalkingPrompt("curious", "natural"), resolution: "720p" });
  });
  it("never sends a paid request when the source is corrupt, and never falls back to another model", async () => {
    database([{ owner_id: "owner" }]);
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not an image"));
    await expect(new ImageTalkingAdapter().submit({ jobId: "job", jobType: "talking_video", idempotencyKey: "once", payload: {
      imageTalking: true, imageUrl: "https://owned.supabase.co/owner/photo.png",
    } })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
