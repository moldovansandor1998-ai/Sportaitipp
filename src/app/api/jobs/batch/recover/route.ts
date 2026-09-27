import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Show only the current user's recent tool uploads that have no bulk job.
// The user chooses the character and gallery category before resuming them.
export async function GET(req: NextRequest) {
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await auth.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = serviceClient();
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: assets, error: assetError } = await svc.from("assets")
    .select("id,sha256,created_at").eq("owner_id", user.id)
    .eq("source", "upload").eq("media_type", "image")
    .like("object_path", `${user.id}/tools/%`)
    .gte("created_at", since).order("created_at", { ascending: false }).limit(200);
  if (assetError) return NextResponse.json({ error: "RECOVERY_LOOKUP_FAILED" }, { status: 500 });
  const ids = (assets ?? []).map((asset) => asset.id);
  const { data: queued, error: queueError } = ids.length
    ? await svc.from("bulk_generation_items").select("asset_id").eq("owner_id", user.id).in("asset_id", ids)
    : { data: [], error: null };
  if (queueError) return NextResponse.json({ error: "RECOVERY_LOOKUP_FAILED" }, { status: 500 });
  const used = new Set((queued ?? []).map((item) => item.asset_id));
  const hashes = new Set<string>();
  const items = (assets ?? []).filter((asset) => {
    if (used.has(asset.id) || hashes.has(asset.sha256)) return false;
    hashes.add(asset.sha256);
    return true;
  }).reverse().map((asset, index) => ({ assetId: asset.id, name: `Korábbi feltöltés ${index + 1}` }));
  return NextResponse.json({ items });
}
