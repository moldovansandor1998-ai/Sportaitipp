import "server-only";
import { serviceClient } from "@/lib/supabase/server";

export async function holdCredits(userId: string, jobId: string, amount: number) {
  const sb = serviceClient();
  const { error } = await sb.rpc("credit_hold", {
    p_user: userId, p_job: jobId, p_amount: amount, p_key: `hold:${jobId}`,
  });
  if (error) throw Object.assign(new Error(error.message), { code: error.message }) as Error & { code: string };
}

export async function chargeJob(jobId: string) {
  const sb = serviceClient();
  const { error } = await sb.rpc("credit_charge_hold", { p_job: jobId, p_key: `charge:${jobId}` });
  if (error) throw new Error(error.message);
}

export async function refundJob(jobId: string) {
  const sb = serviceClient();
  const { error } = await sb.rpc("credit_refund_job", { p_job: jobId, p_key: `refund:${jobId}` });
  if (error) throw new Error(error.message);
}

/** Egyetlen tranzakció: tulajdon-ellenőrzés + job + atomi hold. Árva job nincs. */
export async function createJobWithHold(input: {
  userId: string; type: string; characterId?: string; projectId?: string;
  payload: Record<string, unknown>; idempotencyKey: string; costEstimate: number;
}): Promise<string> {
  const sb = serviceClient();
  const { data: jobId, error } = await sb.rpc("create_job_with_hold", {
    p_owner: input.userId,
    p_type: input.type,
    p_character: input.characterId ?? null,
    p_project: input.projectId ?? null,
    p_payload: input.payload,
    p_key: input.idempotencyKey,
    p_estimated: input.costEstimate,
  });
  if (error) {
    if (error.message.includes("duplicate key")) {
      const e = new Error("JOB_ALREADY_EXISTS") as Error & { code: string };
      e.code = "JOB_ALREADY_EXISTS";
      throw e;
    }
    throw Object.assign(new Error(error.message), { code: error.message }) as Error & { code: string };
  }
  return jobId as string;
}
