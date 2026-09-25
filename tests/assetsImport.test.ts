// /api/assets/import biztonsági tesztek (fetch-stub: auth + storage + PostgREST emuláció)
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

function mkReq(buf: Buffer, type: string): NextRequest {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(buf)], "t.jpg", { type }));
  return new NextRequest("http://localhost/api/assets/import", {
    method: "POST",
    headers: { authorization: "Bearer t" },
    body: form as never,
  });
}

describe("/api/assets/import biztonság", () => {
  it("üres fájl → 400 FILE_EMPTY", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) =>
      u.includes("/auth/v1/user") ? new Response(JSON.stringify({ id: "u1" }), { status: 200 }) : new Response("{}", { status: 200 })));
    const { POST } = await import("@/app/api/assets/import/route");
    const res = await POST(mkReq(Buffer.alloc(0), "image/jpeg"));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe("FILE_EMPTY");
  });
  it("álcázott tartalom (JPEG-nek mondott PNG) → 415 FILE_CONTENT_MISMATCH", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) =>
      u.includes("/auth/v1/user") ? new Response(JSON.stringify({ id: "u1" }), { status: 200 }) : new Response("{}", { status: 200 })));
    const { POST } = await import("@/app/api/assets/import/route");
    const res = await POST(mkReq(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]), "image/jpeg"));
    expect(res.status).toBe(415);
    expect((await res.json() as { error: string }).error).toBe("FILE_CONTENT_MISMATCH");
  });
  it("insert-hiba → 500 és a Storage-objektum AZONNAL törlődik", async () => {
    const removed: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1" }), { status: 200 });
      if (u.includes("/storage/v1/object/assets") && (init?.method ?? "GET") !== "DELETE") {
        return new Response(JSON.stringify({}), { status: 200 });        // upload ok
      }
      if (u.includes("/storage/v1") && (init?.method ?? "") === "DELETE") {
        removed.push(String(init?.body));                                 // visszatörlés
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (u.includes("/rest/v1/assets") && init?.method === "POST") {
        return new Response(JSON.stringify({ message: "db down" }), { status: 500 });   // insert hiba
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));
    const { POST } = await import("@/app/api/assets/import/route");
    const res = await POST(mkReq(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]), "image/jpeg"));
    expect(res.status).toBe(500);
    expect(removed.length).toBe(1);   // bizonyíték: visszatörlés megtörtént
  });
});
