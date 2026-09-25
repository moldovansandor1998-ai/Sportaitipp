import { authed } from "@/lib/apiAuth";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/server";

import { z } from "zod";

const PatchSchema = z.object({
  platform: z.enum(["instagram", "tiktok", "facebook", "x", "other"]).optional(),
  body: z.string().max(4000).optional(),
  scheduledAt: z.string().min(4).optional(),
  status: z.enum(["draft", "scheduled", "posted", "cancelled"]).optional(),
  mediaAssetId: z.string().uuid().nullable().optional(),
  characterId: z.string().uuid().nullable().optional(),
}).strict();


export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 });
  const patch = parsed.data as Record<string, unknown>;
  const svc = serviceClient();
  if (patch.mediaAssetId) {
    const { data: a } = await svc.from("assets").select("id").eq("id", patch.mediaAssetId).eq("owner_id", user.id).single();
    if (!a) return NextResponse.json({ error: "ASSET_NOT_OWNED" }, { status: 403 });
  }
  if (patch.characterId) {
    const { data: c } = await svc.from("characters").select("id").eq("id", patch.characterId).eq("owner_id", user.id).single();
    if (!c) return NextResponse.json({ error: "CHARACTER_NOT_OWNED" }, { status: 403 });
  }
  const { data, error } = await svc.from("content_calendar_posts").update(patch)
    .eq("id", id).eq("owner_id", user.id).select("id").single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await serviceClient().from("content_calendar_posts").delete().eq("id", id).eq("owner_id", user.id);
  return NextResponse.json({ ok: true });
}
