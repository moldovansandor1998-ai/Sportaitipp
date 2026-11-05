import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { serviceClient } from "@/lib/supabase/server";
import { encrypt, exchangeCode, redditIdentity, redditApproved, redditConfigured, redditRedirectUri } from "@/server/reddit/client";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  let origin = "https://sportaitipp.vercel.app";
  try { origin = new URL(redditRedirectUri()).origin; } catch { /* Safe fixed fallback. */ }
  const redirect = (result: string, characterId?: string) => {
    const path = characterId && /^[0-9a-f-]{36}$/i.test(characterId) ? `/characters/${characterId}` : "/model-studio";
    const response = NextResponse.redirect(new URL(`${path}?reddit=${result}`, origin));
    response.cookies.set("__Host-reddit_oauth_state", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
    return response;
  };
  if (!redditConfigured() || !redditApproved()) return redirect("failed");
  const state = req.nextUrl.searchParams.get("state"), cookie = req.cookies.get("__Host-reddit_oauth_state")?.value;
  if (!state || !cookie || state.length > 100 || Buffer.byteLength(state) !== Buffer.byteLength(cookie) || !timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) return redirect("failed");
  let characterId: string | undefined;
  try {
    const sb = serviceClient();
    const { data: context, error } = await sb.from("reddit_oauth_sessions").delete().eq("state", state)
      .gt("expires_at", new Date().toISOString()).select("owner_id,character_id,return_origin").maybeSingle();
    if (error || !context || context.return_origin !== origin) return redirect("failed");
    characterId = context.character_id;
    const code = req.nextUrl.searchParams.get("code");
    if (!code || req.nextUrl.searchParams.has("error")) return redirect("failed", characterId);
    const { data: character, error: characterError } = await sb.from("characters").select("id")
      .eq("id", characterId).eq("owner_id", context.owner_id).maybeSingle();
    if (characterError || !character) return redirect("failed");
    const token = await exchangeCode(code);
    if (!token.refresh_token) return redirect("failed", characterId);
    const identity = await redditIdentity(token.access_token);
    const saved = await sb.from("reddit_social_connections").upsert({ owner_id: context.owner_id,
      character_id: character.id, reddit_user_id: identity.id, reddit_username: identity.username,
      encrypted_access_token: encrypt(token.access_token), encrypted_refresh_token: encrypt(token.refresh_token),
      token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(), enabled: false,
      rules_confirmed: false, rules_fingerprint: null, pause_reason: null, updated_at: new Date().toISOString() }, { onConflict: "owner_id,character_id" });
    return redirect(saved.error ? "failed" : "connected", characterId);
  } catch { return redirect("failed", characterId); }
}
