import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { decrypt, encrypt, refreshToken } from "@/server/x/client";

export const runtime = "nodejs";
const Uuid = z.string().uuid();
const Save = z.object({ characterId: Uuid, xUserId: z.string().regex(/^\d{1,25}$/),
  username: z.string().regex(/^[A-Za-z0-9_]{1,15}$/), name: z.string().max(100),
  description: z.string().max(1000).default(""), postId: z.string().regex(/^\d{1,25}$/).optional() });
const Update = z.object({ id: Uuid, characterId: Uuid, status: z.enum(["reviewed", "dismissed", "saved"]) });

export async function GET(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const characterId = req.nextUrl.searchParams.get("characterId");
  if (!Uuid.safeParse(characterId).success) return NextResponse.json({ error: "INVALID_MODEL" }, { status: 400 });
  const sb = serviceClient();
  const { data: connection, error: connectionError } = await sb.from("x_social_connections")
    .select("id,encrypted_access_token,encrypted_refresh_token,token_expires_at")
    .eq("owner_id", user.id).eq("character_id", characterId!).maybeSingle();
  if (connectionError || !connection) return NextResponse.json({ error: "X_NOT_CONNECTED" }, { status: 404 });
  const { data: saved, error } = await sb.from("x_follow_candidates")
    .select("id,x_user_id,x_username,display_name,description,source_post,status,created_at")
    .eq("owner_id", user.id).eq("character_id", characterId!)
    .order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "CANDIDATES_UNAVAILABLE" }, { status: 500 });
  if (req.nextUrl.searchParams.get("search") !== "1") return NextResponse.json({ saved });

  // Search is explicitly user initiated. No following action is performed here.
  let access = decrypt(connection.encrypted_access_token);
  if (Date.parse(connection.token_expires_at) < Date.now() + 120_000) {
    try {
      const token = await refreshToken(decrypt(connection.encrypted_refresh_token));
      access = token.access_token;
      const { error: tokenError } = await sb.from("x_social_connections").update({
        encrypted_access_token: encrypt(token.access_token),
        encrypted_refresh_token: encrypt(token.refresh_token),
        token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", connection.id).eq("owner_id", user.id);
      if (tokenError) throw tokenError;
    } catch { return NextResponse.json({ error: "X_RECONNECT_REQUIRED", saved }, { status: 503 }); }
  }
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.search = new URLSearchParams({ query: '("ismerkednék" OR "társat keresek" OR "szingli vagyok") lang:hu -is:retweet',
    max_results: "25", expansions: "author_id", "user.fields": "name,username,description,location,profile_image_url,protected",
    "tweet.fields": "author_id,lang" }).toString();
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return NextResponse.json({ error: `X_SEARCH_${response.status}`, saved }, { status: 502 });
    const body = await response.json() as { data?: { id: string; author_id: string }[];
      includes?: { users?: { id: string; username: string; name: string; description?: string;
        location?: string; profile_image_url?: string; protected?: boolean }[] } };
    const postByAuthor = new Map((body.data ?? []).map(post => [post.author_id, post.id]));
    const existing = new Set((saved ?? []).map(row => row.x_user_id));
    const candidates = (body.includes?.users ?? []).filter(person => !person.protected && !existing.has(person.id))
      .slice(0, 20).map(person => ({ id: person.id, username: person.username, name: person.name,
        description: person.description ?? "", location: person.location ?? "",
        image: person.profile_image_url ?? "", postId: postByAuthor.get(person.id) ?? "" }));
    return NextResponse.json({ saved, candidates });
  } catch { return NextResponse.json({ error: "X_SEARCH_UNAVAILABLE", saved }, { status: 502 }); }
}

export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Save.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_CANDIDATE" }, { status: 400 });
  const { characterId, xUserId, username, name, description, postId } = parsed.data;
  const sb = serviceClient();
  const { data: account } = await sb.from("x_social_connections").select("id")
    .eq("owner_id", user.id).eq("character_id", characterId).maybeSingle();
  if (!account) return NextResponse.json({ error: "X_NOT_CONNECTED" }, { status: 404 });
  const { error } = await sb.from("x_follow_candidates").insert({ owner_id: user.id, character_id: characterId,
    x_user_id: xUserId, x_username: username, display_name: name, description,
    source_post: postId || null });
  if (error?.code === "23505") return NextResponse.json({ error: "ALREADY_SAVED" }, { status: 409 });
  if (error) return NextResponse.json({ error: "SAVE_FAILED" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Update.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_STATUS" }, { status: 400 });
  const { data, error } = await serviceClient().from("x_follow_candidates")
    .update({ status: parsed.data.status }).eq("id", parsed.data.id).eq("owner_id", user.id)
    .eq("character_id", parsed.data.characterId).select("id").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "UPDATE_FAILED" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
