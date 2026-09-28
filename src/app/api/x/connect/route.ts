import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { encrypt, xConfigured, X_CALLBACK } from "@/server/x/client";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!xConfigured()) return NextResponse.json({ error: "X_APP_NOT_CONFIGURED" }, { status: 503 });
  const body = await req.json().catch(() => null) as { characterId?: string } | null;
  if (!body?.characterId || !/^[0-9a-f-]{36}$/i.test(body.characterId))
    return NextResponse.json({ error: "INVALID_CHARACTER" }, { status: 400 });
  const { data: character } = await serviceClient().from("characters").select("id")
    .eq("id", body.characterId).eq("owner_id", user.id).maybeSingle();
  if (!character) return NextResponse.json({ error: "CHARACTER_NOT_FOUND" }, { status: 404 });

  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.search = new URLSearchParams({ response_type: "code", client_id: process.env.X_CLIENT_ID!,
    redirect_uri: X_CALLBACK, scope: "tweet.read tweet.write users.read media.write offline.access",
    state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
  const { error } = await serviceClient().from("x_oauth_sessions").insert({
    state, owner_id: user.id, character_id: character.id,
    encrypted_verifier: encrypt(verifier),
    return_origin: ["sportaitipp.vercel.app", "sportaitipp.com", "www.sportaitipp.com", "sportaitipp.hu", "www.sportaitipp.hu"].includes(req.nextUrl.hostname)
      ? req.nextUrl.origin : "https://sportaitipp.vercel.app",
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  });
  if (error) return NextResponse.json({ error: "X_AUTH_START_FAILED" }, { status: 500 });
  return NextResponse.json({ url: url.toString() });
}
