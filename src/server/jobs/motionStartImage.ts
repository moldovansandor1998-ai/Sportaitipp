import "server-only";
import { serviceClient } from "@/lib/supabase/server";

/** Resolve only server-owned assets; client image URLs are never trusted. */
export async function resolveMotionStartImage(db: ReturnType<typeof serviceClient>, ownerId: string, characterId: string,
  sourceVideoAssetId: string, payload: Record<string, unknown>): Promise<string | null> {
  let sceneAsset: { bucket: string; object_path: string; media_type: string } | null = null;
  if (payload.sceneInputMode === "upload") {
    const { data } = await db.from("assets").select("bucket,object_path,media_type")
      .eq("id", String(payload.sceneImageAssetId)).eq("owner_id", ownerId)
      .eq("source", "upload").eq("media_type", "image").maybeSingle();
    sceneAsset = data;
  } else {
    const { data: preview } = await db.from("generation_jobs").select("id,payload")
      .eq("id", String(payload.scenePreviewJobId)).eq("owner_id", ownerId)
      .eq("character_id", characterId).eq("type", "character_motion_video")
      .eq("status", "completed").maybeSingle();
    const origin = preview?.payload as Record<string, unknown> | undefined;
    if (origin?.motionMethod !== "scene_preview" || origin.sourceVideoAssetId !== sourceVideoAssetId) return null;
    const { data: approved } = await db.from("gallery_items").select("assets!inner(bucket,object_path,media_type)")
      .eq("job_id", preview!.id).eq("owner_id", ownerId)
      .eq("asset_id", String(payload.sceneImageAssetId)).is("deleted_at", null).maybeSingle();
    sceneAsset = approved?.assets as unknown as typeof sceneAsset;
  }
  if (!sceneAsset || sceneAsset.media_type !== "image") return null;
  const { data: signed } = await db.storage.from(sceneAsset.bucket).createSignedUrl(sceneAsset.object_path, 7200);
  return signed?.signedUrl ?? null;
}
