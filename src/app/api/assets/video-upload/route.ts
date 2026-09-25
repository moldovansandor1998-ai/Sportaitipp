export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { serviceClient } from "@/lib/supabase/server";

const MAX_VIDEO_BYTES = 48 * 1024 * 1024;
const TYPES = ["video/mp4", "video/webm"];

async function owner(req: NextRequest) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return (await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "")).data.user;
}

export async function POST(req: NextRequest) {
  const user = await owner(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { contentType, size } = await req.json() as { contentType?: string; size?: number };
  if (!TYPES.includes(contentType ?? "") || !Number.isInteger(size) || !size || size > MAX_VIDEO_BYTES)
    return NextResponse.json({ error: "Csak MP4 vagy WebM videó tölthető fel, legfeljebb 48 MB méretben." }, { status: 400 });
  const objectPath = `${user.id}/tools/video-${randomUUID()}`;
  const { data, error } = await serviceClient().storage.from("assets").createSignedUploadUrl(objectPath);
  if (error || !data) return NextResponse.json({ error: "Nem sikerült előkészíteni a videófeltöltést." }, { status: 502 });
  return NextResponse.json({ objectPath, token: data.token });
}

export async function PUT(req: NextRequest) {
  const user = await owner(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { objectPath, sha256 } = await req.json() as { objectPath?: string; sha256?: string };
  if (!objectPath || !new RegExp(`^${user.id}/tools/video-[0-9a-f-]{36}$`).test(objectPath))
    return NextResponse.json({ error: "Érvénytelen feltöltés." }, { status: 400 });
  if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256)) return NextResponse.json({ error: "Hiányzó fájl-ellenőrző összeg." }, { status: 400 });
  const svc = serviceClient();
  const { data: existing } = await svc.from("assets").select("id").eq("owner_id", user.id).eq("bucket", "assets").eq("object_path", objectPath).maybeSingle();
  if (existing) return NextResponse.json({ assetId: existing.id });
  const { data: info, error } = await svc.storage.from("assets").info(objectPath);
  const size = Number(info?.size);
  const contentType = info?.contentType;
  if (error || !TYPES.includes(contentType ?? "") || !size || size > MAX_VIDEO_BYTES)
    return NextResponse.json({ error: "A feltöltött videó mérete vagy típusa hibás." }, { status: 415 });
  const { data: signed } = await svc.storage.from("assets").createSignedUrl(objectPath, 60);
  if (!signed?.signedUrl) return NextResponse.json({ error: "A videó nem ellenőrizhető." }, { status: 502 });
  const response = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-31" }, signal: AbortSignal.timeout(10000) });
  if (!response.ok || !response.body) return NextResponse.json({ error: "A videó nem olvasható." }, { status: 415 });
  const reader = response.body.getReader();
  const first = await reader.read();
  await reader.cancel();
  const header = Buffer.from(first.value ?? []);
  const valid = contentType === "video/mp4"
    ? header.length >= 12 && header.toString("ascii", 4, 8) === "ftyp"
    : header.length >= 4 && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (!valid) {
    await svc.storage.from("assets").remove([objectPath]);
    return NextResponse.json({ error: "A fájl nem valódi MP4 vagy WebM videó." }, { status: 415 });
  }
  const { data: asset, error: insertError } = await svc.from("assets").insert({
    owner_id: user.id, bucket: "assets", object_path: objectPath, media_type: "video",
    content_type: contentType, bytes: size, sha256, source: "upload",
  }).select("id").single();
  if (insertError || !asset) return NextResponse.json({ error: insertError?.message ?? "A videó mentése sikertelen." }, { status: 500 });
  return NextResponse.json({ assetId: asset.id });
}
