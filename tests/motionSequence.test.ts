import { beforeEach, describe, expect, it, vi } from "vitest";
import { pollMotionSequence, motionSequenceResult } from "@/server/jobs/motionSequence";
import { inspectMediaBytes } from "@/server/jobs/mediaDuration";

interface MockMeta extends Record<string, unknown> {
  parts: Array<Record<string, unknown>>;
  segments: Array<{ start: number; duration: number }>;
}
interface MockRow extends Record<string, unknown> { provider_meta: MockMeta; }
interface MockBuilder {
  select(): MockBuilder;
  update(value: Record<string, unknown>): MockBuilder;
  eq(key: string, value: unknown): MockBuilder;
  contains(key: string, value: Record<string, unknown>): MockBuilder;
  single(): Promise<{ data: Record<string, unknown> }>;
  maybeSingle(): Promise<{ data: { id: unknown } | null }>;
}
const state = vi.hoisted(() => ({ row: {} as MockRow, uploads: [] as string[], saved: vi.fn(), lastFrame: vi.fn(), clip: vi.fn() }));
vi.mock("@/server/jobs/providerDownload", () => ({ downloadProviderFile: vi.fn(async (url: string) => ({ buf: Buffer.from(url) })) }));
vi.mock("@/server/jobs/mediaDuration", () => ({ inspectMediaBytes: vi.fn(async () => ({hasVideo:true,hasAudio:true,seconds:30,durationSeconds:30})) }));
vi.mock("@/server/jobs/motionMedia", () => ({ lastMotionFrame: state.lastFrame, motionClip: state.clip }));
vi.mock("@/server/jobs/runJob", () => ({ storeOutputAssets: state.saved }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: () => ({
  from: (table: string) => {
    const filters: Array<[string, unknown]> = []; let changes: Record<string, unknown> | null = null;
    const builder: MockBuilder = {
      select: () => builder, update: (value: Record<string, unknown>) => { changes = value; return builder; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
      contains: (_key: string, value: Record<string, unknown>) => { for (const [k,v] of Object.entries(value)) filters.push([`meta:${k}`,v]); return builder; },
      single: async () => {
        if (table === "assets") return { data: { bucket:"assets", object_path: String(filters.find(([key]) => key === "id")?.[1]) } };
        return { data: structuredClone(state.row) };
      },
      maybeSingle: async () => {
        const matches = filters.every(([key,value]) => key.startsWith("meta:") ? state.row.provider_meta[key.slice(5)] === value : state.row[key] === value);
        if (!matches) return { data: null };
        Object.assign(state.row, structuredClone(changes)); return { data: { id: state.row.id } };
      },
    }; return builder;
  },
  storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/${path}?fresh=1` } }),
    upload: async (path: string) => { state.uploads.push(path); return { error: null }; } }) },
}) }));

beforeEach(() => {
  vi.clearAllMocks(); state.uploads = [];
  vi.mocked(inspectMediaBytes).mockResolvedValue({hasVideo:true,hasAudio:true,seconds:30,durationSeconds:30});
  state.saved.mockResolvedValue(["saved-part-1"]);
  state.lastFrame.mockResolvedValue(Buffer.from("last-frame")); state.clip.mockResolvedValue(Buffer.from("normalized-video"));
  state.row = { id:"job", owner_id:"owner", type:"character_motion_video", status:"processing", provider:"wavespeed", provider_job_id:"p1",
    payload:{sourceVideoAssetId:"owned-source",sourceSeconds:63.6}, provider_meta:{motionSequence:true,submission_started:true,jobId:"job",
      stage:"motion_rendering",endpoint:"model",prompt:"identity",negativePrompt:"drift",index:0,parts:[],segments:[{start:0,duration:30},{start:30,duration:30},{start:60,duration:3.6}]} };
});

describe("durable serial motion sequence", () => {
  it("continues from a shorter provider output instead of discarding it or regenerating it", async () => {
    vi.mocked(inspectMediaBytes).mockResolvedValue({hasVideo:true,hasAudio:true,seconds:25,durationSeconds:25});
    const request = vi.fn();
    await pollMotionSequence("p1",state.row.provider_meta,request,async()=>({status:"completed",outputs:["https://provider.test/short.mp4"]}));
    expect(state.row.provider_meta.stage).toBe("motion_next");
    expect(state.row.provider_meta.parts[0]).toMatchObject({start:0,duration:30,outputSeconds:25});
    expect(request).not.toHaveBeenCalled();
  });
  it("saves part one, uses its last frame and the next source interval, and submits part two only once", async () => {
    const request = vi.fn(async () => ({id:"p2"}));
    const result = vi.fn(async () => ({status:"completed",outputs:["https://provider.test/part1.mp4"]}));
    const first = structuredClone(state.row.provider_meta);
    await Promise.all([pollMotionSequence("p1", first, request, result), pollMotionSequence("p1", first, request, result)]);
    expect(state.saved).toHaveBeenCalledTimes(1); expect(request).not.toHaveBeenCalled();
    expect(state.row.provider_meta.parts[0].assetId).toBe("saved-part-1");
    await pollMotionSequence("p1", first, request, result);
    expect(state.lastFrame).toHaveBeenCalledWith(Buffer.from("https://storage.test/saved-part-1?fresh=1"));
    expect(state.clip).toHaveBeenCalledWith(Buffer.from("https://storage.test/owned-source?fresh=1"),{start:30,duration:30});
    await Promise.all([pollMotionSequence("p1", first, request, result), pollMotionSequence("p1", first, request, result)]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toEqual(["model", expect.objectContaining({image:"https://storage.test/owner/job/motion-start-2.jpg?fresh=1",video:"https://storage.test/owner/job/motion-source-2.mp4?fresh=1"})]);
    expect(state.row.provider_job_id).toBe("p2");
    expect(await pollMotionSequence("p1", first, request, result)).toBe("running");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not repeat a paid request after a timeout", async () => {
    state.row.provider_meta = {...state.row.provider_meta,stage:"motion_ready",index:1,imagePath:"last.jpg",videoPath:"part2.mp4",parts:[{assetId:"saved-part-1"}]};
    const request = vi.fn(async () => { throw new Error("timeout"); });
    const initial = structuredClone(state.row.provider_meta);
    await pollMotionSequence("p1",initial,request,vi.fn());
    await pollMotionSequence("p1",initial,request,vi.fn());
    expect(request).toHaveBeenCalledTimes(1); expect(state.row.status).toBe("submission_uncertain");
    expect(state.row.provider_meta.parts).toEqual([{assetId:"saved-part-1"}]);
  });
  it("recovers a lost preparation worker but never a lost submission worker", async () => {
    const request = vi.fn(); const result = vi.fn();
    state.row.provider_meta = {...state.row.provider_meta,stage:"motion_preparing",lock:"old",lockAt:0};
    await pollMotionSequence("p1",state.row.provider_meta,request,result);
    expect(state.row.provider_meta.stage).toBe("motion_next");
    state.row.provider_meta = {...state.row.provider_meta,stage:"motion_submitting",lockAt:0};
    await pollMotionSequence("p1",state.row.provider_meta,request,result);
    expect(state.row.status).toBe("submission_uncertain"); expect(request).not.toHaveBeenCalled();
  });
  it("keeps saved parts on a later provider failure and refuses early finalization", async () => {
    state.row.provider_meta.parts = [{assetId:"saved-part-1"}]; state.row.provider_meta.index = 1;
    await expect(pollMotionSequence("p1",state.row.provider_meta,vi.fn(),async()=>({status:"failed",error:"invalid input"}))).rejects.toThrow("2/3. rész");
    expect(state.row.provider_meta.parts).toHaveLength(1);
    await expect(motionSequenceResult(state.row.provider_meta)).rejects.toThrow("NOT_READY");
    state.row.provider_meta.stage = "motion_complete";
    await expect(motionSequenceResult(state.row.provider_meta)).rejects.toThrow("NOT_READY");
    state.row.provider_meta.segments = [state.row.provider_meta.segments[0]];
    expect((await motionSequenceResult(state.row.provider_meta)).meta.motionSequenceAssets).toEqual(["saved-part-1"]);
  });
});
