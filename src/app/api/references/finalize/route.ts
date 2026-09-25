export const runtime = "nodejs";

// Referenciafeltöltés szerveroldali lezárása:
// aláírt URL-lel feltöltött fájl ellenőrzése (méret, MIME, objektum létezése,
// karaktertulajdon, SHA-256) + asset + referencia-sor létrehozása.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { serviceClient } from "@/lib/supabase/server";
import { UPLOAD_LIMITS } from "@/lib/security/validation";

export async function POST(req: NextRequest) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const objectPath: string = String(body.objectPath ?? "");
  const characterId: string = String(body.characterId ?? "");
  const kind: string = ["face", "half_body", "full_body"].includes(body.kind) ? body.kind : "face";

  if (!objectPath.startsWith(`${user.id}/`) || objectPath.includes("..")) {
    return NextResponse.json({ error: "INVALID_OBJECT_PATH" }, { status: 400 });
  }

  const svc = serviceClient();

  // Karaktertulajdon ellenőrzése
  const { data: character } = await svc.from("characters")
    .select("id").eq("id", characterId).eq("owner_id", user.id).single();
  if (!character) return NextResponse.json({ error: "CHARACTER_NOT_OWNED" }, { status: 403 });

  // Objektum lekérése + ellenőrzés
  const { data: file, error: dlErr } = await svc.storage.from("references").download(objectPath);
  if (dlErr || !file) return NextResponse.json({ error: "OBJECT_NOT_FOUND" }, { status: 404 });

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0 || buf.length > UPLOAD_LIMITS.maxBytes) {
    await svc.storage.from("references").remove([objectPath]);
    return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 413 });
  }
  const contentType = file.type || "application/octet-stream";
  if (!(UPLOAD_LIMITS.allowedMime as readonly string[]).includes(contentType)) {
    await svc.storage.from("references").remove([objectPath]);
    return NextResponse.json({ error: "FILE_TYPE_NOT_ALLOWED" }, { status: 415 });
  }

  const sha256 = createHash("sha256").update(buf).digest("hex");

  // Duplikátum-ellenőrzés ugyanarra a karakterre (azonos hash)
  const { data: dup } = await svc.from("assets")
    .select("id").eq("owner_id", user.id).eq("sha256", sha256)
    .eq("bucket", "references").limit(1);
  if (dup?.length) {
    return NextResponse.json({ error: "DUPLICATE_IMAGE" }, { status: 409 });
  }

  const { data: asset, error: assetErr } = await svc.from("assets").insert({
    owner_id: user.id, bucket: "references", object_path: objectPath,
    media_type: "image", content_type: contentType, bytes: buf.length,
    sha256, source: "upload",
  }).select("id").single();
  if (assetErr) return NextResponse.json({ error: assetErr.message }, { status: 500 });

  const { data: ref, error: refErr } = await svc.from("character_reference_images").insert({
    character_id: characterId, asset_id: asset.id, kind,
  }).select("id").single();
  if (refErr) return NextResponse.json({ error: refErr.message }, { status: 500 });

  return NextResponse.json({ assetId: asset.id, referenceId: ref.id, sha256 });
}
