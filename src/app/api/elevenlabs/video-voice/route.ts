export const runtime = "nodejs";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "crypto";
import { serviceClient } from "@/lib/supabase/server";

const VOICE_NAMES: Record<string, string> = { laura: "laura" };

export async function POST(req: NextRequest) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return NextResponse.json({ error: "ELEVENLABS_NOT_CONFIGURED" }, { status: 503 });
  let body: { videoAssetId?: unknown; characterId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 }); }
  const isId = (value: unknown): value is string => typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  if (!isId(body.videoAssetId) || !isId(body.characterId))
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const svc = serviceClient();
  const [{ data: character }, { data: video }] = await Promise.all([
    svc.from("characters").select("name").eq("id", body.characterId).eq("owner_id", user.id).single(),
    svc.from("assets").select("bucket,object_path,media_type,bytes,content_type")
      .eq("id", body.videoAssetId).eq("owner_id", user.id).single(),
  ]);
  if (!character || !video || video.media_type !== "video" || video.content_type !== "video/mp4" ||
      typeof video.bytes !== "number" || video.bytes > 48 * 1024 * 1024)
    return NextResponse.json({ error: "VIDEO_NOT_FOUND" }, { status: 404 });
  const targetName = VOICE_NAMES[character.name.trim().toLocaleLowerCase("hu")];
  if (!targetName) return NextResponse.json({ error: "MODEL_VOICE_NOT_CONFIGURED" }, { status: 409 });
  try {
    const voicesResponse = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": key }, signal: AbortSignal.timeout(15000), cache: "no-store",
    });
    if (!voicesResponse.ok) return NextResponse.json({ error: "ELEVENLABS_VOICES_FAILED" }, { status: 502 });
    const voices = await voicesResponse.json() as { voices?: Array<{ voice_id?: string; name?: string }> };
    const voiceId = voices.voices?.find((voice) => voice.name?.toLocaleLowerCase("hu") === targetName)?.voice_id;
    if (!voiceId) return NextResponse.json({ error: "LAURA_VOICE_NOT_FOUND" }, { status: 409 });

    const { data: source, error: downloadError } = await svc.storage.from(video.bucket).download(video.object_path);
    if (downloadError || !source) return NextResponse.json({ error: "VIDEO_DOWNLOAD_FAILED" }, { status: 502 });
    const form = new FormData();
    form.append("audio", new File([source], "reference.mp4", { type: "video/mp4" }));
    form.append("model_id", "eleven_multilingual_sts_v2");
    const response = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": key }, body: form, signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) return NextResponse.json({ error: "VOICE_CONVERSION_FAILED", status: response.status }, { status: 502 });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 15_000_000 ||
      !(bytes.subarray(0, 3).equals(Buffer.from("ID3")) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)))
      return NextResponse.json({ error: "INVALID_AUDIO_RESULT" }, { status: 502 });
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
    return NextResponse.json({ error: "VOICE_CONVERSION_UNAVAILABLE" }, { status: 502 });
  }
}
