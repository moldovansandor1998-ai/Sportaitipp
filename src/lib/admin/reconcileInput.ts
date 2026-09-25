// Reconcile bemeneti validáció – külön lib (Next route-fájl nem enged tetszőleges exportot).
/** Tiszta bemeneti validáció – a route-tesztek ezt hívják közvetlenül. */
export function parseReconcileInput(b: Record<string, unknown>):
  | { ok: true; lookup: { kind: "job" | "idem"; value: string }; action?: string }
  | { ok: false; error: string; status: number } {
  const lookupJobId = typeof b.lookupJobId === "string" && b.lookupJobId.length > 0 ? b.lookupJobId : null;
  const lookupIdem = typeof b.lookupIdempotencyKey === "string" && b.lookupIdempotencyKey.length > 0 ? b.lookupIdempotencyKey : null;
  if (!lookupJobId && !lookupIdem) return { ok: false, error: "lookupJobId or lookupIdempotencyKey required", status: 400 };
  const reason = typeof b.reason === "string" && b.reason.trim().length > 0 ? b.reason.trim() : null;
  const action = typeof b.action === "string" ? b.action : undefined;
  if (action && action !== "inspect" && !reason) return { ok: false, error: "REASON_REQUIRED", status: 400 };
  if (action === "mark_submitted") {
    if (b.verifiedProvider !== "fal" && b.verifiedProvider !== "replicate") {
      return { ok: false, error: "VERIFIED_PROVIDER_REQUIRED", status: 400 };
    }
    const rid = String(b.verifiedProviderJobId ?? "").trim();
    if (!rid || rid.length > 200) return { ok: false, error: "VERIFIED_PROVIDER_JOB_ID_REQUIRED", status: 400 };
  }
  if (action === "restart" && b.confirmNotRunning !== true) {
    return { ok: false, error: "CONFIRM_NOT_RUNNING_REQUIRED", status: 400 };
  }
  return { ok: true, lookup: lookupJobId ? { kind: "job", value: lookupJobId } : { kind: "idem", value: lookupIdem! }, action };
}
