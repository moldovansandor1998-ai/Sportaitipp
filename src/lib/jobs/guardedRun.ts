// Védett UI-futtatás: szinkron guard + busyállapot try/catch/finally-ben.
// - induláskor setBusy(true)
// - BÁRMELY hiba (token, fetch, JSON, váratlan) → szabályozott onError üzenet
// - finally MINDEN esetben setBusy(false) + guard feloldás → a következő attempt mehet
// - a hívó awaiteli – nincs unhandled Promise rejection
import type { SubmitGuard } from "./submitGuard";

export type GuardedResult<T> = { ok: true; value: T } | { ok: false; error: string } | { skipped: true };

export async function guardedRun<T>(params: {
  guard: SubmitGuard;
  setBusy: (busy: boolean) => void;
  onError: (message: string) => void;
  fn: () => Promise<T>;
}): Promise<GuardedResult<T>> {
  if (params.guard.value) return { skipped: true };          // szinkron zár – minden await előtt
  params.guard.value = true;
  params.setBusy(true);
  try {
    return { ok: true, value: await params.fn() };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Váratlan hiba";
    params.onError(msg);
    return { ok: false, error: msg };
  } finally {
    params.setBusy(false);                                    // MINDEN ágon visszaáll
    params.guard.value = false;
  }
}
