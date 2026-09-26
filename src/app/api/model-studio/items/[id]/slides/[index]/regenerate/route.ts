import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { prepareValidatedJobInput } from "@/server/jobs/prepareJob";
import { buildRouter } from "@/lib/providers";
import { createJobWithHold } from "@/lib/credits/rpc";
import { scheduleKick } from "@/server/jobs/schedule";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; index: string }> }) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (process.env.CONTENT_AUTOMATION_ENABLED === "false")
    return NextResponse.json({ error: "QUALITY_REVIEW_REQUIRED" }, { status: 503 });
  const { id, index: rawIndex } = await params;
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0 || index > 2)
    return NextResponse.json({ error: "INVALID_SLIDE" }, { status: 400 });
  const sb = serviceClient();
  const { data: item } = await sb.from("model_content_items").select("*")
    .eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (!item || item.platform === "fanvue_paid" || !["ready", "failed"].includes(item.status)
      || !item.image_jobs?.[index])
    return NextResponse.json({ error: "SLIDE_NOT_REGENERATABLE" }, { status: 409 });
  const { data: jobs } = await sb.from("generation_jobs").select("id,status")
    .in("id", item.image_jobs).eq("owner_id", user.id);
  if (jobs?.some(job => !["completed", "failed", "cancelled"].includes(job.status)))
    return NextResponse.json({ error: "PREVIOUS_JOBS_RUNNING" }, { status: 409 });
  const pool = item.platform === "tiktok" ? "tiktok" : item.platform === "telegram" ? "telegram" : "fanvue_public";
  const { data: previous } = await sb.from("content_source_uses").select("source_id")
    .eq("owner_id", user.id).eq("character_id", item.character_id);
  const excluded = (previous ?? []).map(row => row.source_id);
  let candidates = sb.from("content_source_images").select("id,asset_id")
    .eq("owner_id", user.id).eq("pool", pool).is("used_at", null).order("created_at").limit(1);
  if (excluded.length) candidates = candidates.not("id", "in", `(${excluded.join(",")})`);
  const { data: available, error: findError } = await candidates;
  if (findError || !available?.length)
    return NextResponse.json({ error: "Nincs még kipróbálatlan forráskép ehhez a modellhez." }, { status: 409 });

  const revision = item.regeneration_count + 1;
  const { data: claimed } = await sb.from("model_content_items")
    .update({ status: "generating", error: null, regeneration_count: revision })
    .eq("id", id).eq("owner_id", user.id).eq("status", item.status)
    .eq("regeneration_count", item.regeneration_count).select("id").maybeSingle();
  if (!claimed) return NextResponse.json({ error: "REGENERATION_CONFLICT" }, { status: 409 });
  try {
    const { error: rejectError } = await sb.rpc("reject_content_slide", {
      p_owner: user.id, p_item: id, p_slide: index,
    });
    if (rejectError) throw rejectError;
    const { data: reserved, error: sourceError } = await sb.rpc("reserve_content_source", {
      p_owner: user.id, p_item: id, p_pool: pool, p_slide: index,
      p_revision: revision, p_preferred: available[0].id,
    });
    if (sourceError || !reserved?.[0]?.asset_id) throw sourceError ?? new Error("SOURCE_TAKEN");
    const prepared = await prepareValidatedJobInput({ userId: user.id, type: "character_swap",
      characterId: item.character_id, payload: { sourceAssetId: reserved[0].asset_id,
        useCharacterReference: true, editModel: "seedream-v4.5", contentAspectRatio: item.aspect_ratio } });
    if (prepared.error) throw new Error(prepared.error);
    const estimate = await buildRouter().estimate("character_swap", prepared.payload);
    const jobId = await createJobWithHold({ userId: user.id, type: "character_swap",
      characterId: item.character_id, payload: prepared.payload,
      idempotencyKey: `content:${id}:${revision}:${index}`, costEstimate: estimate.credits });
    const imageJobs = [...item.image_jobs];
    imageJobs[index] = jobId;
    const { error: saveError } = await sb.from("model_content_items")
      .update({ image_jobs: imageJobs }).eq("id", id).eq("owner_id", user.id);
    if (saveError) throw saveError;
    scheduleKick(jobId);
    return NextResponse.json({ ok: true, jobId, index });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await sb.from("model_content_items").update({ status: "failed", error: message.slice(0, 250) })
      .eq("id", id).eq("owner_id", user.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
