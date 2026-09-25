import { ProviderAdapter, ProviderError, type Estimate, type JobType, type NormalizedOutput, type SubmitParams, type SubmitResult } from "./types";

const API = "https://api.wavespeed.ai/api/v3";
const MODEL = "wavespeed-ai/image-face-swap-pro";
const EDIT_MODELS = {
  "seedream-v4.5": "bytedance/seedream-v4.5/edit",
  "nano-banana": "google/nano-banana/edit",
} as const;
const CHARACTER_EDIT_PROMPT = "Image 1 is the photograph to preserve. Images 2 and 3 show the identity of the woman whose face should appear in image 1. Make a subtle, photorealistic facial identity replacement only within the visible facial region. Preserve image 1 pixel-for-pixel outside the face as much as possible: exact body, anatomy, hands, hair, clothing, accessories, background, framing, camera angle, expression, and head position. Within the face, retain image 1's original light direction, shadow transitions, skin tone variation, visible pores, fine texture, photographic grain and natural imperfections while matching the reference woman's distinctive facial proportions, eyes, nose, mouth and jaw. Match the sharpness, exposure and color of the original photograph. Do not beautify, smooth the skin, enlarge the eyes or lips, alter body shape, change the scene, or produce an illustration or glamour portrait. The result should look like an unretouched photograph of the original scene.";

export class WaveSpeedAdapter implements ProviderAdapter {
  readonly name = "wavespeed";
  readonly supports: JobType[] = ["character_swap"];

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

  async estimate(): Promise<Estimate> { return { credits: 40, secondsExpected: 60 }; }

  async submit(p: SubmitParams): Promise<SubmitResult> {
    const characterImages = p.payload.characterImageUrls;
    if (Array.isArray(characterImages) && characterImages.length >= 2
        && characterImages.length <= 4 && characterImages.every((url) => typeof url === "string" && url.startsWith("https://"))) {
      const model = p.payload.editModel === "nano-banana" ? EDIT_MODELS["nano-banana"] : EDIT_MODELS["seedream-v4.5"];
      const data = await this.request(`${API}/${model}`, {
        images: characterImages, prompt: CHARACTER_EDIT_PROMPT,
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

  async getResult(id: string): Promise<NormalizedOutput> {
    const data = await this.result(id);
    if (data.status !== "completed") throw new ProviderError("WaveSpeed result is not ready", true, id);
    const outputs = Array.isArray(data.outputs) ? data.outputs : [];
    const urls = outputs.map((x) => typeof x === "string" ? x : (x as { url?: unknown })?.url)
      .filter((x): x is string => typeof x === "string" && /^https:\/\//.test(x));
    if (urls.length === 0) throw new ProviderError("WaveSpeed returned no image", false, id);
    return { files: urls.map((url) => ({ kind: "image" as const, url })), meta: {} };
  }

  async cancel(): Promise<void> { /* No cancellation API required for this integration. */ }
  async healthCheck() { return { ok: Boolean(process.env.WAVESPEED_API_KEY), latencyMs: 0 }; }
  normalizeWebhook(): { eventId: string; status: "failed" } { return { eventId: "unused", status: "failed" }; }
  async verifyWebhook(): Promise<boolean> { return false; } // Polling only; reject unsigned webhooks.
}
