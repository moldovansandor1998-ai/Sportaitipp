// Provider router: elsődleges + tartalék, circuit breaker, timeout, retry-számláló.
// Tiszta függőségek (adapterek injektálhatók) → unit-tesztelhető (tests/providers.test.ts).
import { ProviderAdapter, ProviderError, JobType } from "./types";

export interface RouterOptions {
  timeoutMs?: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
}

interface Circuit { failures: number; openedUntil: number; }

export class ProviderRouter {
  private circuits = new Map<string, Circuit>();

  constructor(
    private readonly adapters: readonly ProviderAdapter[],
    private readonly primaryFor: (jobType: JobType) => string,
    private readonly opts: RouterOptions = {},
  ) {}

  private circuit(name: string): Circuit {
    let c = this.circuits.get(name);
    if (!c) { c = { failures: 0, openedUntil: 0 }; this.circuits.set(name, c); }
    return c;
  }

  private isOpen(name: string): boolean {
    const c = this.circuit(name);
    if (c.openedUntil === 0) return false;         // sosem nyitott még
    if (c.openedUntil > Date.now()) return true;   // nyitva tart
    c.openedUntil = 0;                             // cooldown lejárt: zár, számláló nullázva
    c.failures = 0;
    return false;
  }

  private recordFailure(name: string) {
    const c = this.circuit(name);
    c.failures += 1;
    if (c.failures >= (this.opts.breakerThreshold ?? 3)) {
      c.openedUntil = Date.now() + (this.opts.breakerCooldownMs ?? 60_000);
    }
  }

  /** Képesség + breaker alapján rendezett adapterlista – mellékhatás nélkül. */
  candidates(jobType: JobType): ProviderAdapter[] {
    const primaryName = this.primaryFor(jobType);
    const keyed = this.adapters
      .filter((a) => a.supports.includes(jobType))
      .map((a) => ({ a, open: this.isOpen(a.name) ? 1 : 0, primary: a.name === primaryName ? 0 : 1 }));
    keyed.sort((x, y) => x.open - y.open || x.primary - y.primary);
    return keyed.map((k) => k.a);
  }

  getAdapter(name: string): ProviderAdapter | undefined {
    return this.adapters.find((a) => a.name === name);
  }

  async estimate(jobType: JobType, payload: Record<string, unknown>) {
    const [first] = this.candidates(jobType);
    if (!first) throw new Error(`no provider supports ${jobType}`);
    return first.estimate(jobType, payload);
  }

  async withTimeout<T>(p: Promise<T>): Promise<T> {
    const timeoutMs = this.opts.timeoutMs ?? 120_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ProviderError("provider timeout", true)), timeoutMs);
        }),
      ]);
    } finally { clearTimeout(timer); }
  }

  async submit(jobType: JobType, params: Parameters<ProviderAdapter["submit"]>[0]) {
    const candidates = this.candidates(jobType);
    if (candidates.length === 0) throw new Error(`no provider supports ${jobType}`);
    let lastError: unknown = null;
    for (const adapter of candidates) {
      try {
        const resolved: Parameters<ProviderAdapter["submit"]>[0] = {
          ...params,
          webhookUrl: params.webhookUrlFor
            ? params.webhookUrlFor(adapter.name)   // URL csak a választott adapter után
            : params.webhookUrl ?? "",
        };
        const result = await this.withTimeout(adapter.submit(resolved));
        return { adapter, ...result };
      } catch (e) {
        lastError = e;
        if (e instanceof ProviderError && !e.retryable) break; // validációs hiba: ne failover
        this.recordFailure(adapter.name);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("submit failed on all providers");
  }
}
