import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await auth.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const characterId = req.nextUrl.searchParams.get("characterId");
  const sb = serviceClient();
  let query = sb.from("generation_jobs").select("id,character_id,created_at,payload")
    .eq("owner_id", user.id).eq("type", "nureta_scene_video").eq("provider", "nureta")
    .in("status", ["completed", "refunded"]).not("result", "is", null).order("created_at", { ascending: false }).limit(50);
  if (characterId) query = query.eq("character_id", characterId);
  const { data: jobs, error } = await query;
  if (error) return NextResponse.json({ error: "NURETA_VIDEOS_UNAVAILABLE" }, { status: 500 });
  const { data: gallery, error: galleryError } = jobs?.length ? await sb.from("gallery_items")
    .select("asset_id,job_id,assets!inner(media_type)").eq("owner_id", user.id)
    .is("deleted_at", null).eq("assets.media_type", "video").in("job_id", jobs.map(j => j.id)) : { data: [], error: null };
  if (galleryError) return NextResponse.json({ error: "NURETA_VIDEOS_UNAVAILABLE" }, { status: 500 });
  const items = (jobs ?? []).flatMap(job => (gallery ?? []).filter(g => g.job_id === job.id).map(g => ({
    assetId: g.asset_id, jobId: job.id, characterId: job.character_id, createdAt: job.created_at,
    duration: (job.payload as { duration?: number })?.duration,
  })));
  return NextResponse.json({ items });
}
