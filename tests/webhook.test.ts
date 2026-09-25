import { describe, it, expect } from "vitest";
import { safeHmacEqual, requireStableEventId } from "@/lib/security/webhook";
import { createHmac } from "crypto";

describe("webhook biztonság", () => {
  const raw = JSON.stringify({ eventId: "evt_1", status: "done" });
  const good = createHmac("sha256", "sekrit").update(raw).digest("hex");

  it("helyes aláírás érvényes", () => {
    expect(safeHmacEqual(raw, good, "sekrit")).toBe(true);
    expect(safeHmacEqual(raw, `sha256=${good}`, "sekrit")).toBe(true);
  });
  it("rossz titok / hiányzó aláírás érvénytelen", () => {
    expect(safeHmacEqual(raw, good, "más")).toBe(false);
    expect(safeHmacEqual(raw, null, "sekrit")).toBe(false);
  });
  it("rossz hosszúságú aláírás nem dob – false", () => {
    expect(safeHmacEqual(raw, "abcd", "sekrit")).toBe(false);
    expect(safeHmacEqual(raw, good + "ff", "sekrit")).toBe(false);
  });
  it("stabil event ID kötelező", () => {
    expect(requireStableEventId({ eventId: "evt_1" })).toBe("evt_1");
    expect(requireStableEventId({ id: "evt_2" })).toBe("evt_2");
    expect(() => requireStableEventId({})).toThrow(/MISSING_STABLE_EVENT_ID/);
    expect(() => requireStableEventId({ eventId: "" })).toThrow(/MISSING_STABLE_EVENT_ID/);
    expect(() => requireStableEventId({ eventId: "x".repeat(201) })).toThrow(/MISSING_STABLE_EVENT_ID/);
  });
  it("hitelesített header fallback (X-Fal-Webhook-Request-Id / webhook-id)", () => {
    expect(requireStableEventId({ request_id: "req_h" })).toBe("req_h");
    expect(requireStableEventId({}, "req_header")).toBe("req_header");
    expect(() => requireStableEventId({}, null)).toThrow(/MISSING_STABLE_EVENT_ID/);
  });
});
