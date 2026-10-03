export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return NextResponse.json({ error: "ELEVENLABS_NOT_CONFIGURED" }, { status: 503 });
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": key }, signal: AbortSignal.timeout(15_000), cache: "no-store",
    });
    if (!response.ok) return NextResponse.json({ error: "ELEVENLABS_VOICES_FAILED" }, { status: 502 });
    const data = await response.json() as { voices?: Array<{ voice_id?: string; name?: string }> };
    return NextResponse.json({ voices: (data.voices ?? []).filter((v) => v.voice_id && v.name)
      .map((v) => ({ id: v.voice_id, name: v.name })) });
  } catch {
    return NextResponse.json({ error: "ELEVENLABS_UNAVAILABLE" }, { status: 502 });
  }
}
