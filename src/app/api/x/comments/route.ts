import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { budapestDate } from "@/server/x/commentSuggestions";

export const runtime = "nodejs";
const Input = z.object({ id: z.string().uuid(), characterId: z.string().uuid(), action: z.enum(["confirm", "reject"]) });

export async function GET(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const characterId = req.nextUrl.searchParams.get("characterId");
  if (!z.string().uuid().safeParse(characterId).success) return NextResponse.json({ error: "INVALID_MODEL" }, { status: 400 });
  const sb = serviceClient();
  const { data: connection } = await sb.from("x_social_connections").select("id")
    .eq("owner_id", user.id).eq("character_id", characterId!).maybeSingle();
  if (!connection) return NextResponse.json({ error: "X_NOT_CONNECTED" }, { status: 404 });
  const { data, error } = await sb.from("x_comment_suggestions")
    .select("id,x_post_id,x_author_username,post_text,like_count,reply_count,repost_count,view_count,post_created_at,suggestion,created_at")
    .eq("owner_id", user.id).eq("character_id", characterId!).eq("status", "pending")
    .gte("post_created_at", new Date(Date.now() - 48 * 60 * 60_000).toISOString())
    .order("post_created_at", { ascending: false }).limit(20);
  if (error) return NextResponse.json({ error: "QUEUE_FAILED" }, { status: 500 });
  return NextResponse.json({ suggestions: data });
}

export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  const { id, characterId, action } = parsed.data;
  const sb = serviceClient();
  const { data: row } = await sb.from("x_comment_suggestions")
    .select("id,status,post_created_at")
    .eq("id", id).eq("owner_id", user.id).eq("character_id", characterId).maybeSingle();
  if (!row || row.status !== "pending") return NextResponse.json({ error: "ALREADY_HANDLED" }, { status: 409 });
  if (action === "reject") {
    const { data, error } = await sb.from("x_comment_suggestions")
      .update({ status: "rejected", acted_at: new Date().toISOString() })
      .eq("id", id).eq("owner_id", user.id).eq("status", "pending").select("id").maybeSingle();
    if (error || !data) return NextResponse.json({ error: "ALREADY_HANDLED" }, { status: 409 });
    return NextResponse.json({ ok: true });
  }
  if (Date.now() - Date.parse(row.post_created_at) > 48 * 60 * 60_000)
    return NextResponse.json({ error: "POST_TOO_OLD" }, { status: 409 });
  const { data: today, error: countError } = await sb.from("x_comment_suggestions")
    .select("acted_at").eq("owner_id", user.id).eq("character_id", characterId).eq("status", "posted")
    .gte("acted_at", new Date(Date.now() - 26 * 60 * 60_000).toISOString());
  if (countError) return NextResponse.json({ error: "COUNT_FAILED" }, { status: 500 });
  if ((today ?? []).filter(item => item.acted_at && budapestDate(new Date(item.acted_at)) === budapestDate()).length >= 35)
    return NextResponse.json({ error: "DAILY_LIMIT" }, { status: 409 });
  const { data: claim, error: claimError } = await sb.from("x_comment_suggestions")
    .update({ status: "posted", error: "MANUALLY_CONFIRMED", acted_at: new Date().toISOString() })
    .eq("id", id).eq("owner_id", user.id).eq("status", "pending").select("id").maybeSingle();
  if (claimError || !claim) return NextResponse.json({ error: "ALREADY_HANDLED" }, { status: 409 });
  return NextResponse.json({ ok: true, manual: true });
}
