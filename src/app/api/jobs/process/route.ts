// Cron-belépési pont:
//  1) reaper: beragadt submitted/processing → queued (újra claimelhető, provider-idempotencia véd)
//  2) új claim-ek atomi claim_next_job-jal
//  3) lejárt finalizing lease-ek újrafuttatása (a finalize_claim engedi a lopást)
// Fail-closed: hiányzó CRON_SECRET → 500, rossz token → 401.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
import { serviceClient } from "@/lib/supabase/server";
import { isCronAuthorized } from "@/lib/security/cron";
import { buildRouter } from "@/lib/providers";
import { runClaimedJob, finalizeJob, type JobRow } from "@/server/jobs/runJob";
import { failJob } from "@/server/jobs/runJob";
import { ProviderError } from "@/lib/providers/types";
import { createJobWithHold } from "@/lib/credits/rpc";
import { prepareValidatedJobInput } from "@/server/jobs/prepareJob";
import { scheduleKick } from "@/server/jobs/schedule";
import { prepareContent, refreshContentJobs } from "@/server/content/prepare";

export async function POST(req: NextRequest) {
  const verdict = isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (verdict === "no_secret") {
    return NextResponse.json({ error: "CRON_SECRET_NOT_CONFIGURED" }, { status: 500 });
  }
  if (verdict === "unauthorized") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = serviceClient();

  // Runs in Budapest's local 11/15/19 windows, including DST transitions.
  // Failures must not stop the existing generation queue.
  let content: unknown = null;
  try {
    content = await prepareContent(new Date(), undefined, 1);
    await refreshContentJobs();
  } catch (e) {
    console.error(JSON.stringify({ scope: "cron.content", error: String(e) }));
  }

  // Tartós tömeges sor: a böngészőnek a beküldés után már nem kell nyitva lennie.
  let bulkStarted = 0;
  for (let i = 0; i < 4; i++) {
    const { data: items, error: queueError } = await sb.rpc("claim_bulk_generation_item");
    if (queueError) return NextResponse.json({ error: "bulk_claim_failed" }, { status: 500 });
    const item = (items as Array<{ id: string; owner_id: string; character_id: string; asset_id: string; edit_model: string }> | null)?.[0];
    if (!item) break;
    try {
      const { data: existing } = await sb.from("generation_jobs").select("id")
        .eq("idempotency_key", `bulk:${item.id}`).maybeSingle();
      let jobId = existing?.id as string | undefined;
      if (!jobId) {
        const prepared = await prepareValidatedJobInput({
          userId: item.owner_id, type: "character_swap", characterId: item.character_id,
          payload: { sourceAssetId: item.asset_id, useCharacterReference: true, editModel: item.edit_model },
        });
        if (prepared.error) throw new Error(prepared.error);
        const router = buildRouter();
        const estimate = await router.estimate("character_swap", prepared.payload);
        jobId = await createJobWithHold({
          userId: item.owner_id, type: "character_swap", characterId: prepared.characterId,
          projectId: prepared.projectId, payload: prepared.payload,
          idempotencyKey: `bulk:${item.id}`, costEstimate: estimate.credits,
        });
      }
      const { data: linked, error: saveError } = await sb.rpc("link_bulk_generation_job", { p_item: item.id, p_job: jobId });
      if (saveError || !linked) throw new Error(`BULK_LINK_FAILED: ${saveError?.message ?? "not linked"}`);
      scheduleKick(jobId);
      bulkStarted++;
    } catch (error) {
      // Ha a job már létrejött, a következő cron az idempotenciakulcs alapján folytatja.
      const detail = error instanceof Error ? error.message : JSON.stringify(error);
      console.error(JSON.stringify({ scope: "cron.bulk", itemId: item.id, error: detail }));
      const { data: existing } = await sb.from("generation_jobs").select("id")
        .eq("idempotency_key", `bulk:${item.id}`).maybeSingle();
      if (existing?.id) {
        const { error: linkError } = await sb.rpc("link_bulk_generation_job", { p_item: item.id, p_job: existing.id });
        if (linkError) console.error(JSON.stringify({ scope: "cron.bulk.relink", itemId: item.id, error: linkError.message }));
      } else {
        await sb.from("bulk_generation_items").update({ status: "failed", error: detail.slice(0, 300) }).eq("id", item.id);
      }
    }
  }

  // 1) Reaper – az RPC hibáját kötelező ellenőrizni (hiba esetén nem folytatunk)
  const { data: reaped, error: reapErr } = await sb.rpc("reap_stale_jobs");
  if (reapErr) {
    console.error(JSON.stringify({ level: "error", scope: "cron.reaper", error: reapErr.message }));
    return NextResponse.json({ error: "reaper_failed" }, { status: 500 });
  }

  // 2) Új claimek – az RPC hibája kötelező ellenőrzés (hiba nem lehet ál-siker)
  const claimed: JobRow[] = [];
  for (let i = 0; i < 4; i++) {
    const { data, error: claimErr } = await sb.rpc("claim_next_job");
    if (claimErr) {
      console.error(JSON.stringify({ level: "error", scope: "cron.claim", error: claimErr.message }));
      return NextResponse.json({ error: "claim_failed" }, { status: 500 });
    }
    const next = ((data ?? []) as unknown) as JobRow[];
    if (!next.length) break;
    claimed.push(...next);
  }
  await Promise.all(claimed.map(async (job) => {
    await runClaimedJob(job).catch((e: unknown) => {
      console.error(JSON.stringify({ level: "error", scope: "cron.process", jobId: job.id, error: String(e) }));
    });
  }));

  // 3) Lejárt finalizing lease-ek: eredmény újralekérése (idempotens), finalize újra
  const { data: stale } = await sb.from("generation_jobs")
    .select("*").eq("status", "finalizing")
    .lt("claimed_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .limit(10);
  let resumed = 0;
  for (const j of (stale ?? []) as unknown as JobRow[]) {
    if (!j.provider || !j.provider_job_id) continue;
    const adapter = buildRouter().getAdapter(j.provider);
    if (!adapter) continue;
    try {
      // meta + job type kötelező átadása (kulcsolt URL-ek és modell-specifikus mapping!)
      const meta = (j as unknown as { provider_meta?: Record<string, unknown> }).provider_meta ?? undefined;
      const output = await adapter.getResult(j.provider_job_id, meta, j.type);
      await finalizeJob(j.id, output); // finalize_claim lopja a lejárt lease-t
      resumed += 1;
    } catch (e: unknown) {
      console.error(JSON.stringify({ level: "error", scope: "cron.resume", jobId: j.id, error: String(e) }));
    }
  }

  // Provider webhookok mellett rendszeresen lekérdezzük a már elindított kép- és videófeladatokat.
  const { data: active, error: activeError } = await sb.from("generation_jobs").select("*")
    .eq("status", "processing").not("provider_job_id", "is", null)
    .order("started_at", { ascending: true }).limit(20);
  if (activeError) return NextResponse.json({ error: "poll_failed" }, { status: 500 });
  let checked = 0;
  for (const job of (active ?? []) as (JobRow & { provider_meta?: Record<string, unknown> })[]) {
    if (!job.provider || !job.provider_job_id) continue;
    const adapter = buildRouter().getAdapter(job.provider);
    if (!adapter) continue;
    try {
      const status = await adapter.getStatus(job.provider_job_id, job.provider_meta);
      if (status === "done") await finalizeJob(job.id, await adapter.getResult(job.provider_job_id, job.provider_meta, job.type));
      if (status === "failed") await failJob(job, "provider status: failed");
      checked++;
    } catch (error) {
      console.error(JSON.stringify({ scope: "cron.poll", jobId: job.id, error: String(error) }));
      if (error instanceof ProviderError && !error.retryable) await failJob(job, error.message);
    }
  }
  return NextResponse.json({ reaped: reaped ?? 0, processed: claimed.length, resumed, bulkStarted, checked, content });
}

// Vercel Cron GET kérést küld, azonos Bearer ellenőrzéssel.
export const GET = POST;
