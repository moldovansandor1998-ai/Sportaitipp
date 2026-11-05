import "server-only";
import { randomUUID } from "node:crypto";
import { serviceClient } from "@/lib/supabase/server";
import { ProviderError, ProviderSubmissionRejectedError, type NormalizedOutput, type SubmitParams, type SubmitResult } from "@/lib/providers/types";
import { planMotionSegments, type MotionSegment } from "@/lib/motionSegments";
import { downloadProviderFile } from "./providerDownload";
import { inspectMediaBytes } from "./mediaDuration";
import { motionClip, lastMotionFrame } from "./motionMedia";
import type { JobRow } from "./runJob";

type Request = (endpoint: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
type Result = (id: string) => Promise<Record<string, unknown>>;
interface Part { assetId: string; providerId: string; start: number; duration: number; outputSeconds?: number; }
interface Meta extends Record<string, unknown> {
  motionSequence: true; submission_started: true; jobId: string; stage: string;
  endpoint: string; prompt: string; negativePrompt: string; segments: MotionSegment[];
  index: number; parts: Part[]; lock?: string; lockAt?: number; imagePath?: string; videoPath?: string;
}
type SequenceJob = JobRow & { provider_meta: Meta };

async function ownedUrl(owner: string, assetId: string): Promise<string> {
  const sb = serviceClient();
  const { data, error } = await sb.from("assets").select("bucket,object_path")
    .eq("id", assetId).eq("owner_id", owner).single();
  if (error || !data) throw new Error("MOTION_SOURCE_UNAVAILABLE");
  const { data: signed, error: signError } = await sb.storage.from(data.bucket).createSignedUrl(data.object_path, 86400);
  if (signError || !signed?.signedUrl) throw new Error("MOTION_SOURCE_UNAVAILABLE");
  return signed.signedUrl;
}

async function upload(path: string, bytes: Buffer, contentType: string): Promise<void> {
  const { error } = await serviceClient().storage.from("assets").upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`MOTION_UPLOAD_FAILED: ${error.message}`);
}

async function signedPath(path: string): Promise<string> {
  const { data, error } = await serviceClient().storage.from("assets").createSignedUrl(path, 86400);
  if (error || !data?.signedUrl) throw new Error("MOTION_INPUT_UNAVAILABLE");
  return data.signedUrl;
}

async function prepareClip(job: JobRow, segment: MotionSegment, index: number): Promise<string> {
  const sourceId = String(job.payload?.sourceVideoAssetId ?? "");
  const { buf } = await downloadProviderFile(await ownedUrl(job.owner_id, sourceId));
  if (buf.length > 48 * 1024 * 1024) throw new Error("MOTION_SOURCE_TOO_LARGE");
  const path = `${job.owner_id}/${job.id}/motion-source-${index + 1}.mp4`;
  await upload(path, await motionClip(buf, segment), "video/mp4");
  return path;
}

function body(meta: Meta, image: string, video: string) {
  return { image, video, character_orientation: "video", keep_original_sound: true,
    prompt: meta.prompt, negative_prompt: meta.negativePrompt };
}

export async function startMotionSequence(p: SubmitParams, endpoint: string, prompt: string, negativePrompt: string, request: Request): Promise<SubmitResult> {
  let meta: Meta;
  let image: string, video: string;
  try {
    const { data: job } = await serviceClient().from("generation_jobs").select("*").eq("id", p.jobId).single();
    if (!job || typeof p.payload.sourceVideoAssetId !== "string" || typeof p.payload.sceneImageAssetId !== "string")
      throw new Error("MOTION_SOURCE_UNAVAILABLE");
    // sourceSeconds is produced by server preparation, never copied from client estimates.
    const segments = planMotionSegments(Number(p.payload.sourceSeconds));
    meta = { motionSequence: true, submission_started: true, jobId: p.jobId, stage: "motion_rendering",
      endpoint, prompt, negativePrompt, segments, index: 0, parts: [] };
    const path = await prepareClip({ ...job, payload: p.payload } as JobRow, segments[0], 0);
    [image, video] = await Promise.all([ownedUrl(job.owner_id, p.payload.sceneImageAssetId), signedPath(path)]);
  } catch (error) {
    throw new ProviderSubmissionRejectedError(error instanceof Error ? error.message : "MOTION_PREPARATION_FAILED", false);
  }
  const data = await request(endpoint, body(meta, image, video));
  if (typeof data.id !== "string") throw new ProviderError("WaveSpeed did not return a task ID", true);
  return { providerJobId: data.id, providerMeta: meta };
}

async function readJob(meta: Record<string, unknown>): Promise<SequenceJob> {
  const { data, error } = await serviceClient().from("generation_jobs").select("*").eq("id", String(meta.jobId)).single();
  if (error || !data || !data.provider_meta?.motionSequence) throw new ProviderError("MOTION_SEQUENCE_UNAVAILABLE", true);
  return data as SequenceJob;
}

/** Optimistic, persistent stage lock shared by cron and browser polling. */
async function save(job: SequenceJob, next: Meta, extra: Record<string, unknown> = {}): Promise<boolean> {
  const { data, error } = await serviceClient().from("generation_jobs").update({ provider_meta: next, ...extra })
    .eq("id", job.id).eq("status", "processing").eq("provider_job_id", job.provider_job_id!)
    .contains("provider_meta", { stage: job.provider_meta.stage, index: job.provider_meta.index,
      ...(job.provider_meta.lock ? { lock: job.provider_meta.lock } : {}) })
    .select("id").maybeSingle();
  if (error) throw new ProviderError(`MOTION_CHECKPOINT_FAILED: ${error.message}`, true);
  return !!data;
}

async function claim(job: SequenceJob, stage: string): Promise<SequenceJob | null> {
  const next: Meta = { ...job.provider_meta, stage, lock: randomUUID(), lockAt: Date.now() };
  return await save(job, next) ? { ...job, provider_meta: next } : null;
}

export async function pollMotionSequence(id: string, initial: Record<string, unknown>, request: Request, result: Result): Promise<"running" | "done"> {
  const job = await readJob(initial), meta = job.provider_meta;
  if (job.status !== "processing" || job.provider_job_id !== id) return "running";
  if (meta.stage === "motion_complete") return "done";
  // Preparation/storage are safe to retry after a lost worker. Paid submissions are not.
  if (["motion_saving", "motion_preparing", "motion_submitting"].includes(meta.stage)) {
    if (Date.now() - Number(meta.lockAt) < 10 * 60_000) return "running";
    if (meta.stage === "motion_submitting") {
      await save(job, meta, { status: "submission_uncertain", error: { message: "A következő rész beküldése nem ellenőrizhető. A kész részek a galériában maradtak; nem indítunk második fizetős kérést." } });
    } else {
      await save(job, { ...meta, stage: meta.stage === "motion_saving" ? "motion_rendering" : "motion_next", lock: randomUUID() });
    }
    return "running";
  }
  if (meta.stage === "motion_rendering") {
    const data = await result(id);
    if (["failed", "cancelled", "timeout", "deleted"].includes(String(data.status)))
      throw new ProviderError(`${meta.index + 1}/${meta.segments.length}. rész: ${String(data.error ?? data.error_message ?? data.status).slice(0, 400)}. A már elkészült részek a galériában maradtak.`, false, id);
    if (data.status !== "completed") return "running";
    const output = Array.isArray(data.outputs) ? data.outputs[0] : null;
    const url = typeof output === "string" ? output : output?.url;
    if (typeof url !== "string") throw new ProviderError("WaveSpeed returned no video", false, id);
    const locked = await claim(job, "motion_saving");
    if (!locked) return "running";
    try {
      const { buf } = await downloadProviderFile(url, "wavespeed", "video");
      const media = await inspectMediaBytes(buf);
      if (!media.hasVideo) throw new Error("MOTION_OUTPUT_INVALID");
      const { storeOutputAssets } = await import("./runJob");
      const [assetId] = await storeOutputAssets(job.id, job, { files: [{ kind: "video", base64: buf.toString("base64"),
        filename: `resz-${String(meta.index + 1).padStart(2, "0")}-${meta.segments.length}.mp4`, contentType: "video/mp4" }], meta: {} }, serviceClient());
      const segment = meta.segments[meta.index];
      // Kling may return a shorter valid-motion extraction. Continue the next
      // requested source interval using the ACTUAL saved video's final frame.
      // Do not resubmit/charge an already processed source interval to chase length.
      const parts = [...meta.parts, { assetId, providerId: id, ...segment, outputSeconds: media.durationSeconds }];
      const next = { ...locked.provider_meta, parts, stage: parts.length === meta.segments.length ? "motion_complete" : "motion_next" };
      if (!await save(locked, next)) return "running";
      return "running"; // Next polling call uses the persisted checkpoint.
    } catch (error) {
      await save(locked, { ...locked.provider_meta, stage: "motion_rendering" }).catch(() => {});
      throw error;
    }
  }
  if (meta.stage === "motion_next") {
    const locked = await claim(job, "motion_preparing");
    if (!locked) return "running";
    try {
      const index = meta.parts.length;
      const previous = await downloadProviderFile(await ownedUrl(job.owner_id, meta.parts[index - 1].assetId), undefined, "video");
      const previousMedia = await inspectMediaBytes(previous.buf);
      const parts = meta.parts.map((part, i) => i === index - 1 ? { ...part, outputSeconds: previousMedia.durationSeconds } : part);
      const imagePath = `${job.owner_id}/${job.id}/motion-start-${index + 1}.jpg`;
      await upload(imagePath, await lastMotionFrame(previous.buf), "image/jpeg");
      const videoPath = await prepareClip(job, meta.segments[index], index);
      await save(locked, { ...locked.provider_meta, stage: "motion_ready", index, imagePath, videoPath, parts });
    } catch (error) {
      await save(locked, { ...locked.provider_meta, stage: "motion_next" }).catch(() => {});
      throw error;
    }
    return "running";
  }
  if (meta.stage === "motion_ready") {
    // Sign before acquiring the irreversible submission marker. Expired links are refreshed per part.
    const [image, video] = await Promise.all([signedPath(meta.imagePath!), signedPath(meta.videoPath!)]);
    const locked = await claim(job, "motion_submitting");
    if (!locked) return "running";
    let acceptedId: string | undefined;
    try {
      const data = await request(meta.endpoint, body(meta, image, video));
      if (typeof data.id !== "string") throw new Error("MOTION_TASK_ID_MISSING");
      acceptedId = data.id;
      console.info(JSON.stringify({ scope: "motion.part_submitted", jobId: job.id, part: meta.index + 1, providerJobId: acceptedId }));
      if (!await save(locked, { ...locked.provider_meta, stage: "motion_rendering" }, { provider_job_id: data.id }))
        throw new Error("MOTION_SUBMISSION_NOT_RECORDED");
    } catch (error) {
      // Even 5xx/timeouts can hide an accepted, billed request. Never auto-resubmit it.
      await save(locked, { ...locked.provider_meta, ...(acceptedId ? { uncertainProviderId: acceptedId } : {}) }, {
        status: "submission_uncertain", error: { message: "A következő videórész beküldését ellenőrizni kell. A kész részek a galériában maradtak.", detail: String(error).slice(0, 400) },
        ...(acceptedId ? { provider_job_id: acceptedId } : {}),
      });
    }
    return "running";
  }
  throw new ProviderError("MOTION_STAGE_INVALID", true);
}

export async function motionSequenceResult(meta: Record<string, unknown>): Promise<NormalizedOutput> {
  const job = await readJob(meta);
  if (job.provider_meta.stage !== "motion_complete" || job.provider_meta.parts.length !== job.provider_meta.segments.length)
    throw new ProviderError("MOTION_SEQUENCE_NOT_READY", true);
  return { files: [], meta: { motionSequenceAssets: job.provider_meta.parts.map(part => part.assetId),
    parts: job.provider_meta.parts, sourceSeconds: job.payload?.sourceSeconds } };
}
