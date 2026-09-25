import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";

const SAVED: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CONTENT_AI_API_URL", "CONTENT_AI_API_KEY", "CONTENT_AI_MODEL"]) SAVED[k] = process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://stub";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.CONTENT_AI_API_URL = "https://content-ai.test/chat";
  process.env.CONTENT_AI_API_KEY = "test";
  process.env.CONTENT_AI_MODEL = "test-model";
});
afterAll(() => { for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
afterEach(() => vi.unstubAllGlobals());

const USER = "11111111-1111-1111-1111-111111111111";
function baseStub(): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) {
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      if (auth !== "Bearer t") {
        return new Response(JSON.stringify({ code: "bad_jwt", message: "JWT is missing" }),
          { status: 401, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ user: { id: USER } }), { status: 200 });
    }
    if (u.includes("/rest/v1/credit_transactions")) return new Response(JSON.stringify([]), { status: 200 });
    if (u.includes("/rest/v1/rpc/")) return new Response(JSON.stringify("job-1"), { status: 200 });
    if (u.includes("/rest/v1/plans")) return new Response(JSON.stringify({ id: "starter", credits: 1000, price_huf: 4900, name: "Starter" }), { status: 200 });
    if (u.includes("content-ai.test")) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      hook: "Hook", script: ["Scene"], caption: "Caption", hashtags: ["tag"],
      trends: [{ title: "Trend", platform: "tiktok", score: 80, why: "Reason" }],
      ideas: [{ niche: "Niche", angle: "Angle", monetization: "Affiliate", difficulty: "easy" }],
    }) } }] }), { status: 200 });
    return new Response("{}", { status: 200 });
  }));
}
async function post(path: string, body: Record<string, unknown>, token = "t"): Promise<Response> {
  const mod = await import(`@/app${path}/route`);
  return mod.POST(new NextRequest(`http://localhost${path}`, {
    method: "POST", headers: { authorization: token ? `Bearer ${token}` : "", "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

describe("content API-k", () => {
  it("401 anonimnak; 400 érvénytelen body; 200 érvényes reels-copy", async () => {
    baseStub();
    expect((await post("/api/content/reels-copy", { topic: "x", idempotencyKey: "test-key-0001" }, "")).status).toBe(401);
    baseStub();
    expect((await post("/api/content/reels-copy", { topic: "", idempotencyKey: "test-key-0002" })).status).toBe(400);
    baseStub();
    expect((await post("/api/content/reels-copy", { topic: "AI videók", idempotencyKey: "test-key-0003" })).status).toBe(200);
  });
  it("niche és trends 200; carousel 201 érvényes bodyval", async () => {
    baseStub();
    expect((await post("/api/content/niche", { interests: ["fitness"], idempotencyKey: "test-key-0004" })).status).toBe(200);
    baseStub();
    expect((await post("/api/content/trends", { niche: "fitness", idempotencyKey: "test-key-0005" })).status).toBe(200);
    baseStub();
    expect((await post("/api/content/carousel", { title: "T", bullets: ["a"], idempotencyKey: "test-key-0006" })).status).toBe(201);
  });
});

describe("TikTok-import", () => {
  it("nem-tiktok URL → 400; tiktok URL mockolt oEmbed-del → 201", async () => {
    baseStub();
    expect((await post("/api/trends/import", { url: "https://evil.example/x", idempotencyKey: "test-key-0007" })).status).toBe(400);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ user: { id: USER } }), { status: 200 });
      if (u.includes("/rest/v1/credit_transactions")) return new Response(JSON.stringify([]), { status: 200 });
      if (u.includes("/rest/v1/rpc/")) return new Response(JSON.stringify("job-1"), { status: 200 });
      if (u.includes("/rest/v1/viral_trends")) return new Response(JSON.stringify({ id: "t-1" }), { status: 201 });
      if (u.includes("tiktok.com/oembed")) return new Response(JSON.stringify({ title: "TikTok cím", author_name: "user" }), { status: 200 });
      return new Response("{}", { status: 200 });
    }));
    expect((await post("/api/trends/import", { url: "https://www.tiktok.com/@u/video/123", idempotencyKey: "test-key-0008" })).status).toBe(201);
  });
});

describe("projektek CRUD", () => {
  it("201 létrehozás; 400 érvénytelen kind", async () => {
    baseStub();
    expect((await post("/api/projects", { name: "P1", kind: "general" })).status).toBe(201);
    baseStub();
    expect((await post("/api/projects", { name: "", kind: "general" })).status).toBe(400);
  });
});

describe("Stripe webhook", () => {
  it("hiányzó titok → 500; hamis aláírás → 401", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { POST } = await import("@/app/api/billing/webhook/route");
    const r1 = await POST(new NextRequest("http://x/api/billing/webhook", { method: "POST", body: "{}" }));
    expect(r1.status).toBe(500);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const { POST: POST2 } = await import("@/app/api/billing/webhook/route");
    const r2 = await POST2(new NextRequest("http://x/api/billing/webhook", {
      method: "POST", headers: { "stripe-signature": "t=1,v1=bad" }, body: JSON.stringify({ id: "evt_1", type: "checkout.session.completed" }),
    }));
    expect(r2.status).toBe(401);
  });
});

describe("admin users", () => {
  it("nem admin → 403", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ user: { id: USER } }), { status: 200 });
      if (u.includes("/rest/v1/profiles")) return new Response(JSON.stringify({ id: USER, role: "user" }), { status: 200 });
      return new Response("{}", { status: 200 });
    }));
    const { POST } = await import("@/app/api/admin/users/route");
    expect((await POST(new NextRequest("http://x/api/admin/users", {
      method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify({ userId: USER, action: "ban" }),
    }))).status).toBe(403);
  });
});
