import "server-only";
import { serviceClient } from "@/lib/supabase/server";
import { resolveCharacterVoice } from "./characterVoice";
import { mediaDuration } from "./mediaDuration";
import { REDUB_MAX_SECONDS, REDUB_DELIVERIES, type RedubDelivery } from "@/lib/videoRedub";
import { imageTalkingPrompt, type TalkingMotion } from "@/lib/imageTalking";
import type { PreparedJob } from "./prepareJob";

export async function prepareImageTalking(ownerId: string, characterId: string, input: Record<string, unknown>, projectId?: string): Promise<PreparedJob> {
  const type = "talking_video";
  const bad = (error: PreparedJob["error"], status = 400): PreparedJob => ({ type, payload: {}, error, status });
  if (!process.env.WAVESPEED_API_KEY) return bad("PROVIDER_MODEL_INVALID", 503);
  const sb = serviceClient();
  const { data: image } = await sb.from("assets").select("id,bucket,object_path,content_type,bytes,source")
    .eq("id", String(input.imageAssetId)).eq("owner_id", ownerId).eq("media_type", "image").maybeSingle();
  if (!image || image.bytes > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(image.content_type))
    return bad("IMAGE_INPUT_REQUIRED", 415);
  if (image.source === "generation") {
    const { data: gallery } = await sb.from("gallery_items").select("id").eq("asset_id", image.id)
      .eq("owner_id", ownerId).eq("character_id", characterId).is("deleted_at", null).maybeSingle();
    if (!gallery) return bad("IMAGE_INPUT_REQUIRED", 404);
  } else if (image.source !== "upload") return bad("IMAGE_INPUT_REQUIRED", 404);
  const voice = await resolveCharacterVoice(sb, characterId, ownerId);
  if (!voice?.voiceId) return bad("TTS_VOICE_INVALID", 409);
  const { data: speech } = await sb.from("generation_jobs").select("id,payload,result")
    .eq("id", String(input.speechJobId)).eq("owner_id", ownerId).eq("character_id", characterId)
    .eq("type", "tts").eq("status", "completed").maybeSingle();
  const payload = speech?.payload as { videoRedubSpeech?: boolean; voiceId?: string; delivery?: RedubDelivery } | undefined;
  const audioId = (speech?.result as { assetIds?: string[] } | null)?.assetIds?.[0];
  if (payload?.videoRedubSpeech !== true || payload.voiceId !== voice.voiceId || !audioId) return bad("TTS_VOICE_INVALID", 409);
  const { data: audio } = await sb.from("assets").select("bucket,object_path")
    .eq("id", audioId).eq("owner_id", ownerId).eq("media_type", "audio").maybeSingle();
  if (!audio) return bad("SOURCE_IMAGE_REQUIRED", 404);
  const [{ data: i }, { data: a }] = await Promise.all([
    sb.storage.from(image.bucket).createSignedUrl(image.object_path, 7200),
    sb.storage.from(audio.bucket).createSignedUrl(audio.object_path, 7200),
  ]);
  if (!i?.signedUrl || !a?.signedUrl) return bad("SOURCE_IMAGE_REQUIRED", 502);
  try {
    const seconds = await mediaDuration(a.signedUrl);
    if (seconds > REDUB_MAX_SECONDS) return bad("REDUB_DURATION_LIMIT");
    const delivery = REDUB_DELIVERIES.includes(payload.delivery as RedubDelivery) ? payload.delivery! : "natural";
    const motion = (input.motion ?? "natural") as TalkingMotion;
    return { type, characterId, projectId, payload: {
      imageTalking: true, imageAssetId: image.id, speechJobId: speech!.id,
      imageUrl: i.signedUrl, audioUrl: a.signedUrl, billableSeconds: seconds,
      resolution: input.resolution === "480p" ? "480p" : "720p", motion, delivery,
      prompt: imageTalkingPrompt(delivery, motion), outputCategory: "tiktok",
    } };
  } catch { return bad("VIDEO_FORMAT_UNSUPPORTED", 415); }
}
