import { describe, it, expect } from "vitest";
import { MockProvider } from "@/lib/providers/mock";
import { createHmac } from "crypto";

describe("mock provider", () => {
  it("becslést ad minden támogatott típusra", async () => {
    const m = new MockProvider();
    for (const t of m.supports) {
      const e = await m.estimate(t);
      expect(e.credits).toBeGreaterThan(0);
    }
  });

  it("kimenet data URL – nincs külső letöltés (SSRF-mentes)", async () => {
    const m = new MockProvider();
    const out = await m.getResult("mock_x");
    expect(out.files[0].dataUrl).toMatch(/^data:image\/svg/);
    expect(out.files[0].url).toBeUndefined();
  });

  it("submit idempotens kulccsal stabil providerJobId", async () => {
    const m = new MockProvider();
    const p = { jobId: "j", jobType: "image_generation" as const, payload: {}, webhookUrl: "w", idempotencyKey: "abc" };
    const a = await m.submit(p); const b = await m.submit(p);
    expect(a.providerJobId).toBe(b.providerJobId);
  });

  it("webhook-aláírás: helyes titokkal érvényes, rosszal nem", async () => {
    const m = new MockProvider();
    const raw = JSON.stringify({ eventId: "e1" });
    const good = createHmac("sha256", "secret").update(raw).digest("hex");
    expect(await m.verifyWebhook(raw, { "x-castora-signature": good }, "secret")).toBe(true);
    expect(await m.verifyWebhook(raw, { "x-castora-signature": good }, "other")).toBe(false);
    expect(await m.verifyWebhook(raw, { "x-castora-signature": null }, "secret")).toBe(false);
  });
});
