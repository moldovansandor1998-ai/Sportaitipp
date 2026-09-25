import { describe, it, expect } from "vitest";
import { canTransition, TRANSITIONS } from "@/lib/jobs/states";

describe("submission_uncertain állapot", () => {
  it("processing → submission_uncertain → processing/failed/queued engedélyezett", () => {
    expect(canTransition("processing", "submission_uncertain")).toBe(true);
    expect(canTransition("submission_uncertain", "processing")).toBe(true); // admin: befutott, webhook folytatja
    expect(canTransition("submission_uncertain", "failed")).toBe(true);
    expect(canTransition("submission_uncertain", "queued")).toBe(true);     // admin: kontrollált restart
  });
  it("submission_uncertain → completed TILTOTT (csak finalizingből)", () => {
    expect(canTransition("submission_uncertain", "completed")).toBe(false);
  });
  it("nem megy be submission_uncertainből más csapda-átmenetbe", () => {
    expect(canTransition("submission_uncertain", "refunded")).toBe(false);
    expect(TRANSITIONS.submission_uncertain).toEqual(["processing", "failed", "queued"]);
  });
});
