import { describe, it, expect } from "vitest";
import { ProviderRouter } from "@/lib/providers/router";
import { ProviderError, type ProviderAdapter, type JobType } from "@/lib/providers/types";

function fakeAdapter(name: string, behavior: "ok" | "fail-retry" | "fail-hard"): ProviderAdapter {
  return {
    name, supports: ["image_generation" as JobType],
    estimate: async () => ({ credits: 10, secondsExpected: 1 }),
    submit: async () => {
      if (behavior === "ok") return { providerJobId: `${name}_job` };
      throw new ProviderError("boom", behavior === "fail-retry");
    },
    getStatus: async () => "done" as const,
    getResult: async () => ({ files: [], meta: {} }),
    cancel: async () => {},
    healthCheck: async () => ({ ok: true, latencyMs: 1 }),
    normalizeWebhook: () => ({ eventId: "e", status: "done" as const }),
    verifyWebhook: async () => true, // (headers, secret) aláírású mock
  };
}

const params = {
  jobId: "j1", jobType: "image_generation" as JobType, payload: {},
  webhookUrl: "https://x/hook", idempotencyKey: "k1",
};

describe("provider router", () => {
  it("failover: tartalék veszi át, ha az elsődleges retryable hibát ad", async () => {
    const router = new ProviderRouter(
      [fakeAdapter("a", "fail-retry"), fakeAdapter("b", "ok")],
      () => "a",
    );
    const r = await router.submit("image_generation", params);
    expect(r.adapter.name).toBe("b");
    expect(r.providerJobId).toBe("b_job");
  });

  it("nem retryable hibánál nincs failover", async () => {
    const router = new ProviderRouter(
      [fakeAdapter("a", "fail-hard"), fakeAdapter("b", "ok")],
      () => "a",
    );
    await expect(router.submit("image_generation", params)).rejects.toThrow("boom");
  });

  it("circuit breaker: nyitás után az elsődleges adapter már nincs is hívva", async () => {
    let aCalls = 0;
    const a: ProviderAdapter = {
      ...fakeAdapter("a", "fail-retry"),
      submit: async () => {
        aCalls += 1;
        throw new ProviderError("boom", true);
      },
    };
    const b = fakeAdapter("b", "ok");
    const router = new ProviderRouter([a, b], () => "a", { breakerThreshold: 2, breakerCooldownMs: 60_000 });

    const r1 = await router.submit("image_generation", params); // a hibázik (1), b átvesz
    expect(r1.adapter.name).toBe("b");
    expect(aCalls).toBe(1);

    await router.submit("image_generation", params); // a hibázik (2) → breaker nyílik
    expect(aCalls).toBe(2);

    const r3 = await router.submit("image_generation", params); // a nyitva → egyáltalán nem hívjuk
    expect(r3.adapter.name).toBe("b");
    expect(aCalls).toBe(2);
  });

  it("timeout után retryable hiba", async () => {
    const slow: ProviderAdapter = {
      ...fakeAdapter("slow", "ok"),
      submit: () => new Promise(() => {}),
    };
    const router = new ProviderRouter([slow, fakeAdapter("b", "ok")], () => "slow", { timeoutMs: 50 });
    const r = await router.submit("image_generation", params);
    expect(r.adapter.name).toBe("b");
  });
});
