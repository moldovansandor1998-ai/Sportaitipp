import { describe, it, expect } from "vitest";
import { canActivateCharacter, assertRefOwnership, canTransitionCharacter, CHARACTER_TRANSITIONS } from "@/lib/jobs/characterFlow";
import { TRANSITIONS } from "@/lib/jobs/states";

describe("karakterfolyamat-megkerülés kizárva", () => {
  it("identity_check nem aktivál tréning és tesztkép nélkül", () => {
    expect(canActivateCharacter(null)).toBe(false);
    expect(canActivateCharacter({ status: "test_pending", test_image_asset_id: null })).toBe(false);
    expect(canActivateCharacter({ status: "training", test_image_asset_id: "a" })).toBe(false);
    expect(canActivateCharacter({ status: "test_pending", test_image_asset_id: "a" })).toBe(true);
  });
  it("idegen refId támadás elutasítva", () => {
    const owned = [{ id: "r1" }, { id: "r2" }];
    expect(() => assertRefOwnership(owned, ["r1", "r2"])).not.toThrow();
    expect(() => assertRefOwnership(owned, ["r1", "EVIL"])).toThrow(/REF_NOT_OWNED/);
  });
  it("karakter-állapotgép: tiltott ugrások", () => {
    expect(canTransitionCharacter("collecting_refs", "active")).toBe(false);
    expect(canTransitionCharacter("training", "active")).toBe(false);
    expect(canTransitionCharacter("test_pending", "active")).toBe(true);
    for (const [from, tos] of Object.entries(CHARACTER_TRANSITIONS)) {
      for (const to of tos) expect(canTransitionCharacter(from, to)).toBe(true);
    }
  });
});

describe("finalizing lease szabályai", () => {
  it("a transitions modulban: finalizing csak megfelelő átmenetekkel", () => {
    expect(TRANSITIONS.submitted).toContain("finalizing");
    expect(TRANSITIONS.processing).toContain("finalizing");
    expect(TRANSITIONS.finalizing).toContain("completed");
    expect(TRANSITIONS.finalizing).toContain("failed");
  });
});
