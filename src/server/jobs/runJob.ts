import "server-only";
import { createHash } from "crypto";
import sharp from "sharp";
import { serviceClient } from "@/lib/supabase/server";
import { refundJob } from "@/lib/credits/rpc";
import { buildRouter } from "@/lib/providers";
import type { JobType, NormalizedOutput, ProviderFile } from "@/lib/providers/types";
import { assertAllowedUrl } from "@/lib/security/ssrf";

const router = buildRouter();
const MAX_PROVIDER_FILE = 100 * 1024 * 1024;

export interface JobRow {
  id: string; owner_id: string; type: JobType; character_id: string | null;
  payload: Record<string, unknown> | null; provider: string | null;
  provider_job_id: string | null; cost_estimate: number;
  idempotency_key: string | null; status: string;
}

/** Direkt indítás: atomi claim, aztán feldolgozás. */
export async function kickJob(jobId: string): Promise<void> {
  const sb = serviceClient();
  const { data: claimed } = await sb.rpc("claim_job", { p_job: jobId });
  if (!claimed) return;
  const { data: job } = await sb.from("generation_jobs").select("*").eq("id", jobId).single();
  if (job) await runClaimedJob(job as unknown as JobRow);
}

/** Már claimelt job feldolgozása. `routerOverride` KIZÁRÓLAG tesztelésre (integrációs tesztek). */
export async function runClaimedJob(job: JobRow, routerOverride?: ReturnType<typeof buildRouter>): Promise<void> {
  const sb0 = serviceClient();
  const activeRouter = routerOverride ?? router;
  // Ha már van provider_job_id: ezt a jobot korábban elküldtük (timeout/reaper újrakezdés).
  // ÚJRA nem submitolunk – a ledger szerint a provider-jog már nem a miénk.
  if (job.provider_job_id) {
    await mustUpdate("generation_jobs", { status: "processing" }, job.id);
    if (job.provider === "mock") {
      const adapter = activeRouter.getAdapter("mock");
      if (adapter) await finalizeJob(job.id, await adapter.getResult(job.provider_job_id, undefined, job.type as JobType));
    }
    return; // éles provider: webhook/poll folytatja
  }
  if (activeRouter.candidates(job.type).length === 0) throw new Error("NO_PROVIDER_CONFIGURED");
  // Ledger-mutex: két párhuzamos workerből pontosan egy nyeri meg a submit-jogot
  const { data: maySubmit } = await sb0.rpc("begin_provider_submission", { p_job: job.id });
  if (!maySubmit) return; // a submit-jog a másik feldolgozóé (vagy már lezajlott)
  try {
    const { adapter, providerJobId, providerMeta } = await activeRouter.submit(job.type, {
      jobId: job.id,
      jobType: job.type,
      payload: job.payload ?? {},
      webhookUrlFor: (name) => `${process.env.APP_URL}/api/webhooks/provider/${name}`,
      idempotencyKey: job.idempotency_key ?? job.id,
    });
    // A TÉNYLEGESEN használt adapter (failover után is helyes) – csak ha még nincs provider_job_id.
    // Az eredményt KÖTELEZŐ ellenőrizni: sikertelen mentésnél NEM mehetünk tovább processingbe.
    const { data: recorded, error: recErr } = await sb0.rpc("record_provider_submission", {
      p_job: job.id, p_provider: adapter.name, p_provider_job_id: providerJobId, p_meta: providerMeta ?? {},
    });
    if (recErr || recorded !== true) {
      // Egységes üzleti szabály: ha a beküldés lezajlott, de a rögzítést nem tudtuk ellenőrizteni,
      // NEM megyünk ál-processingbe – submission_uncertain + meglévő provider_job_id megőrzése
      // (a webhook a meglévő ID alapján továbbra is tud finalizálni; admin egyeztethet).
      throw new Error(`record_provider_submission failed: ${recErr?.message ?? "race"}`);
    }
    await mustUpdate("generation_jobs", { status: "processing" }, job.id);
    if (adapter.name === "mock") {
      const output = await adapter.getResult(providerJobId, undefined, job.type as JobType);
      await finalizeJob(job.id, output);
    }
    // Éles provider: itt a kérés véget ér, a folytatást a provider webhookja indítja.
  } catch (e: unknown) {
    // Bizonytalan submit-timeout / hiba: a fizetős művelet NEM veszhet el és NEM ismétlődhet.
    const { data: current } = await sb0.from("generation_jobs").select("provider_job_id,status").eq("id", job.id).single();
    const cur = current as { provider_job_id: string | null; status: string } | null;
    if (cur?.provider_job_id) {
      // A provider elfogadta (a provider_job_id megmarad). Egységes szabály: admin review alatt
      // uncertain marad – a webhook a meglévő ID-val finalizál, az admin pedig nyomon követ.
      await mustUpdate("generation_jobs", {
        status: "submission_uncertain",
        error: {
          message: e instanceof Error ? e.message : "unknown",
          recovery: "provider_job_id vagy idempotency kulcs alapján",
        },
      }, job.id, "submitted")
        .catch(async () => {
          const { data: again } = await sb0.from("generation_jobs").select("status").eq("id", job.id).single();
          if ((again as { status: string } | null)?.status !== "submission_uncertain") {
            throw new Error("transition to submission_uncertain failed");
          }
        });
      return;
    }
    // Nem tudjuk biztosan, hogy futott-e: submission_uncertain. NINCS automatikus refund
    // és NINCS automatikus újraküldés. Ha az átmenet mentése sikertelen: HANGOS kritikus hiba
    // (kivétel továbbdobva – nincs csendes beragadás, nincs elnyelt hiba).
    // TÉNYLEGES útvonal: claim_job után a job SUBMITTED – onnan megyünk uncertainbe.
    // (A processing→uncertain átmenet csak a beküldés utáni fázisban releváns.)
    await mustUpdate("generation_jobs", {
      status: "submission_uncertain",
      error: { message: e instanceof Error ? e.message : "unknown", recovery: "provider_job_id vagy idempotency kulcs alapján" },
    }, job.id, "submitted");
  }
}

/** Idempotens finalizálás: storage → assets (upsert) → gallery (dedup) → mock karakterlépés → charge → completed. */
export async function finalizeJob(jobId: string, output: NormalizedOutput): Promise<void> {
  const sb = serviceClient();
  const { data: jobRaw } = await sb.from("generation_jobs").select("*").eq("id", jobId).single();
  if (!jobRaw) throw new Error("job not found");
  const job = jobRaw as unknown as JobRow;
  // Adatbázis-szintű atomi lefoglalás: a minősítésbe állítás a lock.
  // Két párhuzamos webhookból csak az egyik nyer; a másik false-t kap és kimegy.
  const { data: claimed } = await sb.rpc("finalize_claim", { p_job: jobId });
  if (!claimed) return; // másik feldolgozó viszi (vagy friss lease) – biztonságos dupla webhook

  try {
    await finalizeLocked(jobId, job, output, sb);
  } catch (e: unknown) {
    // hiba a lefoglalt állapotban: rendes hiba- és takarításút
    await failJob(job, e instanceof Error ? e.message : "finalize failed");
  }
}

async function finalizeLocked(
  jobId: string, job: JobRow, output: NormalizedOutput,
  sb: ReturnType<typeof serviceClient>,
): Promise<void> {

  const assetIds: string[] = [];
  for (const [i, f] of output.files.entries()) {
    const { buf, contentType } = await fileToBuffer(f);
    if (job.payload?.contentAspectRatio === "9:16" && f.kind === "image") {
      const dimensions = await sharp(buf).metadata();
      if (!dimensions.width || !dimensions.height || Math.abs(dimensions.width / dimensions.height - 9 / 16) > 0.015)
        throw new Error("TIKTOK_OUTPUT_NOT_9_16");
    }
    const objectPath = `${job.owner_id}/${jobId}/${i}-${f.filename ?? "output"}`;
    const sha = createHash("sha256").update(buf).digest("hex");

    const { error: upErr } = await sb.storage.from("assets").upload(objectPath, buf, {
      contentType: f.contentType ?? contentType, upsert: true,
    });
    if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

    const { data: asset, error: assetErr } = await sb.from("assets").upsert({
      owner_id: job.owner_id, bucket: "assets", object_path: objectPath,
      media_type: f.kind, content_type: f.contentType ?? contentType,
      bytes: buf.length, sha256: sha, source: "generation",
    }, { onConflict: "bucket,object_path" }).select("id").single();
    if (assetErr || !asset) throw new Error(`asset upsert failed: ${assetErr?.message}`);
    assetIds.push(asset.id);

    const { data: existing } = await sb.from("gallery_items")
      .select("id").eq("owner_id", job.owner_id).eq("asset_id", asset.id).maybeSingle();
    if (!existing) {
      const { error: gErr } = await sb.from("gallery_items").insert({
        owner_id: job.owner_id, asset_id: asset.id, job_id: jobId,
        character_id: job.character_id, qc_status: "pending",
      });
      if (gErr) throw new Error(`gallery insert failed: ${gErr.message}`);
    }
  }

  // Eredmény-meta visszaírása (állapotváltozás nélkül – a finalizing lease alatt)
  await mustUpdate("generation_jobs", { result: { assetIds, meta: output.meta } }, jobId);

  // FLOW + CHARGE + COMPLETED egyetlen tranzakciós RPC-ben:
  // ha a charge vagy a completed elhibázódik, a karakterfolyamat is visszagörget.
  const refIds = (job.payload as { refIds?: string[] } | null)?.refIds ?? [];
  // Valódi tréningnél a SÚLYOK URL-je kerül a verzióba (csak sikeres tréning után értelmes LoRA-ref)
  const weights = (output.meta as { weightsUrl?: string; weights?: unknown } | null)?.weightsUrl
    ?? (typeof (output.meta as { weights?: unknown } | null)?.weights === "string"
      ? (output.meta as { weights: string }).weights : null);
  if (job.type === "character_training" && job.provider !== "mock" && !weights) {
    throw new Error("TRAINING_WEIGHTS_MISSING");
  }
  const { error: txErr } = await sb.rpc("complete_job_transactional", {
    p_job: jobId,
    p_first_asset: assetIds[0] ?? null,
    p_ref_ids: refIds,
    p_provider: job.provider ?? "mock",
    p_weights: weights ?? null,
  });
  if (txErr) throw new Error(`complete_job_transactional failed: ${txErr.message}`);

  // ZIP-életciklus: sikeres tréning után a dataset törlődik (a provider már nem kéri)
  if (job.type === "character_training") {
    const { data: vers } = await sb.from("character_versions")
      .select("id,dataset_object_path").eq("generation_job_id", jobId);
    for (const v of (vers ?? []) as Array<{ id: string; dataset_object_path: string | null }>) {
      if (v.dataset_object_path) {
        await sb.storage.from("assets").remove([v.dataset_object_path]).catch(() => {});
        await sb.from("character_versions").update({ dataset_object_path: null }).eq("id", v.id).select("id").then(() => {}, () => {});
      }
    }
  }
  await notify(job.owner_id, "generation_completed", { jobType: job.type }, `done:${jobId}`).catch(() => {});
}

export async function failJob(job: JobRow, message: string): Promise<void> {
  const sb0 = serviceClient();
  // Tréning-pecsét: a jobhoz KÖTÖTT verzió failed (nem „legújabb”), ZIP takarítás
  if (job.type === "character_training") {
    const { data: vers } = await sb0.from("character_versions")
      .select("id,dataset_object_path").eq("generation_job_id", job.id);
    for (const v of (vers ?? []) as Array<{ id: string; dataset_object_path: string | null }>) {
      if (v.dataset_object_path) {
        await sb0.storage.from("assets").remove([v.dataset_object_path]).then(() => {}, () => {});
        await sb0.from("character_versions")
          .update({ dataset_object_path: null }).eq("id", v.id).then(() => {}, () => {});
      }
      await sb0.from("character_versions").update({ status: "failed" })
        .eq("id", v.id).eq("status", "training").then(() => {}, () => {});
    }
  }
  // Részlegesen létrehozott storage-, asset- és gallery-adatok takarítása
  const { data: items } = await sb0.from("gallery_items")
    .select("asset_id,assets(bucket,object_path)").eq("job_id", job.id);
  for (const it of (items ?? []) as Array<{ asset_id: string; assets: unknown }>) {
    const a = it.assets as { bucket: string; object_path: string } | null;
    if (a) await sb0.storage.from(a.bucket).remove([a.object_path]).then(() => {}, () => {});
    await sb0.from("assets").delete().eq("id", it.asset_id).then(() => {}, () => {});
  }
  const jobId = job.id;
  await mustUpdate("generation_jobs", { status: "failed", error: { message } }, jobId).catch(() => {});
  await refundJob(jobId).catch(() => {});           // pontosan egyszeri (SQL idempotens)
  await mustUpdate("generation_jobs", { status: "refunded" }, jobId).catch(() => {});
  await notify(job.owner_id, "generation_failed", { jobType: job.type, error: message }, `fail:${jobId}`).catch(() => {});
  await notify(job.owner_id, "credits_refunded", { amount: job.cost_estimate, reason: message }, `refund:${jobId}`).catch(() => {});
}

async function mustUpdate(
  table: string, patch: Record<string, unknown>, id: string, expectedFrom?: string,
): Promise<void> {
  const sb = serviceClient();
  let q = sb.from(table).update(patch).eq("id", id);
  if (expectedFrom) q = q.eq("status", expectedFrom);   // elvárt kiinduló állapot kikényszerítve
  const { data, error } = await q.select("id");
  if (error) throw new Error(`${table} update failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`${table} update affected 0 rows (id=${id}${expectedFrom ? `, expected=${expectedFrom}` : ""})`);
  }
}

// ---------- SSRF-védett, méretkorlátos provider-letöltés ----------
async function downloadProviderFile(url: string): Promise<{ buf: Buffer; contentType: string }> {
  const safe = assertAllowedUrl(url); // allowlist + privát/link-local tiltás
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(safe.toString(), { signal: controller.signal, redirect: "error" });
    if (!res.ok || !res.body) throw new Error(`provider download failed: ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_PROVIDER_FILE) throw new Error("provider file too large");
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PROVIDER_FILE) throw new Error("provider file too large");
      chunks.push(Buffer.from(value));
    }
    return { buf: Buffer.concat(chunks), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  } finally {
    clearTimeout(timer);
  }
}

async function fileToBuffer(f: ProviderFile): Promise<{ buf: Buffer; contentType?: string }> {
  if (f.base64) return { buf: Buffer.from(f.base64, "base64") };
  if (f.dataUrl) {
    const [head, data] = f.dataUrl.split(",");
    return { buf: Buffer.from(data ?? "", "base64"), contentType: head?.slice(5, head.indexOf(";")) };
  }
  if (f.url) return downloadProviderFile(f.url);
  throw new Error("empty provider file");
}

async function notify(
  userId: string,
  template: "generation_completed" | "generation_failed" | "credits_refunded",
  payload: Record<string, unknown>, keySuffix: string,
): Promise<void> {
  const sb = serviceClient();
  const [{ data: settings }, { data: profile }] = await Promise.all([
    sb.from("user_settings").select("*").eq("user_id", userId).single(),
    sb.from("profiles").select("email").eq("id", userId).single(),
  ]);
  const s = settings as Record<string, unknown> | null;
  const enabled =
    template === "generation_completed" ? s?.email_generation_done :
    template === "generation_failed" ? s?.email_generation_failed :
    s?.email_credit_refund;
  const email = (profile as { email: string } | null)?.email;
  if (!enabled || !email) return;
  const { sendEmail } = await import("@/lib/email/resend");
  await sendEmail({ userId, to: email, template, payload, idempotencyKey: `${template}:${keySuffix}` });
}
