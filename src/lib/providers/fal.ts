// fal.ai adapter – a hivatalos protokoll szerint.
//  - Submit: POST https://queue.fal.run/{endpoint}?fal_webhook=… (DOKUMENTÁLT query-paraméter)
//    válasz: { request_id, status_url, response_url, cancel_url }
//  - Webhook (hivatalos): X-Fal-Webhook-Request-Id / -User-Id / -Timestamp / -Signature;
//    signed message: v1:{request_id}.{timestamp}.{sha256hex(rawBody)}; Ed25519;
//    JWKS: https://rest.fal.ai/.well-known/jwks.json (cache max 24 h); ±5 perc timestamp-ablak;
//    hiányzó/hibás header = fail-closed.
//  - Webhook payload: status "OK" → done, "ERROR" → failed; kimenet a payload mezőben.
// Működéséhez FAL_KEY kell; kulcs nélkül nem regisztrálódik.
import { createHash, createPublicKey, verify as edVerify, KeyObject } from "crypto";
import {
  Estimate, JobType, NormalizedOutput, ProviderAdapter, ProviderError,
  SubmitParams, SubmitResult, ProviderErrorCategory,
} from "./types";

const QUEUE = "https://queue.fal.run";
const JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;
const TIMESTAMP_TOLERANCE_SEC = 300; // 5 perc

interface FalModelSpec {
  endpoint: string;
  estimate: number;
  mapInput: (payload: Record<string, unknown>) => Record<string, unknown>;
  mapOutput: (raw: Record<string, unknown>) => NormalizedOutput;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const fileUrl = (v: unknown): string | undefined =>
  typeof v === "object" && v !== null && "url" in v
    ? str((v as { url: unknown }).url) : str(v);

const file = (kind: "image" | "video" | "audio") =>
  (v: unknown): NormalizedOutput["files"] => {
    if (!v) return [];
    if (typeof v === "string") return [{ kind, url: v }];
    if (Array.isArray(v)) return v.flatMap((x) => file(kind)(x));
    if (typeof v === "object" && "url" in (v as Record<string, unknown>)) {
      return file(kind)((v as Record<string, unknown>).url);
    }
    return [];
  };

const MODELS: Partial<Record<JobType, FalModelSpec>> = {
  character_training: {
    endpoint: "fal-ai/flux-lora-fast-training",
    estimate: 1500,
    // EGYSÉGES mező: data URL vagy signed zip URL → a fal dokumentált images_data_url mezője
    mapInput: (p) => ({
      images_data_url: p.imagesDataUrl ?? p.imagesZipUrl,
      steps: p.steps ?? 1000,
      ...(p.triggerWord ? { trigger_word: p.triggerWord } : {}),
    }),
    mapOutput: (raw) => ({
      files: [],
      meta: {
        configFileUrl: fileUrl(raw.config_file),
        weightsUrl: fileUrl(raw.diffusers_lora_file ?? raw.lora_file),
      },
    }),
  },
  test_image: {
    endpoint: "fal-ai/flux-lora",
    estimate: 40,
    mapInput: (p) => ({
      prompt: p.prompt,
      loras: [{ path: p.loraPath, scale: 1 }],
      image_size: p.imageSize ?? "square_hd",
      num_inference_steps: p.steps ?? 28,
      seed: p.seed,
    }),
    mapOutput: (raw) => ({ files: file("image")(raw.images ?? raw.image), meta: { seed: raw.seed } }),
  },
  image_generation: {
    endpoint: "fal-ai/flux-lora",
    estimate: 40,
    mapInput: (p) => ({
      prompt: p.prompt,
      ...(p.negativePrompt ? { negative_prompt: p.negativePrompt } : {}),
      ...(p.loraPath ? { loras: [{ path: p.loraPath, scale: 1 }] } : {}),
      image_size: p.imageSize ?? "square_hd",
      num_inference_steps: p.steps ?? 28,
      ...(p.guidance ? { guidance_scale: p.guidance } : {}),
      seed: p.seed,
      num_images: p.numImages ?? 1,
    }),
    mapOutput: (raw) => ({ files: file("image")(raw.images ?? raw.image), meta: { seed: raw.seed } }),
  },
  image_edit: {
    endpoint: "fal-ai/nano-banana-pro/edit",
    estimate: 50,
    mapInput: (p) => ({ prompt: p.prompt, image_urls: p.imageUrls }),
    mapOutput: (raw) => ({ files: file("image")(raw.images ?? raw.image), meta: {} }),
  },
  video_from_image: {
    endpoint: "fal-ai/kling-video/v2.1/master/image-to-video",
    estimate: 400,
    mapInput: (p) => ({
      prompt: p.prompt, image_url: p.imageUrl,
      duration: p.duration ?? "5", aspect_ratio: p.aspectRatio ?? "16:9",
      ...(p.motionStrength ? { motion_bucket_id: p.motionStrength } : {}),
      ...(p.cfg ? { cfg_scale: p.cfg } : {}),
    }),
    mapOutput: (raw) => ({ files: file("video")(raw.video), meta: {} }),
  },
  lip_sync: {
    endpoint: "fal-ai/sync-lips",
    estimate: 300,
    mapInput: (p) => ({ video_url: p.videoUrl, audio_url: p.audioUrl }),
    mapOutput: (raw) => ({ files: file("video")(raw.video), meta: {} }),
  },
  // ---- ÚJ: korábban BLOCKED eszközök – dokumentált fal.ai végpontok ----
  video_to_prompt: {
    // BLIP-alapú képfeliratozás: kép → leírás (caption)
    endpoint: "fal-ai/imageutils/caption",
    estimate: 10,
    mapInput: (p) => ({ image_url: p.imageUrl }),
    mapOutput: (raw) => ({ files: [], meta: { caption: raw.caption ?? raw.text ?? "" } }),
  },
  upscale: {
    // Real-ESRGAN felbontásnövelés
    endpoint: "fal-ai/esrgan",
    estimate: 25,
    mapInput: (p) => ({ image_url: p.imageUrl, scale: p.scale ?? 4 }),
    mapOutput: (raw) => ({ files: file("image")(raw.image ?? raw.images), meta: {} }),
  },
  background_removal: {
    // BiRefNet háttér-eltávolítás
    endpoint: "fal-ai/birefnet",
    estimate: 15,
    mapInput: (p) => ({ image_url: p.imageUrl }),
    mapOutput: (raw) => ({ files: file("image")(raw.image ?? raw.images), meta: {} }),
  },
  skin_enhance: {
    // Preset-alapú retus: a SZERVER által adott prompttal nano-banana edit
    endpoint: "fal-ai/nano-banana-pro/edit",
    estimate: 50,
    mapInput: (p) => ({ prompt: p.prompt, image_urls: [p.imageUrl] }),
    mapOutput: (raw) => ({ files: file("image")(raw.images ?? raw.image), meta: {} }),
  },
  fix_face: {
    endpoint: "fal-ai/nano-banana-pro/edit",
    estimate: 50,
    mapInput: (p) => ({ prompt: p.prompt, image_urls: [p.imageUrl] }),
    mapOutput: (raw) => ({ files: file("image")(raw.images ?? raw.image), meta: {} }),
  },
  pinterest_composition: {
    endpoint: "fal-ai/nano-banana-pro/edit",
    estimate: 50,
    mapInput: (p) => ({ prompt: p.prompt, image_urls: [p.imageUrl] }),
    mapOutput: (raw) => ({ files: file("image")(raw.images ?? raw.image), meta: {} }),
  },
  motion_control: {
    endpoint: "fal-ai/kling-video/v2.1/master/video-to-video",
    estimate: 450,
    mapInput: (p) => ({ prompt: p.prompt, video_url: p.videoUrl, duration: p.duration ?? "5", aspect_ratio: p.aspectRatio ?? "16:9" }),
    mapOutput: (raw) => ({ files: file("video")(raw.video), meta: {} }),
  },
  character_swap: {
    // Arccsere: alapkép + cserefotó (a karakter referenciája)
    endpoint: "fal-ai/face-swap",
    estimate: 40,
    mapInput: (p) => ({ base_image_url: p.imageUrl, swap_image_url: p.swapImageUrl }),
    mapOutput: (raw) => ({ files: file("image")(raw.image ?? raw.images), meta: {} }),
  },
  talking_video: {
    // Kép helyett VIDEÓ + hang → beszélő videó (sync-lips)
    endpoint: "fal-ai/sync-lips",
    estimate: 350,
    mapInput: (p) => ({ video_url: p.videoUrl, audio_url: p.audioUrl }),
    mapOutput: (raw) => ({ files: file("video")(raw.video), meta: {} }),
  },
  video_to_video: {
    // Kling 2.1 videó→videó (stílus/mozgás átvitel)
    endpoint: "fal-ai/kling-video/v2.1/master/video-to-video",
    estimate: 450,
    mapInput: (p) => ({ prompt: p.prompt, video_url: p.videoUrl, duration: p.duration ?? "5", aspect_ratio: p.aspectRatio ?? "16:9" }),
    mapOutput: (raw) => ({ files: file("video")(raw.video), meta: {} }),
  },
  tts: {
    endpoint: "fal-ai/playht/tts/v3",
    estimate: 20,
    mapInput: (p) => ({ text: p.text, voice: p.voice, speed: p.speed ?? 1, language: p.language ?? "auto" }),
    mapOutput: (raw) => ({ files: file("audio")(raw.audio), meta: {} }),
  },
};

function classify(status: number): { retryable: boolean; category: ProviderErrorCategory } {
  if (status === 401 || status === 403) return { retryable: false, category: "auth" };
  if (status === 400 || status === 422) return { retryable: false, category: "invalid_input" };
  if (status === 429) return { retryable: true, category: "rate_limit" };
  if (status >= 500) return { retryable: true, category: "outage" };
  return { retryable: false, category: "unknown" };
}

// JWKS cache (memória, folyamatonként; 24 óra)
let jwksCache: { keys: KeyObject[]; at: number } | null = null;

async function getJwksKeys(): Promise<KeyObject[]> {
  if (jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new ProviderError(`fal jwks ${res.status}`, true, undefined, "outage");
  const jwks = (await res.json()) as { keys: Array<Record<string, unknown>> };
  const keys = (jwks.keys ?? [])
    .filter((k) => k.kty === "OKP" && k.crv === "Ed25519")
    .map((k) => createPublicKey({ key: k, format: "jwk" }));
  jwksCache = { keys, at: Date.now() };
  return keys;
}

export class FalAdapter implements ProviderAdapter {
  readonly name = "fal";
  readonly supports = Object.keys(MODELS) as JobType[];

  private key(): string {
    const k = process.env.FAL_KEY;
    if (!k) throw new ProviderError("FAL_KEY missing", false, undefined, "auth");
    return k;
  }

  private spec(jobType: JobType): FalModelSpec {
    const s = MODELS[jobType];
    if (!s) throw new ProviderError(`fal: unsupported ${jobType}`, false, undefined, "invalid_input");
    return s;
  }

  async estimate(jobType: JobType): Promise<Estimate> {
    const s = this.spec(jobType);
    return { credits: s.estimate, secondsExpected: jobType === "character_training" ? 900 : 120 };
  }

  async submit(p: SubmitParams): Promise<SubmitResult> {
    const s = this.spec(p.jobType);
    // Hivatalos dokumentált paraméter: fal_webhook (NEM fal_webhook_url)
    const url = new URL(`${QUEUE}/${s.endpoint}`);
    if (p.webhookUrl) url.searchParams.set("fal_webhook", p.webhookUrl);
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { authorization: `Key ${this.key()}`, "content-type": "application/json" },
      body: JSON.stringify(s.mapInput(p.payload)),
    });
    if (!res.ok) {
      const { retryable, category } = classify(res.status);
      throw new ProviderError(`fal submit ${res.status}: ${(await res.text()).slice(0, 200)}`, retryable, undefined, category);
    }
    const data = (await res.json()) as Record<string, unknown>;
    return {
      providerJobId: String(data.request_id),
      providerMeta: {
        endpoint: s.endpoint,
        requestId: str(data.request_id),
        statusUrl: str(data.status_url),
        responseUrl: str(data.response_url),
        cancelUrl: str(data.cancel_url),   // hivatalos cancel URL – tárolva, nem építve
      },
    };
  }

  private urls(meta: Record<string, unknown> | undefined, providerJobId: string) {
    const m = meta ?? {};
    const endpoint = str(m.endpoint);
    const statusUrl = str(m.statusUrl) ?? (endpoint ? `${QUEUE}/${endpoint}/requests/${providerJobId}/status` : "");
    const responseUrl = str(m.responseUrl) ?? (endpoint ? `${QUEUE}/${endpoint}/requests/${providerJobId}` : "");
    if (!statusUrl || !responseUrl) {
      throw new ProviderError("fal: provider_meta missing (endpoint/status/response url)", false, providerJobId, "unknown");
    }
    return { statusUrl, responseUrl, cancelUrl: str(m.cancelUrl) };
  }

  private async getJson(url: string, providerJobId?: string): Promise<Record<string, unknown>> {
    const res = await fetch(url, { headers: { authorization: `Key ${this.key()}` } });
    if (!res.ok) {
      const { retryable, category } = classify(res.status);
      throw new ProviderError(`fal ${res.status}`, retryable, providerJobId, category);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  async getStatus(providerJobId: string, meta?: Record<string, unknown>): Promise<"running" | "done" | "failed"> {
    const { statusUrl } = this.urls(meta, providerJobId);
    const data = await this.getJson(statusUrl, providerJobId);
    if (data.status === "COMPLETED") return "done";
    if (data.status === "FAILED") return "failed";
    return "running"; // IN_QUEUE / IN_PROGRESS
  }

  async getResult(providerJobId: string, meta?: Record<string, unknown>, jobType?: JobType): Promise<NormalizedOutput> {
    const { responseUrl } = this.urls(meta, providerJobId);
    const raw = await this.getJson(responseUrl, providerJobId);
    const s = jobType ? MODELS[jobType] : undefined;
    return s ? s.mapOutput(raw) : { files: [], meta: { rawKeys: Object.keys(raw) } };
  }

  async cancel(providerJobId: string, meta?: Record<string, unknown>): Promise<void> {
    // A TÁROLT cancel_url-t használjuk (ha hiányzik: hivatalos fallback endpointre építve)
    const { cancelUrl } = this.urls(meta, providerJobId);
    const url = cancelUrl ??
      (meta?.endpoint ? `${QUEUE}/${String(meta.endpoint)}/requests/${providerJobId}/cancel` : null);
    if (!url) return;
    await fetch(url, { method: "PUT", headers: { authorization: `Key ${this.key()}` } }).catch(() => {});
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
    const t0 = Date.now();
    try {
      const res = await fetch(`${QUEUE}/fal-ai/flux/schnell`, { method: "HEAD", headers: { authorization: `Key ${this.key()}` } });
      return { ok: res.status !== 401 && res.status !== 403, latencyMs: Date.now() - t0, detail: `http ${res.status}` };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, detail: e instanceof Error ? e.message : "error" };
    }
  }

  normalizeWebhook(raw: unknown): {
    eventId: string; providerJobId?: string; status: "running" | "done" | "failed"; output?: NormalizedOutput;
  } {
    const r = (raw ?? {}) as Record<string, unknown>;
    // Hivatalos státusz: OK / ERROR (nem COMPLETED/FAILED); kimenet a payload mezőben
    const status = r.status === "OK" ? "done" : r.status === "ERROR" ? "failed" : "running";
    const inner = (r.payload ?? {}) as Record<string, unknown>;
    const files: NormalizedOutput["files"] = [
      ...file("image")(inner.images ?? inner.image),
      ...file("video")(inner.video),
      ...file("audio")(inner.audio),
    ];
    return {
      eventId: str(r.request_id) ?? "fal_evt",   // request_id = replay-védelmi azonosító
      providerJobId: str(r.request_id),
      status,
      ...(files.length > 0 ? { output: { files, meta: { via: "webhook" } } } : {}),
    };
  }

  async verifyWebhook(rawBody: string, headers: Record<string, string | null>): Promise<boolean> {
    // Hivatalos fal.ai ellenőrzés – NINCS közös titok: JWKS-publikus kulcs + Ed25519.
    // Signed message (pontosan): requestId\nuserId\ntimestamp\nsha256Hex(rawBody)
    // Az aláírás HEX-kódolású (NEM Base64). Hiányzó/hibás header = fail-closed.
    const requestId = headers["x-fal-webhook-request-id"];
    const userId = headers["x-fal-webhook-user-id"];
    const timestamp = headers["x-fal-webhook-timestamp"];
    const signature = headers["x-fal-webhook-signature"];
    if (!requestId || !userId || !timestamp || !signature) return false;

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    if (Math.abs(Date.now() / 1000 - ts) > TIMESTAMP_TOLERANCE_SEC) return false; // ±5 perc

    const message = `${requestId}\n${userId}\n${timestamp}\n${createHash("sha256").update(rawBody).digest("hex")}`;

    let keys: KeyObject[];
    try { keys = await getJwksKeys(); } catch { return false; }            // JWKS hiba = fail-closed
    if (keys.length === 0) return false;

    const sigBuf = Buffer.from(signature, "hex");                          // HEX, nem Base64
    if (sigBuf.length !== 64) return false;
    const msgBuf = Buffer.from(message);
    for (const key of keys) {
      try { if (edVerify(null, msgBuf, key, sigBuf)) return true; } catch { /* következő kulcs */ }
    }
    return false;
  }
}
