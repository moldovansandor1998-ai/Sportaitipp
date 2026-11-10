import { assertLocalIntegrationTarget, LOCAL_OWNER_EMAIL } from "./helpers/localIntegration";
// Reconcile: unit (parseReconcileInput) + integrációs (handler, INTEGRATION=1)
import { describe, it, expect, afterAll, vi } from "vitest";
import { parseReconcileInput } from "@/lib/admin/reconcileInput";

// Disposable local handler fixture only: do not publish or create the real owner
// identity. Production owner mapping is unchanged and covered by its own tests.
vi.mock("@/lib/security/internalAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/internalAccess")>();
  return { ...actual, isInternalOwner: (email: string | null | undefined) =>
    email?.trim().toLowerCase() === "owner-recovery@example.invalid" };
});

describe("parseReconcileInput (unit)", () => {
  it("lookup kötelező", () => {
    expect(parseReconcileInput({})).toMatchObject({ ok: false, status: 400 });
    expect(parseReconcileInput({ lookupJobId: "x" })).toMatchObject({ ok: true, lookup: { kind: "job" } });
    expect(parseReconcileInput({ lookupIdempotencyKey: "k" })).toMatchObject({ ok: true, lookup: { kind: "idem" } });
  });
  it("művelethez reason kell", () => {
    expect(parseReconcileInput({ lookupJobId: "x", action: "mark_failed" }))
      .toMatchObject({ ok: false, error: "REASON_REQUIRED" });
    expect(parseReconcileInput({ lookupJobId: "x", action: "mark_failed", reason: "r" })).toMatchObject({ ok: true });
  });
  it("mark_submitted: provider + request ID validálva", () => {
    const bad = parseReconcileInput({ lookupJobId: "x", action: "mark_submitted", reason: "r" });
    expect(bad).toMatchObject({ ok: false, error: "VERIFIED_PROVIDER_REQUIRED" });
    const bad2 = parseReconcileInput({ lookupJobId: "x", action: "mark_submitted", reason: "r", verifiedProvider: "fal" });
    expect(bad2).toMatchObject({ ok: false, error: "VERIFIED_PROVIDER_JOB_ID_REQUIRED" });
    const ok = parseReconcileInput({ lookupJobId: "x", action: "mark_submitted", reason: "r", verifiedProvider: "replicate", verifiedProviderJobId: "t-1" });
    expect(ok).toMatchObject({ ok: true });
  });
  it("restart: confirmNotRunning kötelező", () => {
    expect(parseReconcileInput({ lookupJobId: "x", action: "restart", reason: "r" }))
      .toMatchObject({ ok: false, error: "CONFIRM_NOT_RUNNING_REQUIRED" });
    expect(parseReconcileInput({ lookupJobId: "x", action: "restart", reason: "r", confirmNotRunning: true }))
      .toMatchObject({ ok: true });
  });
});

const ENABLED = Boolean(process.env.INTEGRATION && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
describe.skipIf(!ENABLED)("reconcile handler (local INTEGRATION=1)", () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterAll(async () => { await cleanup?.(); });
  it("401 nem hitelesített; 403 nem admin; 404 ismeretlen; mark_failed pontosan egyszer", async () => {
    assertLocalIntegrationTarget();
    const { NextRequest } = await import("next/server");
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;

    const handler = (await import("@/app/api/admin/jobs/reconcile/route")).POST;
    const mk = (body: object, token?: string) => new NextRequest("http://localhost/api/admin/jobs/reconcile", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

    // 401: nincs token
    expect((await handler(mk({ lookupJobId: "x" }))).status).toBe(401);

    // felhasználó + admin létrehozása
    const email = `rec-${Date.now()}@castora.test`;
    const { data: u } = await sb.auth.admin.createUser({ email, password: "Rec-pass-123", email_confirm: true });
    const uid = u.user!.id;
    cleanup = async () => {
      assertLocalIntegrationTarget();
      // Audit actors intentionally do not cascade in production. Remove only
      // this disposable local user's audit fixtures before deleting its account.
      const audits = await sb.from("audit_logs").delete().eq("actor_id", uid);
      if (audits.error) throw new Error(`LOCAL_AUDIT_CLEANUP_FAILED: ${audits.error.message}`);
      const result = await sb.auth.admin.deleteUser(uid);
      if (result.error) throw new Error(`LOCAL_FIXTURE_CLEANUP_FAILED: ${result.error.message}`);
      const remaining = await sb.from("profiles").select("id").eq("id", uid);
      expect(remaining.error).toBeNull();
      expect(remaining.data).toEqual([]);
    };
    const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const signIn = await anon.auth.signInWithPassword({ email, password: "Rec-pass-123" });
    let token = signIn.data.session?.access_token ?? "";
    expect(token.length).toBeGreaterThan(0);

    // 403: nem admin
    expect((await handler(mk({ lookupJobId: "x" }, token))).status).toBe(403);

    await sb.from("profiles").update({ role: "admin" }).eq("id", uid);
    // A non-owner admin still cannot use the synthetic owner recovery route.
    expect((await handler(mk({ lookupJobId: "x" }, token))).status).toBe(403);
    const owner = await sb.auth.admin.updateUserById(uid, { email: LOCAL_OWNER_EMAIL, email_confirm: true });
    if (owner.error) throw new Error(owner.error.message);
    const ownerSession = await anon.auth.signInWithPassword({ email: LOCAL_OWNER_EMAIL, password: "Rec-pass-123" });
    if (ownerSession.error) throw new Error(ownerSession.error.message);
    token = ownerSession.data.session!.access_token;
    const funding = await sb.from("credit_accounts").update({ balance: 200 }).eq("user_id", uid);
    if (funding.error) throw new Error("LOCAL_FIXTURE_FUNDING_FAILED");
    // 400: nincs lookup
    expect((await handler(mk({}, token))).status).toBe(400);
    // 404: ismeretlen job
    expect((await handler(mk({ lookupJobId: crypto.randomUUID() }, token))).status).toBe(404);

    // uncertain job + hold; mark_failed: pontosan egyszer, refund egyszer
    const { data: j } = await sb.from("generation_jobs").insert({
      owner_id: uid, type: "image_generation", status: "submission_uncertain", cost_estimate: 10,
      provider_meta: { submission_started: true },
    }).select("id").single();
    const jobId = (j as { id: string }).id;
    await sb.rpc("credit_hold", { p_user: uid, p_job: jobId, p_amount: 10, p_key: `rec:${jobId}` });
    const balBefore = (await sb.from("credit_accounts").select("balance").eq("user_id", uid).single()).data as { balance: number };

    const ok1 = await handler(mk({ lookupJobId: jobId, action: "mark_failed", reason: "dashboard: nincs munka" }, token));
    expect(ok1.status).toBe(200);
    const ok2 = await handler(mk({ lookupJobId: jobId, action: "mark_failed", reason: "újra" }, token));
    expect(ok2.status).toBe(200);
    const body2 = await ok2.json() as { note?: string };
    expect(body2.note).toBe("already_resolved");   // idempotens
    const balAfter = (await sb.from("credit_accounts").select("balance").eq("user_id", uid).single()).data as { balance: number };
    expect(balAfter.balance).toBe(balBefore.balance + 10);   // pontosan egyszeri refund

    const audit = await sb.from("audit_logs").select("id").eq("actor_id", uid)
      .eq("action", "admin.job.mark_failed").eq("target_id", jobId);
    expect(audit.error).toBeNull();
    expect(audit.data).toHaveLength(1);
    await cleanup();
    cleanup = undefined;
  }, 180_000);
});
