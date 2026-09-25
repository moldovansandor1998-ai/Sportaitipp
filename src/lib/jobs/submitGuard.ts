// Szinkron duplaindítás-védelem – React state helyett ref-szemantika:
// két gyors start() ugyanabban a renderben SEM indíthat két kérést.
export interface SubmitGuard { value: boolean }

export function createSubmitGuard(): SubmitGuard { return { value: false }; }

/** A fn CSAK akkor fut, ha a guard szabad; finally mindig visszaállítja. */
export async function withSubmitGuard<T>(guard: SubmitGuard, fn: () => Promise<T>): Promise<T | { skipped: true }> {
  if (guard.value) return { skipped: true };     // azonnali, szinkron zár – minden await előtt
  guard.value = true;
  try {
    return await fn();
  } finally {
    guard.value = false;                          // hiba esetén is felold
  }
}
