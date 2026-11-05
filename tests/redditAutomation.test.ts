import { describe, expect, it } from "vitest";
import { buildRedditCopy, localRedditTime, normalizeDestination, normalizeFanvueUrl, normalizePostingMinutes, redditCopyTooSimilar } from "@/lib/redditAutomation";
import { similarImageHashes } from "@/server/reddit/imageFingerprint";

describe("Reddit automation validation", () => {
  it("requires a real HTTPS Fanvue profile", () => {
    expect(normalizeFanvueUrl("https://www.fanvue.com/model")).toBe("https://www.fanvue.com/model");
    for (const value of ["https://fanvue.com.evil.test/model", "https://name:pass@fanvue.com/model", "http://fanvue.com/model", "https://fanvue.com/", "https://fanvue.com:444/model", null])
      expect(() => normalizeFanvueUrl(value)).toThrow();
  });
  it("normalizes safe communities and own-profile notation", () => {
    expect(normalizeDestination("r/Example")).toBe("example");
    expect(normalizeDestination("u/Example")).toBe("u_example");
    expect(() => normalizeDestination("example/../../api")).toThrow();
  });
  it("sorts spaced slots and rejects midnight crowding, duplicates and limits", () => {
    expect(normalizePostingMinutes([900, 600, 1200])).toEqual([600, 900, 1200]);
    for (const times of [[], [600, 600], [0, 1439], [600, 650], [1, 300, 600, 900, 1200], [NaN], [1440]])
      expect(() => normalizePostingMinutes(times)).toThrow();
  });
  it("uses Budapest local dates and DST instead of fixed offsets", () => {
    expect(localRedditTime(new Date("2026-11-03T23:30:00Z"), "Europe/Budapest")).toEqual({ date: "2026-11-04", minute: 30 });
    expect(localRedditTime(new Date("2026-07-03T23:30:00Z"), "Europe/Budapest")).toEqual({ date: "2026-07-04", minute: 90 });
  });
  it("never emits a missing link and includes AI disclosure", () => {
    const copy = buildRedditCopy("Nyugodt pillanat, természetes hangulat.", "Teszt", "https://fanvue.com/testmodel");
    expect(copy.text).toContain("https://fanvue.com/testmodel");
    expect(copy.text).toContain("AI-karakter");
    expect(() => buildRedditCopy("https://unrelated.test", "Teszt", "https://fanvue.com/testmodel")).toThrow();
  });
  it("rejects exact and close caption repeats", () => {
    expect(redditCopyTooSimilar("Természetes fény, nyugodt hangulat!", ["Természetes fény, nyugodt hangulat."])).toBe(true);
    expect(redditCopyTooSimilar("Szeretem ezt a természetes könnyed délutáni hangulatot", ["Ez a természetes könnyed délutáni hangulatot idézi"])).toBe(true);
    expect(redditCopyTooSimilar("Egészen más történet jutott eszembe", ["Természetes fény, nyugodt hangulat"])).toBe(false);
  });
  it("compares perceptual hashes without accepting malformed data", () => {
    expect(similarImageHashes("0000000000000000", "000000000000000f")).toBe(true);
    expect(similarImageHashes("0000000000000000", "00000000000000ff")).toBe(false);
    expect(similarImageHashes("bad", "bad")).toBe(false);
  });
});
