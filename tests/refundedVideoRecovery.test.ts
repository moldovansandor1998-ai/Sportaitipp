import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getResult: vi.fn(), submit: vi.fn(), charge: vi.fn(), refund: vi.fn(),
  service: vi.fn(), download: vi.fn(),
}));
vi.mock("@/lib/providers", () => ({ buildRouter: () => ({
  getAdapter: () => ({ getResult: mocks.getResult, submit: mocks.submit }),
}) }));
vi.mock("@/lib/credits/rpc", () => ({ refundJob: mocks.refund }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: mocks.service }));
vi.mock("@/server/jobs/providerDownload", async (original) => ({
  ...await original<typeof import("@/server/jobs/providerDownload")>(),
  downloadProviderFile: mocks.download,
}));
vi.mock("@/server/jobs/compactVideo", () => ({ compactVideo: async (b: Buffer) => b }));
import { recoverRefundedVideoJob, type JobRow } from "@/server/jobs/runJob";

const job: JobRow & { provider_meta: Record<string, unknown> } = {
  id: "job", owner_id: "owner", type: "character_motion_video", character_id: "character",
  payload: {}, provider: "wavespeed", provider_job_id: "existing-provider-id", cost_estimate: 100,
  idempotency_key: "job", status: "refunded", provider_meta: { stage: "video" },
};

beforeEach(() => vi.clearAllMocks());

it("restores the existing video once while preserving its refund and avoiding a new submission", async () => {
  const state: { status: string; error: { message: string }; result: unknown } = {
    status: "refunded", error: { message: "provider file too large" }, result: null,
  };
  const gallery: unknown[] = [];
  const upload = vi.fn(async () => ({ error: null }));
  mocks.service.mockReturnValue({
    rpc: mocks.charge,
    storage: { from: () => ({ upload }) },
    from: (table: string) => {
      let patch: Record<string, unknown> | undefined;
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; },
        update(value: Record<string, unknown>) { patch = value; return query; },
        upsert() { return query; },
        async single() { return { data: table === "generation_jobs" ? state : { id: "asset" }, error: null }; },
        async maybeSingle() { return { data: gallery[0] ?? null, error: null }; },
        async insert(value: unknown) { gallery.push(value); return { error: null }; },
        then(resolve: (value: { error: null }) => unknown) {
          if (patch) Object.assign(state, patch);
          return Promise.resolve(resolve({ error: null }));
        },
      };
      return query;
    },
  });
  mocks.getResult.mockResolvedValue({ files: [{ kind: "video", url: "https://cdn.cachegalaxy.com/video.mp4" }], meta: {} });
  mocks.download.mockResolvedValue({ buf: Buffer.from("mp4"), contentType: "video/mp4" });

  expect(await recoverRefundedVideoJob(job)).toBe(true);
  expect(mocks.getResult).toHaveBeenCalledWith("existing-provider-id", { stage: "video" }, "character_motion_video");
  expect(gallery).toEqual([expect.objectContaining({ owner_id: "owner", asset_id: "asset", job_id: "job", character_id: "character" })]);
  expect(state.status).toBe("refunded");
  expect(state.result).toMatchObject({ assetIds: ["asset"], recoveredAfterRefund: true });

  expect(await recoverRefundedVideoJob(job)).toBe(false);
  expect(mocks.getResult).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.charge).not.toHaveBeenCalled();
  expect(mocks.refund).not.toHaveBeenCalled();
});
