import { serviceClient } from "@/lib/supabase/server";
import { redubSpeechText, REDUB_MAX_SECONDS, type RedubDelivery } from "@/lib/videoRedub";
import { mediaDuration } from "@/server/jobs/mediaDuration";
import { WaveSpeedAdapter } from "./wavespeed";
import { ProviderError, ProviderSubmissionRejectedError, type ProviderAdapter, type JobType,
  type SubmitParams, type NormalizedOutput } from "./types";

/** Isolated opt-in path: existing generators, voices and Nureta postprocessing retain their behavior. */
export class VideoRedubAdapter implements ProviderAdapter {
  readonly name = "video_redub";
  readonly supports: readonly JobType[] = ["tts", "lip_sync"];
  private poller = new WaveSpeedAdapter();
  async estimate(type: JobType, payload: Record<string, unknown>) {
    if (type === "tts") return { credits: Math.ceil((String(payload.text).length + 30) * 0.0003 * 330) + 10, secondsExpected: 60 };
    const seconds = Number(payload.billableSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > REDUB_MAX_SECONDS) throw new ProviderError("REDUB_DURATION_LIMIT", false);
    return { credits: Math.ceil(seconds * 0.084 * 330), secondsExpected: 240 };
  }
  async submit(p: SubmitParams) {
    if (p.jobType === "tts" && p.payload.videoRedubSpeech === true) return this.speech(p);
    if (p.jobType !== "lip_sync" || p.payload.videoRedub !== true) throw new ProviderSubmissionRejectedError("INVALID_REDUB_JOB", false);
    // Loop extends the existing footage to the FULL speech, rather than cutting the audio off.
    const response = await fetch("https://api.wavespeed.ai/api/v3/sync/lipsync-2-pro", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.WAVESPEED_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ video: p.payload.videoUrl, audio: p.payload.audioUrl, sync_mode: "loop" }),
      signal: AbortSignal.timeout(45_000),
    });
    const body = await response.json() as { data?: { id?: string }; message?: string };
    if (!response.ok) {
      const message = `Szájszinkron: ${response.status}: ${String(body.message ?? "Elutasított kérés").slice(0, 200)}`;
      if ([400,401,402,403,404,422].includes(response.status) && !body.data?.id) throw new ProviderSubmissionRejectedError(message, false);
      throw new ProviderError(message, true);
    }
    if (!body.data?.id) throw new ProviderError("LIPSYNC_TASK_ID_MISSING", true);
    return { providerJobId: body.data.id, providerMeta: { stage: "video_redub", speechJobId: p.payload.speechJobId,
      expectedSeconds: p.payload.billableSeconds } };
  }
  private async speech(p: SubmitParams) {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(String(p.payload.voiceId))}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "", "content-type": "application/json" },
      body: JSON.stringify({ text: redubSpeechText(String(p.payload.text), p.payload.delivery as RedubDelivery),
        model_id: "eleven_v4", language_code: "hu" }), signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      const message = `A modell hangja nem készült el (ElevenLabs ${response.status}).`;
      if ([400,401,402,403,404,422].includes(response.status)) throw new ProviderSubmissionRejectedError(message, false);
      throw new ProviderError(message, true);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 5_000_000 || !(bytes.subarray(0,3).toString() === "ID3" || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))
      throw new ProviderSubmissionRejectedError("INVALID_SPEECH_AUDIO", false);
    const sb = serviceClient();
    const { data: job } = await sb.from("generation_jobs").select("owner_id").eq("id", p.jobId).single();
    if (!job) throw new ProviderSubmissionRejectedError("JOB_NOT_FOUND", false);
    const path = `${job.owner_id}/${p.jobId}/redub-speech.mp3`;
    const { error } = await sb.storage.from("assets").upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
    if (error) throw new ProviderSubmissionRejectedError("SPEECH_STORAGE_FAILED", false);
    const { data: signed } = await sb.storage.from("assets").createSignedUrl(path, 7200);
    if (!signed?.signedUrl) throw new ProviderSubmissionRejectedError("SPEECH_UNAVAILABLE", false);
    const seconds = await mediaDuration(signed.signedUrl);
    if (seconds > REDUB_MAX_SECONDS) throw new ProviderSubmissionRejectedError("A beszéd 3 percnél hosszabb. Rövidítsd a szöveget; nem vágjuk le a végét.", false);
    return { providerJobId: p.jobId, providerMeta: { stage: "redub_speech", path, ownerId: job.owner_id, seconds } };
  }
  async getStatus(id: string, meta?: Record<string, unknown>) {
    return meta?.stage === "redub_speech" ? "done" as const : this.poller.getStatus(id);
  }
  async getResult(id: string, meta?: Record<string, unknown>): Promise<NormalizedOutput> {
    if (meta?.stage === "redub_speech") {
      const { data } = await serviceClient().storage.from("assets").createSignedUrl(String(meta.path), 7200);
      if (!data?.signedUrl) throw new ProviderError("SPEECH_UNAVAILABLE", true);
      return { files: [{ kind: "audio", url: data.signedUrl, filename: "speech.mp3", contentType: "audio/mpeg" }], meta: { seconds: meta.seconds } };
    }
    const output = await this.poller.getResult(id, undefined, "video_character_swap");
    return { ...output, meta: { ...output.meta, videoRedub: true, expectedSeconds: meta?.expectedSeconds } };
  }
  async cancel() {}
  healthCheck() { return this.poller.healthCheck(); }
  normalizeWebhook() { return { eventId: "unused", status: "failed" as const }; }
  async verifyWebhook() { return false; }
}
