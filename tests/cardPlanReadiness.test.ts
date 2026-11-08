import { describe, it, expect } from "vitest";
import { cardPaymentsReady } from "@/lib/billing/card-readiness";
import { SUBSCRIPTION_PLANS } from "@/lib/billing/subscriptionPlans";
import { readFileSync } from "node:fs";
describe("customer card readiness", () => {
  const valid = { ready: true, sandbox: false, plans: SUBSCRIPTION_PLANS };
  it("requires exact verified live catalog rather than sandbox readiness", () => {
    expect(cardPaymentsReady(valid)).toBe(true);
    for (const value of [null, {}, { ...valid, sandbox: true }, { ...valid, ready: false }, { ...valid, sandbox: undefined }, { ...valid, plans: [] }]) expect(cardPaymentsReady(value)).toBe(false);
  });
  it("rejects wrong price, currency, allowance, duplicates and missing plans", () => {
    for (const change of [{ monthlyBasePrice: "28.00" }, { currency: "eur" }, { monthlyCredits: 2001 }, { key: "unapproved" }]) expect(cardPaymentsReady({ ...valid, plans: [{ ...SUBSCRIPTION_PLANS[0], ...change }, ...SUBSCRIPTION_PLANS.slice(1)] })).toBe(false);
    expect(cardPaymentsReady({ ...valid, plans: [SUBSCRIPTION_PLANS[0], SUBSCRIPTION_PLANS[0], SUBSCRIPTION_PLANS[2]] })).toBe(false);
  });
  it("uses the recurring route, safe checkout URL and reentry lock", () => {
    const source = readFileSync("src/components/billing/CardSubscriptionPlans.tsx", "utf8");
    expect(source).toContain('/api/billing/whop/checkout'); expect(source).not.toContain('"/api/billing/checkout"');
    expect(source).toContain('if (!ready || starting.current) return;');
    expect(source).toContain('safeWhopCheckoutUrl(result.url, false)');
    expect(source).toContain('disabled={!ready || pending}');
  });
});
