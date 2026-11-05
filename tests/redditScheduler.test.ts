import { createHash } from "crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), approved: vi.fn(), configured: vi.fn(), community: vi.fn(), submit: vi.fn(), upload: vi.fn(), caption: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: mocks.service }));
vi.mock("@/lib/contentAi", () => ({ questionForXImage: mocks.caption }));
vi.mock("@/server/reddit/client", () => ({
  redditApproved: mocks.approved, redditConfigured: mocks.configured,
  decrypt: (value: string) => value, encrypt: (value: string) => value,
  redditSubreddit: mocks.community, redditSubmitText: mocks.submit, refreshToken: mocks.refresh,
  RedditApiError: class extends Error { constructor(code: string, public ambiguous = false) { super(code); } },
}));
vi.mock("@/server/reddit/media", () => ({ uploadRedditImage: mocks.upload, buildRichTextPost: () => ({ document: [{ e: "img", id: "native123" }] }) }));
import { postDailyReddit } from "@/server/reddit/postDaily";
import { imagePerceptualHash } from "@/server/reddit/imageFingerprint";
import { RedditApiError } from "@/server/reddit/client";

type Row = Record<string, unknown>;
type QueryLog = { table: string; operation: string; fields: string; filters: [string, string, unknown][]; values?: Row };
let tables: Record<string, Row[]>;
let queries: QueryLog[];
let fault: (query: QueryLog) => { code: string } | undefined;
let download: ReturnType<typeof vi.fn>;
let imageBytes: Buffer;
const now = new Date("2026-11-04T12:05:00Z");
function database() {
  return {
    storage: { from: () => ({ download }) },
    from: (table: string) => {
      const query: QueryLog = { table, operation: "select", fields: "", filters: [] };
      let single = false;
      let disjunction = "";
      const builder = {
        select(fields = "") { query.fields = fields; return builder; },
        insert(values: Row) { query.operation = "insert"; query.values = values; return builder; },
        delete() { query.operation = "delete"; return builder; },
        update(values: Row) { query.operation = "update"; query.values = values; return builder; },
        eq(key: string, value: unknown) { query.filters.push(["eq", key, value]); return builder; },
        neq(key: string, value: unknown) { query.filters.push(["neq", key, value]); return builder; },
        is(key: string, value: unknown) { query.filters.push(["eq", key, value]); return builder; },
        not(key: string, _operator: string, value: unknown) { query.filters.push(["neq", key, value]); return builder; },
        in(key: string, values: unknown[]) { query.filters.push(["in", key, values]); return builder; },
        lt(key: string, value: unknown) { query.filters.push(["lt", key, value]); return builder; },
        gt(key: string, value: unknown) { query.filters.push(["gt", key, value]); return builder; },
        lte(key: string, value: unknown) { query.filters.push(["lte", key, value]); return builder; },
        or(expression: string) { disjunction = expression; return builder; },
        order() { return builder; }, limit() { return builder; },
        maybeSingle() { single = true; return builder; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          queries.push(structuredClone(query));
          const error = fault(query);
          if (error) return Promise.resolve({ data: null, error }).then(resolve, reject);
          const matches = (row: Row) => query.filters.every(([op, key, value]) => {
            if (op === "eq") return row[key] === value;
            if (op === "neq") return row[key] !== value && row[key] !== undefined;
            if (op === "in") return (value as unknown[]).includes(row[key]);
            if (op === "gt") return String(row[key]) > String(value);
            if (op === "lt") return String(row[key]) < String(value);
            return String(row[key]) <= String(value);
          });
          let rows = (tables[table] ?? []).filter(matches);
          if (disjunction) {
            const cutoff = disjunction.match(/created_at.lt.([^)]*)/)?.[1] ?? "";
            rows = rows.filter(row => row.status === "uncertain" || (row.status === "sending" && String(row.created_at) < cutoff));
          }
          if (query.operation === "insert") {
            if (table === "reddit_publishing_locks" && tables[table].some(row => row.owner_id === query.values?.owner_id)) return Promise.resolve({ data: null, error: { code: "23505" } }).then(resolve, reject);
            const row = { id: `claim-${tables[table].length}`, created_at: now.toISOString(), ...query.values };
            tables[table].push(row); rows = [row];
          }
          if (query.operation === "delete") tables[table] = tables[table].filter(row => !matches(row));
          if (query.operation === "update") rows.forEach(row => Object.assign(row, query.values));
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected live fetch in scheduler unit test"); })); vi.spyOn(console, "error").mockImplementation(() => {});
  queries = []; fault = () => undefined;
  mocks.approved.mockReturnValue(true); mocks.configured.mockReturnValue(true);
  mocks.community.mockResolvedValue({ restricted: false, quarantined: false, submissionType: "any", rules: [], over18: false });
  mocks.upload.mockResolvedValue({ assetId: "native123" });
  mocks.submit.mockResolvedValue({ id: "t3_test", permalink: "https://www.reddit.com/r/test/comments/test" });
  mocks.caption.mockResolvedValue({ question: "A quiet afternoon beside the window" });
  imageBytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#975734" } }).png().toBuffer();
  download = vi.fn().mockResolvedValue({ data: new Blob([new Uint8Array(imageBytes)]), error: null });
  tables = {
    reddit_publishing_locks: [],
    reddit_social_connections: [{ reddit_user_id: "reddit-account", id: "connection", owner_id: "owner", character_id: "character", reddit_username: "model", enabled: true,
      encrypted_access_token: "fake-access", encrypted_refresh_token: "fake-refresh", token_expires_at: "2099-01-01T00:00:00Z", timezone: "UTC", subreddit: "test", posting_minutes: [720, 960], rules_confirmed: true,
      rules_fingerprint: createHash("sha256").update("[]").digest("hex") }],
    reddit_social_posts: [], characters: [{ id: "character", owner_id: "owner", name: "Mira", status: "active" }],
    model_accounts: [{ owner_id: "owner", character_id: "character", platform: "fanvue", account_url: "https://fanvue.com/mira" }],
    gallery_items: [{ id: "gallery", owner_id: "owner", character_id: "character", content_category: "tiktok", deleted_at: null, used_at: now.toISOString(), qc_status: "accepted", assets: { bucket: "private", object_path: "owned-image.png", media_type: "image" } }],
  };
  mocks.service.mockReturnValue(database());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const claim = () => tables.reddit_social_posts.find(row => String(row.id).startsWith("claim-"));

describe("Reddit scheduler boundaries", () => {
  it.each(["approved", "configured"] as const)("makes no requests or DB reads when %s is false", async (gate) => {
    mocks[gate].mockReturnValue(false);
    expect(await postDailyReddit(now)).toEqual({ posted: 0, skipped: "REDDIT_NOT_READY" });
    expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.community).not.toHaveBeenCalled();
  });
  it("posts an owned image and the existing model Fanvue source once", async () => {
    expect(await postDailyReddit(now)).toMatchObject({ posted: 1, attempted: 1 });
    expect(claim()).toMatchObject({ status: "posted", fanvue_url: "https://fanvue.com/mira", gallery_item_id: "gallery" });
    const lookup = queries.find(q => q.table === "model_accounts");
    expect(lookup?.filters).toEqual(expect.arrayContaining([["eq", "owner_id", "owner"], ["eq", "character_id", "character"], ["eq", "platform", "fanvue"]]));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    await postDailyReddit(now); expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("does not submit when another runner owns the atomic slot", async () => {
    fault = query => query.table === "reddit_social_posts" && query.operation === "insert" ? { code: "23505" } : undefined;
    expect(await postDailyReddit(now)).toMatchObject({ posted: 0 });
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.community).not.toHaveBeenCalled();
  });
  it("records preparation failures without submitting or retrying the claimed slot", async () => {
    mocks.upload.mockRejectedValue(new Error("REDDIT_MEDIA_UPLOAD_400"));
    await postDailyReddit(now); await postDailyReddit(now);
    expect(claim()).toMatchObject({ status: "failed", error: "REDDIT_MEDIA_UPLOAD_400" });
    expect(mocks.upload).toHaveBeenCalledTimes(1); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("pauses when no owned Fanvue profile exists instead of inventing or using another owner's link", async () => {
    tables.model_accounts[0].owner_id = "other-owner";
    await postDailyReddit(now);
    expect(tables.reddit_social_connections[0]).toMatchObject({ enabled: false, pause_reason: "REDDIT_FANVUE_LINK_REQUIRED" });
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.community).not.toHaveBeenCalled();
  });
  it("does not claim or submit when another publisher owns the owner lease", async () => {
    tables.reddit_publishing_locks.push({ owner_id: "owner", lease_token: "other-worker", expires_at: "2099-01-01T00:00:00Z" });
    await postDailyReddit(now);
    expect(claim()).toBeUndefined(); expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.community).not.toHaveBeenCalled();
    expect(tables.reddit_publishing_locks[0].lease_token).toBe("other-worker");
  });
  it("recovers an expired owner lease and releases only its own lease after publication", async () => {
    tables.reddit_publishing_locks.push({ owner_id: "owner", lease_token: "expired-worker", expires_at: "2000-01-01T00:00:00Z" });
    await postDailyReddit(now);
    expect(mocks.submit).toHaveBeenCalledTimes(1); expect(tables.reddit_publishing_locks).toHaveLength(0);
    const release = queries.find(query => query.table === "reddit_publishing_locks" && query.operation === "delete");
    expect(release?.filters).toEqual(expect.arrayContaining([["eq", "owner_id", "owner"], ["eq", "lease_token", expect.any(String)]]));
  });
  it("does not submit or delete a replacement lease if its lease expires during preparation", async () => {
    mocks.upload.mockImplementationOnce(async () => {
      tables.reddit_publishing_locks[0].lease_token = "replacement-worker";
      tables.reddit_publishing_locks[0].expires_at = "2099-01-01T00:00:00Z";
      return { assetId: "native123" };
    });
    await postDailyReddit(now);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(claim()?.error).toBe("REDDIT_PUBLISH_LEASE_EXPIRED");
    expect(tables.reddit_publishing_locks[0].lease_token).toBe("replacement-worker");
  });
  it("rejects a lease that cannot cover the full submission timeout", async () => {
    mocks.upload.mockImplementationOnce(async () => {
      tables.reddit_publishing_locks[0].expires_at = new Date(Date.now() + 30_000).toISOString();
      return { assetId: "native123" };
    });
    await postDailyReddit(now);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(claim()?.error).toBe("REDDIT_PUBLISH_LEASE_EXPIRED");
  });
  it("rechecks unresolved outcomes after acquiring the owner lease", async () => {
    fault = query => {
      if (query.table === "reddit_publishing_locks" && query.operation === "insert") {
        tables.reddit_social_posts.push({ id: "racing-unknown", connection_id: null, owner_id: "owner", reddit_user_id: "reddit-account", status: "uncertain" });
      }
      return undefined;
    };
    await postDailyReddit(now);
    expect(claim()).toBeUndefined(); expect(mocks.submit).not.toHaveBeenCalled();
    expect(tables.reddit_social_connections[0]).toMatchObject({ enabled: false, pause_reason: "REDDIT_SUBMIT_OUTCOME_UNKNOWN" });
    expect(tables.reddit_publishing_locks).toHaveLength(0);
  });
  it("blocks unresolved prior publication even after disconnect and reconnect changes connection id", async () => {
    tables.reddit_social_posts.push({ id: "old-unknown", connection_id: null, owner_id: "owner", reddit_user_id: "reddit-account", status: "uncertain", local_date: "2026-11-03", slot: "12:00" });
    tables.reddit_social_connections[0].id = "reconnected";
    await postDailyReddit(now);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.community).not.toHaveBeenCalled();
    expect(tables.reddit_social_connections[0]).toMatchObject({ enabled: false, pause_reason: "REDDIT_SUBMIT_OUTCOME_UNKNOWN" });
  });
  it("does not submit after the user pauses during image preparation", async () => {
    mocks.upload.mockImplementationOnce(async () => {
      tables.reddit_social_connections[0].enabled = false;
      return { assetId: "native123" };
    });
    await postDailyReddit(now);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(claim()?.error).toBe("REDDIT_SETTINGS_CHANGED");
  });
  it("does not submit if the durable sending transition fails", async () => {
    fault = query => query.operation === "update" && query.values?.status === "sending" ? { code: "DB_UNAVAILABLE" } : undefined;
    await postDailyReddit(now);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(claim()?.status).toBe("failed");
  });
  it("marks uncertain submissions and pauses without retrying even at the next slot", async () => {
    mocks.submit.mockRejectedValue(new Error("network timeout"));
    await postDailyReddit(now); await postDailyReddit(new Date("2026-11-04T16:05:00Z"));
    expect(claim()).toMatchObject({ status: "uncertain" });
    expect(tables.reddit_social_connections[0]).toMatchObject({ enabled: false, pause_reason: "REDDIT_SUBMIT_OUTCOME_UNKNOWN" });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("marks a definite Reddit rejection failed rather than uncertain", async () => {
    mocks.submit.mockRejectedValue(new RedditApiError("REDDIT_BAD_TITLE", false));
    await postDailyReddit(now);
    expect(claim()).toMatchObject({ status: "failed" }); expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("marks success with failed DB recording uncertain and pauses", async () => {
    fault = query => query.operation === "update" && query.values?.status === "posted" ? { code: "DB_UNAVAILABLE" } : undefined;
    await postDailyReddit(now);
    expect(claim()).toMatchObject({ status: "uncertain" });
    expect(tables.reddit_social_connections[0].enabled).toBe(false);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("skips exact previously used image bytes", async () => {
    tables.reddit_social_posts.push({ id: "old", connection_id: "connection", owner_id: "owner", reddit_user_id: "reddit-account", image_sha256: createHash("sha256").update(imageBytes).digest("hex"), status: "posted", local_date: "2026-11-03", slot: "12:00" });
    await postDailyReddit(now);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(claim()?.error).toBe("REDDIT_NO_UNUSED_PUBLIC_IMAGE");
  });
  it("skips re-encoded visually duplicate images even when byte hashes differ", async () => {
    const olderEncoding = await sharp(imageBytes).jpeg({ quality: 50 }).toBuffer();
    expect(createHash("sha256").update(olderEncoding).digest("hex")).not.toBe(createHash("sha256").update(imageBytes).digest("hex"));
    tables.reddit_social_posts.push({ id: "old", connection_id: "connection", owner_id: "owner", reddit_user_id: "reddit-account", image_sha256: createHash("sha256").update(olderEncoding).digest("hex"), image_phash: await imagePerceptualHash(olderEncoding), status: "posted", local_date: "2026-11-03", slot: "12:00" });
    await postDailyReddit(now);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
    expect(claim()?.error).toBe("REDDIT_NO_UNUSED_PUBLIC_IMAGE");
  });
  it("leaves a prior crashed preparation unsubmitted and does not reuse its claimed image", async () => {
    tables.reddit_social_posts.push({ id: "crashed", connection_id: "connection", owner_id: "owner", reddit_user_id: "reddit-account", status: "preparing", gallery_item_id: "gallery", image_sha256: createHash("sha256").update(imageBytes).digest("hex"), local_date: "2026-11-04", slot: "08:00", created_at: "2026-11-04T08:00:00Z" });
    await postDailyReddit(now);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
    expect(tables.reddit_social_posts.find(row => row.id === "crashed")?.status).toBe("preparing");
  });
  it.each(["sending", "preparing"])("never resubmits a same-slot crashed %s record", async status => {
    tables.reddit_social_posts.push({ id: "crashed", connection_id: "connection", owner_id: "owner", reddit_user_id: "reddit-account", status, local_date: "2026-11-04", slot: "12:00", created_at: "2026-11-04T12:00:00Z" });
    await postDailyReddit(now); expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("does not publish a later slot while an earlier crashed sending outcome is unresolved", async () => {
    tables.reddit_social_posts.push({ id: "crashed", connection_id: "connection", owner_id: "owner", reddit_user_id: "reddit-account", status: "sending", local_date: "2026-11-04", slot: "08:00", created_at: "2026-11-04T08:00:00Z" });
    await postDailyReddit(now);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(tables.reddit_social_connections[0].enabled).toBe(false);
  });
});
