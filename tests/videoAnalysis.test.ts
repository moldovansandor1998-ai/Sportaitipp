import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), service: vi.fn(), prepare: vi.fn(), analyze: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: mocks.service }));
vi.mock("@/server/videoAnalysis/prepareVideo", () => ({ prepareAnalysisVideo: mocks.prepare }));
vi.mock("@/server/videoAnalysis/analyzeVideo", () => ({ analyzeVideo: mocks.analyze }));
import { POST } from "@/app/api/nureta/video-prompt/route";
const assetId = "11111111-1111-4111-8111-111111111111";
function request(body: unknown = { videoAssetId: assetId, duration: 5 }) {
  return new NextRequest("https://example.com/api/nureta/video-prompt", { method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" }, body: JSON.stringify(body) });
}
let filters: Array<[string, unknown]>;
function database(asset: unknown = { bucket: "assets", object_path: "owned/video.mp4", media_type: "video", content_type: "video/mp4", bytes: 10 }) {
  const download = vi.fn().mockResolvedValue({ data: new Blob(["video"]), error: null });
  const storage = { info: vi.fn().mockResolvedValue({ data: { size: 10 } }), download };
  const db = { from: vi.fn((table: string) => {
    const chain = { select: vi.fn(() => chain), eq: vi.fn((key: string, value: unknown) => { filters.push([key, value]); return chain; }),
      maybeSingle: vi.fn().mockResolvedValue({ data: table === "profiles" ? { age_verified_at: "now" } : asset }) };
    return chain;
  }), storage: { from: vi.fn(() => storage) } };
  mocks.service.mockReturnValue(db);
  return storage;
}
beforeEach(() => {
  vi.clearAllMocks(); filters = [];
  mocks.getUser.mockResolvedValue({ data: { user: { id: crypto.randomUUID() } } });
  mocks.prepare.mockResolvedValue({ video: Buffer.from("analysis"), duration: 8 });
  mocks.analyze.mockResolvedValue({ prompt: "0–5s: Slowly turn the head toward the camera.", summary: "Lassú fejfordítás." });
});
describe("Video prompt endpoint", () => {
  it("rejects unauthenticated callers before accessing assets or AI", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("requires an owned video and does not download an unavailable asset", async () => {
    const storage = database(null);
    expect((await POST(request())).status).toBe(404);
    expect(filters.some(([key]) => key === "owner_id")).toBe(true);
    expect(storage.download).not.toHaveBeenCalled(); expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("rejects URLs, unsupported durations and image inputs without AI cost", async () => {
    database({ media_type: "image" });
    expect((await POST(request())).status).toBe(404);
    expect((await POST(request({ videoAssetId: assetId, duration: 30 }))).status).toBe(400);
    expect((await POST(request({ videoAssetId: assetId, duration: 5, videoUrl: "https://evil.test" }))).status).toBe(400);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("returns an editable prompt for the selected duration without creating a video job", async () => {
    database();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sourceDuration: 8, targetDuration: 5, summary: "Lassú fejfordítás." });
    expect(mocks.analyze).toHaveBeenCalledWith(Buffer.from("analysis"), 8, 5);
  });
  it("rejects overlong clips before calling AI", async () => {
    database(); mocks.prepare.mockRejectedValue(new Error("VIDEO_DURATION_LIMIT"));
    expect((await POST(request())).status).toBe(400); expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("returns a safe failure without exposing provider credentials or video bytes", async () => {
    database(); mocks.analyze.mockRejectedValue(new Error("secret-key-and-video-bytes"));
    const response = await POST(request()); expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret-key");
  });
});
