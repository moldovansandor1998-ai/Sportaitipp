import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase/server";
import { resolveCharacterVoice } from "@/server/jobs/characterVoice";
import { REDUB_DELIVERIES } from "@/lib/videoRedub";

export const runtime = "nodejs";

/** Recover a paid, completed speech preview without generating or charging again. */
export async function GET(req: NextRequest) {
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await auth.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const characterId = req.nextUrl.searchParams.get("characterId");
  if (!z.string().uuid().safeParse(characterId).success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const sb = serviceClient();
  const voice = await resolveCharacterVoice(sb, characterId!, user.id);
  if (!voice?.voiceId) return NextResponse.json({ error: "TTS_VOICE_INVALID" }, { status: 404 });
  const { data: job, error } = await sb.from("generation_jobs").select("id,payload")
    .eq("owner_id", user.id).eq("character_id", characterId!).eq("type", "tts").eq("status", "completed")
    .eq("payload->>videoRedubSpeech", "true").eq("payload->>voiceId", voice.voiceId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: "SPEECH_LOOKUP_FAILED" }, { status: 502 });
  if (!job) return NextResponse.json({ error: "NO_COMPLETED_SPEECH" }, { status: 404 });
  const { data: gallery } = await sb.from("gallery_items").select("id")
    .eq("job_id", job.id).eq("owner_id", user.id).eq("character_id", characterId!).is("deleted_at", null).limit(1).maybeSingle();
  if (!gallery) return NextResponse.json({ error: "NO_COMPLETED_SPEECH" }, { status: 404 });
  const payload = job.payload as { text?: string; delivery?: string };
  return NextResponse.json({ jobId: job.id, text: payload.text ?? "", delivery: REDUB_DELIVERIES.includes(payload.delivery as typeof REDUB_DELIVERIES[number]) ? payload.delivery : "natural" },
    { headers: { "cache-control": "no-store" } });
}
