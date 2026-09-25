import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// Pinterest keresés kizárólag a hivatalos, hozzáféréshez kötött API-n át.
export async function GET(req: NextRequest) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const query = req.nextUrl.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (query.length < 2) return NextResponse.json({ error: "SEARCH_TERM_REQUIRED" }, { status: 400 });
  const accessToken = process.env.PINTEREST_ACCESS_TOKEN;
  if (!accessToken) return NextResponse.json({ error: "PINTEREST_ACCESS_REQUIRED" }, { status: 503 });

  const url = new URL("https://api.pinterest.com/v5/search/partner/pins");
  url.searchParams.set("term", query);
  url.searchParams.set("country_code", "HU");
  url.searchParams.set("limit", "10");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!res.ok) return NextResponse.json({ error: res.status === 403 ? "PINTEREST_SEARCH_ACCESS_REQUIRED" : "PINTEREST_SEARCH_FAILED" }, { status: res.status === 403 ? 503 : 502 });
  const data = await res.json() as { items?: Array<{ id?: string; link?: string; media?: { images?: Record<string, { url?: string }> } }> };
  const pins = (data.items ?? []).flatMap((pin) => {
    const image = pin.media?.images?.["1200x"]?.url ?? pin.media?.images?.originals?.url ?? pin.media?.images?.["600x"]?.url;
    if (!pin.id || !image) return [];
    try {
      const imageUrl = new URL(image);
      if (imageUrl.protocol !== "https:" || imageUrl.hostname !== "i.pinimg.com") return [];
      return [{ id: pin.id, imageUrl: imageUrl.href, pinUrl: `https://www.pinterest.com/pin/${encodeURIComponent(pin.id)}/` }];
    } catch { return []; }
  });
  return NextResponse.json({ pins }, { headers: { "Cache-Control": "no-store" } });
}
