import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/server";
import { decrypt, encrypt, exchangeCode, xIdentity, xConfigured } from "@/server/x/client";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const redirect = (result: string, origin = "https://sportaitipp.vercel.app") => {
    return NextResponse.redirect(new URL(`/model-studio?x=${result}`, origin));
  };
  if (!xConfigured() || req.nextUrl.searchParams.has("error")) return redirect("failed");
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state || state.length > 100) return redirect("failed");
  try {
    const svc = serviceClient();
    const { data: context } = await svc.from("x_oauth_sessions").delete()
      .eq("state", state).gt("expires_at", new Date().toISOString())
      .select("owner_id,character_id,encrypted_verifier,return_origin").maybeSingle();
    if (!context) return redirect("failed");
    const { data: character } = await svc.from("characters").select("id")
      .eq("id", context.character_id).eq("owner_id", context.owner_id).maybeSingle();
    if (!character) return redirect("failed", context.return_origin);
    const token = await exchangeCode(code, decrypt(context.encrypted_verifier));
    if (!token.refresh_token) return redirect("failed", context.return_origin);
    const identity = await xIdentity(token.access_token);
    const { error } = await svc.from("x_social_connections").upsert({
      owner_id: context.owner_id, character_id: character.id,
      x_user_id: identity.id, x_username: identity.username,
      encrypted_access_token: encrypt(token.access_token), encrypted_refresh_token: encrypt(token.refresh_token),
      token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      enabled: false, updated_at: new Date().toISOString(),
    }, { onConflict: "owner_id,character_id" });
    if (error) { console.error("x.oauth.save", error.code); return redirect("failed", context.return_origin); }
    return redirect("connected", context.return_origin);
  } catch (error) {
    console.error("x.oauth.callback", error instanceof Error ? error.message : "unknown");
    return redirect("failed");
  }
}
