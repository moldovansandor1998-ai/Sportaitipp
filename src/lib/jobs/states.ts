// Állapotgép – a 0002 migrációban lévő SQL-szabályokkal szinkronban.
// Minden átmenet automatikusan tesztelve (tests/transitions.test.ts).

export const JOB_STATUSES = [
  "draft", "awaiting_credit", "queued", "submitted", "processing", "finalizing", "submission_uncertain",
  "quality_check", "completed", "retrying", "failed", "cancelled", "refunded",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  draft:           ["awaiting_credit", "cancelled"],
  awaiting_credit: ["queued", "cancelled", "failed"],
  queued:          ["submitted", "cancelled", "failed"],
  submitted:       ["processing", "finalizing", "submission_uncertain", "retrying", "failed", "cancelled"],
  finalizing:      ["completed", "failed", "refunded", "processing"],
  submission_uncertain: ["processing", "failed", "queued"],
  processing:      ["quality_check", "finalizing", "submission_uncertain", "retrying", "failed"],
  quality_check:   ["completed", "retrying", "failed", "refunded"],
  retrying:        ["queued", "submitted", "failed", "cancelled"],
  failed:          ["refunded", "retrying"],
  completed:       [],
  cancelled:       [],
  refunded:        [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return true; // idempotens no-op
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal job transition: ${from} → ${to}`);
  }
}

export const TERMINAL: JobStatus[] = ["completed", "failed", "cancelled", "refunded"];
export function isTerminal(s: JobStatus): boolean { return TERMINAL.includes(s); }
