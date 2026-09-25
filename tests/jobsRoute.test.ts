// POST /api/jobs handler: fetch-stubbal emlélt Supabase válaszokkal (nincs élő DB).
// Bizonyítja: karakter nélkül 400; LoRA-hiba esetén nincs createJobWithHold/hold;
// sikeres injektálás; kliens loraPath felülíródik; Easy prompt szerveren készül;
// idegen assetnél nincs hold; imageSize/numImages megmarad.
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";

// A scheduling (production: next/server after()) mockolva – a callback kontrolláltan rögzítve.
const scheduleKickMock = vi.fn();
vi.mock("@/server/jobs/schedule", () => ({ scheduleKick: (...a: unknown[]) => scheduleKickMock(...a) }));

// Környezet mentése/visszaállítása – nincs globális szennyezés a többi teszt felé
const SAVED_ENV: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    SAVED_ENV[k] = process.env[k];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://stub";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
});
afterAll(() => {
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const USER = "11111111-1111-1111-1111-111111111111";
const CHAR = "22222222-2222-2222-2222-222222222222";
const VER = "33333333-3333-3333-3333-333333333333";

function harness(opts: {
  character?: unknown; version?: unknown; asset?: unknown; rpcError?: string; project?: unknown;
}) {
  const calls = {
    rpc: [] as string[], hold: false, insert: false,
    lastJobPayload: null as Record<string, unknown> | null,   // create_job_with_hold p_payload
    lastCharacter: null as string | null,
    lastProject: null as string | null,
    lastKey: null as string | null,
  };
  const seenKeys = new Set<string>();   // a valós unique(idempotency_key) emulálása
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    // auth: a Bearer token elfogadva, felhasználó visszaadva
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: USER, email: "u@x.hu" }), { status: 200 });
    }
    if (method === "POST" && u.includes("/auth/v1/token")) {
      return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
    }
    // PostgREST REST hívások
    if (u.includes("/rest/v1/profiles")) {
      return new Response(JSON.stringify({ id: USER, age_verified_at: "2024-01-01T00:00:00Z" }), { status: 200 });
    }
    if (u.includes("/rest/v1/characters")) {
      return new Response(JSON.stringify(opts.character ?? null), { status: 200 });
    }
    if (u.includes("/rest/v1/projects")) {
      return new Response(JSON.stringify(opts.project ?? null), { status: 200 });
    }
    if (u.includes("/rest/v1/character_versions")) {
      return new Response(JSON.stringify(opts.version ?? null), { status: 200 });
    }
    if (u.includes("/rest/v1/assets")) {
      return new Response(JSON.stringify(opts.asset ?? null), { status: 200 });
    }
    // RPC
    if (u.includes("/rest/v1/rpc/")) {
      const fn = u.split("/rpc/")[1].split("?")[0];
      calls.rpc.push(fn);
      if (fn === "create_job_with_hold") {
        calls.hold = true;
        if (opts.rpcError) return new Response(JSON.stringify({ message: opts.rpcError }), { status: 400 });
        // valós unique constraint emuláció: ugyanaz a p_key → duplicate key hiba (a route 409-et ad)
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(String(init?.body ?? "{}")); } catch { /* ignore */ }
        const key = String(body.p_key ?? "");
        if (key && seenKeys.has(key)) {
          return new Response(JSON.stringify({ message: 'duplicate key value violates unique constraint "generation_jobs_idempotency_key_key"' }), { status: 400 });
        }
        if (key) seenKeys.add(key);
        calls.lastProject = body.p_project == null ? null : String(body.p_project);
        calls.lastJobPayload = (body.p_payload ?? null) as Record<string, unknown>;
        calls.lastCharacter = body.p_character == null ? null : String(body.p_character);
        calls.lastKey = key || null;
        return new Response(JSON.stringify("job-1"), { status: 200 });
      }
      if (fn === "credit_hold") { calls.hold = true; return new Response(JSON.stringify(true), { status: 200 }); }
      return new Response(JSON.stringify(true), { status: 200 });
    }
    if (u.includes("/storage/v1")) {
      return new Response(JSON.stringify({ signedUrl: "https://signed/x" }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }));
  return { calls };
}

async function post(body: Record<string, unknown>): Promise<Response> {
  const { POST } = await import("@/app/api/jobs/route");
  return POST(new NextRequest("http://localhost/api/jobs", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}
afterEach(() => { vi.unstubAllGlobals(); scheduleKickMock.mockClear(); });

const ACTIVE = { id: CHAR, owner_id: USER, status: "active", active_version_id: VER };
const FAL_VER = { id: VER, provider: "fal", provider_model_ref: "https://v3.fal.media/w/x.bin", status: "approved" };

describe("POST /api/jobs – route handler (fetch-stub)", () => {
  it("image_generation karakter nélkül → 400, nincs hold", async () => {
    const { calls } = harness({});
    const res = await post({ type: "image_generation", payload: { prompt: "x" } });
    expect(res.status).toBe(400);
    expect(calls.hold).toBe(false);
    expect(scheduleKickMock).not.toHaveBeenCalled();   // scheduling sem történhet
  });
  it("inaktív karakter → 409 CHARACTER_NOT_ACTIVE, nincs hold/createJob", async () => {
    const { calls } = harness({ character: { ...ACTIVE, status: "draft" } });
    const res = await post({ type: "image_generation", characterId: CHAR, payload: { prompt: "x" } });
    expect(res.status).toBe(409);
    const b = await res.json() as { error: string };
    expect(b.error).toBe("CHARACTER_NOT_ACTIVE");
    expect(calls.rpc).not.toContain("create_job_with_hold");
    expect(calls.hold).toBe(false);
    expect(scheduleKickMock).not.toHaveBeenCalled();   // createJobWithHold hiba → nincs scheduling
  });
  it("sikeres injektálás: loraPath a SZERVERÉ, kliensé felülíródik; Easy prompt szerveren készül", async () => {
    const { calls } = harness({ character: ACTIVE, version: FAL_VER });
    const res = await post({
      type: "image_generation", characterId: CHAR,
      payload: {
        mode: "easy", scene: "portré", pose: "félprofil",
        loraPath: "https://evil.example/fake.bin",   // kliens hamis értéke
        imageSize: "portrait_4_3", numImages: 2,
      },
    });
    expect(res.status).toBe(202);
    expect(calls.rpc).toContain("create_job_with_hold");
    expect(calls.hold).toBe(true);
    expect(scheduleKickMock).toHaveBeenCalledTimes(1);   // PONTOSAN egyszer ütemezve
    expect(scheduleKickMock).toHaveBeenCalledWith("job-1");
    // ---- TELJES ÚT: a create_job_with_hold PAYLOAD-ja a SZERVER által összeállított ----
    expect(calls.lastJobPayload).toMatchObject({
      prompt: "portré, félprofil",                 // SZERVEROLDALI builder kimenete
      imageSize: "portrait_4_3",
      numImages: 2,
      mode: "easy",
    });
    expect(String(calls.lastJobPayload?.loraPath)).toBe("https://v3.fal.media/w/x.bin");
    expect(calls.lastJobPayload?.loraPath).not.toBe("https://evil.example/fake.bin");  // kliens hamis értéke
    expect(calls.lastCharacter).toBe(CHAR);
    expect(calls.lastKey).toBeTruthy();
  });
  it("saját projectId továbbmegy; idegen → 403; hibás → 400; projectId nélkül is működik", async () => {
    const own = "44444444-4444-4444-4444-444444444444";
    const foreign = "55555555-5555-5555-5555-555555555555";
    // saját
    let { calls } = harness({ character: ACTIVE, version: FAL_VER, project: { id: own } });
    let res = await post({ type: "image_generation", characterId: CHAR, projectId: own, payload: { prompt: "x" } });
    expect(res.status).toBe(202);
    expect(calls.lastProject).toBe(own);
    // idegen
    ({ calls } = harness({ character: ACTIVE, version: FAL_VER, project: null }));
    res = await post({ type: "image_generation", characterId: CHAR, projectId: foreign, payload: { prompt: "x" } });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe("PROJECT_NOT_OWNED");
    expect(calls.hold).toBe(false);
    // hibás UUID
    ({ calls } = harness({ character: ACTIVE, version: FAL_VER }));
    res = await post({ type: "image_generation", characterId: CHAR, projectId: "nem-uuid", payload: { prompt: "x" } });
    expect(res.status).toBe(400);
    // projectId nélkül továbbra is megy
    ({ calls } = harness({ character: ACTIVE, version: FAL_VER }));
    res = await post({ type: "image_generation", characterId: CHAR, payload: { prompt: "x" } });
    expect(res.status).toBe(202);
    expect(calls.lastProject).toBeNull();
  });

  it("kliens loraPath KIZÁRÓDIK: karakterrel felülírva, karakter nélkül eltávolítva", async () => {
    const { calls } = harness({ character: ACTIVE, version: FAL_VER });
    await post({ type: "image_generation", characterId: CHAR,
      payload: { prompt: "x", loraPath: "https://evil.example/fake", activeVersionId: "hack" } });
    expect(calls.lastJobPayload?.loraPath).toBe("https://v3.fal.media/w/x.bin");  // SZERVER értéke
    expect(calls.lastJobPayload?.activeVersionId).toBe("33333333-3333-3333-3333-333333333333");
    // image_edit karakter nélkül: a kliens loraPath-ja NEM maradhat meg
    const { calls: calls2 } = harness({ asset: { id: "asset-1", bucket: "assets", object_path: "u/a.png" } });
    const res2 = await post({ type: "image_edit", payload: { prompt: "x", imageAssetIds: ["asset-1"], loraPath: "https://evil.example/fake" } });
    expect(res2.status).toBe(202);
    expect(calls2.lastJobPayload?.loraPath).toBeUndefined();
  });

  it("idegen asset image_editnél → elutasítás hold nélkül", async () => {
    const { calls } = harness({ asset: undefined });   // asset lekérdezés üres → idegen/nem létező
    const res = await post({ type: "image_edit", payload: { prompt: "x", imageAssetIds: ["idegen-1"] } });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe("IMAGE_INPUT_REQUIRED");
    expect(calls.hold).toBe(false);
  });
  it("azonos idempotency kulccsal a job nem ütemeződik kétszer", async () => {
    const { calls } = harness({ character: ACTIVE, version: FAL_VER });
    const body = { type: "image_generation", characterId: CHAR, payload: { prompt: "x" }, idempotencyKey: "same-key-123" };
    expect((await post(body)).status).toBe(202);
    expect((await post(body)).status).toBe(409);        // JOB_ALREADY_EXISTS
    expect(calls.rpc.filter((f) => f === "create_job_with_hold")).toHaveLength(2);
    expect(scheduleKickMock).toHaveBeenCalledTimes(1);  // dupla kérés ellenére egyszer
  });
  it("scheduling-hiba: nincs hamis 202, a hiba nem tűnik el, 1 job, nincs második scheduling", async () => {
    const { calls } = harness({ character: ACTIVE, version: FAL_VER });
    scheduleKickMock.mockImplementationOnce(() => { throw new Error("SCHEDULE_FAILED"); });
    const res = await post({ type: "image_generation", characterId: CHAR, payload: { prompt: "x" } });
    // fail-fast: a scheduling hiba 500 (nem hamis 202, nem átomló kivétel)
    expect(res.status).toBe(500);
    expect((await res.json() as { error: string }).error).toBe("JOB_SCHEDULING_FAILED");
    expect(calls.rpc.filter((f) => f === "create_job_with_hold")).toHaveLength(1);  // pontosan 1 job
    expect(scheduleKickMock).toHaveBeenCalledTimes(1);                              // nincs második scheduling
    // dokumentált viselkedés: a queued maradt jobot a REAPER később felveszi (queued → retry → requeue)
  });
  it("DB-hiba (INSUFFICIENT_CREDITS) → 402, a hiba nem rejtőzik", async () => {
    const { calls } = harness({ character: ACTIVE, version: FAL_VER, rpcError: "INSUFFICIENT_CREDITS" });
    const res = await post({ type: "image_generation", characterId: CHAR, payload: { prompt: "x" } });
    expect(res.status).toBe(402);
    expect(calls.rpc).toContain("create_job_with_hold");
    expect(scheduleKickMock).not.toHaveBeenCalled();    // hold-hiba → scheduling nélkül
  });
});
