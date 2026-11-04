import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ authed: vi.fn(), serviceClient: vi.fn(), redditSubreddit: vi.fn(), refreshToken: vi.fn() }));
vi.mock("@/server/reddit/client", async (original) => ({ ...(await original<typeof import("@/server/reddit/client")>()), redditSubreddit: mocks.redditSubreddit, refreshToken: mocks.refreshToken }));
import { encrypt } from "@/server/reddit/client";
vi.mock("@/lib/apiAuth", () => ({ authed: mocks.authed })); vi.mock("@/lib/supabase/server", () => ({ serviceClient: mocks.serviceClient }));
import { POST as CONNECT } from "@/app/api/reddit/connect/route";
import { GET as CALLBACK } from "@/app/api/reddit/callback/route";
import { PATCH, GET, DELETE } from "@/app/api/reddit/accounts/route";
const characterId = "11111111-1111-4111-8111-111111111111";
let queries: Array<{ table: string; filters: unknown[][]; update?: Record<string, unknown>; selected?: string }>;
let current: Record<string, unknown>;
let profiles: Array<{ account_url: string }>;
beforeEach(() => {
  vi.stubEnv("REDDIT_API_APPROVED", "true"); vi.stubEnv("REDDIT_CLIENT_ID", "id"); vi.stubEnv("REDDIT_CLIENT_SECRET", "secret");
  vi.stubEnv("REDDIT_TOKEN_ENCRYPTION_KEY", "x".repeat(32)); vi.stubEnv("REDDIT_USER_AGENT", "test");
  mocks.authed.mockResolvedValue({ id: "owner" }); queries = [];
  mocks.redditSubreddit.mockReset(); mocks.redditSubreddit.mockResolvedValue({ name: "test", title: "Models", description: "", over18: true, restricted: false, quarantined: false, submissionType: "any", rules: [{ name: "Permissions", description: "AI models and external links welcome." }] });
  mocks.refreshToken.mockReset(); mocks.refreshToken.mockResolvedValue({ access_token: "new", expires_in: 3600 });
  current = { id: "connection", enabled: false, subreddit: "test", reddit_username: "myself", rules_confirmed: true, timezone: "Europe/Budapest", posting_minutes: [600, 900, 1200], encrypted_access_token: encrypt("access"), encrypted_refresh_token: encrypt("refresh"), token_expires_at: new Date(Date.now() + 3_600_000).toISOString() };
  profiles = [{ account_url: "https://fanvue.com/model" }];
  mocks.serviceClient.mockReturnValue({ from(table: string) {
    const query: typeof queries[number] = { table, filters: [] }; queries.push(query);
    const result = () => ({ data: table === "model_accounts" ? profiles : query.update ? { id: "connection" } : current, error: null });
    const chain = { select(s: string) { query.selected = s; return chain; }, eq(...args: unknown[]) { query.filters.push(args); return chain; },
      update(v: Record<string, unknown>) { query.update = v; return chain; }, delete() { return chain; }, insert() { return chain; }, gt() { return chain; }, order() { return chain; }, limit() { return chain; },
      maybeSingle: async () => result(), then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); } };
    return chain;
  } });
});
afterEach(() => vi.unstubAllEnvs());
function patch(body: Record<string, unknown>) { return PATCH(new NextRequest("https://sportaitipp.vercel.app/api/reddit/accounts", { method: "PATCH", body: JSON.stringify({ characterId, ...body }) })); }
describe("Reddit account settings", () => {
  it("rejects unauthenticated access", async () => { mocks.authed.mockResolvedValue(null); expect((await patch({ enabled: true })).status).toBe(401); expect(queries).toHaveLength(0); });
  it("requires app approval to enable", async () => { vi.stubEnv("REDDIT_API_APPROVED", "false"); expect((await patch({ enabled: true })).status).toBe(503); expect(queries.some(q => q.update)).toBe(false); });
  it("requires valid Fanvue URL", async () => { profiles = [{ account_url: "https://fanvue.com.evil.test/model" }]; expect((await patch({ enabled: true })).status).toBe(400); });
  it("rejects circular schedule collisions and invalid timezone", async () => {
    expect((await patch({ postingMinutes: [0, 1380] })).status).toBe(400); expect((await patch({ timezone: "Mars/Planet" })).status).toBe(400);
  });
  it("does not permit posting to another user profile", async () => { expect((await patch({ subreddit: "u_other" })).status).toBe(400); });
  it("resets destination confirmation and pauses existing schedules", async () => {
    current.enabled = true; expect((await patch({ subreddit: "r/NewPlace" })).status).toBe(200);
    expect(queries.find(q => q.update)?.update).toMatchObject({ subreddit: "newplace", enabled: false, rules_confirmed: false });
  });
  it("requires new confirmation to explicitly enable a changed destination", async () => { expect((await patch({ subreddit: "newplace", enabled: true })).status).toBe(400); });
  it("accepts validated schedule and scopes every connection write to owner", async () => {
    expect((await patch({ enabled: true, postingMinutes: [1200, 600, 900] })).status).toBe(200);
    const write = queries.find(q => q.update)!; expect(write.filters).toContainEqual(["owner_id", "owner"]); expect(write.update?.posting_minutes).toEqual([600, 900, 1200]);
  });
  it("blocks explicit prohibitions even after the owner checks confirmation", async () => {
    mocks.redditSubreddit.mockResolvedValue({ name: "test", title: "Models", description: "", restricted: false, quarantined: false, submissionType: "any", rules: [{ name: "No AI content", description: "No external links" }] });
    const response = await patch({ enabled: true, rulesConfirmed: true }); expect(response.status).toBe(400); expect((await response.json()).error).toBe("REDDIT_COMMUNITY_BLOCKED"); expect(queries.some(q => q.update)).toBe(false);
  });
  it("fails closed when current community rules cannot be read", async () => {
    mocks.redditSubreddit.mockRejectedValue(new Error("REDDIT_HTTP_403"));
    const response = await patch({ enabled: true }); expect(response.status).toBe(502); expect(queries.some(q => q.update?.enabled)).toBe(false);
  });
  it("binds explicit rules confirmation to a fingerprint and clears on destination changes", async () => {
    expect((await patch({ rulesConfirmed: true })).status).toBe(200);
    expect(queries.find(q => q.update?.rules_fingerprint)?.update?.rules_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    current.rules_fingerprint = "old"; expect((await patch({ enabled: true })).status).toBe(409);
  });
  it("refreshes expired credentials before checking rules", async () => {
    current.token_expires_at = "2000-01-01T00:00:00Z"; expect((await patch({ enabled: true })).status).toBe(200);
    expect(mocks.refreshToken).toHaveBeenCalledWith("refresh"); expect(mocks.redditSubreddit).toHaveBeenCalledWith("new", "test");
  });
  it("never selects token secrets for GET and scopes deletion", async () => {
    await GET(new NextRequest("https://sportaitipp.vercel.app/api/reddit/accounts")); expect(queries.every(q => !q.selected?.includes("token"))).toBe(true);
    await DELETE(new NextRequest(`https://sportaitipp.vercel.app/api/reddit/accounts?characterId=${characterId}`)); expect(queries.at(-1)?.filters).toContainEqual(["owner_id", "owner"]);
  });
});

describe("Reddit OAuth browser binding", () => {
  it("does not consume state or exchange code without matching browser cookie", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const response = await CALLBACK(new NextRequest("https://sportaitipp.vercel.app/api/reddit/callback?state=attacker&code=code", { headers: { cookie: "__Host-reddit_oauth_state=victim" } }));
    expect(response.headers.get("location")).toContain("reddit=failed"); expect(queries).toHaveLength(0); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it("rejects unexpected connect origin before creating state", async () => {
    const response = await CONNECT(new NextRequest("https://evil.test/api/reddit/connect", { method: "POST", body: JSON.stringify({ characterId }) }));
    expect(response.status).toBe(400); expect(queries).toHaveLength(0);
  });
  it("sets secure same-site httpOnly state and minimal permanent scopes", async () => {
    const response = await CONNECT(new NextRequest("https://sportaitipp.vercel.app/api/reddit/connect", { method: "POST", body: JSON.stringify({ characterId }) }));
    expect(response.status).toBe(200);
    const url = new URL((await response.json()).url); expect(url.searchParams.get("scope")).toBe("identity submit read"); expect(url.searchParams.get("duration")).toBe("permanent");
    const cookie = response.headers.get("set-cookie")!; expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=lax");
    expect(queries.find(q => q.table === "characters")?.filters).toContainEqual(["owner_id", "owner"]);
  });
});
