import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateJobSchema } from "@/lib/security/validation";
import { ProviderRouter } from "@/lib/providers/router";
import { NuretaLipSyncAdapter } from "@/lib/providers/nuretaLipSync";
import { WaveSpeedAdapter } from "@/lib/providers/wavespeed";
import { FalAdapter } from "@/lib/providers/fal";
import { NuretaAdapter } from "@/lib/providers/nureta";
import { prepareNuretaLipSync } from "@/server/jobs/nuretaLipSync";

const mocks = vi.hoisted(() => ({ service: vi.fn(), voice: vi.fn(), audio: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: mocks.service }));
vi.mock("@/server/jobs/characterVoice", () => ({ resolveCharacterVoice: mocks.voice }));
vi.mock("@/server/jobs/nuretaLipSync", async importOriginal => ({ ...(await importOriginal<object>()), createNuretaSyncAudio: mocks.audio }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const assetId = "a6368963-29eb-4e97-bc76-18a2c857249f", characterId = "05274aae-99fa-4352-9181-519f25a54963";
function database(data: unknown[]) {
  const filters: Array<[string, unknown]> = [];
  const from = vi.fn(() => {
    const row = data.shift();
    const chain = { select: () => chain, eq: (field: string, value: unknown) => { filters.push([field,value]); return chain; },
      is: () => chain, maybeSingle: async () => ({ data: row }), single: async () => ({ data: row }) };
    return chain;
  });
  const upload = vi.fn(async () => ({ error: null }));
  const sign = vi.fn(async () => ({ data: { signedUrl: "https://owned.supabase.co/fresh" } }));
  mocks.service.mockReturnValue({ from, storage: { from: () => ({ upload, createSignedUrl: sign }) } });
  return { filters, upload };
}
describe("Nureta-only postprocessing", () => {
  it("does not route existing WaveSpeed generators or ordinary Lip Sync into the new adapter", () => {
    const adapter = new NuretaLipSyncAdapter(), wave = new WaveSpeedAdapter(), fal = new FalAdapter(), nureta = new NuretaAdapter();
    const router = new ProviderRouter([adapter,wave,fal,nureta], () => "fal");
    expect(router.candidates("lip_sync", { nuretaPostprocess: true }).map(a => a.name)).toEqual(["nureta_lipsync"]);
    expect(router.candidates("lip_sync", {}).map(a => a.name)).not.toContain("nureta_lipsync");
    expect(router.candidates("character_motion_video", {}).map(a => a.name)).not.toContain("nureta_lipsync");
    expect(router.candidates("nureta_scene_video", { videoEngine: "nureta" }).map(a => a.name)).toEqual(["nureta"]);
  });
  it("keeps ordinary Lip Sync audio requirements and validates the separate audio modes", () => {
    expect(CreateJobSchema.safeParse({ type: "lip_sync", payload: { videoAssetId: assetId } }).success).toBe(false);
    const input = { type: "lip_sync", characterId, payload: { nuretaPostprocess: true, videoAssetId: assetId, audioMode: "keep" } };
    expect(CreateJobSchema.safeParse(input).success).toBe(true);
    expect(CreateJobSchema.safeParse({ ...input, payload: { ...input.payload, audioMode: "speech" } }).success).toBe(false);
    expect(CreateJobSchema.safeParse({ ...input, characterId: undefined }).success).toBe(false);
  });
  it("rejects an absent/foreign/deleted gallery video before signing or resolving a voice", async () => {
    vi.stubEnv("WAVESPEED_API_KEY", "test");
    mocks.voice.mockReset(); const db = database([null]);
    const result = await prepareNuretaLipSync("owner",characterId,{ videoAssetId: assetId,audioMode:"model" });
    expect(result.error).toBe("SOURCE_IMAGE_REQUIRED");
    expect(db.filters).toContainEqual(["owner_id","owner"]);
    expect(db.filters).toContainEqual(["character_id",characterId]);
    expect(mocks.voice).not.toHaveBeenCalled();
  });
  it("re-signs owned Nureta output and ignores injected URL, voice, duration and category", async () => {
    vi.stubEnv("WAVESPEED_API_KEY", "test"); vi.stubEnv("ELEVENLABS_API_KEY", "test");
    mocks.voice.mockResolvedValue({ voiceId: "savedCharacterVoice" });
    const db = database([{ job_id:"parent",content_category:"fanvue" }, { id:"parent",status:"completed",result:{assetIds:[assetId]},payload:{duration:5} },
      { bucket:"assets",object_path:"owner/parent/video.mp4",content_type:"video/mp4",bytes:1000 }]);
    const prepared = await prepareNuretaLipSync("owner",characterId,{ videoAssetId:assetId,audioMode:"model",videoUrl:"https://evil.invalid",voiceId:"injected",duration:100,outputCategory:"tiktok" });
    expect(prepared.error).toBeUndefined();
    expect(prepared.payload).toMatchObject({ videoUrl:"https://owned.supabase.co/fresh",voiceId:"savedCharacterVoice",duration:5,outputCategory:"fanvue",parentJobId:"parent" });
    expect(db.filters).toContainEqual(["provider","nureta"]);
    expect(db.filters).toContainEqual(["type","nureta_scene_video"]);
  });
  it("submits a separate lip-sync task with the generated target audio and returns video output", async () => {
    database([{owner_id:"owner"}]); mocks.audio.mockResolvedValue(Buffer.from("audio"));
    const request = vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response(JSON.stringify({data:{id:"sync-id"}})))
      .mockResolvedValueOnce(new Response(JSON.stringify({data:{status:"completed",outputs:["https://cdn.wavespeed.ai/synced.mp4"]}})));
    const adapter = new NuretaLipSyncAdapter();
    await adapter.submit({jobId:"sync-job",jobType:"lip_sync",idempotencyKey:"once",payload:{nuretaPostprocess:true,videoUrl:"https://owned.supabase.co/video",parentJobId:"parent",audioMode:"keep"}});
    expect(String(request.mock.calls[0][0])).toContain("sync/lipsync-2-pro");
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({video:"https://owned.supabase.co/video",audio:"https://owned.supabase.co/fresh",sync_mode:"silence"});
    expect((await adapter.getResult("sync-id")).files[0].kind).toBe("video");
  });
  it("does not call the paid lipsync API when soundtrack preparation fails", async () => {
    database([{owner_id:"owner"}]); mocks.audio.mockRejectedValue(new Error("no audio"));
    const request = vi.spyOn(globalThis,"fetch");
    const { ProviderSubmissionRejectedError } = await import("@/lib/providers/types");
    await expect(new NuretaLipSyncAdapter().submit({jobId:"job",jobType:"lip_sync",idempotencyKey:"once",payload:{nuretaPostprocess:true}})).rejects.toBeInstanceOf(ProviderSubmissionRejectedError);
    expect(request).not.toHaveBeenCalled();
  });
});
