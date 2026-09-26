export const runtime = "nodejs";

// Galéria: csak a saját elemek + szerveroldali signed URL TULAJDON-ELLENŐRZÉS után.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";

function authedClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET(req: NextRequest) {
  const sb = authedClient();
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = serviceClient();
  const albumId = req.nextUrl.searchParams.get("albumId");
  const characterId = req.nextUrl.searchParams.get("characterId");
  const view = req.nextUrl.searchParams.get("view") === "used" ? "used" : "available";
  const page = Math.min(10000, Math.max(0, Number.parseInt(req.nextUrl.searchParams.get("page") ?? "0", 10) || 0));
  const pageSize = 60;
  if (characterId && characterId !== "unassigned") {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(characterId)) {
      return NextResponse.json({ error: "INVALID_CHARACTER_ID" }, { status: 400 });
    }
    const { data: character, error: characterError } = await svc.from("characters")
      .select("id").eq("id", characterId).eq("owner_id", user.id).maybeSingle();
    if (characterError) return NextResponse.json({ error: "CHARACTER_LOOKUP_FAILED" }, { status: 500 });
    if (!character) return NextResponse.json({ error: "CHARACTER_NOT_FOUND" }, { status: 404 });
  }
  if (albumId && albumId !== "all" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(albumId)) {
    return NextResponse.json({ error: "INVALID_ALBUM_ID" }, { status: 400 });
  }
  if (albumId && albumId !== "all") {
    const { data: album, error: albumError } = await svc.from("albums").select("id")
      .eq("id", albumId).eq("owner_id", user.id).maybeSingle();
    if (albumError) return NextResponse.json({ error: "ALBUM_LOOKUP_FAILED" }, { status: 500 });
    if (!album) return NextResponse.json({ items: [] });
  }
  // media_type az assets táblából jön
  interface GalleryRow {
    id: string; qc_status: string; character_id: string | null; album_id: string | null; used_at: string | null;
    assets: { id: string; object_path: string; media_type: string; content_type: string; bytes: number } | null;
  }
  let query = svc.from("gallery_items")
    .select("id,qc_status,created_at,used_at,character_id,album_id,assets(id,object_path,media_type,content_type,bytes)", { count: "exact" })
    .eq("owner_id", user.id).is("deleted_at", null)
    .order(view === "used" ? "used_at" : "created_at", { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);
  query = view === "used" ? query.not("used_at", "is", null) : query.is("used_at", null);
  if (albumId && albumId !== "all") query = query.eq("album_id", albumId);
  if (characterId === "unassigned") query = query.is("character_id", null);
  else if (characterId) query = query.eq("character_id", characterId);
  const { data: rows, error: rowsError, count } = await query;
  if (rowsError) return NextResponse.json({ error: "GALLERY_LOOKUP_FAILED" }, { status: 500 });
  const items = (rows ?? []) as unknown as GalleryRow[];

  const enriched = await Promise.all(items.map(async (it) => {
    if (!it.assets) return null;
    // Tulajdon már az owner_id szűrés miatt garantált; signed URL kizárólag szerveren készül
    const { data: signed } = await svc.storage.from("assets")
      .createSignedUrl(it.assets.object_path, 3600);
    return {
      id: it.id,                     // visszafelé kompatibilitás
      galleryItemId: it.id,          // gallery_items.id
      assetId: it.assets.id,         // assets.id – az /api/jobs ezt várja
      mediaType: it.assets.media_type,
      contentType: it.assets.content_type,
      bytes: it.assets.bytes,
      qcStatus: it.qc_status,
      characterId: it.character_id,
      albumId: it.album_id,
      usedAt: it.used_at,
      url: signed?.signedUrl ?? null,
    };  }));
  return NextResponse.json({ items: enriched.filter((i) => i !== null), total: count ?? 0, page, pageSize });
}
