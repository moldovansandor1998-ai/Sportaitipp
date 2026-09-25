import { describe, it, expect } from "vitest";
import { isCronAuthorized } from "@/lib/security/cron";

describe("cron fail-closed hitelesítés", () => {
  it("hiányzó CRON_SECRET → no_secret (végpont: 500)", () => {
    expect(isCronAuthorized("Bearer x", undefined)).toBe("no_secret");
    expect(isCronAuthorized("Bearer x", "")).toBe("no_secret");
  });
  it("hiányzó vagy rossz header → unauthorized (401)", () => {
    expect(isCronAuthorized(null, "s3cret")).toBe("unauthorized");
    expect(isCronAuthorized("Bearer wrong", "s3cret")).toBe("unauthorized");
    expect(isCronAuthorized("s3cret", "s3cret")).toBe("unauthorized");
  });
  it("pontos egyezés → ok", () => {
    expect(isCronAuthorized("Bearer s3cret", "s3cret")).toBe("ok");
  });
});
