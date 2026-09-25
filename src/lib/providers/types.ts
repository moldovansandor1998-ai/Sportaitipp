import { z } from "zod";

export const JobTypeSchema = z.enum([
  "reference_qc","character_training","test_image","identity_check",
  "image_generation","image_edit","upscale","background_removal","skin_enhance","fix_face","pinterest_composition","motion_control",
  "video_from_image","video_to_video","video_character_swap","talking_video","character_swap","motion_control","lip_sync",
  "tts","video_to_prompt","captioning","frame_extract","dataset_generation",
  "carousel_page","viral_scene","ppv_render",
]);
export type JobType = z.infer<typeof JobTypeSchema>;

export interface Estimate { credits: number; secondsExpected: number; }

export interface ProviderFile {
  kind: "image" | "video" | "audio";
  url?: string;
  base64?: string;
  dataUrl?: string;
  filename?: string;
  contentType?: string;
}

export interface NormalizedOutput { files: ProviderFile[]; meta: Record<string, unknown>; }

export interface SubmitParams {
  jobId: string;
  jobType: JobType;
  payload: Record<string, unknown>;
  /** Kész URL – csak akkor használd, ha már ismert a cél-adapter. */
  webhookUrl?: string;
  /** A webhook URL a TÉNYLEGESEN kiválasztott adapter nevével készül el. */
  webhookUrlFor?: (adapterName: string) => string;
  idempotencyKey: string;
}

export interface SubmitResult {
  providerJobId: string;
  /** Szolgáltatói meta (status/response URL, modellverzió stb.) – a job.provider_meta-ba kerül. */
  providerMeta?: Record<string, unknown>;
}

export interface ProviderAdapter {
  readonly name: string;
  readonly supports: readonly JobType[];
  estimate(jobType: JobType, payload: Record<string, unknown>): Promise<Estimate>;
  submit(params: SubmitParams): Promise<SubmitResult>;
  getStatus(providerJobId: string, meta?: Record<string, unknown>): Promise<"running" | "done" | "failed">;
  getResult(providerJobId: string, meta?: Record<string, unknown>, jobType?: JobType): Promise<NormalizedOutput>;
  cancel(providerJobId: string, meta?: Record<string, unknown>): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; detail?: string }>;
  /** Normalizálja a nyers webhookot; a kimenet lehet közvetlenül a payload (ellenőrzés után!). */
  normalizeWebhook(raw: unknown): {
    eventId: string;
    providerJobId?: string;
    status: "running" | "done" | "failed";
    output?: NormalizedOutput;
  };
  /** Aláírás-ellenőrzés a szolgáltató valódi sémájával; MINDEN érkezett headerrel. Aszinkron (JWKS).
   *  A `secret` csak azoknál a szolgáltatóknál kell, ahol közös titkos kulccsal írnak alá
   *  (pl. Replicate Standard Webhooks); JWKS-alapú szolgáltatóknál (fal.ai) nem használt. */
  verifyWebhook(rawBody: string, headers: Record<string, string | null>, secret?: string): Promise<boolean>;
}

export type ProviderErrorCategory =
  | "rate_limit" | "auth" | "invalid_input" | "outage" | "unknown";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly providerJobId?: string,
    readonly category: ProviderErrorCategory = "unknown",
  ) { super(message); this.name = "ProviderError"; }
}
