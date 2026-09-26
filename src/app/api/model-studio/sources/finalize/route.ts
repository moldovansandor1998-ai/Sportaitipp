import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { sniffMedia } from "@/lib/trainingDataset";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!["tiktok", "telegram", "fanvue_public"].includes(body.pool)
      || typeof body.objectPath !== "string"
      || !new RegExp(`^${user.id}/content-sources/[0-9a-f-]{36}$`).test(body.objectPath))
    return NextResponse.json({ error: "INVALID_UPLOAD" }, { status: 400 });
  const sb = serviceClient();
  const { data: already } = await sb.from("assets").select("id").eq("owner_id", user.id)
    .eq("bucket", "assets").eq("object_path", body.objectPath).maybeSingle();
  if (already) return NextResponse.json({ error: "ALREADY_FINALIZED" }, { status: 409 });
  const { data: blob, error: downloadError } = await sb.storage.from("assets").download(body.objectPath);
  if (downloadError || !blob) return NextResponse.json({ error: "UPLOAD_MISSING" }, { status: 404 });
  const bytes = Buffer.from(await blob.arrayBuffer());
  const contentType = sniffMedia(bytes);
  if (!bytes.length || bytes.length > 15 * 1024 * 1024 || !contentType
      || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    await sb.storage.from("assets").remove([body.objectPath]);
    return NextResponse.json({ error: "INVALID_IMAGE" }, { status: 422 });
  }
  let width: number | undefined, height: number | undefined;
  try { ({ width, height } = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata()); }
  catch { /* invalid image */ }
  if (!width || !height || width < 512 || height < 512
      || (body.pool === "tiktok" && Math.abs(width / height - 9 / 16) > 0.025)) {
    await sb.storage.from("assets").remove([body.objectPath]);
    return NextResponse.json({ error: body.pool === "tiktok" ? "TIKTOK_REQUIRES_9_16" : "INVALID_IMAGE" }, { status: 422 });
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { data: duplicate } = await sb.from("content_source_images").select("id")
    .eq("owner_id", user.id).eq("sha256", sha256).maybeSingle();
  if (duplicate) {
    await sb.storage.from("assets").remove([body.objectPath]);
    return NextResponse.json({ error: "DUPLICATE_IMAGE" }, { status: 409 });
  }
  const { data: asset, error: assetError } = await sb.from("assets").insert({
    owner_id: user.id, bucket: "assets", object_path: body.objectPath,
    media_type: "image", content_type: contentType, bytes: bytes.length, sha256, source: "upload",
  }).select("id").single();
  if (assetError || !asset) return NextResponse.json({ error: "ASSET_SAVE_FAILED" }, { status: 500 });
  const { data: source, error } = await sb.from("content_source_images").insert({
    owner_id: user.id, asset_id: asset.id, pool: body.pool, sha256,
  }).select("id").single();
  if (error || !source) {
    await sb.from("assets").delete().eq("id", asset.id);
    await sb.storage.from("assets").remove([body.objectPath]);
    return NextResponse.json({ error: error?.code === "23505" ? "DUPLICATE_IMAGE" : "SOURCE_SAVE_FAILED" }, { status: 409 });
  }
  return NextResponse.json({ id: source.id }, { status: 201 });
}
