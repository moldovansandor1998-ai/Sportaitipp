import { ProviderAdapter, ProviderError, type Estimate, type JobType, type NormalizedOutput, type SubmitParams, type SubmitResult } from "./types";

const API = "https://api.wavespeed.ai/api/v3";
const MODEL = "wavespeed-ai/image-face-swap-pro";
const EDIT_MODELS = {
  "seedream-v4.5": "bytedance/seedream-v4.5/edit",
  "nano-banana": "google/nano-banana/edit",
} as const;
const CHARACTER_EDIT_PROMPT = "Refer to image 2 to make the same photograph, but use the face, hair and eyes of the adult woman in image 1. Images 3 and 4, when present, show the same woman's body proportions and further identity views. Image 1 is the identity anchor; image 2 is ONLY the pose, clothing, camera angle and setting reference. Preserve image 1's exact hair length, color, face shape, eye shape and natural skin detail. Keep her consistent natural body proportions from the identity references, with exactly two arms, two hands and five fingers on each hand. Preserve image 2's composition. Photorealistic candid camera image, not illustration or cartoon. If a phone is visible, make it a realistic silver iPhone 17 Pro Max with its three-camera rear plateau; never add a phone if image 2 has none. No text, watermark, tattoos, extra limbs, extra hands, plastic skin or altered face. Do not add other people.";

export class WaveSpeedAdapter implements ProviderAdapter {
  readonly name = "wavespeed";
  readonly supports: JobType[] = ["character_swap", "video_character_swap", "character_motion_video"];

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
    // The provider caps billing at 120 seconds; never use client-supplied duration to price a job.
    if (jobType === "video_character_swap") return { credits: 120 * (payload.resolution === "480p" ? 8 : 16), secondsExpected: 180 };
    // Motion Control bills by input duration, capped at 30 s. Reserve the maximum
    // rather than trusting a browser-provided duration to reduce the user's balance.
    if (jobType === "character_motion_video") return { credits: payload.quality === "standard" ? 756 : 1008, secondsExpected: 180 };
    return { credits: 40, secondsExpected: 60 };
  }

  async submit(p: SubmitParams): Promise<SubmitResult> {
    if (p.jobType === "character_motion_video") {
      const video = p.payload.videoUrl, image = p.payload.characterImageUrl;
      if (typeof video !== "string" || typeof image !== "string")
        throw new ProviderError("A mozgásvideó és a modell referenciafotója kötelező.", false);
      const endpoint = p.payload.quality === "standard"
        ? "kwaivgi/kling-v3.0-std/motion-control"
        : "kwaivgi/kling-v3.0-pro/motion-control";
      const data = await this.request(`${API}/${endpoint}`, {
        video, image, character_orientation: "video", keep_original_sound: true,
        prompt: "The woman in the reference image is the sole main character. Follow the motion, gestures, timing, camera movement and perspective of the driving video. Maintain the reference woman's recognizable face, hair and natural body proportions consistently across frames. Photorealistic, natural skin texture and lighting. Preserve the original scene where possible.",
        negative_prompt: "different person, changing face, inconsistent hair, extra limbs, deformed hands, tattoos, plastic skin, flicker",
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
        && characterImages.length <= 4 && characterImages.every((url) => typeof url === "string" && url.startsWith("https://"))) {
      const model = p.payload.editModel === "nano-banana" ? EDIT_MODELS["nano-banana"] : EDIT_MODELS["seedream-v4.5"];
      const appearance = p.payload.characterName === "Laura"
        ? " The identity in image 1 has short straight blonde bob hair ending near the shoulders. Never give Laura long hair or extensions."
        : "";
      const data = await this.request(`${API}/${model}`, {
        images: characterImages, prompt: CHARACTER_EDIT_PROMPT + appearance,
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

  async getStatus(id: string): Promise<"running" | "done" | "failed"> {
    const data = await this.result(id);
    if (data.status === "completed") return "done";
    if (["failed", "cancelled", "timeout", "deleted"].includes(String(data.status))) {
      const detail = typeof data.error === "string" ? data.error
        : typeof data.error_message === "string" ? data.error_message
        : typeof data.message === "string" ? data.message : String(data.status);
      throw new ProviderError(`WaveSpeed ${String(data.status)}: ${detail.slice(0, 400)}`, false, id, "invalid_input");
    }
    return "running";
  }

  async getResult(id: string, _meta?: Record<string, unknown>, jobType?: JobType): Promise<NormalizedOutput> {
    const data = await this.result(id);
    if (data.status !== "completed") throw new ProviderError("WaveSpeed result is not ready", true, id);
    const outputs = Array.isArray(data.outputs) ? data.outputs : [];
    const urls = outputs.map((x) => typeof x === "string" ? x : (x as { url?: unknown })?.url)
      .filter((x): x is string => typeof x === "string" && /^https:\/\//.test(x));
    if (urls.length === 0) throw new ProviderError("WaveSpeed returned no output", false, id);
    const kind = jobType === "video_character_swap" || jobType === "character_motion_video" ? "video" as const : "image" as const;
    return { files: urls.map((url) => ({ kind, url })), meta: {} };
  }

  async cancel(): Promise<void> { /* No cancellation API required for this integration. */ }
  async healthCheck() { return { ok: Boolean(process.env.WAVESPEED_API_KEY), latencyMs: 0 }; }
  normalizeWebhook(): { eventId: string; status: "failed" } { return { eventId: "unused", status: "failed" }; }
  async verifyWebhook(): Promise<boolean> { return false; } // Polling only; reject unsigned webhooks.
}
