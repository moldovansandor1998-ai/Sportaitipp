import "server-only";
import { serviceClient } from "@/lib/supabase/server";
import { resolveCharacterVoice } from "./characterVoice";
import type { PreparedJob } from "./prepareJob";
import { addVideoSoundtrack } from "./videoSoundtrack";
import { assertAllowedUrl } from "@/lib/security/ssrf";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

export async function prepareNuretaLipSync(ownerId: string, characterId: string, input: Record<string, unknown>, projectId?: string): Promise<PreparedJob> {
  const bad = (error: PreparedJob["error"], status = 400): PreparedJob => ({ type: "lip_sync", payload: {}, error, status });
  if (!process.env.WAVESPEED_API_KEY) return bad("PROVIDER_MODEL_INVALID", 503);
  const sb = serviceClient();
  const { data: gallery } = await sb.from("gallery_items").select("job_id,content_category")
    .eq("owner_id", ownerId).eq("character_id", characterId).eq("asset_id", String(input.videoAssetId)).is("deleted_at", null).maybeSingle();
  if (!gallery?.job_id) return bad("SOURCE_IMAGE_REQUIRED", 404);
  const { data: parent } = await sb.from("generation_jobs").select("id,payload,status,result")
    .eq("id", gallery.job_id).eq("owner_id", ownerId).eq("character_id", characterId)
    .eq("type", "nureta_scene_video").eq("provider", "nureta").maybeSingle();
  if (!parent?.result || !["completed", "refunded"].includes(parent.status)) return bad("SOURCE_IMAGE_REQUIRED", 409);
  if (!(parent.result as { assetIds?: string[] }).assetIds?.includes(String(input.videoAssetId))) return bad("SOURCE_IMAGE_REQUIRED", 409);
  const { data: asset } = await sb.from("assets").select("bucket,object_path,content_type,bytes")
    .eq("id", String(input.videoAssetId)).eq("owner_id", ownerId).eq("media_type", "video").maybeSingle();
  if (!asset || asset.content_type !== "video/mp4" || asset.bytes > 100 * 1024 * 1024) return bad("VIDEO_FORMAT_UNSUPPORTED", 415);
  const { data: signed } = await sb.storage.from(asset.bucket).createSignedUrl(asset.object_path, 7200);
  if (!signed?.signedUrl) return bad("SOURCE_IMAGE_REQUIRED", 502);
  const parentPayload = parent.payload as Record<string, unknown>;
  const duration = Number(parentPayload.duration);
  if (!Number.isFinite(duration) || duration < 5 || duration > 15) return bad("validation");
  const payload: Record<string, unknown> = {
    nuretaPostprocess: true, videoAssetId: input.videoAssetId, videoUrl: signed.signedUrl,
    parentJobId: parent.id, audioMode: input.audioMode, duration,
    outputCategory: gallery.content_category,
  };
  if (typeof input.verificationRun === "string" && input.verificationRun.startsWith("castora-e2e-")) payload.verificationRun = input.verificationRun;
  if (input.audioMode !== "keep") {
    const voice = await resolveCharacterVoice(sb, characterId, ownerId);
    if (!voice?.voiceId || !process.env.ELEVENLABS_API_KEY) return bad("TTS_VOICE_INVALID", 503);
    payload.voiceId = voice.voiceId;
    // This separate conversion preserves delivery rather than retranscribing.
    if (input.audioMode === "speech") {
      const text = String(input.speechText).trim();
      if (text.length > duration * 12) return bad("validation");
      payload.speechText = text;
    }
  }
  return { type: "lip_sync", characterId, projectId, payload };
}

async function ownedVideo(url: string): Promise<Buffer> {
  const safe = assertAllowedUrl(url);
  if (safe.origin !== new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin) throw new Error("SOURCE_VIDEO_UNAVAILABLE");
  const response = await fetch(safe, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error("SOURCE_VIDEO_UNAVAILABLE");
  if (Number(response.headers.get("content-length")) > 100 * 1024 * 1024) throw new Error("VIDEO_TOO_LARGE");
  const chunks: Buffer[] = []; let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    total += chunk.byteLength;
    if (total > 100 * 1024 * 1024) throw new Error("VIDEO_TOO_LARGE");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Extract the final soundtrack, padded/trimmed to the saved video's duration. */
export async function createNuretaSyncAudio(payload: Record<string, unknown>): Promise<Buffer> {
  let video = await ownedVideo(String(payload.videoUrl));
  if (payload.audioMode === "model") video = await addVideoSoundtrack(video, { sourceVideo: video, voiceId: String(payload.voiceId) });
  if (payload.audioMode === "speech") video = await addVideoSoundtrack(video, { voiceId: String(payload.voiceId), speechText: String(payload.speechText) });
  const dir = await mkdtemp(join(tmpdir(), "castora-nureta-sync-"));
  try {
    if (!ffmpegPath) throw new Error("FFMPEG_UNAVAILABLE");
    await writeFile(join(dir, "input.mp4"), video);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath!, ["-hide_banner", "-loglevel", "error", "-y", "-i", join(dir, "input.mp4"),
        "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "44100", "-b:a", "128k", join(dir, "target.mp3")]);
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("LIPSYNC_AUDIO_TIMEOUT")); }, 30_000);
      let detail = "";
      child.stderr.on("data", (chunk: Buffer) => { detail = (detail + chunk.toString()).slice(-300); });
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("close", code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`LIPSYNC_AUDIO_UNAVAILABLE: ${detail}`)); });
    });
    return await readFile(join(dir, "target.mp3"));
  } finally { await rm(dir, { recursive: true, force: true }); }
}
