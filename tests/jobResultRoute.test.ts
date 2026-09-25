// GET /api/jobs/[id]: tulajdonhoz kötött – idegen/missing job 404 (nem szivárogtat adatot).
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

const ME = "11111111-1111-1111-1111-111111111111";
const FOREIGN_JOB = "99999999-9999-4999-9999-999999999999";

describe("GET /api/jobs/[id] tulajdon", () => {
  it("idegen vagy nem létező job → 404, nincs eredmény-szivárgás", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: ME }), { status: 200 });
      if (u.includes("/rest/v1/generation_jobs")) return new Response("null", { status: 200 });  // owner szűrés: üres
      return new Response("{}", { status: 200 });
    }));
    const { GET } = await import("@/app/api/jobs/[id]/route");
    const res = await GET(new NextRequest(`http://localhost/api/jobs/${FOREIGN_JOB}`, {
      headers: { authorization: "Bearer t" },
    }), { params: Promise.resolve({ id: FOREIGN_JOB }) });
    expect(res.status).toBe(404);
    const b = await res.json() as { results?: unknown };
    expect(b.results).toBeUndefined();
  });
  it("saját job: job + eredmény-assetek signed URL-lel", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: ME }), { status: 200 });
      if (u.includes("/rest/v1/generation_jobs")) {
        return new Response(JSON.stringify({ id: "j1", type: "video_from_image", status: "completed" }), { status: 200 });
      }
      if (u.includes("/rest/v1/gallery_items")) {
        return new Response(JSON.stringify([{
          id: "g1",
          assets: { id: "a1", bucket: "custom-results", object_path: "u/j/g.mp4", media_type: "video", content_type: "video/mp4", bytes: 10 },
        }]), { status: 200 });
      }
      if (u.includes("/storage/v1/object/sign/")) {
        return new Response(JSON.stringify({ signedURL: "/object/sign/assets/u%2Fj%2Fg.mp4?token=t" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }));
    const { GET } = await import("@/app/api/jobs/[id]/route");
    const requestedBuckets: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = new Proxy(origFetch, {
      apply(target, thisArg, args: [string, RequestInit?]) {
        const u = String(args[0]);
        if (u.includes("/storage/v1/object/sign/")) {
          const m = u.match(/\/object\/sign\/([^/]+)\//);
          if (m) requestedBuckets.push(m[1]);
        }
        return Reflect.apply(target, thisArg, args as never);
      },
    }) as typeof fetch;
    const res = await GET(new NextRequest("http://localhost/api/jobs/j1", {
      headers: { authorization: "Bearer t" },
    }), { params: Promise.resolve({ id: "j1" }) });
    globalThis.fetch = origFetch;
    expect(res.status).toBe(200);
    expect(requestedBuckets).toEqual(["custom-results"]);   // AZ ASSET bucket-je, nem hardcode
    const b = await res.json() as { job: { status: string }; results: Array<{ mediaType: string; url: string | null; assetId: string; galleryItemId: string }> };
    expect(b.job.status).toBe("completed");
    expect(b.results).toHaveLength(1);
    expect(b.results[0]).toMatchObject({ mediaType: "video", assetId: "a1", galleryItemId: "g1" });
    expect(String(b.results[0].url)).toContain("object/sign");
  });
});
