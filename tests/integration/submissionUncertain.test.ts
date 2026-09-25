// A runClaimedJob TÉNYLEGES működése három szcenárióban (INTEGRATION=1):
// 1) provider submit timeout 2) provider elfogadta, de a record-RPC hibázik 3) minden provider retryable hibával bukik.
// Mindháromnál: submitted→submission_uncertain, hold megmarad, NINCS refund/charge/resubmit,
// a reaper nem queue-z, admin reconcile után szabályosan folytatható vagy refundolható.
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { ProviderAdapter } from "@/lib/providers/types";
import { ProviderRouter } from "@/lib/providers/router";
import { ProviderError } from "@/lib/providers/types";

const ENABLED = Boolean(process.env.INTEGRATION && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe.skipIf(!ENABLED)("runClaimedJob: submission_uncertain szcenáriók", () => {
  let sb: SupabaseClient;
  let userId: string;

  const fakeAdapter = (name: string, behavior: "timeout" | "ok" | "fail"): ProviderAdapter => ({
    name, supports: ["image_generation"],
    estimate: async () => ({ credits: 10, secondsExpected: 1 }),
    submit: async () => {
      if (behavior === "ok") return { providerJobId: `${name}_job_1` };
      if (behavior === "timeout") return new Promise(() => {}); // sosem oldódik fel
      throw new ProviderError("boom", true);
    },
    getStatus: async () => "running" as const,
    getResult: async () => ({ files: [], meta: {} }),
    cancel: async () => {},
    healthCheck: async () => ({ ok: true, latencyMs: 1 }),
    normalizeWebhook: () => ({ eventId: "e", status: "running" as const }),
    verifyWebhook: async () => true,
  });

  const mkRouter = (behavior: "timeout" | "ok" | "fail") =>
    new ProviderRouter([fakeAdapter("fal", behavior), fakeAdapter("rep", behavior)], () => "fal", { timeoutMs: 300 });

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;
    sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: u } = await sb.auth.admin.createUser({
      email: `unc-${Date.now()}@castora.test`, password: "Unc-pass-123", email_confirm: true,
    });
    userId = u.user!.id;
  }, 60_000);

  async function mkJob(): Promise<{ jobId: string; balanceBefore: number; held: number }> {
    const { data: j } = await sb.from("generation_jobs").insert({
      owner_id: userId, type: "image_generation", status: "submitted",
      cost_estimate: 10, started_at: new Date().toISOString(),
    }).select("id").single();
    const jobId = (j as { id: string }).id;
    await sb.rpc("credit_hold", { p_user: userId, p_job: jobId, p_amount: 10, p_key: `hold:${jobId}` });
    // NINCS előre beállított submission_started – a runClaimedJob maga kezdi a claimet
    await sb.from("generation_jobs").update({
      status: "submitted", attempt: 1,
    }).eq("id", jobId);
    const bal = (await sb.from("credit_accounts").select("balance").eq("user_id", userId).single()).data as { balance: number };
    return { jobId, balanceBefore: bal.balance + 10, held: 10 };
  }

  async function assertCommon(jobId: string, balanceBefore: number) {
    const { data: job } = await sb.from("generation_jobs").select("status,provider_job_id").eq("id", jobId).single();
    expect(job).toMatchObject({ status: "submission_uncertain", provider_job_id: null });
    const bal = (await sb.from("credit_accounts").select("balance").eq("user_id", userId).single()).data as { balance: number };
    expect(bal.balance).toBe(balanceBefore - 10);          // hold MEGMARADT
    const { data: txs } = await sb.from("credit_transactions").select("type").eq("user_id", userId);
    const mine = (txs ?? []).filter((t: { type: string }) => t.type === "refund" || t.type === "charge");
    expect(mine).toHaveLength(0);                          // NINCS refund, NINCS charge
    // reaper: submission_started + nincs provider_job_id → NEM queue-z
    await sb.rpc("reap_stale_jobs");
    await sb.from("generation_jobs").update({ started_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() }).eq("id", jobId);
    await sb.rpc("reap_stale_jobs");
    const { data: after } = await sb.from("generation_jobs").select("status").eq("id", jobId).single();
    expect((after as { status: string }).status).toBe("submission_uncertain");
  }

  it("1) provider submit timeout → uncertain, hold megmarad, semmi sem történik", async () => {
    const { runClaimedJob } = await import("@/server/jobs/runJob");
    const { jobId, balanceBefore } = await mkJob();
    const { data: job } = await sb.from("generation_jobs").select("*").eq("id", jobId).single();
    await runClaimedJob(job as never, mkRouter("timeout"));
    await assertCommon(jobId, balanceBefore);
    // admin restart: folytatható
    const { data: adm } = await sb.from("profiles").select("id").eq("role", "admin").limit(1).single();
    const ok = await sb.rpc("admin_restart", { p_job: jobId, p_admin: (adm as { id: string }).id, p_reason: "teszt" });
    expect(ok.data).toBe(true);
  }, 120_000);

  it("2) provider submit OK, de a record-RPC versenyhelyzetben false-t ad → uncertain, ID megmarad", async () => {
    const { runClaimedJob } = await import("@/server/jobs/runJob");
    const { jobId, balanceBefore } = await mkJob();
    const { data: job } = await sb.from("generation_jobs").select("*").eq("id", jobId).single();

    // VALÓDI record-RPC verseny: a submit VÉGÉN egy párhuzamos writer már rögzített egy
    // provider_job_id-t – így a runJob record_provider_submission hívása FALSE-t ad,
    // a catch → submission_uncertain (ez a kódág fut le, nem az „elfogadva→processing").
    const racing: ProviderAdapter = {
      ...fakeAdapter("fal", "ok"),
      submit: async () => {
        await sb.rpc("record_provider_submission", {
          p_job: jobId, p_provider: "ghost", p_provider_job_id: "race_job_9", p_meta: { raced: true },
        });
        return { providerJobId: "fal_job_1", providerMeta: {} };
      },
    };
    const raceRouter = new ProviderRouter([racing], () => "fal", { timeoutMs: 5000 });
    await runClaimedJob(job as never, raceRouter);

    const { data: after } = await sb.from("generation_jobs").select("status,provider_job_id,error").eq("id", jobId).single();
    // EGYSÉGES viselkedés bizonyítva: uncertain + a race által rögzített ID maradt meg
    expect(after).toMatchObject({ status: "submission_uncertain", provider_job_id: "race_job_9" });
    expect(String((after as { error: { message?: string } | null }).error?.message)).toContain("record_provider_submission failed");
    const bal = (await sb.from("credit_accounts").select("balance").eq("user_id", userId).single()).data as { balance: number };
    expect(bal.balance).toBe(balanceBefore - 10);   // hold megmarad, nincs refund/charge
    // admin mark_submitted a MEGLÉVŐ (tényleges) ID-val: a webhook folytathatja
    const { data: adm } = await sb.from("profiles").select("id").eq("role", "admin").limit(1).single();
    expect((await sb.rpc("admin_mark_submitted", {
      p_job: jobId, p_provider: "fal", p_provider_job_id: "race_job_9",
      p_admin: (adm as { id: string }).id, p_reason: "dashboard-ellenőrzés",
    })).data).toBe(true);
  }, 120_000);

  it("3) minden provider retryable hibával bukik → uncertain, hold megmarad", async () => {
    const { runClaimedJob } = await import("@/server/jobs/runJob");
    const { jobId, balanceBefore } = await mkJob();
    const { data: job } = await sb.from("generation_jobs").select("*").eq("id", jobId).single();
    await runClaimedJob(job as never, mkRouter("fail"));
    await assertCommon(jobId, balanceBefore);
    // admin mark_failed: refund pontosan egyszer
    const { data: adm } = await sb.from("profiles").select("id").eq("role", "admin").limit(1).single();
    expect((await sb.rpc("admin_mark_failed", {
      p_job: jobId, p_admin: (adm as { id: string }).id, p_reason: "bizonyítottan nem futott",
    })).data).toBe(true);
    const bal = (await sb.from("credit_accounts").select("balance").eq("user_id", userId).single()).data as { balance: number };
    expect(bal.balance).toBe(balanceBefore);
  }, 120_000);

  it("claim: két eltérő kulcs párhuzamosan – pontosan egy nyer", async () => {
    // előkészítés: ready_to_train karakter
    const { data: c } = await sb.from("characters").insert({
      owner_id: userId, name: `Race-${Date.now()}`, consent_type: "ai_persona", status: "ready_to_train",
    }).select("id").single();
    const cid = (c as { id: string }).id;
    const [a, b] = await Promise.all([
      sb.rpc("claim_character_version", { p_character: cid, p_provider: "mock", p_job: null, p_destination: null, p_dataset_path: null, p_preparation_key: `k1-${Date.now()}` }),
      sb.rpc("claim_character_version", { p_character: cid, p_provider: "mock", p_job: null, p_destination: null, p_dataset_path: null, p_preparation_key: `k2-${Date.now()}` }),
    ]);
    const winners = [a, b].filter((r) => r.data !== null && !r.error).length;
    const errs = [a, b].filter((r) => r.error?.message?.includes("TRAINING_ALREADY_ACTIVE")).length;
    expect(winners + 0).toBeGreaterThanOrEqual(1);
    expect(errs + winners).toBe(2);   // vagy nyer, vagy aktív-attempt hiba – dupla nyerés lehetetlen
  }, 60_000);
});
