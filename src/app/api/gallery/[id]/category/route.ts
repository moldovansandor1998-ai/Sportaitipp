import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";
const Input = z.object({ category: z.enum(["tiktok", "fanvue"]) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input = Input.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const { id } = await params;
  const { data, error } = await serviceClient().from("gallery_items")
    .update({ content_category: input.data.category })
    .eq("id", id).eq("owner_id", user.id).is("deleted_at", null)
    .eq("content_category", input.data.category === "tiktok" ? "fanvue" : "tiktok")
    .select("id,character_id,content_category").maybeSingle();
  if (error) return NextResponse.json({ error: "CATEGORY_UPDATE_FAILED" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "GALLERY_ITEM_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true, characterId: data.character_id, category: data.content_category });
}
