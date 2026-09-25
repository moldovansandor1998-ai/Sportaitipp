// /api/jobs/estimate: NEM foglal, NEM von le kreditet; árparitás a tényleges job-létrehozással.
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";

const SAVED_ENV: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) SAVED_ENV[k] = process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://stub";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
});
afterAll(() => {
  for (const [k, v] of Object.entries(SAVED_ENV)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
afterEach(() => vi.unstubAllGlobals());

const USER = "11111111-1111-1111-1111-111111111111";
const CHAR = "22222222-2222-2222-2222-222222222222";
const ACTIVE = { id: CHAR, owner_id: USER, status: "active", active_version_id: "33333333-3333-3333-3333-333333333333" };
const FAL_VER = { id: "33333333-3333-3333-3333-333333333333", provider: "fal", provider_model_ref: "https://v3.fal.media/w/x.bin", status: "approved" };

function harness(): { rpc: string[] } {
  const calls = { rpc: [] as string[] };
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: USER }), { status: 200 });
    if (u.includes("/rest/v1/profiles")) return new Response(JSON.stringify({ id: USER, age_verified_at: "2024-01-01T00:00:00Z" }), { status: 200 });
    if (u.includes("/rest/v1/character_versions")) return new Response(JSON.stringify(FAL_VER), { status: 200 });
    if (u.includes("/rest/v1/characters")) return new Response(JSON.stringify(ACTIVE), { status: 200 });
    if (u.includes("/rest/v1/rpc/")) { calls.rpc.push(u.split("/rpc/")[1].split("?")[0]); return new Response("true", { status: 200 }); }
    return new Response("{}", { status: 200 });
  }));
  return calls;
}
async function postEstimate(body: Record<string, unknown>): Promise<Response> {
  const { POST } = await import("@/app/api/jobs/estimate/route");
  return POST(new NextRequest("http://localhost/api/jobs/estimate", {
    method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

describe("/api/jobs/estimate", () => {
  it("becslés: NINCS credit_hold és NINCS create_job_with_hold – semmi nem vonódik le", async () => {
    const calls = harness();
    const res = await postEstimate({ type: "image_generation", characterId: CHAR, payload: { prompt: "portré" } });
    expect(res.status).toBe(200);
    const b = await res.json() as { credits: number; secondsExpected: number };
    expect(b.credits).toBeGreaterThan(0);
    expect(calls.rpc).not.toContain("credit_hold");
    expect(calls.rpc).not.toContain("create_job_with_hold");
  });
  it("árparitás: ugyanaz a payload → ugyanaz az ár a router.estimate-ben (a job-létrehozás is ezt használja)", async () => {
    harness();
    const res = await postEstimate({ type: "image_generation", characterId: CHAR, payload: { prompt: "x", numImages: 2 } });
    const { credits } = await res.json() as { credits: number };
    // ugyanaz a becslő réteg: a jobs route ugyanígy buildRouter().estimate(...)-et hív –
    // a paritást a providerCredits teszt (mock adapter) és ez a közös út bizonyítja
    const { buildRouter } = await import("@/lib/providers");
    const router = buildRouter();
    const est = await router.estimate("image_generation", { prompt: "x", numImages: 2, loraPath: "https://v3.fal.media/w/x.bin" });
    expect(credits).toBe(est.credits);
  });
  it("LoRA-hiba esetén 409 (nem becsül hamis árra idegen karakterre)", async () => {
    const calls = harness();
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: USER }), { status: 200 });
      if (u.includes("/rest/v1/profiles")) return new Response(JSON.stringify({ id: USER, age_verified_at: "2024-01-01T00:00:00Z" }), { status: 200 });
      if (u.includes("/rest/v1/characters")) return new Response(JSON.stringify({ ...ACTIVE, owner_id: "masik" }), { status: 200 });
      return new Response("null", { status: 200 });
    }));
    void calls;
    const res = await postEstimate({ type: "image_generation", characterId: CHAR, payload: { prompt: "x" } });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe("CHARACTER_NOT_OWNED");
  });
});
