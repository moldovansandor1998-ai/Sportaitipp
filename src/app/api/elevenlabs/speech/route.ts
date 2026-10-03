export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "crypto";
import { serviceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return NextResponse.json({ error: "ELEVENLABS_NOT_CONFIGURED" }, { status: 503 });
  let body: { text?: unknown; voiceId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 }); }
  const content = typeof body.text === "string" ? body.text.trim() : "";
  const voiceId = typeof body.voiceId === "string" ? body.voiceId : "";
  if (!content || content.length > 1500 || !/^[A-Za-z0-9]{10,40}$/.test(voiceId))
    return NextResponse.json({ error: "INVALID_SPEECH_INPUT" }, { status: 400 });
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text: content, model_id: "eleven_multilingual_v2" }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) return NextResponse.json({ error: "ELEVENLABS_GENERATION_FAILED", status: response.status }, { status: 502 });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 15_000_000 || !bytes.subarray(0, 3).equals(Buffer.from("ID3")) &&
      !(bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))
      return NextResponse.json({ error: "INVALID_AUDIO_RESULT" }, { status: 502 });
    const svc = serviceClient();
    const objectPath = `${user.id}/tools/${randomUUID()}.mp3`;
    const { error: uploadError } = await svc.storage.from("assets").upload(objectPath, bytes, { contentType: "audio/mpeg" });
    if (uploadError) return NextResponse.json({ error: "AUDIO_STORAGE_FAILED" }, { status: 502 });
    const { data: asset, error } = await svc.from("assets").insert({
      owner_id: user.id, bucket: "assets", object_path: objectPath,
      media_type: "audio", content_type: "audio/mpeg", bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), source: "generation",
    }).select("id").single();
    if (error || !asset) {
      await svc.storage.from("assets").remove([objectPath]);
      return NextResponse.json({ error: "AUDIO_ASSET_FAILED" }, { status: 502 });
    }
    return NextResponse.json({ assetId: asset.id });
  } catch {
    return NextResponse.json({ error: "ELEVENLABS_UNAVAILABLE" }, { status: 502 });
  }
}
