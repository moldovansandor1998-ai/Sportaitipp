import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { redditApproved, redditConfigured, redditRedirectUri } from "@/server/reddit/client";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!redditApproved()) return NextResponse.json({ error: "REDDIT_API_NOT_APPROVED" }, { status: 503 });
  if (!redditConfigured()) return NextResponse.json({ error: "REDDIT_APP_NOT_CONFIGURED" }, { status: 503 });
  const callback = new URL(redditRedirectUri());
  // Cookie binding requires connect and callback to use the same trusted origin.
  if (req.nextUrl.origin !== callback.origin || (req.headers.get("origin") && req.headers.get("origin") !== callback.origin))
    return NextResponse.json({ error: "REDDIT_CONNECT_ORIGIN_MISMATCH" }, { status: 400 });
  const input = z.object({ characterId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "INVALID_CHARACTER" }, { status: 400 });
  const sb = serviceClient();
  const { data: character, error } = await sb.from("characters").select("id")
    .eq("id", input.data.characterId).eq("owner_id", user.id).maybeSingle();
  if (error || !character) return NextResponse.json({ error: "CHARACTER_NOT_FOUND" }, { status: 404 });
  const state = randomBytes(32).toString("base64url");
  const saved = await sb.from("reddit_oauth_sessions").insert({ state, owner_id: user.id, character_id: character.id,
    return_origin: callback.origin, expires_at: new Date(Date.now() + 600_000).toISOString() });
  if (saved.error) return NextResponse.json({ error: "REDDIT_AUTH_START_FAILED" }, { status: 500 });
  const url = new URL("https://www.reddit.com/api/v1/authorize");
  url.search = new URLSearchParams({ client_id: process.env.REDDIT_CLIENT_ID!, response_type: "code", state,
    redirect_uri: callback.toString(), duration: "permanent", scope: "identity submit read" }).toString();
  const response = NextResponse.json({ url: url.toString() });
  response.cookies.set("__Host-reddit_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return response;
}
