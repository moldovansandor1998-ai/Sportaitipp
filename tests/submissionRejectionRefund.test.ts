import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError, ProviderSubmissionRejectedError } from "@/lib/providers/types";
import { runClaimedJob, type JobRow } from "@/server/jobs/runJob";
import type { buildRouter } from "@/lib/providers";

const state = vi.hoisted(() => ({ providerId: null as string | null, patches: [] as Array<Record<string, unknown>>, rpc: vi.fn() }));
vi.mock("@/lib/providers", () => ({ buildRouter: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: () => ({
  rpc: state.rpc,
  from: (table: string) => {
    let updating = false;
    const chain = {
      select: () => chain, eq: () => chain, is: () => chain,
      update: (patch: Record<string, unknown>) => { updating = true; state.patches.push(patch); return chain; },
      single: async () => ({ data: table === "generation_jobs" ? { provider_job_id: state.providerId, status: "submitted" } : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: updating ? [{ id: "job" }] : [], error: null }).then(resolve),
    };
    return chain;
  },
}) }));

beforeEach(() => {
  state.providerId = null; state.patches = [];
  state.rpc.mockReset().mockResolvedValue({ data: true, error: null });
});
const job: JobRow = { id: "job", owner_id: "owner", type: "image_generation", character_id: null,
  payload: {}, provider: null, provider_job_id: null, cost_estimate: 733, idempotency_key: "key", status: "submitted" };

async function submitFailure(error: Error) {
  const submit = vi.fn().mockRejectedValue(error);
  const router = { candidates: () => [{}], submit } as unknown as ReturnType<typeof buildRouter>;
  await runClaimedJob(job, router);
  expect(submit).toHaveBeenCalledTimes(1);
}
describe("Rejected submission credit handling", () => {
  it("refunds a definite denial once and finishes as refunded", async () => {
    await submitFailure(new ProviderSubmissionRejectedError("Nureta 403: denied", false));
    expect(state.patches.map(patch => patch.status)).toEqual(["failed", "refunded"]);
    expect(state.rpc.mock.calls.filter(call => call[0] === "credit_refund_job")).toHaveLength(1);
  });
  it("retains the hold after a network timeout", async () => {
    await submitFailure(new ProviderError("timeout", true));
    expect(state.patches.map(patch => patch.status)).toEqual(["submission_uncertain"]);
    expect(state.rpc.mock.calls.some(call => call[0] === "credit_refund_job")).toBe(false);
  });
  it("does not refund when an accepted provider task ID is already recorded", async () => {
    state.providerId = "accepted-task";
    await submitFailure(new ProviderSubmissionRejectedError("denied", false));
    expect(state.patches.map(patch => patch.status)).toEqual(["submission_uncertain"]);
    expect(state.rpc.mock.calls.some(call => call[0] === "credit_refund_job")).toBe(false);
  });
});
