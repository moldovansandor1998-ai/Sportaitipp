import "server-only";
import { serviceClient } from "@/lib/supabase/server";
import { resolveCharacterVoice } from "./characterVoice";
import { mediaDuration } from "./mediaDuration";
import { REDUB_MAX_SECONDS } from "@/lib/videoRedub";
import type { PreparedJob } from "./prepareJob";
import { elevenLabsSpeechHealth } from "@/lib/providers/elevenLabsStatus";

/** Only owned asset IDs and a completed, same-character speech job are accepted. */
export async function prepareVideoRedub(ownerId: string, characterId: string, type: "tts" | "lip_sync",
  input: Record<string, unknown>, projectId?: string): Promise<PreparedJob> {
  const bad = (error: PreparedJob["error"], status = 400): PreparedJob => ({ type, payload: {}, error, status });
  if (!process.env.ELEVENLABS_API_KEY || (type === "lip_sync" && !process.env.WAVESPEED_API_KEY))
    return bad("PROVIDER_MODEL_INVALID", 503);
  if (type === "tts") {
    const health = await elevenLabsSpeechHealth();
    if (["invalid_api_key", "authentication_error"].includes(health.code ?? "")) return bad("ELEVENLABS_AUTH_FAILED", 503);
    if (health.code === "quota_exceeded") return bad("ELEVENLABS_QUOTA_EXCEEDED", 503);
    if (health.code === "payment_issue") return bad("ELEVENLABS_PAYMENT_ISSUE", 503);
  }
  const sb = serviceClient();
  const voice = await resolveCharacterVoice(sb, characterId, ownerId);
  if (!voice?.voiceId) return bad("TTS_VOICE_INVALID", 409);
  if (type === "tts") return { type, characterId, projectId, payload: {
    videoRedubSpeech: true, text: String(input.text).trim(), delivery: input.delivery ?? "natural", voiceId: voice.voiceId,
  } };

  const { data: video } = await sb.from("assets").select("id,bucket,object_path,media_type,content_type,bytes,source")
    .eq("id", String(input.videoAssetId)).eq("owner_id", ownerId).eq("media_type", "video").maybeSingle();
  if (!video || video.bytes > 48 * 1024 * 1024 || !["video/mp4", "video/webm"].includes(video.content_type))
    return bad("VIDEO_FORMAT_UNSUPPORTED", 415);
  if (video.source === "generation") {
    const { data: gallery } = await sb.from("gallery_items").select("id")
      .eq("asset_id", video.id).eq("owner_id", ownerId).eq("character_id", characterId).is("deleted_at", null).maybeSingle();
    if (!gallery) return bad("SOURCE_IMAGE_REQUIRED", 404);
  } else if (video.source !== "upload") return bad("SOURCE_IMAGE_REQUIRED", 404);
  const { data: speech } = await sb.from("generation_jobs").select("id,payload,result")
    .eq("id", String(input.speechJobId)).eq("owner_id", ownerId).eq("character_id", characterId)
    .eq("type", "tts").eq("status", "completed").maybeSingle();
  const speechPayload = speech?.payload as Record<string, unknown> | undefined;
  const audioId = (speech?.result as { assetIds?: string[] } | null)?.assetIds?.[0];
  if (!speechPayload?.videoRedubSpeech || speechPayload.voiceId !== voice.voiceId || !audioId)
    return bad("TTS_VOICE_INVALID", 409);
  const { data: audio } = await sb.from("assets").select("bucket,object_path")
    .eq("id", audioId).eq("owner_id", ownerId).eq("media_type", "audio").maybeSingle();
  if (!audio) return bad("SOURCE_IMAGE_REQUIRED", 404);
  const [{ data: v }, { data: a }] = await Promise.all([
    sb.storage.from(video.bucket).createSignedUrl(video.object_path, 7200),
    sb.storage.from(audio.bucket).createSignedUrl(audio.object_path, 7200),
  ]);
  if (!v?.signedUrl || !a?.signedUrl) return bad("SOURCE_IMAGE_REQUIRED", 502);
  try {
    const [videoSeconds, audioSeconds] = await Promise.all([mediaDuration(v.signedUrl), mediaDuration(a.signedUrl)]);
    if (videoSeconds > REDUB_MAX_SECONDS || audioSeconds > REDUB_MAX_SECONDS) return bad("REDUB_DURATION_LIMIT", 400);
    return { type, characterId, projectId, payload: {
      videoRedub: true, videoAssetId: video.id, speechJobId: speech!.id,
      videoUrl: v.signedUrl, audioUrl: a.signedUrl, sourceSeconds: videoSeconds,
      billableSeconds: audioSeconds, syncMode: "loop",
    } };
  } catch { return bad("VIDEO_FORMAT_UNSUPPORTED", 415); }
}
