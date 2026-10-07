import { withVideoContinuity } from "@/lib/videoContinuity";
import { ProviderAdapter, ProviderError, type Estimate, type JobType, type NormalizedOutput, type SubmitParams, type SubmitResult } from "./types";
import sharp from "sharp";
import { serviceClient } from "@/lib/supabase/server";
import { sceneFrame } from "@/server/jobs/sceneFrame";
import { applyCharacterIdentity } from "@/lib/characterIdentity";

const API = "https://api.wavespeed.ai/api/v3";
const MODEL = "wavespeed-ai/image-face-swap-pro";
const EDIT_MODELS = {
  "seedream-v4.5": "bytedance/seedream-v4.5/edit",
  "nano-banana": "google/nano-banana/edit",
} as const;
const CHARACTER_EDIT_PROMPT = "Refer to image 2 to make the same photograph, but use the face, hair and eyes of the adult woman in image 1. Images 3 and 4, when present, show the same woman's body proportions and further identity views. Image 1 is the identity anchor; image 2 alone determines the pose, clothing, camera angle, setting and objects. Preserve image 1's exact hair length, color, face shape, eye shape and natural skin detail. Keep her consistent natural body proportions from the identity references, with exactly two arms, two hands and five fingers on each hand. Preserve image 2's composition. Photorealistic candid camera image, not illustration or cartoon. Copy no objects or accessories from images 1, 3 or 4. No text, watermark, tattoos, extra limbs, extra hands, plastic skin or altered face. Do not add other people.";
const SCENE_EDIT_PROMPT = `${CHARACTER_EDIT_PROMPT} Keep every food item, utensil, prop and its position from image 2 exactly recognizable. Preserve the original hand-object contact, framing, clothing, camera position and background. Change only the woman, never replace or invent objects.`;
const MOTION_ENDPOINT = "kwaivgi/kling-v2.6-pro/motion-control";
const MOTION_ENDPOINT_IDENTITY = "kwaivgi/kling-v3.0-pro/motion-control";
const IDENTITY_MOTION_PROMPT = "Animate the exact adult woman in the approved scene image. Preserve her facial identity throughout every frame: the same face shape, jawline, cheeks, eyes, nose, lips, hairline, age and natural skin texture. Keep the approved image's clothing, body proportions, objects, lighting and background. Transfer only the source video's natural gestures and timing. Subtle realistic facial expressions and mouth movement; no face morphing or beauty filter.";
const IDENTITY_MOTION_NEGATIVE = "different face, sagging face, melted features, altered jaw, changed eyes, asymmetry, waxy or over-smoothed skin, face drift, extra hands, missing objects, transformed objects, distorted hands, altered background";
const CREATIVE_ENDPOINT = "wavespeed-ai/open-video/image-to-video";
// Lip-sync the completed video itself. An image-driven avatar regenerates the
// whole head and torso and can distort proportions in longer speech clips.
// Use the video editing variant that changes the mouth and local expression
// while retaining the source performance. Lipsync 3 visibly exaggerated
// Petra's head movement in the second half of a completed scene.
const TALKING_SCENE_ENDPOINT = "sync/lipsync-2-pro";
const CREATIVE_PROMPTS: Record<string, string> = {
  playful: "The same adult woman gives a spontaneous playful smile, glances briefly away from the camera, turns back and makes a small natural hand gesture.",
  confident: "The same adult woman shifts her posture naturally, makes calm eye contact, smiles with confidence and gently turns toward the camera.",
  casual: "The same adult woman makes a relaxed small movement, brushes her hair back once and looks toward the camera with a natural smile.",
};

async function sourceRatio(url: string): Promise<number> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new ProviderError("A forráskép mérete nem olvasható.", true);
  const metadata = await sharp(await response.arrayBuffer()).metadata();
  if (!metadata.width || !metadata.height) throw new ProviderError("A forráskép érvénytelen.", false);
  return metadata.width / metadata.height;
}

function closestRatio(ratio: number): { ratio: string; width: number; height: number } {
  const options = [
    { ratio: "9:16", width: 1152, height: 2048 },
    { ratio: "2:3", width: 1152, height: 1728 },
    { ratio: "3:4", width: 1216, height: 1600 },
    { ratio: "4:5", width: 1280, height: 1600 },
    { ratio: "1:1", width: 1440, height: 1440 },
    { ratio: "5:4", width: 1600, height: 1280 },
    { ratio: "4:3", width: 1600, height: 1216 },
    { ratio: "3:2", width: 1728, height: 1152 },
    { ratio: "16:9", width: 2048, height: 1152 },
  ];
  return options.reduce((best, option) =>
    Math.abs(Math.log(option.width / option.height / ratio)) < Math.abs(Math.log(best.width / best.height / ratio)) ? option : best);
}

export class WaveSpeedAdapter implements ProviderAdapter {
  readonly name = "wavespeed";
  readonly supports: JobType[] = ["character_swap", "video_character_swap", "character_motion_video", "nureta_scene_image", "nureta_scene_video", "image_edit"];

  private async request(url: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${process.env.WAVESPEED_API_KEY}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new ProviderError(`WaveSpeed ${res.status}`, res.status === 429 || res.status >= 500,
      undefined, res.status === 401 || res.status === 403 ? "auth" : "invalid_input");
    const raw = await res.json() as { data?: Record<string, unknown>; code?: number; message?: string };
    if (raw.code && raw.code >= 400) throw new ProviderError(`WaveSpeed ${raw.code}: ${raw.message ?? "request failed"}`, false);
    return raw.data ?? raw as Record<string, unknown>;
  }

  async estimate(jobType: JobType, payload: Record<string, unknown>): Promise<Estimate> {
    if (jobType === "nureta_scene_image") return { credits: 40, secondsExpected: 90 };
    if (jobType === "nureta_scene_video") {
      const rate = payload.voiceMode === "nureta" ? 0.168 : 0.112;
      return { credits: Math.ceil(Number(payload.duration) * rate * 330) + (payload.voiceMode === "model" ? 100 : 0), secondsExpected: 300 };
    }
    // The provider caps billing at 120 seconds; never use client-supplied duration to price a job.
    if (jobType === "video_character_swap") return { credits: 120 * (payload.resolution === "480p" ? 8 : 16), secondsExpected: 180 };
    // Video person swap is billed by duration, capped at 30 seconds. Keep the
    // existing conservative reservation until provider usage reconciliation.
    if (jobType === "character_motion_video") {
      if (payload.motionMethod === "scene_preview") return { credits: 40, secondsExpected: 90 };
      if (payload.motionMethod === "talking_scene") return { credits: 1008, secondsExpected: 420 };
      if (payload.motionMethod === "creative") return { credits: 100, secondsExpected: 240 };
      return { credits: payload.quality === "standard" ? 756 : payload.motionMethod === "anchored" ? 1512 : 1008,
        secondsExpected: payload.motionMethod === "anchored" ? 420 : 180 };
    }
    return { credits: 40, secondsExpected: 60 };
  }

  async submit(p: SubmitParams): Promise<SubmitResult> {
    const identityPrompt = (prompt: string) => applyCharacterIdentity(prompt, p.payload.identityPromptVariant);
    if (p.jobType === "nureta_scene_video") {
      if (p.payload.videoEngine !== "kling" || typeof p.payload.sceneImageUrl !== "string")
        throw new ProviderError("A jóváhagyott jelenetkép és a Kling motor szükséges.", false);
      const endpoint = "kwaivgi/kling-v3.0-pro/image-to-video";
      const data = await this.request(`${API}/${endpoint}`, {
        image: p.payload.sceneImageUrl, duration: Number(p.payload.duration),
        prompt: `${withVideoContinuity(String(p.payload.prompt))} ${identityPrompt(IDENTITY_MOTION_PROMPT).replace("Transfer only the source video's natural gestures and timing.", "Follow only the requested motion in one continuous shot.")}`,
        negative_prompt: IDENTITY_MOTION_NEGATIVE, sound: p.payload.voiceMode === "nureta",
        cfg_scale: 0.5, shot_type: "customize",
      });
      if (typeof data.id !== "string") throw new ProviderError("Kling feladatazonosító hiányzik.", false);
      return { providerJobId: data.id, providerMeta: { endpoint, stage: "approved_scene_video" } };
    }
    if (p.jobType === "nureta_scene_image") {
      const refs = p.payload.referenceUrls;
      if (!Array.isArray(refs) || typeof refs[0] !== "string" || typeof p.payload.sourceUrl !== "string")
        throw new ProviderError("A forrás és a modellképek hiányoznak.", false);
      let sourceUrl = p.payload.sourceUrl;
      if (p.payload.sourceMediaType === "video") {
        const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(45_000) });
        if (!response.ok) throw new ProviderError("A forrásvideó nem olvasható.", true);
        const source = Buffer.from(await response.arrayBuffer());
        if (source.length > 48 * 1024 * 1024) throw new ProviderError("A videó túl nagy.", false);
        const frame = await sceneFrame(source, true);
        const { data: job } = await serviceClient().from("generation_jobs")
          .select("owner_id").eq("id", p.jobId).single();
        if (!job) throw new ProviderError("A jelenetfeladat nem található.", false);
        const storage = serviceClient().storage.from("assets");
        const path = `${job.owner_id}/${p.jobId}/source-frame.jpg`;
        const { error: uploaded } = await storage.upload(path, frame, { contentType: "image/jpeg", upsert: true });
        if (uploaded) throw new ProviderError(`Képkocka mentési hiba: ${uploaded.message}`, true);
        const { data: signed } = await storage.createSignedUrl(path, 7200);
        if (!signed?.signedUrl) throw new ProviderError("A képkocka nem érhető el.", true);
        sourceUrl = signed.signedUrl;
      }
      const dimensions = closestRatio(await sourceRatio(sourceUrl));
      const extra = typeof p.payload.scenePrompt === "string" ? p.payload.scenePrompt.trim() : "";
      const endpoint = EDIT_MODELS["seedream-v4.5"];
      const data = await this.request(`${API}/${endpoint}`, {
        images: [refs[0], sourceUrl, ...refs.slice(1, p.payload.identityPromptVariant === "zsofia-blue-eyes" ? 4 : 3)],
        prompt: `${identityPrompt(p.payload.identityPromptVariant === "zsofia-blue-eyes" && refs.length === 4 ? SCENE_EDIT_PROMPT.replace("Images 3 and 4", "Images 3, 4 and 5") : SCENE_EDIT_PROMPT)} ${extra}`.trim(),
        size: `${dimensions.width}*${dimensions.height}`,
      });
      if (typeof data.id !== "string") throw new ProviderError("WaveSpeed jelenetkép azonosító hiányzik.", false);
      return { providerJobId: data.id, providerMeta: { endpoint, stage: "nureta_source_preview" } };
    }
    if (p.jobType === "image_edit") {
      if (p.payload.galleryEdit !== true || !Array.isArray(p.payload.imageUrls) || p.payload.imageUrls.length !== 1
          || typeof p.payload.imageUrls[0] !== "string" || typeof p.payload.prompt !== "string")
        throw new ProviderError("A galériakép és a módosítás leírása kötelező.", false);
      const dimensions = closestRatio(await sourceRatio(p.payload.imageUrls[0]));
      const endpoint = EDIT_MODELS["seedream-v4.5"];
      const data = await this.request(`${API}/${endpoint}`, {
        images: p.payload.imageUrls, prompt: p.payload.prompt,
        size: `${dimensions.width}*${dimensions.height}`,
      });
      if (typeof data.id !== "string") throw new ProviderError("WaveSpeed did not return a task ID", false);
      return { providerJobId: data.id, providerMeta: { endpoint } };
    }
    if (p.jobType === "character_motion_video") {
      const video = p.payload.videoUrl, image = p.payload.characterImageUrl;
      if (typeof video !== "string" || typeof image !== "string")
        throw new ProviderError("Az eredeti videó és a modell referenciafotója kötelező.", false);
      if (p.payload.motionMethod === "talking_scene") {
        const sb = serviceClient();
        const { data: job } = await sb.from("generation_jobs").select("owner_id").eq("id", p.jobId).single();
        if (!job) throw new ProviderError("Video job not found", false);
        const text = String(p.payload.speechText ?? "").trim();
        const voiceId = String(p.payload.voiceId ?? "");
        if (text.length < 20 || text.length > 450 || !/^[A-Za-z0-9]{10,40}$/.test(voiceId))
          throw new ProviderError("A beszéd szövege vagy hangja érvénytelen.", false);
        const speech = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
          method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "", "content-type": "application/json" },
          body: JSON.stringify({ text, model_id: "eleven_v4", language_code: "hu" }),
          signal: AbortSignal.timeout(180_000),
        });
        if (!speech.ok) throw new ProviderError(`ElevenLabs beszédhiba: ${speech.status}`, speech.status >= 500);
        const audio = Buffer.from(await speech.arrayBuffer());
        // 128 kb/s CBR MP3: 16 000 bytes/s. A 30 másodperces felső korlát előtt megállunk.
        if (audio.length < 1000 || audio.length > 30 * 16_000)
          throw new ProviderError("A beszéd 30 másodpercnél hosszabb. Rövidítsd a szöveget.", false);
        const audioPath = `${job.owner_id}/${p.jobId}/talking-scene-voice.mp3`;
        const { error: audioUpload } = await sb.storage.from("assets")
          .upload(audioPath, audio, { contentType: "audio/mpeg", upsert: true });
        if (audioUpload) throw new ProviderError("A hang nem tárolható.", true);
        const { data: audioSigned } = await sb.storage.from("assets").createSignedUrl(audioPath, 7200);
        if (!audioSigned?.signedUrl) throw new ProviderError("A beszédhang nem elérhető.", true);
        const data = await this.request(`${API}/${TALKING_SCENE_ENDPOINT}`, {
          video, audio: audioSigned.signedUrl, sync_mode: "cut_off",
        });
        if (typeof data.id !== "string") throw new ProviderError("WaveSpeed did not return a talking scene task ID", false);
        return { providerJobId: data.id, providerMeta: { endpoint: TALKING_SCENE_ENDPOINT, stage: "talking_scene" } };
      }
      if (p.payload.motionMethod === "creative") {
        const sb = serviceClient();
        const { data: job } = await sb.from("generation_jobs").select("owner_id").eq("id", p.jobId).single();
        if (!job) throw new ProviderError("Video job not found", false);
        const response = await fetch(video, { signal: AbortSignal.timeout(45_000) });
        if (!response.ok) throw new ProviderError("A kész modellvideó nem olvasható.", true);
        const source = Buffer.from(await response.arrayBuffer());
        if (source.length > 48 * 1024 * 1024) throw new ProviderError("A videó túl nagy.", false);
        const frame = await sceneFrame(source);
        const framePath = `${job.owner_id}/${p.jobId}/variation-frame.jpg`;
        const { error: uploadError } = await sb.storage.from("assets").upload(framePath, frame, {
          contentType: "image/jpeg", upsert: true,
        });
        if (uploadError) throw new ProviderError(`Kezdőkép tárolási hiba: ${uploadError.message}`, true);
        const { data: signed } = await sb.storage.from("assets").createSignedUrl(framePath, 7200);
        if (!signed?.signedUrl) throw new ProviderError("A kezdőkép nem érhető el.", true);
        const style = typeof p.payload.motionStyle === "string" ? p.payload.motionStyle : "playful";
        const prompt = `${identityPrompt(CREATIVE_PROMPTS[style] ?? CREATIVE_PROMPTS.playful)} Keep the exact same face, hair, clothing, body proportions, props, background and camera framing from the image. Subtle believable motion with consistent hands and objects. One continuous 8-second shot. No dialogue, subtitles or extra people.`;
        const data = await this.request(`${API}/${CREATIVE_ENDPOINT}`, {
          image: signed.signedUrl, prompt, resolution: "1080p", duration: 8,
        });
        if (typeof data.id !== "string") throw new ProviderError("WaveSpeed did not return a video task ID", false);
        return { providerJobId: data.id, providerMeta: { endpoint: CREATIVE_ENDPOINT, stage: "creative" } };
      }
      if (p.payload.motionMethod === "anchored" && typeof p.payload.sceneImageUrl === "string") {
        const endpoint = p.payload.quality === "standard" ? MOTION_ENDPOINT : MOTION_ENDPOINT_IDENTITY;
        const data = await this.request(`${API}/${endpoint}`, {
          image: p.payload.sceneImageUrl, video, character_orientation: "video", keep_original_sound: true,
          prompt: identityPrompt(IDENTITY_MOTION_PROMPT),
          negative_prompt: IDENTITY_MOTION_NEGATIVE,
        });
        if (typeof data.id !== "string") throw new ProviderError("WaveSpeed did not return the motion task ID", false);
        return { providerJobId: data.id, providerMeta: { endpoint, stage: "video" } };
      }
      if (p.payload.motionMethod === "scene_preview") {
        const sb = serviceClient();
        const { data: job } = await sb.from("generation_jobs").select("owner_id").eq("id", p.jobId).single();
        if (!job) throw new ProviderError("Video job not found", false);
        const response = await fetch(video, { signal: AbortSignal.timeout(45_000) });
        if (!response.ok) throw new ProviderError("A forrásvideó nem olvasható.", true);
        const source = Buffer.from(await response.arrayBuffer());
        if (source.length > 48 * 1024 * 1024) throw new ProviderError("A videó túl nagy.", false);
        const frame = await sceneFrame(source);
        const framePath = `${job.owner_id}/${p.jobId}/scene-frame.jpg`;
        const { error: uploadError } = await sb.storage.from("assets").upload(framePath, frame, {
          contentType: "image/jpeg", upsert: true,
        });
        if (uploadError) throw new ProviderError(`Kezdőkép tárolási hiba: ${uploadError.message}`, true);
        const { data: signed } = await sb.storage.from("assets").createSignedUrl(framePath, 7200);
        if (!signed?.signedUrl) throw new ProviderError("A kezdőkép nem érhető el.", true);
        const endpoint = EDIT_MODELS["seedream-v4.5"];
        const references = Array.isArray(p.payload.characterImageUrls) ? p.payload.characterImageUrls
          .filter((url): url is string => typeof url === "string" && /^https:\/\//.test(url)).slice(1, 3) : [];
        const extra = typeof p.payload.scenePrompt === "string" ? p.payload.scenePrompt.trim() : "";
        const data = await this.request(`${API}/${endpoint}`, {
          images: [image, signed.signedUrl, ...references], prompt: `${identityPrompt(SCENE_EDIT_PROMPT)} ${extra}`.trim(), size: "1152*2048",
        });
        if (typeof data.id !== "string") throw new ProviderError("WaveSpeed did not return the scene image task ID", false);
        return { providerJobId: data.id, providerMeta: { endpoint, stage: "scene_preview" } };
      }
      const endpoint = "pixverse/swap";
      const data = await this.request(`${API}/${endpoint}`, {
        video, image, mode: "person", resolution: p.payload.quality === "standard" ? "540p" : "720p",
      });
      if (typeof data.id !== "string") throw new ProviderError("WaveSpeed did not return a task ID", false);
      return { providerJobId: data.id, providerMeta: { endpoint } };
    }
    if (p.jobType === "video_character_swap") {
      const video = p.payload.videoUrl, face = p.payload.faceImageUrl;
      if (typeof video !== "string" || typeof face !== "string") throw new ProviderError("A videó és a modell arcképe kötelező.", false);
      const endpoint = "wavespeed-ai/video-head-swap";
      const data = await this.request(`${API}/${endpoint}`, {
        video, face_image: face, resolution: p.payload.resolution === "480p" ? "480p" : "720p",
      });
      if (typeof data.id !== "string") throw new ProviderError("WaveSpeed did not return a task ID", false);
      return { providerJobId: data.id, providerMeta: { endpoint } };
    }
    const characterImages = p.payload.characterImageUrls;
    if (Array.isArray(characterImages) && characterImages.length >= 2
        && characterImages.length <= (p.payload.identityPromptVariant === "zsofia-blue-eyes" ? 5 : 4) && characterImages.every((url) => typeof url === "string" && url.startsWith("https://"))) {
      const model = p.payload.editModel === "nano-banana" ? EDIT_MODELS["nano-banana"] : EDIT_MODELS["seedream-v4.5"];
      const fanvue = p.payload.outputCategory === "fanvue";
      const dimensions = fanvue ? closestRatio(await sourceRatio(characterImages[1])) : closestRatio(9 / 16);
      const data = await this.request(`${API}/${model}`, {
        images: characterImages, prompt: identityPrompt(p.payload.identityPromptVariant === "zsofia-blue-eyes" && characterImages.length === 5 ? CHARACTER_EDIT_PROMPT.replace("Images 3 and 4", "Images 3, 4 and 5") : CHARACTER_EDIT_PROMPT),
        ...(p.payload.editModel === "nano-banana" ? { aspect_ratio: dimensions.ratio } : { size: `${dimensions.width}*${dimensions.height}` }),
        ...(p.payload.editModel === "nano-banana" ? { output_format: "png" } : {}),
      });
      if (typeof data.id !== "string") throw new ProviderError("WaveSpeed did not return a task ID", false);
      return { providerJobId: data.id, providerMeta: { endpoint: model } };
    }
    const base = p.payload.imageUrl;
    const face = p.payload.swapImageUrl;
    if (typeof base !== "string" || typeof face !== "string")
      throw new ProviderError("Face swap requires the base photo and Petra's face", false, undefined, "invalid_input");
    const data = await this.request(`${API}/${MODEL}`, {
      image: base, face_image: face, output_format: "png",
    });
    if (typeof data.id !== "string") throw new ProviderError("WaveSpeed did not return a task ID", false);
    return { providerJobId: data.id, providerMeta: { endpoint: MODEL } };
  }

  private result(id: string) { return this.request(`${API}/predictions/${encodeURIComponent(id)}/result`); }

  async getStatus(id: string, meta?: Record<string, unknown>): Promise<"running" | "done" | "failed"> {
    const data = await this.result(id);
    if (data.status === "completed") {
      // Finish already-submitted jobs from the former one-step flow.
      if (meta?.stage === "still") {
        await this.advanceSceneToVideo(id, meta, data);
        return "running";
      }
      return meta?.stage === "submitting_motion" ? "running" : "done";
    }
    if (["failed", "cancelled", "timeout", "deleted"].includes(String(data.status))) {
      const detail = typeof data.error === "string" ? data.error
        : typeof data.error_message === "string" ? data.error_message
        : typeof data.message === "string" ? data.message : String(data.status);
      throw new ProviderError(`WaveSpeed ${String(data.status)}: ${detail.slice(0, 400)}`, false, id, "invalid_input");
    }
    return "running";
  }

  private async advanceSceneToVideo(id: string, meta: Record<string, unknown>, data: Record<string, unknown>): Promise<void> {
    const first = Array.isArray(data.outputs) ? data.outputs[0] : null;
    const imageUrl = typeof first === "string" ? first : first && typeof first === "object" && "url" in first && typeof first.url === "string" ? first.url : null;
    if (!imageUrl || !/^https:\/\//.test(imageUrl) || typeof meta.jobId !== "string" || typeof meta.sourceVideoUrl !== "string")
      throw new ProviderError("A szerkesztett jelenetkép hiányzik.", false, id);
    const sb = serviceClient();
    // Only one cron or user refresh may start the paid motion step.
    const submitting = { ...meta, stage: "submitting_motion", sceneImageUrl: imageUrl };
    const { data: claimed, error: claimError } = await sb.from("generation_jobs")
      .update({ provider_meta: submitting }).eq("id", meta.jobId).eq("provider_job_id", id)
      .eq("status", "processing").contains("provider_meta", { stage: "still" }).select("id").maybeSingle();
    if (claimError) throw new ProviderError(`A videófázis lefoglalása sikertelen: ${claimError.message}`, true, id);
    if (!claimed) return;
    try {
      const motion = await this.request(`${API}/${MOTION_ENDPOINT}`, {
        image: imageUrl, video: meta.sourceVideoUrl, character_orientation: "video", keep_original_sound: true,
        prompt: "Keep the reference scene, objects, clothing, camera and hand-object contact consistent with the edited image. Follow the source video's gestures and timing.",
        negative_prompt: "extra hands, missing objects, transformed objects, distorted hands, altered background, face drift",
      });
      if (typeof motion.id !== "string") throw new ProviderError("WaveSpeed did not return the motion task ID", false);
      const { data: updated, error } = await sb.from("generation_jobs")
        .update({ provider_job_id: motion.id, provider_meta: { ...submitting, endpoint: MOTION_ENDPOINT, stage: "video" } })
        .eq("id", meta.jobId).eq("provider_job_id", id).contains("provider_meta", { stage: "submitting_motion" })
        .select("id").maybeSingle();
      if (error || !updated) throw new Error(`Motion submission recorded uncertainly: ${error?.message ?? "race"}`);
    } catch (error) {
      if (error instanceof ProviderError && !error.retryable) throw error;
      await sb.from("generation_jobs").update({ status: "submission_uncertain", error: {
        message: String(error), recovery: "Ellenőrizd a WaveSpeed motion feladatot, mielőtt újraindítod.",
      } }).eq("id", meta.jobId).eq("status", "processing");
      throw new ProviderError("A mozgásgenerálás állapota nem egyértelmű; nem indítjuk újra automatikusan.", true, id);
    }
  }

  async getResult(id: string, _meta?: Record<string, unknown>, jobType?: JobType): Promise<NormalizedOutput> {
    const data = await this.result(id);
    if (data.status !== "completed") throw new ProviderError("WaveSpeed result is not ready", true, id);
    const outputs = Array.isArray(data.outputs) ? data.outputs : [];
    const urls = outputs.map((x) => typeof x === "string" ? x : (x as { url?: unknown })?.url)
      .filter((x): x is string => typeof x === "string" && /^https:\/\//.test(x));
    if (urls.length === 0) throw new ProviderError("WaveSpeed returned no output", false, id);
    const kind = jobType === "nureta_scene_video" || jobType === "video_character_swap" || (jobType === "character_motion_video" && _meta?.stage !== "scene_preview") ? "video" as const : "image" as const;
    const files: NormalizedOutput["files"] = urls.map((url) => ({ kind, url }));
    if (jobType === "character_motion_video" && _meta?.stage === "video" && typeof _meta.sceneImageUrl === "string")
      files.push({ kind: "image", url: _meta.sceneImageUrl });
    return { files, meta: {} };
  }

  async cancel(): Promise<void> { /* No cancellation API required for this integration. */ }
  async healthCheck() { return { ok: Boolean(process.env.WAVESPEED_API_KEY), latencyMs: 0 }; }
  normalizeWebhook(): { eventId: string; status: "failed" } { return { eventId: "unused", status: "failed" }; }
  async verifyWebhook(): Promise<boolean> { return false; } // Polling only; reject unsigned webhooks.
}
