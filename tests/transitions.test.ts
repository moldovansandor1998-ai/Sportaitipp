import { describe, it, expect } from "vitest";
import { TRANSITIONS, JOB_STATUSES, canTransition, isTerminal, assertTransition, JobStatus } from "@/lib/jobs/states";

describe("állapotgép – minden átmenet", () => {
  it("minden felsorolt állapot létezik a sémában", () => {
    for (const s of Object.keys(TRANSITIONS)) expect(JOB_STATUSES).toContain(s);
  });

  it("csak a szabályokban szereplő átmenetek engedélyezettek", () => {
    for (const from of JOB_STATUSES as readonly JobStatus[]) {
      for (const to of JOB_STATUSES as readonly JobStatus[]) {
        expect(canTransition(from, to)).toBe(TRANSITIONS[from].includes(to) || from === to);
      }
    }
  });

  it("korábbi hibák javítva: tiltott rövidzárak kizárva", () => {
    expect(canTransition("processing", "submitted")).toBe(false);
    expect(canTransition("queued", "quality_check")).toBe(false);
    expect(canTransition("draft", "completed")).toBe(false);
  });

  it("terminális állapotokból nincs átmenet", () => {
    for (const s of ["completed", "cancelled", "refunded"] as JobStatus[]) {
      expect(isTerminal(s)).toBe(true);
      expect(TRANSITIONS[s]).toHaveLength(0);
    }
  });

  it("hibás átmenetnél az assertTransition dob", () => {
    expect(() => assertTransition("failed", "completed")).toThrow(/illegal job transition/);
    expect(() => assertTransition("quality_check", "completed")).not.toThrow();
  });
});
