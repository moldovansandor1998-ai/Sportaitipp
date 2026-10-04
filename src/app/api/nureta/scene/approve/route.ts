import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";
const Input = z.object({ jobId: z.string().uuid(), assetId: z.string().uuid(), characterId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await auth.auth.getUser(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const { jobId, assetId, characterId } = input.data;
  const db = serviceClient();
  const { data: job } = await db.from("generation_jobs").select("id").eq("id", jobId)
    .eq("owner_id", user.id).eq("character_id", characterId)
    .eq("type", "nureta_scene_image").eq("status", "completed").maybeSingle();
  if (!job) return NextResponse.json({ error: "SCENE_PREVIEW_REQUIRED" }, { status: 409 });
  const { data: item } = await db.from("gallery_items").select("id,assets!inner(media_type)")
    .eq("job_id", jobId).eq("owner_id", user.id).eq("asset_id", assetId).is("deleted_at", null).maybeSingle();
  const image = item?.assets as unknown as { media_type: string } | null;
  if (!item || image?.media_type !== "image") return NextResponse.json({ error: "SCENE_PREVIEW_REQUIRED" }, { status: 409 });
  const { error } = await db.from("gallery_items").update({ qc_status: "approved" })
    .eq("id", item.id).eq("owner_id", user.id);
  if (error) return NextResponse.json({ error: "approval_failed" }, { status: 500 });
  return NextResponse.json({ approved: true });
}
