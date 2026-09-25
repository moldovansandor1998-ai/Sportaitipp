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

export async function POST(req: NextRequest) {
  const verdict = isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (verdict === "no_secret") {
    return NextResponse.json({ error: "CRON_SECRET_NOT_CONFIGURED" }, { status: 500 });
  }
  if (verdict === "unauthorized") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = serviceClient();

  // 1) Reaper – az RPC hibáját kötelező ellenőrizni (hiba esetén nem folytatunk)
  const { data: reaped, error: reapErr } = await sb.rpc("reap_stale_jobs");
  if (reapErr) {
    console.error(JSON.stringify({ level: "error", scope: "cron.reaper", error: reapErr.message }));
    return NextResponse.json({ error: "reaper_failed" }, { status: 500 });
  }

  // 2) Új claimek – az RPC hibája kötelező ellenőrzés (hiba nem lehet ál-siker)
  const { data, error: claimErr } = await sb.rpc("claim_next_job");
  if (claimErr) {
    console.error(JSON.stringify({ level: "error", scope: "cron.claim", error: claimErr.message }));
    return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  }
  const claimed = ((data ?? []) as unknown) as JobRow[];
  for (const job of claimed) {
    await runClaimedJob(job).catch((e: unknown) => {
      console.error(JSON.stringify({ level: "error", scope: "cron.process", jobId: job.id, error: String(e) }));
    });
  }

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

  return NextResponse.json({ reaped: reaped ?? 0, processed: claimed.length, resumed });
}
