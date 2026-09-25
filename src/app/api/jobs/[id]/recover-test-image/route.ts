import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";
import { buildRouter } from "@/lib/providers";
import { assertAllowedUrl } from "@/lib/security/ssrf";
import { sniffImage } from "@/lib/trainingDataset";

export const runtime = "nodejs";

// Csak a korábbi, fal által már elkészített kép visszaállítása. Új provider-kérés nincs.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await auth.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = serviceClient();
  const { data: job } = await svc.from("generation_jobs").select("*").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!job) return NextResponse.json({ error: "JOB_NOT_FOUND" }, { status: 404 });
  if (job.type !== "test_image" || job.status !== "refunded" || job.provider !== "fal"
      || !job.provider_job_id || job.error?.message !== "URL_HOST_NOT_ALLOWED" || !job.character_id) {
    return NextResponse.json({ error: "RECOVERY_NOT_APPLICABLE" }, { status: 409 });
  }
  const { data: version } = await svc.from("character_versions").select("id,test_image_asset_id")
    .eq("character_id", job.character_id).eq("status", "test_pending")
    .not("provider_model_ref", "is", null).order("version_no", { ascending: false }).limit(1).maybeSingle();
  if (!version) return NextResponse.json({ error: "VERSION_NOT_FOUND" }, { status: 409 });
  if (version.test_image_asset_id) return NextResponse.json({ assetId: version.test_image_asset_id, recovered: true });
  try {
    const adapter = buildRouter().getAdapter("fal");
    if (!adapter || await adapter.getStatus(job.provider_job_id, job.provider_meta) !== "done") {
      return NextResponse.json({ error: "PROVIDER_RESULT_NOT_READY" }, { status: 409 });
    }
    const output = await adapter.getResult(job.provider_job_id, job.provider_meta, "test_image");
    const url = output.files.find((file) => file.kind === "image")?.url;
    if (!url) return NextResponse.json({ error: "PROVIDER_IMAGE_MISSING" }, { status: 502 });
    const safe = assertAllowedUrl(url);
    const response = await fetch(safe, { redirect: "error", signal: AbortSignal.timeout(30000) });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "IMAGE_DOWNLOAD_FAILED" }, { status: 502 });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const mime = bytes.length <= 12 * 1024 * 1024 ? sniffImage(bytes) : null;
    if (!mime) return NextResponse.json({ error: "INVALID_IMAGE_FORMAT" }, { status: 502 });
    const objectPath = `${user.id}/${id}/recovered-test-image.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`;
    const { error: uploadError } = await svc.storage.from("assets").upload(objectPath, bytes, { contentType: mime, upsert: true });
    if (uploadError) throw uploadError;
    const { data: asset, error: assetError } = await svc.from("assets").upsert({
      owner_id: user.id, bucket: "assets", object_path: objectPath, media_type: "image",
      content_type: mime, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), source: "generation",
    }, { onConflict: "bucket,object_path" }).select("id").single();
    if (assetError || !asset) throw assetError ?? new Error("ASSET_SAVE_FAILED");
    const { error: versionError } = await svc.from("character_versions")
      .update({ test_image_asset_id: asset.id }).eq("id", version.id).eq("status", "test_pending")
      .is("test_image_asset_id", null);
    if (versionError) throw versionError;
    const { data: existingGallery } = await svc.from("gallery_items").select("id")
      .eq("owner_id", user.id).eq("asset_id", asset.id).maybeSingle();
    if (!existingGallery) await svc.from("gallery_items").insert({ owner_id: user.id, asset_id: asset.id,
      job_id: id, character_id: job.character_id, qc_status: "pending" });
    await svc.from("generation_jobs").update({ result: { assetIds: [asset.id], recoveredFromProvider: true } }).eq("id", id);
    return NextResponse.json({ assetId: asset.id, recovered: true });
  } catch (e) {
    console.error(JSON.stringify({ scope: "recover.test_image", jobId: id, error: String(e) }));
    return NextResponse.json({ error: "RECOVERY_FAILED" }, { status: 502 });
  }
}
