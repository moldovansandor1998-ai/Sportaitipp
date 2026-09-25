// Job-indítás idempotens kulccsal – UI-semleges, TESZTELHETŐ (a fetch body assertálható).
// - első indítás: új explicit UUID (tracker.begin)
// - hálózati hiba: AZONOS kulccsal újraküldés (tracker.resend), max 1 retry
// - biztos HTTP-válasz után finish – a felhasználói retry ÚJ kulcsot kap
// - dupla indítás: begin null → nincs második POST
export interface StartJobResult {
  ok: boolean;
  status: number;
  jobId?: string;
  error?: string;
  idempotencyKey: string;
}

export async function startJobWithTracker(params: {
  tracker: { begin: () => string | null; resend: () => string | null; finish: () => void };
  fetchImpl: typeof fetch;
  token: string;
  body: { type: string; characterId?: string; projectId?: string; payload: Record<string, unknown> };
  maxNetworkRetries?: number;
}): Promise<StartJobResult | { skipped: true }> {
  const key = params.tracker.begin();
  if (!key) return { skipped: true };                       // dupla indítás – nincs kérés

  // Some mobile browsers require fetch to be called with its global receiver.
  const send = () => params.fetchImpl.call(globalThis, "/api/jobs", {
    method: "POST",
    headers: { authorization: `Bearer ${params.token}`, "content-type": "application/json" },
    body: JSON.stringify({ ...params.body, idempotencyKey: key }),
  });

  let res: Response;
  try {
    res = await send();
  } catch {
    // hálózati hiba – AZONOS kulcs újraküldve (a szerver idempotens)
    const resendKey = params.tracker.resend();
    if (!resendKey) { params.tracker.finish(); return { ok: false, status: 0, error: "ABORTED", idempotencyKey: key }; }
    try {
      res = await send();
    } catch (e2) {
      params.tracker.finish();                              // szabályozott lezárás – újratolható
      return { ok: false, status: 0, error: e2 instanceof Error ? e2.message : "network", idempotencyKey: key };
    }
  }

  const data = await res.json().catch(() => ({})) as { jobId?: string; error?: string };
  params.tracker.finish();                                  // BIZTOS HTTP-válasz – a kulcs lezárva
  return {
    ok: res.ok,
    status: res.status,
    jobId: data.jobId,
    error: data.error,
    idempotencyKey: key,
  };
}
