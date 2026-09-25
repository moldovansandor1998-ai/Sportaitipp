import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";
import { buildRouter } from "@/lib/providers";
import { assertAllowedUrl } from "@/lib/security/ssrf";
import { sniffImage } from "@/lib/trainingDataset";

export const runtime = "nodejs";

// Restore a result the provider already produced; never submit or charge a new prediction.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await auth.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = serviceClient();
  const { data: job } = await svc.from("generation_jobs").select("*").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!job || job.type !== "character_swap" || job.provider !== "wavespeed" || job.status !== "refunded"
      || job.error?.message !== "URL_HOST_NOT_ALLOWED" || !job.provider_job_id) {
    return NextResponse.json({ error: "RECOVERY_NOT_APPLICABLE" }, { status: 409 });
  }
  const { data: prior } = await svc.from("gallery_items").select("asset_id").eq("job_id", id).eq("owner_id", user.id).limit(1).maybeSingle();
  if (prior) return NextResponse.json({ recovered: true, assetId: prior.asset_id });
  try {
    const adapter = buildRouter().getAdapter("wavespeed");
    if (!adapter || await adapter.getStatus(job.provider_job_id, job.provider_meta) !== "done")
      return NextResponse.json({ error: "RESULT_NOT_READY" }, { status: 409 });
    const output = await adapter.getResult(job.provider_job_id, job.provider_meta, "character_swap");
    const url = output.files.find((f) => f.kind === "image")?.url;
    if (!url) return NextResponse.json({ error: "IMAGE_MISSING" }, { status: 502 });
    const safe = assertAllowedUrl(url);
    const response = await fetch(safe, { redirect: "error", signal: AbortSignal.timeout(30000) });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 12 * 1024 * 1024)
      return NextResponse.json({ error: "DOWNLOAD_FAILED" }, { status: 502 });
    const bytes = Buffer.from(await response.arrayBuffer());
    const mime = bytes.length <= 12 * 1024 * 1024 ? sniffImage(bytes) : null;
    if (!mime) return NextResponse.json({ error: "INVALID_IMAGE_FORMAT" }, { status: 502 });
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const objectPath = `${user.id}/${id}/recovered-face-swap.${ext}`;
    const { error: uploadError } = await svc.storage.from("assets").upload(objectPath, bytes, { contentType: mime, upsert: true });
    if (uploadError) throw uploadError;
    const { data: asset, error: assetError } = await svc.from("assets").upsert({
      owner_id: user.id, bucket: "assets", object_path: objectPath, media_type: "image",
      content_type: mime, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), source: "generation",
    }, { onConflict: "bucket,object_path" }).select("id").single();
    if (assetError || !asset) throw assetError ?? new Error("ASSET_SAVE_FAILED");
    const { error: galleryError } = await svc.from("gallery_items").upsert({
      owner_id: user.id, asset_id: asset.id, job_id: id, character_id: job.character_id, qc_status: "pending",
    }, { onConflict: "owner_id,asset_id" });
    if (galleryError) throw galleryError;
    const { error: jobError } = await svc.from("generation_jobs")
      .update({ result: { assetIds: [asset.id], recoveredFromProvider: true } }).eq("id", id).eq("owner_id", user.id);
    if (jobError) throw jobError;
    return NextResponse.json({ recovered: true, assetId: asset.id });
  } catch (e) {
    console.error(JSON.stringify({ scope: "recover.face_swap", jobId: id, error: String(e) }));
    return NextResponse.json({ error: "RECOVERY_FAILED" }, { status: 502 });
  }
}
