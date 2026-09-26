import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";
const Input = z.object({ characterId: z.string().uuid(), preferred: z.boolean() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input = Input.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const { id } = await params;
  const sb = serviceClient();
  const { data: source } = await sb.from("content_source_images")
    .select("id,preferred_for_character,retired_at")
    .eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!source || source.retired_at) return NextResponse.json({ error: "SOURCE_UNAVAILABLE" }, { status: 404 });
  if (source.preferred_for_character && source.preferred_for_character !== input.data.characterId)
    return NextResponse.json({ error: "SOURCE_BELONGS_TO_OTHER_MODEL" }, { status: 409 });
  if (input.data.preferred) {
    const { data: uses } = await sb.from("content_source_uses")
      .select("item_id,slide_no,review_status").eq("source_id", id)
      .eq("owner_id", user.id).eq("character_id", input.data.characterId)
      .neq("review_status", "rejected");
    if (!uses?.length) return NextResponse.json({ error: "SOURCE_NOT_USED_BY_MODEL" }, { status: 409 });
    const { data: items } = await sb.from("model_content_items")
      .select("id,image_jobs").eq("owner_id", user.id).in("id", uses.map(use => use.item_id));
    const jobIds = uses.map(use => items?.find(item => item.id === use.item_id)?.image_jobs?.[use.slide_no]).filter(Boolean);
    if (!jobIds.length) return NextResponse.json({ error: "NO_COMPLETED_IMAGE" }, { status: 409 });
    const { count } = await sb.from("generation_jobs").select("id", { count: "exact", head: true })
      .eq("owner_id", user.id).eq("status", "completed").in("id", jobIds as string[]);
    if (!count) return NextResponse.json({ error: "NO_COMPLETED_IMAGE" }, { status: 409 });
  }
  const { error } = await sb.from("content_source_images")
    .update({ preferred_for_character: input.data.preferred ? input.data.characterId : null })
    .eq("id", id).eq("owner_id", user.id);
  if (error) return NextResponse.json({ error: "SAVE_FAILED" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
