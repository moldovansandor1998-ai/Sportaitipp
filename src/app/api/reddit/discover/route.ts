import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { redditApproved, redditConfigured } from "@/server/reddit/client";
import { discoverForAccount, DiscoveryError } from "@/server/reddit/discoveryRunner";
export const runtime = "nodejs";
export const maxDuration = 300;
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
const fields = "subreddit,title,description,over18,status,reason,rules,checked_at";

export async function GET(req: NextRequest) {
  const user = await authed(req);
  if (!user) return fail("unauthorized", 401);
  const id = z.string().uuid().safeParse(req.nextUrl.searchParams.get("characterId"));
  if (!id.success) return fail("INVALID_CHARACTER");
  const sb = serviceClient();
  const [result, account] = await Promise.all([
    sb.from("reddit_community_candidates").select(fields).eq("owner_id", user.id).eq("character_id", id.data).order("subreddit"),
    sb.from("reddit_social_connections").select("last_discovery_at").eq("owner_id", user.id).eq("character_id", id.data).maybeSingle(),
  ]);
  if (result.error || account.error) return fail("REDDIT_DISCOVERY_STATUS_FAILED", 500);
  return NextResponse.json({ candidates: result.data, lastDiscoveryAt: account.data?.last_discovery_at ?? null });
}

export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return fail("unauthorized", 401);
  const parsed = z.object({ characterId: z.string().uuid() }).strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("INVALID_CHARACTER");
  if (!redditApproved()) return fail("REDDIT_API_NOT_APPROVED", 503);
  if (!redditConfigured()) return fail("REDDIT_APP_NOT_CONFIGURED", 503);
  const sb = serviceClient(), characterId = parsed.data.characterId;
  const { data: character, error: characterError } = await sb.from("characters").select("id").eq("id", characterId).eq("owner_id", user.id).maybeSingle();
  if (characterError || !character) return fail("CHARACTER_NOT_FOUND", 404);
  try { return NextResponse.json(await discoverForAccount(user.id, characterId)); }
  catch (error) {
    return error instanceof DiscoveryError ? fail(error.code, error.status) : fail("REDDIT_DISCOVERY_FAILED", 502);
  }
}
