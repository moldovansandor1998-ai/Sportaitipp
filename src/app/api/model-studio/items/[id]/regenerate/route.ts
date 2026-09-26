import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (process.env.CONTENT_AUTOMATION_ENABLED === "false")
    return NextResponse.json({ error: "QUALITY_REVIEW_REQUIRED" }, { status: 503 });
  const { id } = await params;
  const sb = serviceClient();
  const { data: item } = await sb.from("model_content_items")
    .select("id,status,image_jobs,regeneration_count,platform").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!item || !["ready", "failed"].includes(item.status) || item.platform === "fanvue_paid")
    return NextResponse.json({ error: "ITEM_NOT_REGENERATABLE" }, { status: 409 });
  if (item.image_jobs?.length) {
    const { data: jobs } = await sb.from("generation_jobs").select("status").in("id", item.image_jobs);
    if (jobs?.some(j => !["completed", "failed", "cancelled"].includes(j.status)))
      return NextResponse.json({ error: "PREVIOUS_JOBS_RUNNING" }, { status: 409 });
  }
  const { data: updated, error } = await sb.from("model_content_items")
    .update({ status: "planned", prepare_at: new Date().toISOString(), error: null, image_jobs: [],
      regeneration_count: item.regeneration_count + 1 })
    .eq("id", id).eq("owner_id", user.id).eq("status", item.status)
    .eq("regeneration_count", item.regeneration_count).select("id").maybeSingle();
  if (error || !updated) return NextResponse.json({ error: "REGENERATION_CONFLICT" }, { status: 409 });
  return NextResponse.json({ ok: true, message: "Új, még nem használt forrásképpel sorba állítva." });
}
