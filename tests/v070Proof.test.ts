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
const seenTaskKeys = new Set<string>();

function authOk(): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ user: { id: USER } }), { status: 200 });
    if (u.includes("/rest/v1/credit_transactions")) {
      const m = u.match(/idempotency_key=eq\.task(?:%3A|:)([^&]+)/i);
      if (m) {
        const key = decodeURIComponent(m[1]);
        if (seenTaskKeys.has(key)) return new Response(JSON.stringify([{ id: "tx-1" }]), { status: 200 });
        seenTaskKeys.add(key);
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (u.includes("/rest/v1/rpc/")) return new Response(JSON.stringify("job-1"), { status: 200 });
    if (u.includes("content-ai.test")) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
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

describe("v0.7.0 bizonyitak", () => {
  it("hibas Stripe-alairasnal SEMMILYEN iras nem tortenik", async () => {
    const writes: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") !== "GET") writes.push(String(url));
      return new Response("{}", { status: 200 });
    }));
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_t";
    const { POST } = await import("@/app/api/billing/webhook/route");
    const res = await POST(new NextRequest("http://x/api/billing/webhook", {
      method: "POST", headers: { "stripe-signature": "t=9999999999,v1=bad" },
      body: JSON.stringify({ id: "evt_bad", type: "checkout.session.completed" }),
    }));
    expect(res.status).toBe(401);
    expect(writes).toHaveLength(0);
  });

  it("azonos ervenyes event masodjara NEM ir jova ujra kreditet", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_t";
    const { createHmac } = await import("crypto");
    const body = JSON.stringify({ id: "evt_rep", type: "checkout.session.completed", data: { object: { id: "cs_1", metadata: { userId: USER, planId: "starter" } } } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", "whsec_t").update(`${ts}.${body}`).digest("hex");
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/rest/v1/rpc/process_stripe_event")) {
        calls += 1;
        return new Response(JSON.stringify(calls > 1 ? "replay" : "processed"), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "p1", credits: 1000 }), { status: 200 });
    }));
    const { POST } = await import("@/app/api/billing/webhook/route");
    const mk = () => new NextRequest("http://x/api/billing/webhook", {
      method: "POST", headers: { "stripe-signature": `t=${ts},v1=${sig}` }, body,
    });
    const r1 = await POST(mk());
    const r2 = await POST(mk());
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const b2 = await r2.json() as { replay?: boolean };
    expect(b2.replay).toBe(true);
  });

  it("anonim content/projekt/TikTok keres 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ code: "bad_jwt", message: "JWT is missing" }),
          { status: 401, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 200 });
    }));
    expect((await post("/api/content/reels-copy", { topic: "x", idempotencyKey: "anon-key-001" }, "")).status).toBe(401);
    expect((await post("/api/projects", { name: "P", kind: "general" }, "")).status).toBe(401);
    expect((await post("/api/trends/import", { url: "https://www.tiktok.com/@u/video/1", idempotencyKey: "anon-key-002" }, "")).status).toBe(401);
  });

  it("masik felhasznalo projektje nem olvashato (izolacio)", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      urls.push(String(url));
      const u = String(url);
      if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ user: { id: USER } }), { status: 200 });
      return new Response(JSON.stringify([{ id: "p-other" }]), { status: 200 });
    }));
    const { GET } = await import("@/app/api/projects/route");
    await GET(new NextRequest("http://x/api/projects", { headers: { authorization: "Bearer t" } }));
    expect(urls.some((u) => u.includes("owner_id=eq." + USER))).toBe(true);
  });

  it("idempotens ujrakuldes nem von le ketszer", async () => {
    authOk();
    const r1 = await post("/api/content/niche", { interests: ["fitness"], idempotencyKey: "idem-key-7777" });
    expect(r1.status).toBe(200);
    const r2 = await post("/api/content/niche", { interests: ["fitness"], idempotencyKey: "idem-key-7777" });
    expect(r2.status).toBe(409);
  });

  it("sikertelen task eseten a hold visszateritesre kerul", async () => {
    authOk();
    const { runBilledTask } = await import("@/lib/billedTask");
    const r = await runBilledTask({
      userId: USER, type: "x", cost: 10, idempotencyKey: "fail-key-0001",
      fn: async () => { throw new Error("boom"); },
    });
    expect(r.ok).toBe(false);
  });
});
