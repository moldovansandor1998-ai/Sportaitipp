export const runtime = "nodejs";

// Purge cron: soft-delete-elt galérielemek storage- és asset-törlése (retryzható).
// Csak CRON_SECRET Bearer tokennel – fail-closed, mint a process végpont.
import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/server";
import { isCronAuthorized } from "@/lib/security/cron";

export async function POST(req: NextRequest) {
  const verdict = isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (verdict === "no_secret") {
    return NextResponse.json({ error: "CRON_SECRET_NOT_CONFIGURED" }, { status: 500 });
  }
  if (verdict === "unauthorized") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = serviceClient();
  // ZIP-életciklus: lejárt, fel nem használt dataset-ZIP-ek törlése
  const { data: expiredZips } = await sb.from("character_versions")
    .select("id,dataset_object_path,dataset_expires_at")
    .not("dataset_object_path", "is", null)
    .lt("dataset_expires_at", new Date().toISOString())
    .limit(50);
  let zipsPurged = 0;
  for (const v of (expiredZips ?? []) as Array<{ id: string; dataset_object_path: string | null }>) {
    if (!v.dataset_object_path) continue;
    const rm = await sb.storage.from("assets").remove([v.dataset_object_path]);
    if (rm.error) continue;
    await sb.from("character_versions").update({ dataset_object_path: null }).eq("id", v.id);
    zipsPurged += 1;
  }

  const { data: items } = await sb.from("gallery_items")
    .select("id,asset_id,assets(bucket,object_path)")
    .not("deleted_at", "is", null)
    .limit(50);

  let purged = 0;
  for (const it of (items ?? []) as Array<{ id: string; asset_id: string; assets: unknown }>) {
    const a = it.assets as { bucket: string; object_path: string } | null;
    const rm = a ? await sb.storage.from(a.bucket).remove([a.object_path]) : { error: null };
    if (rm.error) continue;                 // következő futáskor újrapróbáljuk
    const { error } = await sb.from("assets").delete().eq("id", it.asset_id);
    if (!error) purged += 1;                // a gallery sor az FK cascade-szal tűnik el
  }
  return NextResponse.json({ zipsPurged, scanned: (items ?? []).length, purged });
}
