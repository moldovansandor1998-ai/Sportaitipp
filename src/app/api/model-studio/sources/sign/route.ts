import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input = await req.json().catch(() => ({}));
  if (!["tiktok", "telegram_fanvue"].includes(input.pool)
      || !["image/jpeg", "image/png", "image/webp"].includes(input.contentType)
      || !Number.isInteger(input.size) || input.size <= 0 || input.size > 15 * 1024 * 1024)
    return NextResponse.json({ error: "INVALID_UPLOAD" }, { status: 400 });
  const objectPath = `${user.id}/content-sources/${randomUUID()}`;
  const { data, error } = await serviceClient().storage.from("assets").createSignedUploadUrl(objectPath);
  if (error || !data?.token) return NextResponse.json({ error: "UPLOAD_SIGNING_FAILED" }, { status: 502 });
  return NextResponse.json({ objectPath, token: data.token });
}
