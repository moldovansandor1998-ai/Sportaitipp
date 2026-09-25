export const runtime = "nodejs";

// Galéria-törlés: soft-delete (deleted_at) + retryzható, best-effort storage-purgálás.
// Sorrend és tulajdon-ellenőrzés szerveroldali.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";

interface GalleryRow {
  id: string; asset_id: string; deleted_at: string | null;
  assets: { bucket: string; object_path: string } | null;
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

  // 2) Storage-purgálás best-effort – hiba esetén retry-vel újrapróbálható
  let purged = true;
  if (item.assets) {
    const { error: rmErr } = await svc.storage.from(item.assets.bucket).remove([item.assets.object_path]);
    purged = !rmErr;
  }
  return NextResponse.json({ ok: true, purged });
}
