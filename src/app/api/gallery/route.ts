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
  const pageSize = 24;
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
    id: string; job_id: string | null; qc_status: string; character_id: string | null; album_id: string | null; used_at: string | null;
    assets: { id: string; object_path: string; media_type: string; content_type: string; bytes: number } | null;
  }
  let query = svc.from("gallery_items")
    .select("id,job_id,qc_status,created_at,used_at,character_id,album_id,assets(id,object_path,media_type,content_type,bytes)", { count: "exact" })
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

  // The same uploaded scene can be generated for several characters. Show which
  // character's result was already used, without hiding the other results.
  const jobIds = items.map(i => i.job_id).filter((id): id is string => !!id);
  const { data: sources } = jobIds.length ? await svc.from("bulk_generation_items")
    .select("job_id,asset_id").eq("owner_id", user.id).in("job_id", jobIds) : { data: [] };
  const sourceByJob = new Map((sources ?? []).map(s => [s.job_id, s.asset_id]));
  const sourceIds = [...new Set(sourceByJob.values())];
  const { data: siblingJobs } = sourceIds.length ? await svc.from("bulk_generation_items")
    .select("job_id,asset_id").eq("owner_id", user.id).in("asset_id", sourceIds).not("job_id", "is", null) : { data: [] };
  const sourceBySiblingJob = new Map((siblingJobs ?? []).map(s => [s.job_id, s.asset_id]));
  const siblingIds = [...sourceBySiblingJob.keys()].filter((id): id is string => !!id);
  const { data: usedSiblings } = siblingIds.length ? await svc.from("gallery_items")
    .select("job_id,character_id,used_at").eq("owner_id", user.id).is("deleted_at", null)
    .not("used_at", "is", null).in("job_id", siblingIds) : { data: [] };
  const usedBySource = new Map<string, Set<string>>();
  for (const sibling of usedSiblings ?? []) {
    const sourceId = sibling.job_id && sourceBySiblingJob.get(sibling.job_id);
    if (!sourceId || !sibling.character_id) continue;
    if (!usedBySource.has(sourceId)) usedBySource.set(sourceId, new Set());
    usedBySource.get(sourceId)!.add(sibling.character_id);
  }

  const paths = items.flatMap(it => it.assets ? [it.assets.object_path] : []);
  const { data: signedUrls, error: signError } = paths.length
    ? await svc.storage.from("assets").createSignedUrls(paths, 3600)
    : { data: [], error: null };
  if (signError) return NextResponse.json({ error: "GALLERY_URL_FAILED" }, { status: 502 });
  const signedByPath = new Map((signedUrls ?? []).map(url => [url.path, url.signedUrl]));
  const enriched = items.map((it) => {
    if (!it.assets) return null;
    // Signed URLs are issued in one Storage request after ownership filtering.
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
      usedByCharacterIds: it.job_id && sourceByJob.get(it.job_id)
        ? [...(usedBySource.get(sourceByJob.get(it.job_id)!) ?? [])] : [],
      url: signedByPath.get(it.assets.object_path) ?? null,
    };  });
  return NextResponse.json({ items: enriched.filter((i) => i !== null), total: count ?? 0, page, pageSize });
}
