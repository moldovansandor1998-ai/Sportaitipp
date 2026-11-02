import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateJobSchema } from "@/lib/security/validation";
import { prepareVideoRedub } from "@/server/jobs/videoRedub";
import { VideoRedubAdapter } from "@/lib/providers/videoRedub";
import { NuretaLipSyncAdapter } from "@/lib/providers/nuretaLipSync";
import { FalAdapter } from "@/lib/providers/fal";
import { ProviderRouter } from "@/lib/providers/router";
import { redubSpeechText } from "@/lib/videoRedub";
import { assertAllowedProviderOutputUrl, assertAllowedUrl } from "@/lib/security/ssrf";

const mocks = vi.hoisted(() => ({ service: vi.fn(), voice: vi.fn(), duration: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: mocks.service }));
vi.mock("@/server/jobs/characterVoice", () => ({ resolveCharacterVoice: mocks.voice }));
vi.mock("@/server/jobs/mediaDuration", () => ({ mediaDuration: mocks.duration }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); mocks.voice.mockReset(); mocks.duration.mockReset(); });
const characterId = "05274aae-99fa-4352-9181-519f25a54963";
const videoAssetId = "a6368963-29eb-4e97-bc76-18a2c857249f";
const speechJobId = "05274aae-99fa-4352-9181-519f25a54964";
const script = "Story timeee! " + "Ez a teljes magyar reklámszöveg, semmi ne maradjon le belőle. ".repeat(16);

function database(rows: unknown[]) {
  const filters: Array<[string, unknown]> = [];
  const from = vi.fn(() => {
    const row = rows.shift();
    const chain = { select: () => chain, eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
      single: async () => ({ data: row }), maybeSingle: async () => ({ data: row }) };
    return chain;
  });
  const upload = vi.fn(async () => ({ error: null }));
  const sign = vi.fn(async (path: string) => ({ data: { signedUrl: `https://owned.supabase.co/${path}` } }));
  mocks.service.mockReturnValue({ from, storage: { from: () => ({ upload, createSignedUrl: sign }) } });
  mocks.voice.mockResolvedValue({ voiceId: "savedCharacterVoice" });
  vi.stubEnv("ELEVENLABS_API_KEY", "test"); vi.stubEnv("WAVESPEED_API_KEY", "test");
  return { filters, sign };
}
const video = { id: videoAssetId, bucket: "assets", object_path: "owner/video.mp4", content_type: "video/mp4", bytes: 1000, source: "upload" };
const speech = { id: speechJobId, payload: { videoRedubSpeech: true, voiceId: "savedCharacterVoice" }, result: { assetIds: ["audio-id"] } };

describe("existing video + full model speech + lipsync", () => {
  it("accepts the full supplied-size script, keeps legacy requirements and rejects mixed paths", () => {
    expect(script.length).toBeGreaterThan(450);
    expect(CreateJobSchema.safeParse({ type: "tts", characterId, payload: { videoRedubSpeech: true, text: script, delivery: "girly" } }).success).toBe(true);
    expect(CreateJobSchema.safeParse({ type: "tts", characterId, payload: { videoRedubSpeech: true, text: "x".repeat(3001) } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ type: "tts", payload: { videoRedubSpeech: true, text: script } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ type: "lip_sync", characterId, payload: { videoRedub: true, videoAssetId, speechJobId } }).success).toBe(true);
    expect(CreateJobSchema.safeParse({ type: "lip_sync", characterId, payload: { videoRedub: true, nuretaPostprocess: true, videoAssetId, speechJobId } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ type: "lip_sync", payload: { videoAssetId } }).success).toBe(false);
  });
  it("isolates the new opt-in routes from all existing speech and Nureta jobs", () => {
    const redub = new VideoRedubAdapter(), fal = new FalAdapter(), nureta = new NuretaLipSyncAdapter();
    const router = new ProviderRouter([redub, fal, nureta], () => "fal");
    expect(router.candidates("tts", { videoRedubSpeech: true }).map(a => a.name)).toEqual(["video_redub"]);
    expect(router.candidates("lip_sync", { videoRedub: true }).map(a => a.name)).toEqual(["video_redub"]);
    expect(router.candidates("tts", {}).map(a => a.name)).toEqual(["fal"]);
    expect(router.candidates("lip_sync", { nuretaPostprocess: true }).map(a => a.name)).toEqual(["nureta_lipsync"]);
    expect(router.candidates("lip_sync", {}).map(a => a.name)).toEqual(["fal"]);
  });
  it("resolves the selected character's stored voice and discards an injected voice and timing", async () => {
    database([]);
    const prepared = await prepareVideoRedub("owner", characterId, "tts", { videoRedubSpeech: true, text: script, voiceId: "wrong", delivery: "girly", billableSeconds: 1 });
    expect(prepared.payload).toEqual({ videoRedubSpeech: true, text: script.trim(), voiceId: "savedCharacterVoice", delivery: "girly" });
    expect(mocks.voice).toHaveBeenCalledWith(expect.anything(), characterId, "owner");
    expect(redubSpeechText(script, "girly")).toContain(script.trim());
  });
  it("generates the complete Hungarian script with the stored voice, before any paid lipsync request", async () => {
    database([{ owner_id: "owner" }]);
    mocks.duration.mockResolvedValue(57);
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(Buffer.from("ID3-valid-audio")));
    const adapter = new VideoRedubAdapter();
    const submitted = await adapter.submit({ jobId: "speech-job", jobType: "tts", idempotencyKey: "once", payload: {
      videoRedubSpeech: true, text: script, delivery: "girly", voiceId: "savedCharacterVoice",
    } });
    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0][0])).toContain("/text-to-speech/savedCharacterVoice");
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({ language_code: "hu", model_id: "eleven_v4", text: `[cheerfully] ${script.trim()}` });
    const output = await adapter.getResult(submitted.providerJobId, submitted.providerMeta);
    expect(output.files[0].kind).toBe("audio");
    expect(output.meta.seconds).toBe(57);
  });
  it("uses all 57 speech seconds for the quote, rather than the 12-second source or client duration", async () => {
    const db = database([video, speech, { bucket: "assets", object_path: "owner/speech.mp3" }]);
    mocks.duration.mockResolvedValueOnce(12).mockResolvedValueOnce(57);
    const prepared = await prepareVideoRedub("owner", characterId, "lip_sync", { videoAssetId, speechJobId,
      videoUrl: "https://evil.invalid", audioUrl: "https://evil.invalid", voiceId: "wrong", billableSeconds: 1, syncMode: "cut_off" });
    expect(prepared.error).toBeUndefined();
    expect(prepared.payload).toMatchObject({ videoUrl: "https://owned.supabase.co/owner/video.mp4", audioUrl: "https://owned.supabase.co/owner/speech.mp3",
      billableSeconds: 57, sourceSeconds: 12, syncMode: "loop" });
    expect((await new VideoRedubAdapter().estimate("lip_sync", prepared.payload)).credits).toBe(Math.ceil(57 * 0.084 * 330));
    expect(db.filters).toContainEqual(["owner_id", "owner"]);
    expect(db.filters).toContainEqual(["character_id", characterId]);
    expect(db.filters).toContainEqual(["status", "completed"]);
  });
  it("rejects a missing/foreign video before signing anything", async () => {
    const db = database([null]);
    expect((await prepareVideoRedub("owner", characterId, "lip_sync", { videoAssetId, speechJobId })).error).toBe("VIDEO_FORMAT_UNSUPPORTED");
    expect(db.sign).not.toHaveBeenCalled();
  });
  it("rejects another character's generated gallery video and deleted items", async () => {
    const db = database([{ ...video, source: "generation" }, null]);
    expect((await prepareVideoRedub("owner", characterId, "lip_sync", { videoAssetId, speechJobId })).error).toBe("SOURCE_IMAGE_REQUIRED");
    expect(db.filters).toContainEqual(["deleted_at", null]);
    expect(db.sign).not.toHaveBeenCalled();
  });
  it("requires a completed speech job with the current character voice", async () => {
    const db = database([video, { ...speech, payload: { videoRedubSpeech: true, voiceId: "former-voice" } }]);
    expect((await prepareVideoRedub("owner", characterId, "lip_sync", { videoAssetId, speechJobId })).error).toBe("TTS_VOICE_INVALID");
    expect(db.sign).not.toHaveBeenCalled();
  });
  it("rejects speech over 3 minutes rather than trimming it or charging for a shorter clip", async () => {
    database([video, speech, { bucket: "assets", object_path: "owner/speech.mp3" }]);
    mocks.duration.mockResolvedValueOnce(12).mockResolvedValueOnce(181);
    expect((await prepareVideoRedub("owner", characterId, "lip_sync", { videoAssetId, speechJobId })).error).toBe("REDUB_DURATION_LIMIT");
  });
  it("submits the exact approved full audio with loop mode, with no image generation or audio-only mux", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { id: "sync-id" } })));
    const adapter = new VideoRedubAdapter();
    const result = await adapter.submit({ jobId: "job", jobType: "lip_sync", idempotencyKey: "once",
      payload: { videoRedub: true, videoUrl: "https://owned.supabase.co/video", audioUrl: "https://owned.supabase.co/full-audio", billableSeconds: 57, syncMode: "cut_off" } });
    expect(result.providerJobId).toBe("sync-id");
    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0][0])).toContain("sync/lipsync-2-pro");
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ video: "https://owned.supabase.co/video", audio: "https://owned.supabase.co/full-audio", sync_mode: "loop" });
  });
  it("keeps explicit rejection terminal and does not silently fail over to a different paid generator", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "balance" }), { status: 402 }));
    const router = new ProviderRouter([new VideoRedubAdapter(), new FalAdapter()], () => "fal");
    await expect(router.submit("lip_sync", { jobId: "job", jobType: "lip_sync", idempotencyKey: "once", payload: { videoRedub: true } })).rejects.toThrow("402");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("permits the actual output CDN only on the new server-selected adapter", () => {
    expect(assertAllowedProviderOutputUrl("https://cdn.cachegalaxy.com/result.mp4", "video_redub").hostname).toBe("cdn.cachegalaxy.com");
    expect(() => assertAllowedUrl("https://cdn.cachegalaxy.com/result.mp4")).toThrow();
  });
});
