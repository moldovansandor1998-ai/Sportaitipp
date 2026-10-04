import "server-only";
import { serviceClient } from "@/lib/supabase/server";

/** Existing assignments are retained; database overrides also survive character renaming. */
export function legacyCharacterVoice(name: string): { voiceId?: string; hungarianTts: boolean } {
  const model = name.trim().toLocaleLowerCase("hu");
  const voices: Record<string, string | undefined> = {
    laura: process.env.ELEVENLABS_LAURA_VOICE_ID, petra: process.env.ELEVENLABS_PETRA_VOICE_ID,
    dorina: process.env.ELEVENLABS_DORINA_VOICE_ID, dorika: process.env.ELEVENLABS_ZSOFI_VOICE_ID,
    "dóra": process.env.ELEVENLABS_ZSOFI_VOICE_ID, "zsófia": process.env.ELEVENLABS_DORA_VOICE_ID,
    "zsófi": process.env.ELEVENLABS_DORA_VOICE_ID,
  };
  return { voiceId: voices[model], hungarianTts: model === "zsófi" || model === "zsófia" };
}

export async function resolveCharacterVoice(sb: ReturnType<typeof serviceClient>, characterId: string, ownerId: string) {
  const { data, error } = await sb.from("characters").select("name,elevenlabs_voice_id,elevenlabs_hungarian_tts")
    .eq("id", characterId).eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error("CHARACTER_VOICE_LOOKUP_FAILED");
  if (!data) return null;
  if (data.elevenlabs_voice_id) return { voiceId: data.elevenlabs_voice_id as string, hungarianTts: data.elevenlabs_hungarian_tts === true };
  const legacy = legacyCharacterVoice(data.name);
  if (!legacy.voiceId) return legacy;
  const { error: saveError } = await sb.from("characters").update({ elevenlabs_voice_id: legacy.voiceId,
    elevenlabs_hungarian_tts: legacy.hungarianTts }).eq("id", characterId).eq("owner_id", ownerId).is("elevenlabs_voice_id", null);
  if (saveError) throw new Error("CHARACTER_VOICE_SAVE_FAILED");
  // A concurrent settings update wins; read the assignment actually stored.
  const { data: stored, error: readError } = await sb.from("characters").select("elevenlabs_voice_id,elevenlabs_hungarian_tts")
    .eq("id", characterId).eq("owner_id", ownerId).single();
  if (readError) throw new Error("CHARACTER_VOICE_LOOKUP_FAILED");
  return { voiceId: stored.elevenlabs_voice_id as string, hungarianTts: stored.elevenlabs_hungarian_tts === true };
}
