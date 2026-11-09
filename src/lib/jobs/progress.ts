/** Presentation only. Never changes a job, retries a provider or settles credits. */
export interface ProgressInput {
  status: string;
  type?: string;
  queued_at?: string | null;
  started_at?: string | null;
  created_at?: string | null;
  checked_at?: number;
  provider_meta?: unknown;
}
export type ProgressSource = 'estimated' | 'segments' | 'complete' | 'unavailable';
export interface ProgressView { percent: number | null; source: ProgressSource; delayed: boolean; stale: boolean; parts?: number; total?: number; }
export const PROGRESS_FIELDS = 'type,queued_at,started_at,created_at,provider_meta';
const terminal = new Set(['failed', 'cancelled', 'refunded']);
const active = new Set(['queued', 'submitted', 'processing', 'retrying', 'quality_check', 'finalizing']);
export function progressForJob(job: ProgressInput, now = Date.now()): ProgressView {
  if (job.status === 'completed') return { percent: 100, source: 'complete', delayed: false, stale: false };
  const stale = job.checked_at !== undefined && now - job.checked_at > 45_000;
  if (terminal.has(job.status) || !active.has(job.status) || stale) return { percent: null, source: 'unavailable', delayed: false, stale };
  // The adapters currently return running/done/failed, not a measured render percentage.
  // Persisted completed motion segments ARE measured work; never infer provider progress
  // from an arbitrary provider response property, elapsed time or a queue position.
  const meta = job.provider_meta as { motionSequence?: boolean; parts?: unknown[]; segments?: unknown[] } | null;
  if (meta?.motionSequence === true && Array.isArray(meta.parts) && Array.isArray(meta.segments) && meta.segments.length > 0) {
    const parts = Math.min(meta.parts.length, meta.segments.length);
    return { percent: Math.min(99, Math.floor(parts / meta.segments.length * 100)), source: 'segments', parts, total: meta.segments.length, delayed: false, stale: false };
  }
  const start = Date.parse(job.started_at ?? job.queued_at ?? job.created_at ?? '');
  const elapsed = Number.isFinite(start) ? Math.max(0, (now - start) / 1000) : 0;
  // Coarse timing ranges, deliberately labelled estimated. These are not an SLA.
  const expected = job.type === 'character_training' ? 1200 : /video|motion|lip_sync/.test(job.type ?? '') ? 600 : 180;
  const stage = job.status === 'queued' ? 3 : job.status === 'submitted' ? 8 : job.status === 'retrying' ? 8 : job.status === 'quality_check' ? 96 : job.status === 'finalizing' ? 98 : Math.min(94, Math.floor(12 + 83 * (1 - Math.exp(-elapsed / expected))));
  return { percent: stage, source: 'estimated', delayed: elapsed > expected * 2, stale: false };
}
