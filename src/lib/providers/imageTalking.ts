import sharp from "sharp";
import { serviceClient } from "@/lib/supabase/server";
import { assertAllowedUrl } from "@/lib/security/ssrf";
import { REDUB_MAX_SECONDS } from "@/lib/videoRedub";
import { WaveSpeedAdapter } from "./wavespeed";
import { ProviderError, ProviderSubmissionRejectedError, type ProviderAdapter, type JobType, type SubmitParams } from "./types";

export class ImageTalkingAdapter implements ProviderAdapter {
  readonly name = "image_talking";
  readonly supports: readonly JobType[] = ["talking_video"];
  private poller = new WaveSpeedAdapter();
  async estimate(_type: JobType, payload: Record<string, unknown>) {
    const seconds = Number(payload.billableSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > REDUB_MAX_SECONDS) throw new ProviderError("REDUB_DURATION_LIMIT", false);
    return { credits: Math.ceil(Math.max(3, seconds) * (payload.resolution === "480p" ? 0.03 : 0.06) * 330), secondsExpected: 600 };
  }
  async submit(p: SubmitParams) {
    if (p.jobType !== "talking_video" || p.payload.imageTalking !== true) throw new ProviderSubmissionRejectedError("INVALID_IMAGE_TALKING_JOB", false);
    let imageUrl: string;
    try {
      const url = assertAllowedUrl(String(p.payload.imageUrl));
      if (url.origin !== new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin) throw new Error("IMAGE_INPUT_REQUIRED");
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
      if (!response.ok || !response.body) throw new Error("IMAGE_UNAVAILABLE");
      const chunks: Uint8Array[] = []; let size = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.length; if (size > 10 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE");
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      // Preserve the complete starting photo; fit rather than crop or regenerate it.
      const image = await sharp(Buffer.concat(chunks), { limitInputPixels: 40_000_000 }).rotate()
        .resize(720, 1280, { fit: "contain", background: "#10131a" }).jpeg({ quality: 94 }).toBuffer();
      const sb = serviceClient();
      const { data: job } = await sb.from("generation_jobs").select("owner_id").eq("id", p.jobId).single();
      if (!job) throw new Error("JOB_NOT_FOUND");
      const path = `${job.owner_id}/${p.jobId}/talking-start.jpg`;
      const { error } = await sb.storage.from("assets").upload(path, image, { contentType: "image/jpeg", upsert: true });
      if (error) throw new Error("IMAGE_STORAGE_FAILED");
      const { data: signed } = await sb.storage.from("assets").createSignedUrl(path, 7200);
      if (!signed?.signedUrl) throw new Error("IMAGE_UNAVAILABLE");
      imageUrl = signed.signedUrl;
    } catch (error) { throw new ProviderSubmissionRejectedError(error instanceof Error ? error.message : "IMAGE_INPUT_REQUIRED", false); }
    const response = await fetch("https://api.wavespeed.ai/api/v3/wavespeed-ai/infinitetalk", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.WAVESPEED_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ image: imageUrl, audio: p.payload.audioUrl, prompt: p.payload.prompt,
        resolution: p.payload.resolution === "480p" ? "480p" : "720p" }), signal: AbortSignal.timeout(45_000),
    });
    const body = await response.json() as { data?: { id?: string }; message?: string };
    if (!response.ok) {
      const message = `Beszélő videó: ${response.status}: ${String(body.message ?? "Elutasított kérés").slice(0, 200)}`;
      if ([400,401,402,403,404,422].includes(response.status) && !body.data?.id) throw new ProviderSubmissionRejectedError(message, false);
      throw new ProviderError(message, true);
    }
    if (!body.data?.id) throw new ProviderError("IMAGE_TALKING_TASK_ID_MISSING", true);
    return { providerJobId: body.data.id, providerMeta: { speechJobId: p.payload.speechJobId, imageTalking: true, expectedSeconds: p.payload.billableSeconds } };
  }
  getStatus(id: string) { return this.poller.getStatus(id); }
  async getResult(id: string) {
    const output = await this.poller.getResult(id, undefined, "video_character_swap");
    return { ...output, meta: { ...output.meta, imageTalking: true } };
  }
  async cancel() {}
  healthCheck() { return this.poller.healthCheck(); }
  normalizeWebhook() { return { eventId: "unused", status: "failed" as const }; }
  async verifyWebhook() { return false; }
}
