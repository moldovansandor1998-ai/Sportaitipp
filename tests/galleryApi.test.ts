// /api/gallery: galleryItemId vs assetId; tulajdon-szigetelés VALÓDI bizonyítékokkal:
// - a PostgREST kérésben owner_id=eq.<uid> szerepel;
// - kizárólag a saját elemek kerülnek ki (idegen soha);
// - egy kötegelt Storage-sign kérés, kizárólag a saját objektumútvonalakkal.
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

const UID = "u1";
const FOREIGN_UID = "u9";
const GALLERY_ITEM_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const ASSET_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const FOREIGN_GID = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const FOREIGN_PATH = "u9/secret/foreign.jpg";
const OBJECT_PATH = "the/correct/object/path.jpg";

describe("/api/gallery (fetch-stub, nyers Storage API formátum)", () => {
  it("filters videos on the server before pagination and signs results from either category", async () => {
    let query: URL | undefined;
    const signedPaths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: UID }), { status: 200 });
      if (u.includes("/rest/v1/gallery_items")) {
        query = new URL(u);
        const filtered = query.searchParams.get("assets.media_type") === "eq.video";
        return new Response(JSON.stringify(filtered ? ["fanvue", "tiktok"].map((category, index) => ({
          id: `${GALLERY_ITEM_ID}-${index}`, content_category: category, qc_status: "pending",
          assets: { id: `${ASSET_ID}-${index}`, object_path: `${UID}/${index}.mp4`, media_type: "video", content_type: "video/mp4", bytes: 100 },
        })) : []), { status: 200, headers: { "content-range": "0-1/2" } });
      }
      if (u.endsWith("/storage/v1/object/sign/assets")) {
        const paths: string[] = JSON.parse(String(init?.body)).paths;
        signedPaths.push(...paths);
        return new Response(JSON.stringify(paths.map(path => ({ path, signedURL: `/object/sign/assets/${path}?token=t`, error: null }))), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }));
    const { GET } = await import("@/app/api/gallery/route");
    const response = await GET(new NextRequest("http://localhost/api/gallery?mediaType=video&page=0", { headers: { authorization: "Bearer t" } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(2);
    expect(body.items.map((item: { contentCategory: string }) => item.contentCategory)).toEqual(["fanvue", "tiktok"]);
    expect(body.items.every((item: { mediaType: string; url: string }) => item.mediaType === "video" && item.url)).toBe(true);
    expect(query?.searchParams.get("select")).toContain("assets!inner");
    expect(query?.searchParams.get("owner_id")).toBe(`eq.${UID}`);
    expect(query?.searchParams.has("content_category")).toBe(false);
    expect(signedPaths).toEqual([`${UID}/0.mp4`, `${UID}/1.mp4`]);
  });
  it("rejects invalid media filters without listing or signing assets", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ id: UID }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const { GET } = await import("@/app/api/gallery/route");
    const response = await GET(new NextRequest("http://localhost/api/gallery?mediaType=unknown", { headers: { authorization: "Bearer t" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_MEDIA_TYPE" });
    expect(request.mock.calls).toHaveLength(1);
  });
  it("szerkezet: id alias + galleryItemId + assetId + mediaType + signed URL az object_path alapján", async () => {
    let signedRequestUrl = "";
    let signedPaths: string[] = [];
    let restUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: UID }), { status: 200 });
      if (u.includes("/rest/v1/gallery_items")) {
        restUrl = u;
        return new Response(JSON.stringify([{
          id: GALLERY_ITEM_ID, qc_status: "approved", character_id: null,
          assets: { id: ASSET_ID, object_path: OBJECT_PATH, media_type: "image", content_type: "image/jpeg", bytes: 1234 },
        }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (u.endsWith("/storage/v1/object/sign/assets")) {
        signedRequestUrl = u;
        signedPaths = JSON.parse(String(init?.body)).paths;
        return new Response(JSON.stringify(signedPaths.map(path => ({ path, signedURL: `/object/sign/assets/${path}?token=xyz`, error: null }))),
          { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 200 });
    }));
    const { GET } = await import("@/app/api/gallery/route");
    const res = await GET(new NextRequest("http://localhost/api/gallery", { headers: { authorization: "Bearer t" } }));
    expect(res.status).toBe(200);
    const items = (await res.json() as { items: Array<Record<string, unknown>> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: GALLERY_ITEM_ID, galleryItemId: GALLERY_ITEM_ID, assetId: ASSET_ID, mediaType: "image",
    });
    expect(items[0].assetId).not.toBe(items[0].galleryItemId);
    expect(String(items[0].url)).toContain("/storage/v1/object/sign/assets/");
    expect(String(items[0].url)).toContain("token=xyz");
    expect(signedRequestUrl).toContain("/storage/v1/object/sign/assets");
    expect(signedPaths).toEqual([OBJECT_PATH]);
    expect(restUrl).toContain(`owner_id=eq.${UID}`);   // a kérés TARTALMAZZA az owner-szűrőt
  });

  it("tulajdon-szigetelés: owner_id=eq.<uid> a kérésben; idegen elem/útvonal soha nem kerül ki", async () => {
    const restUrls: string[] = [];
    const signUrls: string[] = [];
    const signedPaths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: UID }), { status: 200 });
      if (u.includes("/rest/v1/gallery_items")) {
        restUrls.push(u);
        // a service query owner_id szűrővel hív – a stub CSAK a saját elemet adja vissza;
        // idegen sorral sosem találkozik (így működik az RLS + a kód szűrője együtt)
        return new Response(JSON.stringify([{
          id: GALLERY_ITEM_ID, qc_status: "pending", character_id: null,
          assets: { id: ASSET_ID, object_path: OBJECT_PATH, media_type: "image", content_type: "image/jpeg", bytes: 1 },
        }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (u.endsWith("/storage/v1/object/sign/assets")) {
        signUrls.push(u);
        const paths: string[] = JSON.parse(String(init?.body)).paths;
        signedPaths.push(...paths);
        return new Response(JSON.stringify(paths.map(path => ({ path, signedURL: `/object/sign/assets/${path}?token=1`, error: null }))), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }));
    const { GET } = await import("@/app/api/gallery/route");
    const res = await GET(new NextRequest("http://localhost/api/gallery", { headers: { authorization: "Bearer t" } }));
    const items = (await res.json() as { items: Array<{ galleryItemId: string }> }).items;
    // 1) a PostgREST kérés mindig az authentikált userre szűr
    expect(restUrls.length).toBe(1);
    expect(restUrls[0]).toContain(`owner_id=eq.${UID}`);
    expect(restUrls[0]).not.toContain(`owner_id=eq.${FOREIGN_UID}`);
    // 2) idegen gallery elem nincs a válaszban
    expect(items.some((i) => i.galleryItemId === FOREIGN_GID)).toBe(false);
    // 3) a kötegelt kérés csak a saját assetet írhatja alá
    expect(signUrls).toHaveLength(1);
    expect(signedPaths).toEqual([OBJECT_PATH]);
    expect(signedPaths).not.toContain(FOREIGN_PATH);
  });
});
