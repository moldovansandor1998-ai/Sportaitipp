// Job részletek + a JOBBÓZ tartozó eredmények (assetId, galleryItemId, mediaType, signed URL).
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = serviceClient();
  const { data: job } = await svc.from("generation_jobs")
    .select("id,type,status,cost_estimate,cost_final,error,queued_at,finished_at")
    .eq("id", id).eq("owner_id", user.id).single();
  if (!job) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // CSAK ennek a jobnak a galéria-elemei → assetId + galleryItemId + signed URL
  const { data: items } = await svc.from("gallery_items")
    .select("id,assets(id,bucket,object_path,media_type,content_type,bytes)")
    .eq("job_id", id).eq("owner_id", user.id).is("deleted_at", null);
  interface AssetRow { id: string; bucket: string; object_path: string; media_type: string; content_type: string; bytes: number; }
  const results = await Promise.all(((items ?? []) as Array<{ id: string; assets: unknown }>).map(async (it) => {
    // PostgREST to-one embed: objektum; a típus alapértelmezése tömb – normalizáljuk
    const asset = (Array.isArray(it.assets) ? it.assets[0] : it.assets) as AssetRow | null;
    if (!asset) return null;
    // a bucket AZ ASSETBŐL jön – nincs hardcode-olt "assets"
    const { data: signed } = await svc.storage.from(asset.bucket)
      .createSignedUrl(asset.object_path, 3600);
    return {
      assetId: asset.id,
      galleryItemId: it.id,
      mediaType: asset.media_type,
      contentType: asset.content_type,
      bytes: asset.bytes,
      url: signed?.signedUrl ?? null,
    };
  }));

  return NextResponse.json({ job, results: results.filter((r) => r !== null) });
}
