import { describe, it, expect } from "vitest";
import { createAttemptTracker } from "@/lib/jobs/attemptKey";

describe("idempotency kulcs életciklus", () => {
  it("első begin új kulcsot ad; dupla begin null (egy kérés)", () => {
    const t = createAttemptTracker(() => "k1");
    expect(t.begin()).toBe("k1");
    expect(t.begin()).toBeNull();
  });
  it("resend ugyanazt a kulcsot adja (hálózati újraküldés)", () => {
    const t = createAttemptTracker(() => "k2");
    t.begin();
    expect(t.resend()).toBe("k2");
    expect(t.resend()).toBe("k2");
  });
  it("finish után a következő begin ÚJ kulcs (retry)", () => {
    let n = 0;
    const t = createAttemptTracker(() => `k${++n}`);
    const a = t.begin(); t.finish();
    const b = t.begin();
    expect(a).toBe("k1");
    expect(b).toBe("k2");
    expect(a).not.toBe(b);
  });
  it("finish nélkül begin még mindig null – a kulcs érvényes marad az újraküldéshez", () => {
    const t = createAttemptTracker(() => "k3");
    t.begin();
    expect(t.begin()).toBeNull();
    expect(t.resend()).toBe("k3");
  });
});
