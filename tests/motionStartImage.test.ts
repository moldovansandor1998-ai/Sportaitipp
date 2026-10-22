import { describe, expect, it, vi } from "vitest";
import { CreateJobSchema } from "@/lib/security/validation";
import { resolveMotionStartImage } from "@/server/jobs/motionStartImage";
import { serviceClient } from "@/lib/supabase/server";
const imageId = crypto.randomUUID(), videoId = crypto.randomUUID(), characterId = crypto.randomUUID();
const image = { bucket: "assets", object_path: "owner/upload.jpg", media_type: "image" };
function database(rows: unknown[]) {
  const filters: Array<[string, unknown]> = [];
  const from = vi.fn(() => {
    const row = rows.shift();
    const chain = { select: () => chain, eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
      is: () => chain, maybeSingle: async () => ({ data: row }) };
    return chain;
  });
  const sign = vi.fn(async () => ({ data: { signedUrl: "https://owned.supabase.co/signed-image" } }));
  return { db: { from, storage: { from: () => ({ createSignedUrl: sign }) } } as unknown as ReturnType<typeof serviceClient>, filters, sign, from };
}
const payload = { videoAssetId: videoId, motionMethod: "anchored", sceneInputMode: "upload", sceneImageAssetId: imageId };
const valid = (p: Record<string, unknown>) => CreateJobSchema.safeParse({ type: "character_motion_video", characterId, payload: p }).success;
describe("Uploaded motion starting image", () => {
  it("accepts an upload without requiring a generated preview and rejects mixed or unknown modes", () => {
    expect(valid(payload)).toBe(true);
    expect(valid({ ...payload, scenePreviewJobId: crypto.randomUUID() })).toBe(false);
    expect(valid({ ...payload, sceneInputMode: "external" })).toBe(false);
    expect(valid({ ...payload, motionMethod: "legacy" })).toBe(false);
    expect(valid({ ...payload, sceneImageAssetId: undefined })).toBe(false);
    expect(valid({ ...payload, sceneInputMode: undefined })).toBe(false);
    expect(valid({ ...payload, sceneInputMode: undefined, scenePreviewJobId: crypto.randomUUID() })).toBe(true);
  });
  it("signs only the owned uploaded image, ignoring any client-provided URL", async () => {
    const d = database([image]);
    expect(await resolveMotionStartImage(d.db, "owner", characterId, videoId, { ...payload, sceneImageUrl: "https://attacker.test/image" }))
      .toBe("https://owned.supabase.co/signed-image");
    expect(d.from).toHaveBeenCalledWith("assets");
    expect(d.from).toHaveBeenCalledTimes(1);
    expect(d.filters).toEqual(expect.arrayContaining([["id", imageId], ["owner_id", "owner"], ["source", "upload"], ["media_type", "image"]]));
    expect(d.sign).toHaveBeenCalledWith("owner/upload.jpg", 7200);
  });
  it("refuses unavailable or non-image assets before signing", async () => {
    for (const row of [null, { ...image, media_type: "video" }]) {
      const d = database([row]);
      expect(await resolveMotionStartImage(d.db, "owner", characterId, videoId, payload)).toBeNull();
      expect(d.sign).not.toHaveBeenCalled();
    }
  });
  it("keeps the generated preview bound to the original video and selected character", async () => {
    const d = database([{ id: "preview", payload: { motionMethod: "scene_preview", sourceVideoAssetId: videoId } }, { assets: image }]);
    expect(await resolveMotionStartImage(d.db, "owner", characterId, videoId, { scenePreviewJobId: "preview", sceneImageAssetId: imageId }))
      .toBe("https://owned.supabase.co/signed-image");
    expect(d.filters).toEqual(expect.arrayContaining([["character_id", characterId], ["status", "completed"], ["type", "character_motion_video"], ["job_id", "preview"]]));
    const other = database([{ id: "preview", payload: { motionMethod: "scene_preview", sourceVideoAssetId: "other-video" } }]);
    expect(await resolveMotionStartImage(other.db, "owner", characterId, videoId, {})).toBeNull();
    expect(other.sign).not.toHaveBeenCalled();
  });
});
