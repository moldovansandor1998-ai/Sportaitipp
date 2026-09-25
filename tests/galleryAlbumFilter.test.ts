import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const saved: Record<string, string | undefined> = {};
const USER = "11111111-1111-4111-8111-111111111111";
const OWN_ALBUM = "22222222-2222-4222-8222-222222222222";
const FOREIGN_ALBUM = "33333333-3333-4333-8333-333333333333";

beforeAll(() => {
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) saved[key] = process.env[key];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://stub";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
});
afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
afterEach(() => vi.unstubAllGlobals());

function row(id: string, albumId: string | null) {
  return { id, qc_status: "approved", character_id: null, album_id: albumId,
    assets: { id: `a${id.slice(1)}`, object_path: `${USER}/${id}.jpg`, media_type: "image", content_type: "image/jpeg", bytes: 10 } };
}

function stub() {
  const galleryUrls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ user: { id: USER } }), { status: 200 });
    if (u.includes("/rest/v1/albums")) {
      return new Response(JSON.stringify(u.includes(`id=eq.${OWN_ALBUM}`) ? { id: OWN_ALBUM } : null), { status: 200 });
    }
    if (u.includes("/rest/v1/gallery_items")) {
      galleryUrls.push(u);
      const filtered = u.includes(`album_id=eq.${OWN_ALBUM}`)
        ? [row("44444444-4444-4444-8444-444444444444", OWN_ALBUM)]
        : [row("44444444-4444-4444-8444-444444444444", OWN_ALBUM), row("55555555-5555-4555-8555-555555555555", null)];
      return new Response(JSON.stringify(filtered), { status: 200 });
    }
    if (u.includes("/storage/v1/object/sign/")) return new Response(JSON.stringify({ signedURL: "/signed?token=t" }), { status: 200 });
    return new Response("{}", { status: 200 });
  }));
  return galleryUrls;
}

async function get(query = "") {
  const { GET } = await import("@/app/api/gallery/route");
  return GET(new NextRequest(`http://localhost/api/gallery${query}`, { headers: { authorization: "Bearer t" } }));
}

describe("gallery album owner isolation", () => {
  it("saját album csak a saját, albumhoz tartozó elemet adja vissza", async () => {
    const urls = stub();
    const res = await get(`?albumId=${OWN_ALBUM}`);
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);
    expect(urls[0]).toContain(`owner_id=eq.${USER}`);
    expect(urls[0]).toContain(`album_id=eq.${OWN_ALBUM}`);
  });

  it("más felhasználó albumazonosítója üres és nem indít gallery lekérdezést", async () => {
    const urls = stub();
    const res = await get(`?albumId=${FOREIGN_ALBUM}`);
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
    expect(urls).toHaveLength(0);
  });

  it("albumId=all és album nélküli kérés minden saját elemet ad, album-felülírás nélkül", async () => {
    let urls = stub();
    expect((await (await get("?albumId=all")).json()).items).toHaveLength(2);
    expect(urls[0]).toContain(`owner_id=eq.${USER}`);
    expect(urls[0]).not.toContain("album_id=eq.");
    urls = stub();
    expect((await (await get()).json()).items).toHaveLength(2);
    expect(urls[0]).toContain(`owner_id=eq.${USER}`);
  });

  it("hibás albumazonosító 400", async () => {
    stub();
    expect((await get("?albumId=not-a-uuid")).status).toBe(400);
  });
});
