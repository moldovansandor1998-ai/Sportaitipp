import "server-only";
import { assertCreationAllowed, CreationAccessDenied } from "@/lib/security/creationAccess";
import { customerTariffRequired } from "@/lib/providers/operatingTariff";
import { serviceClient } from "@/lib/supabase/server";

// Szinkron, számlázott feladat: hold → munka → charge / refund. Idempotens kulccsal.
export async function runBilledTask<T>(input: {
  userId: string; type: string; cost: number; idempotencyKey: string;
  fn: () => Promise<T>;
}): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  // No verified complete provider/auxiliary cost exists for these content workflows yet.
  if (customerTariffRequired(input.userId)) return { ok: false, error: "CREATION_COST_UNAVAILABLE" };
  const sb = serviceClient();
  const key = input.idempotencyKey;
  const { data: existing, error: existingError } = await sb.from("credit_transactions")
    .select("id").eq("idempotency_key", `task:${key}`).limit(1).maybeSingle();
  if (existingError) return { ok: false, error: "CREDIT_LOOKUP_FAILED" };
  if (existing) return { ok: false, error: "TASK_ALREADY_PROCESSED" };

  try { await assertCreationAllowed(input.userId); }
  catch (error) { return { ok: false, error: (error as CreationAccessDenied).code }; }
  const { data: jobId, error: holdError } = await sb.rpc("create_job_with_hold", {
    p_owner: input.userId, p_type: "carousel_page", p_character: null, p_project: null,
    p_payload: { task: input.type }, p_key: `task:${key}`, p_estimated: input.cost,
  });
  if (holdError || typeof jobId !== "string" || !jobId) {
    return { ok: false, error: holdError?.message ?? "CREDIT_HOLD_FAILED" };
  }
  // Keep an existing hold intact if access changed after reservation; no automatic refund.
  try { await assertCreationAllowed(input.userId); }
  catch (error) { return { ok: false, error: (error as CreationAccessDenied).code }; }
  try {
    const value = await input.fn();
    const { error: chargeError } = await sb.rpc("credit_charge_hold", { p_job: jobId, p_key: `charge:${jobId}` });
    if (chargeError) throw new Error(`CREDIT_CHARGE_FAILED: ${chargeError.message}`);
    const { error: updateError } = await sb.from("generation_jobs").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", jobId);
    if (updateError) throw new Error(`JOB_FINALIZE_FAILED: ${updateError.message}`);
    return { ok: true, value };
  } catch (e: unknown) {
    const { error: refundError } = await sb.rpc("credit_refund_job", { p_job: jobId, p_key: `refund:${jobId}` });
    if (!refundError) {
      await sb.from("generation_jobs").update({ status: "refunded", finished_at: new Date().toISOString() }).eq("id", jobId);
    }
    const message = e instanceof Error ? e.message : "task failed";
    return { ok: false, error: refundError ? `${message}; CREDIT_REFUND_FAILED: ${refundError.message}` : message };
  }
}
