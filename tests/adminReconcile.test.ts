// Reconcile: unit (parseReconcileInput) + integrációs (handler, INTEGRATION=1)
import { describe, it, expect } from "vitest";
import { parseReconcileInput } from "@/lib/admin/reconcileInput";

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
describe.skipIf(!ENABLED)("reconcile handler (INTEGRATION=1)", () => {
  it("401 nem hitelesített; 403 nem admin; 404 ismeretlen; mark_failed pontosan egyszer", async () => {
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
    const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const signIn = await anon.auth.signInWithPassword({ email, password: "Rec-pass-123" });
    const token = signIn.data.session?.access_token ?? "";
    expect(token.length).toBeGreaterThan(0);

    // 403: nem admin
    expect((await handler(mk({ lookupJobId: "x" }, token))).status).toBe(403);

    await sb.from("profiles").update({ role: "admin" }).eq("id", uid);
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

    await sb.auth.admin.deleteUser(uid);
  }, 180_000);
});
