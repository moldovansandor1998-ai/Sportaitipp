import { authed } from "@/lib/apiAuth";
// Content Calendar CRUD (tulajdonos).
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase/server";

const Body = z.object({
  platform: z.enum(["instagram", "tiktok", "facebook", "x", "other"]),
  body: z.string().max(4000).default(""),
  mediaAssetId: z.string().uuid().nullable().default(null),
  scheduledAt: z.string().min(4),
  characterId: z.string().uuid().nullable().default(null),
});


export async function GET(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await serviceClient().from("content_calendar_posts")
    .select("*").eq("owner_id", user.id).order("scheduled_at");
  return NextResponse.json({ posts: data ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const svc0 = serviceClient();
  if (parsed.data.mediaAssetId) {
    const { data: a } = await svc0.from("assets").select("id").eq("id", parsed.data.mediaAssetId).eq("owner_id", user.id).single();
    if (!a) return NextResponse.json({ error: "ASSET_NOT_OWNED" }, { status: 403 });
  }
  if (parsed.data.characterId) {
    const { data: c } = await svc0.from("characters").select("id").eq("id", parsed.data.characterId).eq("owner_id", user.id).single();
    if (!c) return NextResponse.json({ error: "CHARACTER_NOT_OWNED" }, { status: 403 });
  }
  const { data, error } = await serviceClient().from("content_calendar_posts")
    .insert({ owner_id: user.id, ...parsed.data, status: "scheduled" }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
