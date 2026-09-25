// Per-job polling – versenyhelyzet-mentes: inFlight jelző (egy jobhoz egyszerre egy fetch),
// generation/cancellation token (stop/stopAll után a folyamatban lévő fetch eredménye NEM hív
// onUpdate-et), terminal/maxAttempts/maxErrors kezelés, dupla start ellen.
export type PollStatus = string;

export interface PollerOptions {
  intervalMs?: number;
  maxAttempts?: number;
  maxConsecutiveErrors?: number;
  isTerminal: (status: PollStatus) => boolean;
}

interface Entry {
  timer: ReturnType<typeof setInterval>;
  inFlight: boolean;
  generation: number;      // stop növeli – a régi fetch eredménye elvetve
  attempts: number;
  errors: number;
}

export class JobPoller {
  private entries = new Map<string, Entry>();

  constructor(private readonly opts: PollerOptions) {}

  start(
    jobId: string,
    fetchStatus: () => Promise<{ status: PollStatus; error?: string | null }>,
    onUpdate: (jobId: string, status: PollStatus, error?: string | null) => void,
  ): void {
    if (this.entries.has(jobId)) return;
    const entry: Entry = { timer: undefined as never, inFlight: false, generation: 0, attempts: 0, errors: 0 };
    this.entries.set(jobId, entry);

    const tick = async (): Promise<void> => {
      const e = this.entries.get(jobId);
      if (!e || e.inFlight) return;                     // párhuzamos fetch ugyanarra a jobra TILOS
      e.inFlight = true;
      const gen = e.generation;
      try {
        const r = await fetchStatus();
        const cur = this.entries.get(jobId);
        if (!cur || cur.generation !== gen) return;     // stop/stopAll közben – eredmény elvetve
        cur.errors = 0;
        onUpdate(jobId, r.status, r.error ?? null);
        if (this.opts.isTerminal(r.status)) { this.stop(jobId); return; }
      } catch {
        const cur = this.entries.get(jobId);
        if (!cur || cur.generation !== gen) return;
        cur.errors += 1;
        if (cur.errors >= (this.opts.maxConsecutiveErrors ?? 3)) { this.stop(jobId); return; }
      } finally {
        const cur = this.entries.get(jobId);
        if (cur) cur.inFlight = false;
      }
      const cur = this.entries.get(jobId);
      if (!cur) return;
      cur.attempts += 1;
      if (cur.attempts >= (this.opts.maxAttempts ?? 240)) { this.stop(jobId); return; }
    };

    void tick();
    entry.timer = setInterval(() => void tick(), this.opts.intervalMs ?? 2500);
  }

  stop(jobId: string): void {
    const e = this.entries.get(jobId);
    if (!e) return;
    clearInterval(e.timer);
    e.generation += 1;         // folyamatban lévő fetch eredménye érvénytelenítve
    this.entries.delete(jobId);
  }

  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.stop(id);
  }

  activeCount(): number { return this.entries.size; }
  isInFlight(jobId: string): boolean { return this.entries.get(jobId)?.inFlight ?? false; }
}

export const TERMINAL_STATUSES = ["completed", "failed", "refunded", "cancelled"];
