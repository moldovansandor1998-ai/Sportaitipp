import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt, exchangeCode, redditApproved, redditConfigured, redditSubmitText, refreshToken, validPostingMinutes, normalizeDestination } from "@/server/reddit/client";
beforeEach(() => {
  vi.stubEnv("REDDIT_API_APPROVED", "true"); vi.stubEnv("REDDIT_CLIENT_ID", "client"); vi.stubEnv("REDDIT_CLIENT_SECRET", "secret");
  vi.stubEnv("REDDIT_TOKEN_ENCRYPTION_KEY", "x".repeat(32)); vi.stubEnv("REDDIT_USER_AGENT", "castora:test:v1 (by /u/test)");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("Reddit client", () => {
  it("requires explicit approval and a strong dedicated key", async () => {
    vi.stubEnv("REDDIT_API_APPROVED", "false"); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(redditApproved()).toBe(false); await expect(exchangeCode("code")).rejects.toThrow("REDDIT_API_NOT_APPROVED"); expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("REDDIT_TOKEN_ENCRYPTION_KEY", "short"); expect(redditConfigured()).toBe(false);
  });
  it("encrypts with authenticated encryption and rejects tampering", () => {
    const encoded = encrypt("private-token"); expect(decrypt(encoded)).toBe("private-token");
    const b = Buffer.from(encoded, "base64url"); b[b.length - 1] ^= 1; expect(() => decrypt(b.toString("base64url"))).toThrow();
  });
  it("refresh permits Reddit omitting unchanged refresh token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ access_token: "new", expires_in: 3600 })));
    expect((await refreshToken("old")).access_token).toBe("new");
  });
  it("checks JSON errors even on HTTP 200 and never blindly retries", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ json: { errors: [["RATELIMIT", "wait", "ratelimit"]] } })); vi.stubGlobal("fetch", fetch);
    await expect(redditSubmitText("access", { subreddit: "r/test", title: "title", text: "body" })).rejects.toMatchObject({ code: "REDDIT_RATELIMIT", ambiguous: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("flags timeout/network failures as ambiguous and does not retry", async () => {
    const fetch = vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")); vi.stubGlobal("fetch", fetch);
    await expect(redditSubmitText("access", { subreddit: "test", title: "title", text: "body" })).rejects.toMatchObject({ ambiguous: true }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("treats missing post ID as ambiguous", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ json: { errors: [], data: {} } })));
    await expect(redditSubmitText("access", { subreddit: "test", title: "title", text: "body" })).rejects.toMatchObject({ ambiguous: true });
  });
  it("submits richtext instead of text when requested", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ json: { errors: [], data: { id: "abc", url: "https://www.reddit.com/r/test/comments/abc" } } })); vi.stubGlobal("fetch", fetch);
    expect((await redditSubmitText("access", { subreddit: "test", title: "title", text: "body", richtext: '{"document":[]}' })).id).toBe("abc");
    const body = fetch.mock.calls[0][1].body as URLSearchParams; expect(body.get("richtext_json")).toBe('{"document":[]}'); expect(body.has("text")).toBe(false);
  });
  it("rejects oversized titles before issuing requests", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(redditSubmitText("access", { subreddit: "test", title: "a".repeat(301), text: "body" })).rejects.toThrow("REDDIT_POST_INVALID"); expect(fetch).not.toHaveBeenCalled();
  });
  it("validates circular schedule spacing and destinations", () => {
    expect(validPostingMinutes([600, 900, 1200])).toBe(true); expect(validPostingMinutes([0, 1380])).toBe(false);
    expect(validPostingMinutes([600, 600])).toBe(false); expect(validPostingMinutes([])).toBe(false);
    expect(normalizeDestination("r/Test")).toBe("test"); expect(normalizeDestination("u/Test-user")).toBe("u_test-user"); expect(normalizeDestination("test/../../x")).toBeNull();
  });
});
