// Replicate adapter – a dokumentált REST-végpontok szerint.
//  - Predikciók: POST /v1/models/{owner}/{model}/predictions · GET /v1/predictions/{id} · POST /v1/predictions/{id}/cancel
//  - TRÉNING (hivatalos training flow): POST /v1/models/{owner}/{model}/trainings
//    body: { destination, input } · státusz/eredmény: GET /v1/trainings/{id} → output = weights URI
//  - Webhook: Standard Webhooks (webhook-id / webhook-timestamp / webhook-signature), svix-verifikáció
// Működéséhez REPLICATE_API_TOKEN kell; kulcs nélkül nem regisztrálódik (fail-closed).
import { Webhook } from "svix";
import {
  Estimate, JobType, NormalizedOutput, ProviderAdapter, ProviderError,
  SubmitParams, SubmitResult, ProviderErrorCategory,
} from "./types";

const API = "https://api.replicate.com/v1";

interface RepModelSpec {
  model: string;                    // owner/name
  version?: string;                 // opcionális pinned verzió
  estimate: number;
  kind: "prediction" | "training";
  mapInput: (payload: Record<string, unknown>) => Record<string, unknown>;
}

const MODELS: Partial<Record<JobType, RepModelSpec>> = {
  character_training: {
    model: "ostris/flux-dev-lora-trainer",
    estimate: 2000,
    kind: "training",
    // A tréning NEM prediction – hivatalos training flow, destination saját modellként
    mapInput: (p) => ({
      input: {
        input_images: p.imagesDataUrl ?? p.imagesZipUrl,   // data URL vagy signed zip URL
        trigger_word: p.triggerWord ?? "TOK",
        steps: p.steps ?? 1000,
        ...(p.learningRate ? { learning_rate: p.learningRate } : {}),
      },
      destination: p.destination,   // kötelező: "owner/modellnév" – a felhasználó Replicate-fiókjában jön létre
    }),
  },
  test_image: {
    model: "black-forest-labs/flux-dev-lora",
    estimate: 40, kind: "prediction",
    mapInput: (p) => ({ prompt: p.prompt, lora_weights: p.loraPath, num_inference_steps: p.steps ?? 28, seed: p.seed }),
  },
  image_generation: {
    model: "black-forest-labs/flux-dev-lora",
    estimate: 40, kind: "prediction",
    mapInput: (p) => ({ prompt: p.prompt, lora_weights: p.loraPath, num_inference_steps: p.steps ?? 28, seed: p.seed }),
  },
  image_edit: {
    model: "google/nano-banana",
    estimate: 50, kind: "prediction",
    mapInput: (p) => ({ prompt: p.prompt, images: p.imageUrls }),
  },
  video_from_image: {
    model: "tencent/seedance-1-pro",
    estimate: 500, kind: "prediction",
    mapInput: (p) => ({ prompt: p.prompt, image: p.imageUrl, duration: p.duration ?? 5, aspect_ratio: p.aspectRatio ?? "16:9" }),
  },
  // talking_video / lip_sync: Replicate-oldalon nincs igazolt modell – az adapter NEM támogatja
  // (a fal sync-lips az elsődleges; más providert külön igazolás után kell bekötni)
};

function classify(status: number): { retryable: boolean; category: ProviderErrorCategory } {
  if (status === 401 || status === 403) return { retryable: false, category: "auth" };
  if (status === 400 || status === 404 || status === 422) return { retryable: false, category: "invalid_input" };
  if (status === 429) return { retryable: true, category: "rate_limit" };
  if (status >= 500) return { retryable: true, category: "outage" };
  return { retryable: false, category: "unknown" };
}

export class ReplicateAdapter implements ProviderAdapter {
  readonly name = "replicate";
  readonly supports = Object.keys(MODELS) as JobType[];

  private token(): string {
    const t = process.env.REPLICATE_API_TOKEN;
    if (!t) throw new ProviderError("REPLICATE_API_TOKEN missing", false, undefined, "auth");
    return t;
  }

  private async call(path: string, init: RequestInit, providerJobId?: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token()}`,
        "content-type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const { retryable, category } = classify(res.status);
      throw new ProviderError(`replicate ${res.status}: ${(await res.text()).slice(0, 200)}`, retryable, providerJobId, category);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  private spec(jobType: JobType): RepModelSpec {
    const s = MODELS[jobType];
    if (!s) throw new ProviderError(`replicate: unsupported ${jobType}`, false, undefined, "invalid_input");
    return s;
  }

  async estimate(jobType: JobType): Promise<Estimate> {
    const s = this.spec(jobType);
    return { credits: s.estimate, secondsExpected: s.kind === "training" ? 1200 : 180 };
  }

  async submit(p: SubmitParams): Promise<SubmitResult> {
    const s = this.spec(p.jobType);
    if (s.kind === "training") {
      if (typeof p.payload.destination !== "string" || !/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(p.payload.destination)) {
        throw new ProviderError("replicate: destination required", false, undefined, "invalid_input");
      }
      // Hivatalos training flow: POST /v1/models/{model}/trainings
      const data = await this.call(`/models/${s.model}/trainings`, {
        method: "POST",
        body: JSON.stringify({ ...s.mapInput(p.payload), webhook: p.webhookUrl }),
      });
      return {
        providerJobId: String(data.id),   // training ID
        providerMeta: { kind: "training", model: s.model, version: data.version },
      };
    }
    const input = s.mapInput(p.payload);
    const body: Record<string, unknown> = { input, webhook: p.webhookUrl, webhook_events_filter: ["start", "completed"] };
    if (s.version) body.version = s.version;
    const data = await this.call(`/models/${s.model}/predictions`, { method: "POST", body: JSON.stringify(body) });
    return {
      providerJobId: String(data.id),
      providerMeta: { kind: "prediction", model: s.model, version: data.version },
    };
  }

  private basePath(meta: Record<string, unknown> | undefined, providerJobId: string): string {
    return (meta?.kind === "training" ? "/trainings/" : "/predictions/") + providerJobId;
  }

  async getStatus(providerJobId: string, meta?: Record<string, unknown>): Promise<"running" | "done" | "failed"> {
    const data = await this.call(this.basePath(meta, providerJobId), { method: "GET" }, providerJobId);
    if (data.status === "succeeded") return "done";
    if (["failed", "canceled"].includes(String(data.status))) return "failed";
    return "running";
  }

  async getResult(providerJobId: string, meta?: Record<string, unknown>): Promise<NormalizedOutput> {
    const data = await this.call(this.basePath(meta, providerJobId), { method: "GET" }, providerJobId);
    const out = data.output;
    if (meta?.kind === "training") {
      // Tréning output: weights URI (replicate weights://…) – fájl nélküli meta
      return { files: [], meta: { weights: out, version: data.version, logs: data.logs ?? null } };
    }
    const urls: string[] = [];
    if (typeof out === "string") urls.push(out);
    else if (Array.isArray(out)) urls.push(...out.filter((x): x is string => typeof x === "string"));
    const files = urls.map((url) => ({
      kind: (url.match(/\.(mp4|webm|mov)(\?|$)/) ? "video"
        : url.match(/\.(mp3|wav|m4a)(\?|$)/) ? "audio" : "image") as "video" | "audio" | "image",
      url,
    }));
    return { files, meta: { logs: data.logs ?? null } };
  }

  async cancel(providerJobId: string, meta?: Record<string, unknown>): Promise<void> {
    // Csak predikció törölhető; a GET-re nincs indokolatlan Prefer fejléc
    if (meta?.kind === "training") return;
    await this.call(`${this.basePath(meta, providerJobId)}/cancel`, { method: "POST" }, providerJobId).catch(() => {});
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
    const t0 = Date.now();
    try {
      const res = await fetch(`${API}/account`, { headers: { authorization: `Bearer ${this.token()}` } });
      return { ok: res.ok, latencyMs: Date.now() - t0, detail: res.ok ? undefined : `http ${res.status}` };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, detail: e instanceof Error ? e.message : "error" };
    }
  }

  normalizeWebhook(raw: unknown): { eventId: string; providerJobId?: string; status: "running" | "done" | "failed" } {
    const r = (raw ?? {}) as Record<string, unknown>;
    const status = r.status === "succeeded" ? "done" : ["failed", "canceled"].includes(String(r.status)) ? "failed" : "running";
    const id = typeof r.id === "string" ? r.id : undefined;
    return { eventId: id ?? "rep_evt", providerJobId: id, status };
  }

  async verifyWebhook(rawBody: string, headers: Record<string, string | null>, secret: string): Promise<boolean> {
    // Replicate Standard Webhooks: webhook-id / webhook-timestamp / webhook-signature (svix séma,
    // alapértelmezett ~5 perc időablak + timestamp/replay védelem a verify-ban)
    if (!headers["webhook-id"] || !headers["webhook-timestamp"] || !headers["webhook-signature"]) return false;
    try {
      new Webhook(secret).verify(rawBody, {
        "webhook-id": headers["webhook-id"] ?? "",
        "webhook-timestamp": headers["webhook-timestamp"] ?? "",
        "webhook-signature": headers["webhook-signature"] ?? "",
      });
      return true;
    } catch {
      return false;
    }
  }
}
