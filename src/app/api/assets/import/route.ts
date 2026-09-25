// Eszköz-bemeneti kép importja: privát assets bucket, tulajdon-ellenőrzés, SHA-256.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, createHash } from "crypto";
import { serviceClient } from "@/lib/supabase/server";
import { UPLOAD_LIMITS } from "@/lib/security/validation";
import { sniffMedia } from "@/lib/trainingDataset";

export async function POST(req: NextRequest) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "FILE_EMPTY" }, { status: 400 });   // üres fájl KÜLÖN hiba
  if (file.size > UPLOAD_LIMITS.maxBytes) return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 413 });
  const AUDIO = ["audio/mpeg", "audio/wav"];
  const allowed = [...UPLOAD_LIMITS.allowedMime, ...AUDIO];
  if (!allowed.includes(file.type as never)) return NextResponse.json({ error: "FILE_TYPE_NOT_ALLOWED" }, { status: 415 });

  const buf = Buffer.from(await file.arrayBuffer());
  // MIME és magic byte EGYEZÉSE kell (átnehezett/álcázott fájlok kiszűrése)
  const sniffed = sniffMedia(buf);
  if (!sniffed || sniffed !== file.type) {
    return NextResponse.json({ error: "FILE_CONTENT_MISMATCH" }, { status: 415 });
  }
  const objectPath = `${user.id}/tools/${randomUUID()}`;
  const svc = serviceClient();
  const { error: upErr } = await svc.storage.from("assets").upload(objectPath, buf, { contentType: file.type });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  const { data: asset, error: aErr } = await svc.from("assets").insert({
    owner_id: user.id, bucket: "assets", object_path: objectPath,
    media_type: sniffed.startsWith("audio") ? "audio" : "image", content_type: file.type, bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"), source: "upload",
  }).select("id").single();
  if (aErr || !asset) {
    // AZONNALI visszatörlés: nem marad árva Storage-objektum sikertelen insert után
    await svc.storage.from("assets").remove([objectPath]).catch(() => {});
    return NextResponse.json({ error: aErr?.message ?? "ASSET_INSERT_FAILED" }, { status: 500 });
  }
  return NextResponse.json({ assetId: (asset as { id: string }).id });
}
