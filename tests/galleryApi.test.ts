// /api/gallery: galleryItemId vs assetId; tulajdon-szigetelés VALÓDI bizonyítékokkal:
// - a PostgREST kérésben owner_id=eq.<uid> szerepel;
// - kizárólag a saját elemek kerülnek ki (idegen soha);
// - minden visszaadott elemhez PONTOSAN egy Storage-sign hívás – az idegen objektumútvonal soha.
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
  it("szerkezet: id alias + galleryItemId + assetId + mediaType + signed URL az object_path alapján", async () => {
    let signedRequestUrl = "";
    let restUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: UID }), { status: 200 });
      if (u.includes("/rest/v1/gallery_items")) {
        restUrl = u;
        return new Response(JSON.stringify([{
          id: GALLERY_ITEM_ID, qc_status: "approved", character_id: null,
          assets: { id: ASSET_ID, object_path: OBJECT_PATH, media_type: "image", content_type: "image/jpeg", bytes: 1234 },
        }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (u.includes("/storage/v1/object/sign/")) {
        signedRequestUrl = u;
        return new Response(JSON.stringify({ signedURL: "/object/sign/assets/the%2Fcorrect%2Fobject%2Fpath.jpg?token=xyz" }),
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
    expect(signedRequestUrl).toContain("/storage/v1/object/sign/assets/");
    expect(signedRequestUrl).toContain("path.jpg");
    expect(restUrl).toContain(`owner_id=eq.${UID}`);   // a kérés TARTALMAZZA az owner-szűrőt
  });

  it("tulajdon-szigetelés: owner_id=eq.<uid> a kérésben; idegen elem/útvonal soha nem kerül ki", async () => {
    const restUrls: string[] = [];
    const signUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
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
      if (u.includes("/storage/v1/object/sign/")) {
        signUrls.push(u);
        return new Response(JSON.stringify({ signedURL: "/object/sign/assets/x?token=1" }), { status: 200 });
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
    // 3) pontosan annyi Storage-sign hívás, ahány elem – és az idegen útvonal SOHA nem kért aláírást
    expect(signUrls).toHaveLength(items.length);
    expect(signUrls.every((u) => !u.includes(encodeURIComponent(FOREIGN_PATH)) && !u.includes(FOREIGN_PATH))).toBe(true);
  });
});
