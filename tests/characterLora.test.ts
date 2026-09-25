import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { validateLoraRef } from "@/lib/jobs/characterLora";

const SAVED_ENV: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) SAVED_ENV[k] = process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
});
afterAll(() => {
  for (const [k, v] of Object.entries(SAVED_ENV)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
afterEach(() => vi.unstubAllGlobals());

const USER = "u1";
function harness(chRow: unknown, verRow: unknown): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = String(url);
    // postgrest-js .single() → application/vnd.pgrst.object+json → OBJEKTUM a válasz
    if (u.includes("/rest/v1/character_versions")) {
      return new Response(JSON.stringify(verRow ?? null), { status: 200 });
    }
    if (u.includes("/rest/v1/characters")) {
      return new Response(JSON.stringify(chRow ?? null), { status: 200 });
    }
    return new Response("null", { status: 200 });
  }));
}
async function load() { return (await import("@/lib/jobs/characterLora")).resolveCharacterLora; }

const ACTIVE_CH = { id: "c1", owner_id: USER, status: "active", active_version_id: "v1" };
const FAL_VER = { id: "v1", provider: "fal", provider_model_ref: "https://v3.fal.media/w/x.bin", status: "approved" };

describe("validateLoraRef (providerfüggő)", () => {
  const prod = true;
  it("fal.ai: csak fal.media URL", () => {
    expect(validateLoraRef("fal", "https://v3.fal.media/files/abc/lora.bin", prod)).toMatchObject({ ok: true, adapter: "fal" });
    expect(validateLoraRef("fal", "https://evil.example/x.bin", prod).ok).toBe(false);
  });
  it("replicate: weights:// URI és replicate.delivery URL elfogadva", () => {
    expect(validateLoraRef("replicate", "weights://replicate/xyz/lora.safetensors", prod)).toMatchObject({ ok: true, adapter: "replicate" });
    expect(validateLoraRef("replicate", "https://replicate.delivery/pb_models/abc/weights.bin", prod)).toMatchObject({ ok: true, adapter: "replicate" });
  });
  it("replicate: ismeretlen URL, fal URL replikátán és Replicate-ref falnál elutasítva", () => {
    expect(validateLoraRef("replicate", "https://evil.example/x", prod).ok).toBe(false);
    expect(validateLoraRef("replicate", "https://v3.fal.media/files/x", prod).ok).toBe(false);          // fal URL replicate-nél
    expect(validateLoraRef("fal", "https://replicate.delivery/pb_models/x", prod).ok).toBe(false);      // Replicate-ref falnál
    expect(validateLoraRef("replicate", "replicate/owner/model", prod).ok).toBe(false);                  // nincs kitalált formátum
  });
  it("mock: productionben TILTOTT", () => {
    expect(validateLoraRef("mock", "mock_lora_x", true).ok).toBe(false);
    expect(validateLoraRef("mock", "mock_lora_x", false)).toMatchObject({ ok: true, adapter: "mock" });
  });
  it("ismeretlen provider / null elutasítva", () => {
    expect(validateLoraRef("unknown", "https://v3.fal.media/a", prod).ok).toBe(false);
    expect(validateLoraRef(null, "https://v3.fal.media/a", prod).ok).toBe(false);
  });
});

describe("resolveCharacterLora (mockolt Supabase, URL-szerinti stub)", () => {
  it("idegen karakter → CHARACTER_NOT_OWNED", async () => {
    harness({ ...ACTIVE_CH, owner_id: "masik" }, FAL_VER);
    expect((await (await load())(USER, "c1")).error).toBe("CHARACTER_NOT_OWNED");
  });
  it("inaktív karakter → CHARACTER_NOT_ACTIVE", async () => {
    harness({ ...ACTIVE_CH, status: "draft" }, FAL_VER);
    expect((await (await load())(USER, "c1")).error).toBe("CHARACTER_NOT_ACTIVE");
  });
  it("nincs aktív verzió → NO_ACTIVE_LORA", async () => {
    harness(ACTIVE_CH, undefined);
    expect((await (await load())(USER, "c1")).error).toBe("NO_ACTIVE_LORA");
  });
  it("nem approved verzió → LORA_NOT_READY", async () => {
    harness(ACTIVE_CH, { ...FAL_VER, status: "training" });
    expect((await (await load())(USER, "c1")).error).toBe("LORA_NOT_READY");
  });
  it("fal URL sikeres: loraPath + provider visszaadva", async () => {
    harness(ACTIVE_CH, FAL_VER);
    const r = await (await load())(USER, "c1");
    expect(r).toMatchObject({ loraPath: "https://v3.fal.media/w/x.bin", provider: "fal" });
  });
  it("érvénytelen provider-ref → PROVIDER_MODEL_INVALID", async () => {
    harness(ACTIVE_CH, { ...FAL_VER, provider_model_ref: "https://evil.example/x" });
    expect((await (await load())(USER, "c1")).error).toBe("PROVIDER_MODEL_INVALID");
  });
});
