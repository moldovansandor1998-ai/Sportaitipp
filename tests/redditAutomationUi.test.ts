import { describe, expect, it } from "vitest";
import { redditPostLink, validateRedditSettings } from "@/components/RedditAutomation";

const settings = { subreddit: "r/example", timezone: "Europe/Budapest", times: ["09:00", "18:00"], rulesConfirmed: false };

describe("Reddit settings UI validation", () => {
  it("sorts valid daily times and accepts a profile target", () => {
    expect(validateRedditSettings({ ...settings, subreddit: "u_example", times: ["18:00", "09:00"] })).toEqual([540, 1080]);
  });
  it("accepts 1 to 4 daily slots and exactly two-hour gaps", () => {
    expect(validateRedditSettings({ ...settings, times: ["00:00"] })).toEqual([0]);
    expect(validateRedditSettings({ ...settings, times: ["00:00", "02:00", "04:00", "22:00"] })).toEqual([0, 120, 240, 1320]);
  });
  it.each([["09:00", "10:59"], ["23:00", "00:59"], ["09:00", "09:00"]])("rejects too-close or duplicate times %j", (...times) => {
    expect(() => validateRedditSettings({ ...settings, times })).toThrow("legalább 2 óra");
  });
  it.each([[], [""], ["24:00"], ["09:60"], ["00:00", "03:00", "06:00", "09:00", "12:00"]])("rejects invalid slots %j", (...times) => {
    expect(() => validateRedditSettings({ ...settings, times })).toThrow("1–4");
  });
  it("requires a valid destination and timezone", () => {
    expect(() => validateRedditSettings({ ...settings, subreddit: "https://reddit.com/r/example" })).toThrow("célközösséget");
    expect(() => validateRedditSettings({ ...settings, timezone: "" })).toThrow();
    expect(() => validateRedditSettings({ ...settings, timezone: "Budapest" })).toThrow();
  });
});

describe("Reddit history URLs", () => {
  it("allows Reddit permalink paths and HTTPS Reddit URLs", () => {
    expect(redditPostLink("/r/example/comments/abc/title")).toBe("https://www.reddit.com/r/example/comments/abc/title");
    expect(redditPostLink("https://reddit.com/comments/abc")).toBe("https://reddit.com/comments/abc");
  });
  it.each([null, "javascript:alert(1)", "https://evil.test/", "//evil.test/", "https://reddit.com.evil.test/", "http://reddit.com/", "https://user:secret@reddit.com/"])("rejects unsafe URLs %s", value => {
    expect(redditPostLink(value)).toBeUndefined();
  });
});
