import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import sharp from "sharp";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { sniffMedia } from "@/lib/trainingDataset";

export const runtime = "nodejs";
const MAX_FILE = 15 * 1024 * 1024;
const pools = new Set(["tiktok", "telegram", "fanvue_public"]);

export async function GET(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = serviceClient();
  const { data, error } = await sb.from("content_source_images")
    .select("id,pool,created_at,used_at,asset_id,assets(bucket,object_path)")
    .eq("owner_id", user.id).order("created_at", { ascending: false }).limit(300);
  if (error) return NextResponse.json({ error: "SOURCES_UNAVAILABLE" }, { status: 500 });
  const sources = await Promise.all((data ?? []).map(async (row) => {
    const asset = row.assets as unknown as { bucket: string; object_path: string } | null;
    const signed = asset ? await sb.storage.from(asset.bucket).createSignedUrl(asset.object_path, 3600) : null;
    return { id: row.id, pool: row.pool, created_at: row.created_at, used_at: row.used_at,
      preview_url: signed?.data?.signedUrl ?? null };
  }));
  return NextResponse.json({ sources });
}

export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData();
  const pool = form.get("pool");
  const file = form.get("file");
  if (typeof pool !== "string" || !pools.has(pool) || !(file instanceof File))
    return NextResponse.json({ error: "INVALID_UPLOAD" }, { status: 400 });
  if (!file.size || file.size > MAX_FILE || !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return NextResponse.json({ error: "IMAGE_TYPE_OR_SIZE" }, { status: 415 });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (sniffMedia(bytes) !== file.type) return NextResponse.json({ error: "IMAGE_CONTENT_MISMATCH" }, { status: 415 });
  let width: number | undefined, height: number | undefined;
  try { ({ width, height } = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata()); }
  catch { return NextResponse.json({ error: "INVALID_IMAGE" }, { status: 422 }); }
  if (!width || !height || width < 512 || height < 512)
    return NextResponse.json({ error: "IMAGE_TOO_SMALL" }, { status: 422 });
  if (pool === "tiktok" && Math.abs(width / height - 9 / 16) > 0.025)
    return NextResponse.json({ error: "TIKTOK_REQUIRES_9_16" }, { status: 422 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sb = serviceClient();
  const { data: existing } = await sb.from("content_source_images").select("id,pool,used_at")
    .eq("owner_id", user.id).eq("sha256", sha256).maybeSingle();
  if (existing) return NextResponse.json({ error: "DUPLICATE_IMAGE", source: existing }, { status: 409 });
  const objectPath = `${user.id}/content-sources/${randomUUID()}`;
  const { error: uploadError } = await sb.storage.from("assets").upload(objectPath, bytes, { contentType: file.type });
  if (uploadError) return NextResponse.json({ error: "UPLOAD_FAILED" }, { status: 500 });
  const { data: asset, error: assetError } = await sb.from("assets").insert({ owner_id: user.id,
    bucket: "assets", object_path: objectPath, media_type: "image", content_type: file.type,
    bytes: bytes.length, sha256, source: "upload" }).select("id").single();
  if (assetError || !asset) {
    await sb.storage.from("assets").remove([objectPath]);
    return NextResponse.json({ error: "ASSET_SAVE_FAILED" }, { status: 500 });
  }
  const { data: source, error: sourceError } = await sb.from("content_source_images")
    .insert({ owner_id: user.id, asset_id: asset.id, pool, sha256 }).select("id").single();
  if (sourceError || !source) {
    await sb.from("assets").delete().eq("id", asset.id);
    await sb.storage.from("assets").remove([objectPath]);
    return NextResponse.json({ error: sourceError?.code === "23505" ? "DUPLICATE_IMAGE" : "SOURCE_SAVE_FAILED" }, { status: 409 });
  }
  return NextResponse.json({ id: source.id }, { status: 201 });
}
