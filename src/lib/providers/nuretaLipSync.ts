import { ProviderSubmissionRejectedError, ProviderError, type ProviderAdapter, type JobType, type SubmitParams, type NormalizedOutput } from "./types";
import { WaveSpeedAdapter } from "./wavespeed";
import { serviceClient } from "@/lib/supabase/server";

/** Independent postprocessing adapter; the existing WaveSpeed generator is unchanged. */
export class NuretaLipSyncAdapter implements ProviderAdapter {
  readonly name = "nureta_lipsync";
  readonly supports: readonly JobType[] = ["lip_sync"];
  private poller = new WaveSpeedAdapter();
  async estimate(_type: JobType, payload: Record<string, unknown>) {
    return { credits: Math.ceil((Number(payload.duration) + 1) * 0.084 * 330) + (payload.audioMode === "keep" ? 0 : 100), secondsExpected: 180 };
  }
  async submit(p: SubmitParams) {
    let audioUrl: string;
    try {
      const sb = serviceClient();
      const { data: job } = await sb.from("generation_jobs").select("owner_id").eq("id", p.jobId).single();
      if (!job || p.payload.nuretaPostprocess !== true) throw new Error("Nureta utófeldolgozási feladat szükséges.");
      const { createNuretaSyncAudio } = await import("@/server/jobs/nuretaLipSync");
      const audio = await createNuretaSyncAudio(p.payload);
      const path = `${job.owner_id}/${p.jobId}/lipsync-target.mp3`;
      const { error } = await sb.storage.from("assets").upload(path, audio, { contentType: "audio/mpeg", upsert: true });
      if (error) throw new Error("A szájszinkron hangja nem tárolható.");
      const { data: signed } = await sb.storage.from("assets").createSignedUrl(path, 7200);
      if (!signed?.signedUrl) throw new Error("A szájszinkron hangja nem érhető el.");
      audioUrl = signed.signedUrl;
    } catch (error) {
      // No lip-sync task has been submitted yet, so the original video remains safe.
      throw new ProviderSubmissionRejectedError(error instanceof Error ? error.message : "LIPSYNC_AUDIO_FAILED", false);
    }
    const response = await fetch("https://api.wavespeed.ai/api/v3/sync/lipsync-2-pro", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.WAVESPEED_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ video: p.payload.videoUrl, audio: audioUrl, sync_mode: "silence" }), signal: AbortSignal.timeout(45_000),
    });
    const body = await response.json() as { data?: { id?: string }; message?: string };
    if (!response.ok) {
      const error = `Nureta szájszinkron: WaveSpeed ${response.status}: ${String(body.message ?? "Elutasított kérés").slice(0, 200)}`;
      if ([400,401,402,403,404,422].includes(response.status) && !body.data?.id) throw new ProviderSubmissionRejectedError(error, false);
      throw new ProviderError(error, true);
    }
    if (!body.data?.id) throw new ProviderError("Szájszinkron feladatazonosító hiányzik.", true);
    return { providerJobId: body.data.id, providerMeta: { parentJobId: p.payload.parentJobId, stage: "nureta_lipsync", audioMode: p.payload.audioMode } };
  }
  getStatus(id: string) { return this.poller.getStatus(id); }
  async getResult(id: string): Promise<NormalizedOutput> {
    const output = await this.poller.getResult(id, undefined, "video_character_swap");
    return { ...output, meta: { ...output.meta, nuretaPostprocess: true } };
  }
  async cancel() {}
  healthCheck() { return this.poller.healthCheck(); }
  normalizeWebhook() { return { eventId: "unused", status: "failed" as const }; }
  async verifyWebhook() { return false; }
}
