import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { classifyCommunity } from "@/server/reddit/discovery";
import { z } from "zod";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { redditApproved, redditConfigured, normalizeDestination, validPostingMinutes, validFanvueUrl, decrypt, encrypt, refreshToken, redditSubreddit } from "@/server/reddit/client";
export const runtime = "nodejs";
const Settings = z.object({ characterId: z.string().uuid(), enabled: z.boolean().optional(),
  subreddit: z.string().max(100).nullable().optional(), timezone: z.string().max(100).optional(),
  postingMinutes: z.array(z.number().int()).optional(), rulesConfirmed: z.boolean().optional() }).strict();
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
export async function GET(req: NextRequest) {
  const user = await authed(req);
  if (!user) return fail("unauthorized", 401);
  const sb = serviceClient();
  const [accounts, history] = await Promise.all([
    sb.from("reddit_social_connections").select("character_id,reddit_username,enabled,timezone,subreddit,posting_minutes,rules_confirmed,pause_reason").eq("owner_id", user.id),
    sb.from("reddit_social_posts").select("character_id,local_date,slot,status,reddit_post_id,permalink,error").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(30),
  ]);
  if (accounts.error || history.error) return fail("REDDIT_STATUS_FAILED", 500);
  return NextResponse.json({ configured: redditConfigured(), apiApproved: redditApproved(), accounts: accounts.data, history: history.data });
}
export async function PATCH(req: NextRequest) {
  const user = await authed(req);
  if (!user) return fail("unauthorized", 401);
  const parsed = Settings.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("INVALID_SETTINGS");
  const input = parsed.data;
  if (input.postingMinutes && !validPostingMinutes(input.postingMinutes)) return fail("INVALID_POST_TIMES");
  if (input.timezone !== undefined) {
    try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format(); } catch { return fail("INVALID_TIMEZONE"); }
  }
  const sb = serviceClient();
  const { data: current, error } = await sb.from("reddit_social_connections")
    .select("id,enabled,subreddit,reddit_username,rules_confirmed,rules_fingerprint,timezone,posting_minutes,encrypted_access_token,encrypted_refresh_token,token_expires_at").eq("owner_id", user.id).eq("character_id", input.characterId).maybeSingle();
  if (error || !current) return fail("REDDIT_ACCOUNT_NOT_FOUND", 404);
  const destination = input.subreddit === undefined ? current.subreddit : input.subreddit ? normalizeDestination(input.subreddit) : null;
  if (input.subreddit && !destination) return fail("INVALID_DESTINATION");
  if (destination?.startsWith("u_") && destination !== `u_${current.reddit_username.toLowerCase()}`) return fail("REDDIT_PROFILE_MUST_BE_OWN");
  const changedDestination = destination !== current.subreddit;
  const confirmed = input.rulesConfirmed ?? (changedDestination ? false : current.rules_confirmed);
  // Changed destinations and revoked confirmation pause an existing schedule unless explicitly re-enabled.
  const enabled = input.enabled ?? ((changedDestination || !confirmed) ? false : current.enabled);
  if (enabled) {
    if (!redditApproved()) return fail("REDDIT_API_NOT_APPROVED", 503);
    if (!redditConfigured()) return fail("REDDIT_APP_NOT_CONFIGURED", 503);
    if (!destination || !confirmed) return fail("REDDIT_RULES_CONFIRMATION_REQUIRED");
    const minutes = input.postingMinutes ?? current.posting_minutes;
    if (!Array.isArray(minutes) || !validPostingMinutes(minutes)) return fail("INVALID_POST_TIMES");
    const { data: profiles, error: profileError } = await sb.from("model_accounts").select("account_url")
      .eq("owner_id", user.id).eq("character_id", input.characterId).eq("platform", "fanvue");
    if (profileError || !profiles?.some(p => validFanvueUrl(p.account_url))) return fail("REDDIT_FANVUE_PROFILE_REQUIRED");
  }
  let fingerprint = changedDestination || input.rulesConfirmed === false ? null : current.rules_fingerprint;
  if (enabled || input.rulesConfirmed === true) {
    if (!redditApproved()) return fail("REDDIT_API_NOT_APPROVED", 503);
    if (!redditConfigured()) return fail("REDDIT_APP_NOT_CONFIGURED", 503);
    if (!destination || !confirmed) return fail("REDDIT_RULES_CONFIRMATION_REQUIRED");
    try {
      let access: string;
      const expiry = Date.parse(current.token_expires_at ?? "");
      if (!Number.isFinite(expiry) || expiry < Date.now() + 60_000) {
        const token = await refreshToken(decrypt(current.encrypted_refresh_token));
        access = token.access_token;
        const saved = await sb.from("reddit_social_connections").update({ encrypted_access_token: encrypt(access),
          ...(token.refresh_token ? { encrypted_refresh_token: encrypt(token.refresh_token) } : {}),
          token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
        }).eq("owner_id", user.id).eq("id", current.id).select("id").maybeSingle();
        if (saved.error || !saved.data) return fail("REDDIT_TOKEN_SAVE_FAILED", 500);
      } else access = decrypt(current.encrypted_access_token);
      const community = await redditSubreddit(access, destination);
      const verdict = classifyCommunity(community, community.rules,
        community.restricted || community.quarantined || community.submissionType === "link");
      if (verdict.status === "blocked") return fail("REDDIT_COMMUNITY_BLOCKED");
      const liveFingerprint = createHash("sha256").update(JSON.stringify(community.rules)).digest("hex");
      if (fingerprint && fingerprint !== liveFingerprint && input.rulesConfirmed !== true) return fail("REDDIT_RULES_CHANGED", 409);
      fingerprint = liveFingerprint;
    } catch { return fail("REDDIT_COMMUNITY_CHECK_FAILED", 502); }
  }
  const result = await sb.from("reddit_social_connections").update({ enabled, subreddit: destination, rules_confirmed: confirmed, rules_fingerprint: fingerprint,
    ...(input.timezone !== undefined && { timezone: input.timezone }),
    ...(input.postingMinutes !== undefined && { posting_minutes: [...input.postingMinutes].sort((a, b) => a - b) }),
    ...(input.enabled === true && { pause_reason: null }), updated_at: new Date().toISOString(),
  }).eq("owner_id", user.id).eq("id", current.id).select("id").maybeSingle();
  if (result.error || !result.data) return fail("REDDIT_SETTINGS_FAILED", 500);
  return NextResponse.json({ ok: true });
}
export async function DELETE(req: NextRequest) {
  const user = await authed(req);
  if (!user) return fail("unauthorized", 401);
  const characterId = req.nextUrl.searchParams.get("characterId");
  if (!z.string().uuid().safeParse(characterId).success) return fail("INVALID_CHARACTER");
  const { error } = await serviceClient().from("reddit_social_connections").delete().eq("owner_id", user.id).eq("character_id", characterId);
  return error ? fail("REDDIT_DISCONNECT_FAILED", 500) : NextResponse.json({ ok: true });
}
