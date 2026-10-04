export const runtime = "nodejs";

// Galéria-törlés: azonnali soft-delete. A fizikai tárhelytakarítás külön feladat.
// Sorrend és tulajdon-ellenőrzés szerveroldali.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";

interface GalleryRow {
  id: string; asset_id: string; deleted_at: string | null;
  assets: { bucket: string; object_path: string } | null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  const body = await req.json().catch(() => null) as { goodBaseVideo?: unknown } | null;
  if (typeof body?.goodBaseVideo !== "boolean")
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = serviceClient();
  const { data: item, error: lookupError } = await svc.from("gallery_items")
    .select("id,assets(media_type)").eq("id", id).eq("owner_id", user.id).is("deleted_at", null).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "LOOKUP_FAILED" }, { status: 500 });
  if (!item) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if ((item.assets as { media_type?: string } | null)?.media_type !== "video")
    return NextResponse.json({ error: "VIDEO_REQUIRED" }, { status: 400 });
  const qcStatus = body.goodBaseVideo ? "approved" : "pending";
  const { data: updated, error } = await svc.from("gallery_items")
    .update({ qc_status: qcStatus }).eq("id", id).eq("owner_id", user.id)
    .is("deleted_at", null).select("id,qc_status").maybeSingle();
  if (error || !updated) return NextResponse.json({ error: "SAVE_FAILED", detail: error?.message }, { status: 500 });
  return NextResponse.json({ ok: true, qcStatus: updated.qc_status });
}

export async function DELETE(
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
  const { data: raw } = await svc.from("gallery_items")
    .select("id,asset_id,deleted_at,assets(bucket,object_path)")
    .eq("id", id).eq("owner_id", user.id).single();
  if (!raw) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const item = raw as unknown as GalleryRow;

  // 1) Soft-delete (ha még nem történt) – visszaállítható állapot
  if (!item.deleted_at) {
    const { error } = await svc.from("gallery_items")
      .update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, purged: false });
}
