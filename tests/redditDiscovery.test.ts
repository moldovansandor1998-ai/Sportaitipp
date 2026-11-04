import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
vi.mock("@/server/reddit/client", () => ({
  normalizeDestination: (name: string) => /^[a-z0-9_]{2,21}$/i.test(name) ? name.toLowerCase() : null,
  redditSearchSubreddits: vi.fn(), redditSubreddit: vi.fn(),
  redditApproved: vi.fn(() => true), redditConfigured: vi.fn(() => true),
  decrypt: vi.fn(() => "access"), encrypt: vi.fn(() => "encrypted"), refreshToken: vi.fn(),
}));
vi.mock("@/lib/apiAuth", () => ({ authed: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: vi.fn() }));
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { discoverDueCommunities } from "@/server/reddit/discoveryRunner";
import { GET, POST } from "@/app/api/reddit/discover/route";
import { redditApproved, redditConfigured, redditSearchSubreddits, redditSubreddit } from "@/server/reddit/client";
import { classifyCommunity, discoverCommunities, discoveryQueries } from "@/server/reddit/discovery";
const community = { name: "modelphotos", title: "AI models", description: "Model photography", over18: true };
const permission = [{ name: "Content", description: "AI models are allowed. Fanvue links are permitted." }];
const current = { ...community, rules: permission, restricted: false, quarantined: false, submissionType: "any" };
beforeEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("conservative Reddit community classification", () => {
  it("does not treat relevance or missing rules as permission", () => {
    expect(classifyCommunity(community, []).status).toBe("needs_review");
    expect(classifyCommunity(community, [{ name: "Be nice", description: "Share your models" }]).status).toBe("needs_review");
  });
  it("requires explicit permission for AI and external links", () => {
    expect(classifyCommunity(community, permission).status).toBe("eligible");
    expect(classifyCommunity(community, [{ name: "Content", description: "AI models are allowed" }]).status).toBe("needs_review");
  });
  it.each(["No AI", "No promotion", "No external links", "Fanvue is banned", "AI models are not allowed", "No solicitation", "No self-promotion"])("blocks %s despite permission elsewhere", rule => {
    expect(classifyCommunity(community, [...permission, { name: rule, description: "" }]).status).toBe("blocked");
  });
  it.each(["AI models are allowed only after verification. Fanvue links are permitted.", "AI models are allowed. Fanvue links are permitted unless moderators object."])("does not infer unconditional permission from %s", description => {
    expect(classifyCommunity(community, [{ name: "Content", description }]).status).toBe("needs_review");
  });
  it.each([
    "Tilos a reklám és az önreklám. Nem lehet promóciót közzétenni.",
    "A Fanvue linkek megosztása nem engedélyezett. Külső linkek nem megengedettek.",
    "AI tartalom nem megengedett. A mesterséges intelligencia használata tilos.",
  ])("blocks explicit Hungarian prohibition: %s", description => {
    expect(classifyCommunity(community, [...permission, { name: "Szabályok", description }]).status).toBe("blocked");
  });
  it("does not treat unrelated Hungarian negatives as a promotion ban", () => {
    const description = "Tilos a sértegetés. Nem lehet másokat zaklatni. A reklám szabályait olvasd el.";
    expect(classifyCommunity(community, [{ name: "Szabályok", description }]).status).toBe("needs_review");
    expect(classifyCommunity(community, [...permission, { name: "Szabályok", description }]).status).toBe("eligible");
  });
  it("blocks relationship advice, personals, restricted communities", () => {
    expect(classifyCommunity({ ...community, name: "relationship_advice" }, permission).status).toBe("blocked");
    expect(classifyCommunity({ ...community, description: "A dating advice community" }, permission).status).toBe("blocked");
    expect(classifyCommunity({ ...community, description: "Personal matchmaking: r4r" }, permission).status).toBe("blocked");
    expect(classifyCommunity(community, permission, true).status).toBe("blocked");
  });
});
describe("read-only discovery", () => {
  it("uses bounded configurable queries", () => {
    expect(discoveryQueries()).toEqual(["AI models", "Fanvue", "AI model photography"]);
    vi.stubEnv("REDDIT_DISCOVERY_QUERIES", "dating|AI|photos|fanvue|ignored");
    expect(discoveryQueries()).toEqual(["dating", "AI", "photos", "fanvue"]);
  });
  it("deduplicates results and fetches current rules", async () => {
    vi.mocked(redditSearchSubreddits).mockResolvedValue([community, community]);
    vi.mocked(redditSubreddit).mockResolvedValue(current);
    const result = await discoverCommunities("test-access");
    expect(result).toHaveLength(1);
    expect(redditSubreddit).toHaveBeenCalledTimes(1);
    expect(result[0]).toMatchObject({ subreddit: "modelphotos", status: "eligible", rules: permission, over18: true });
  });
  it("never returns eligibility when a search fails", async () => {
    vi.mocked(redditSearchSubreddits).mockRejectedValueOnce(new Error("secret server error")).mockResolvedValue([community]);
    vi.mocked(redditSubreddit).mockResolvedValue(current);
    expect((await discoverCommunities("test-access"))[0].status).toBe("needs_review");
  });
  it("turns missing rules into review rather than permission", async () => {
    vi.mocked(redditSearchSubreddits).mockResolvedValue([community]);
    vi.mocked(redditSubreddit).mockRejectedValue(new Error("secret token"));
    const result = await discoverCommunities("test-access");
    expect(result[0].status).toBe("needs_review");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("uses current metadata rather than search descriptions", async () => {
    vi.mocked(redditSearchSubreddits).mockResolvedValue([community]);
    vi.mocked(redditSubreddit).mockResolvedValue({ ...current, description: "Relationship advice and support group" });
    expect((await discoverCommunities("test-access"))[0].status).toBe("blocked");
  });
  it("limits results to twelve even if the API returns more", async () => {
    vi.mocked(redditSearchSubreddits).mockResolvedValue(Array.from({ length: 20 }, (_, index) => ({ ...community, name: `models${index}` })));
    vi.mocked(redditSubreddit).mockResolvedValue(current);
    expect(await discoverCommunities("test-access")).toHaveLength(12);
    expect(redditSubreddit).toHaveBeenCalledTimes(12);
  });
  it("fails safely if all searches fail", async () => {
    vi.mocked(redditSearchSubreddits).mockRejectedValue(new Error("raw API payload"));
    await expect(discoverCommunities("test-access")).rejects.toThrow("REDDIT_DISCOVERY_SEARCH_FAILED");
  });
});

const characterId = "b44d9c84-76e7-44bf-8958-dac59688f98c";
function mockDatabase(results: unknown[]) {
  const query: Record<string, Mock> = {};
  for (const method of ["select", "eq", "or", "order", "update", "upsert", "limit"]) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => results.shift());
  const from = vi.fn(() => query);
  vi.mocked(serviceClient).mockReturnValue({ from } as unknown as ReturnType<typeof serviceClient>);
  return query;
}
function postRequest() { return new NextRequest("https://example.com/api/reddit/discover", { method: "POST", body: JSON.stringify({ characterId }) }); }
describe("discovery route isolation and cadence", () => {
  beforeEach(() => {
    vi.mocked(authed).mockResolvedValue({ id: "owner" } as Awaited<ReturnType<typeof authed>>);
    vi.mocked(redditApproved).mockReturnValue(true);
    vi.mocked(redditConfigured).mockReturnValue(true);
  });
  it("rejects unauthenticated requests before database access", async () => {
    vi.mocked(authed).mockResolvedValue(null);
    expect((await POST(postRequest())).status).toBe(401);
    expect((await GET(new NextRequest("https://example.com/api/reddit/discover"))).status).toBe(401);
    expect(serviceClient).not.toHaveBeenCalled();
  });
  it("does not use Reddit without API approval", async () => {
    vi.mocked(redditApproved).mockReturnValue(false);
    expect((await POST(postRequest())).status).toBe(503);
    expect(redditSearchSubreddits).not.toHaveBeenCalled();
  });
  it("requires an owned character", async () => {
    const query = mockDatabase([{ data: null, error: null }]);
    expect((await POST(postRequest())).status).toBe(404);
    expect(query.eq).toHaveBeenCalledWith("owner_id", "owner");
    expect(redditSearchSubreddits).not.toHaveBeenCalled();
  });
  it("enforces the 24-hour cooldown before any API call", async () => {
    mockDatabase([{ data: { id: characterId } }, { data: { id: "account", last_discovery_at: new Date().toISOString() } }]);
    expect((await POST(postRequest())).status).toBe(429);
    expect(redditSearchSubreddits).not.toHaveBeenCalled();
  });
  it("cannot run if another request holds the lease", async () => {
    const query = mockDatabase([{ data: { id: characterId } }, { data: { id: "account", last_discovery_at: null } }, { data: null, error: null }]);
    expect((await POST(postRequest())).status).toBe(409);
    expect(query.or).toHaveBeenCalledWith(expect.stringContaining("discovery_lease_until.is.null"));
    expect(query.or).toHaveBeenCalledWith(expect.stringContaining("last_discovery_at.is.null"));
    expect(redditSearchSubreddits).not.toHaveBeenCalled();
  });
});

describe("scheduled community discovery", () => {
  beforeEach(() => {
    vi.mocked(redditApproved).mockReturnValue(true);
    vi.mocked(redditConfigured).mockReturnValue(true);
  });
  it("does not touch the database until configuration and approval exist", async () => {
    vi.mocked(redditApproved).mockReturnValue(false);
    expect(await discoverDueCommunities()).toEqual({ checked: 0, candidates: 0 });
    expect(serviceClient).not.toHaveBeenCalled();
  });
  it("does no work if no account is due", async () => {
    const query = mockDatabase([{ data: null }]);
    expect(await discoverDueCommunities()).toEqual({ checked: 0, candidates: 0 });
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(redditSearchSubreddits).not.toHaveBeenCalled();
  });
  it("updates candidates without enabling or changing a posting destination", async () => {
    const query = mockDatabase([
      { data: { owner_id: "owner", character_id: characterId } },
      { data: { id: "account", last_discovery_at: null } },
      { data: { encrypted_access_token: "ciphertext", token_expires_at: new Date(Date.now() + 3_600_000).toISOString() } },
      { data: { id: "account" } },
    ]);
    vi.mocked(redditSearchSubreddits).mockResolvedValue([community]);
    vi.mocked(redditSubreddit).mockResolvedValue(current);
    expect(await discoverDueCommunities()).toEqual({ checked: 1, candidates: 1 });
    expect(query.upsert).toHaveBeenCalledWith([expect.objectContaining({ owner_id: "owner", character_id: characterId, status: "eligible" })], { onConflict: "owner_id,character_id,subreddit" });
    for (const [update] of query.update.mock.calls) {
      expect(update).not.toHaveProperty("enabled");
      expect(update).not.toHaveProperty("subreddit");
      expect(update).not.toHaveProperty("rules_confirmed");
    }
  });
});
