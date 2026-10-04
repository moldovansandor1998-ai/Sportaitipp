import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
const Voice = z.object({ voiceId: z.string().regex(/^[a-zA-Z0-9]{10,40}$/).nullable(), hungarianTts: z.boolean().default(false) });
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const input = Voice.safeParse(await req.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !input.success)
    return NextResponse.json({ error: "validation" }, { status: 400 });
  const sb = serviceClient();
  const { data: character } = await sb.from("characters").select("id").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!character) return NextResponse.json({ error: "CHARACTER_NOT_OWNED" }, { status: 404 });
  if (input.data.voiceId) {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return NextResponse.json({ error: "ELEVENLABS_NOT_CONFIGURED" }, { status: 503 });
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(input.data.voiceId)}`, {
        headers: { "xi-api-key": key }, signal: AbortSignal.timeout(15_000), cache: "no-store",
      });
      if (!response.ok) return NextResponse.json({ error: "TTS_VOICE_INVALID" }, { status: 400 });
    } catch { return NextResponse.json({ error: "ELEVENLABS_UNAVAILABLE" }, { status: 502 }); }
  }
  const { data, error } = await sb.from("characters").update({ elevenlabs_voice_id: input.data.voiceId,
    elevenlabs_hungarian_tts: input.data.hungarianTts }).eq("id", id).eq("owner_id", user.id).select("id").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "VOICE_SAVE_FAILED" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
