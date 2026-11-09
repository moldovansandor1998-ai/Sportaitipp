import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const scheduled = vi.hoisted(() => vi.fn());
vi.mock("@/server/jobs/schedule", () => ({ scheduleKick: scheduled }));
import { assertCreationAllowed } from "@/lib/security/creationAccess";
import { holdCredits, createJobWithHold } from "@/lib/credits/rpc";
import { prepareValidatedJobInput } from "@/server/jobs/prepareJob";
import { runBilledTask } from "@/lib/billedTask";
import { runClaimedJob, type JobRow } from "@/server/jobs/runJob";
import { POST as create } from "@/app/api/jobs/route";
import { POST as quote } from "@/app/api/jobs/estimate/route";
import type { buildRouter } from "@/lib/providers";

const USER = "11111111-1111-4111-8111-111111111111";
const OWNER = "56413297-fc33-4c66-ba2f-25371a40202e";
const ASSET = "22222222-2222-4222-8222-222222222222";
let user: string, banned: string | null, reviewed: Set<string>, memberships: string[];
let failing: string | undefined, missingProfile: boolean;
let calls: Array<{ url: URL; method: string; body: Record<string, unknown> }>;
const jobInput = () => ({ userId: user, type: "image_edit", payload: { imageUrls: ["https://example.test/image.jpg"], prompt: "blue sky" }, idempotencyKey: "once", costEstimate: user === OWNER ? 40 : 70 });
const body = () => ({ type: "image_edit", payload: { imageAssetIds: [ASSET], prompt: "blue sky" }, maxCredits: user === OWNER ? 40 : 70 });
const request = (endpoint: string) => new NextRequest(`https://example.test/api/${endpoint}`, {
  method: "POST", headers: { authorization: "Bearer verified-user-token", "content-type": "application/json" }, body: JSON.stringify(body()),
});
const rpcNames = () => calls.filter(c => c.url.pathname.includes("/rpc/")).map(c => c.url.pathname.split("/rpc/")[1]);

beforeEach(() => {
  user = USER; banned = null; reviewed = new Set(); memberships = ["mem_one"];
  failing = undefined; missingProfile = false; calls = []; scheduled.mockClear();
  vi.stubEnv("CREATION_OPERATING_TARIFF_ENABLED", "true");
  vi.stubEnv("WAVESPEED_API_KEY", "fixture");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture");
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); const path = url.pathname;
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (failing && path.endsWith("/" + failing)) return Response.json({ message: "private database failure" }, { status: 400 });
    if (path === "/auth/v1/user") return Response.json({ id: user, email: "fixture@example.test", email_confirmed_at: "2026-01-01", is_anonymous: false });
    if (path === "/rest/v1/profiles") return Response.json(missingProfile ? null : { banned_until: banned, age_verified_at: "2026-01-01" });
    if (path === "/rest/v1/whop_card_memberships") {
      expect(url.searchParams.get("whop_card_bindings.user_id")).toBe("eq." + user);
      expect(url.searchParams.get("select")).toBe("membership_id,whop_card_bindings!inner(user_id)");
      const after = url.searchParams.get("membership_id")?.slice(3) ?? "";
      return Response.json(memberships.filter(id => id > after).sort().slice(0, 100)
        .map(membership_id => ({ membership_id, whop_card_bindings: { user_id: user } })));
    }
    if (path === "/rest/v1/whop_card_reviews") {
      const ids = url.searchParams.get("membership_id")!.slice(4, -1).split(",").map(id => id.replaceAll('"', ""));
      return Response.json(ids.some(id => reviewed.has(id)) ? [{ payment_id: "pay_reviewed" }] : []);
    }
    if (path === "/rest/v1/assets") return Response.json({ bucket: "assets", object_path: "owned/input.jpg" });
    if (path.startsWith("/storage/v1/object/sign/")) return Response.json({ signedURL: "/object/sign/assets/owned/input.jpg?token=fixture" });
    if (path === "/rest/v1/credit_transactions") return Response.json(null);
    if (path === "/rest/v1/generation_jobs" && method === "PATCH") return Response.json([{ id: "job" }]);
    if (path === "/rest/v1/rpc/create_job_with_hold") return Response.json("job");
    if (path.startsWith("/rest/v1/rpc/")) return Response.json(true);
    throw new Error("Unexpected external call: " + path);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("persisted creation access", () => {
  it.each(["refund", "dispute"])("denies a %s review before quote, reservation and direct preparation", async () => {
    reviewed.add("mem_one");
    for (const [route, endpoint] of [[quote, "jobs/estimate"], [create, "jobs"]] as const) {
      const response = await route(request(endpoint));
      expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: "PAYMENT_REVIEW" });
    }
    expect(await prepareValidatedJobInput({ userId: USER, type: "image_edit", payload: body().payload }))
      .toMatchObject({ error: "PAYMENT_REVIEW", status: 403 });
    await expect(createJobWithHold(jobInput())).rejects.toMatchObject({ code: "PAYMENT_REVIEW" });
    await expect(holdCredits(user, "job", 70)).rejects.toMatchObject({ code: "PAYMENT_REVIEW" });
    expect(rpcNames()).toEqual([]); expect(scheduled).not.toHaveBeenCalled();
    expect(calls.some(c => c.url.pathname.startsWith("/storage/"))).toBe(false);
  });
  it.each([USER, OWNER])("denies banned Bearer identity %s, including price-exempt owner", async id => {
    user = id; banned = "2999-01-01T00:00:00Z";
    const response = await create(request("jobs"));
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: "ACCOUNT_UNAVAILABLE" });
    await expect(createJobWithHold(jobInput())).rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" });
    expect(rpcNames()).toEqual([]); expect(scheduled).not.toHaveBeenCalled();
  });
  it.each([USER, OWNER])("preserves legitimate creation and exact-owner pricing for %s", async id => {
    user = id; reviewed.add("mem_other_user");
    const response = await create(request("jobs"));
    expect(response.status).toBe(202);
    const reservation = calls.find(c => c.url.pathname.endsWith("/rpc/create_job_with_hold"));
    expect(reservation?.body.p_estimated).toBe(id === OWNER ? 20 : 70);
    expect(reservation?.body.p_owner).toBe(id);
    expect(scheduled).toHaveBeenCalledOnce();
  });
  it("retains owner pricing exemption without a payment-review exemption", async () => {
    user = OWNER; reviewed.add("mem_one");
    await expect(createJobWithHold(jobInput())).rejects.toMatchObject({ code: "PAYMENT_REVIEW" });
    const fn = vi.fn();
    expect(await runBilledTask({ userId: user, type: "caption", cost: 1, idempotencyKey: "task", fn }))
      .toEqual({ ok: false, error: "PAYMENT_REVIEW" });
    expect(fn).not.toHaveBeenCalled(); expect(rpcNames()).toEqual([]);
  });
  it.each(["profiles", "whop_card_memberships", "whop_card_reviews"])("fails closed on %s lookup errors without revealing details or cost zero", async table => {
    failing = table;
    for (const [route, endpoint] of [[quote, "jobs/estimate"], [create, "jobs"]] as const) {
      const response = await route(request(endpoint));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "CREATION_ACCESS_UNAVAILABLE" });
    }
    await expect(createJobWithHold(jobInput())).rejects.toMatchObject({ code: "CREATION_ACCESS_UNAVAILABLE" });
    expect(rpcNames()).toEqual([]); expect(scheduled).not.toHaveBeenCalled();
  });
  it("does not treat missing profiles or invalid ban values as permission", async () => {
    missingProfile = true;
    await expect(assertCreationAllowed(user)).rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" });
    missingProfile = false; banned = "not-a-date";
    await expect(assertCreationAllowed(user)).rejects.toMatchObject({ code: "CREATION_ACCESS_UNAVAILABLE" });
  });
  it("permits expired bans and accounts without card memberships", async () => {
    memberships = []; banned = "2020-01-01T00:00:00Z";
    await expect(assertCreationAllowed(user)).resolves.toBeUndefined();
  });
  it("checks reviews beyond the first membership page", async () => {
    memberships = Array.from({ length: 101 }, (_, i) => `mem_${String(i).padStart(3, "0")}`);
    reviewed.add("mem_100");
    await expect(assertCreationAllowed(user)).rejects.toMatchObject({ code: "PAYMENT_REVIEW" });
    expect(calls.filter(c => c.url.pathname.endsWith("/whop_card_reviews"))).toHaveLength(2);
  });
});

const job = (): JobRow => ({ id: "job", owner_id: user, type: "image_edit", character_id: null,
  payload: {}, provider: null, provider_job_id: null, cost_estimate: 70, idempotency_key: "once", status: "submitted" });
const router = (onEstimate?: () => void) => {
  const submit = vi.fn(async () => ({ adapter: { name: "wavespeed" }, providerJobId: "existing-provider-job", providerMeta: {} }));
  const result = { candidates: vi.fn(() => [{}]), estimate: vi.fn(async () => { onEstimate?.(); return { credits: 70 }; }), submit };
  return { result, override: result as unknown as ReturnType<typeof buildRouter> };
};
describe("first provider submission boundary", () => {
  it.each(["ban", "refund", "dispute", "lookup error"])("pauses unsent job for %s without changing holds, media or models", async reason => {
    if (reason === "ban") banned = "2999-01-01T00:00:00Z";
    else if (reason === "lookup error") failing = "whop_card_reviews";
    else reviewed.add("mem_one");
    const r = router(); await runClaimedJob(job(), r.override);
    expect(r.result.submit).not.toHaveBeenCalled(); expect(rpcNames()).toEqual([]);
    const writes = calls.filter(c => c.method !== "GET");
    expect(writes).toHaveLength(1); expect(writes[0].url.pathname).toBe("/rest/v1/generation_jobs");
    expect(Object.keys(writes[0].body)).toEqual(["error"]);
  });
  it("rechecks a review that arrives during estimation before submission rights", async () => {
    const r = router(() => reviewed.add("mem_one"));
    await runClaimedJob({ ...job(), payload: { __operatingTariff: "card-usd-2026-11-09-v1" } }, r.override);
    expect(r.result.estimate).toHaveBeenCalledOnce(); expect(r.result.submit).not.toHaveBeenCalled(); expect(rpcNames()).toEqual([]);
  });
  it("submits an allowed job once", async () => {
    const r = router(); await runClaimedJob(job(), r.override);
    expect(r.result.submit).toHaveBeenCalledOnce();
    expect(rpcNames()).toEqual(["begin_provider_submission", "record_provider_submission"]);
  });
  it.each(["ban", "review", "lookup error"])("preserves already-submitted recovery despite %s", async reason => {
    if (reason === "ban") banned = "2999-01-01T00:00:00Z";
    if (reason === "review") reviewed.add("mem_one");
    if (reason === "lookup error") failing = "profiles";
    const r = router();
    await runClaimedJob({ ...job(), provider: "wavespeed", provider_job_id: "existing-provider-job" }, r.override);
    expect(r.result.submit).not.toHaveBeenCalled(); expect(rpcNames()).toEqual([]);
    expect(calls).toHaveLength(1); expect(calls[0].body).toEqual({ status: "processing" });
  });
});
