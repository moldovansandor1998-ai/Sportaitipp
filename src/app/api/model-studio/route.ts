import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
const Account = z.object({
  id: z.string().uuid(), account_url: z.string().url().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = serviceClient();
  const [accounts, characters, items] = await Promise.all([
    svc.from("model_accounts").select("id,character_id,model_name,platform,login_email,account_url,notes").eq("owner_id", user.id).order("model_name"),
    svc.from("characters").select("id,name,status,active_version_id").eq("owner_id", user.id),
    svc.from("model_content_items").select("*").eq("owner_id", user.id).order("due_at", { ascending: false }).limit(100),
  ]);
  if (accounts.error || characters.error || items.error) return NextResponse.json({ error: "MODEL_STUDIO_UNAVAILABLE" }, { status: 500 });
  const itemIds = (items.data ?? []).map(item => item.id);
  const jobIds = [...new Set((items.data ?? []).flatMap(item => item.image_jobs ?? []))];
  const [uses, jobs] = await Promise.all([
    itemIds.length ? svc.from("content_source_uses").select("item_id,slide_no,revision,source_id,review_status")
      .eq("owner_id", user.id).in("item_id", itemIds) : Promise.resolve({ data: [], error: null }),
    jobIds.length ? svc.from("generation_jobs").select("id,status,result,error")
      .eq("owner_id", user.id).in("id", jobIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (uses.error || jobs.error) return NextResponse.json({ error: "PACKAGE_DETAILS_UNAVAILABLE" }, { status: 500 });
  const assetIds = [...new Set((jobs.data ?? []).flatMap(job => (job.result as { assetIds?: string[] } | null)?.assetIds ?? []))];
  const sourceIds = [...new Set((uses.data ?? []).map(use => use.source_id))];
  const [assets, sources] = await Promise.all([
    assetIds.length ? svc.from("assets").select("id,bucket,object_path").eq("owner_id", user.id).in("id", assetIds)
      : Promise.resolve({ data: [], error: null }),
    sourceIds.length ? svc.from("content_source_images").select("id,asset_id").eq("owner_id", user.id).in("id", sourceIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (assets.error || sources.error) return NextResponse.json({ error: "PACKAGE_MEDIA_UNAVAILABLE" }, { status: 500 });
  const sourceAssetIds = (sources.data ?? []).map(source => source.asset_id);
  const sourceAssets = sourceAssetIds.length ? await svc.from("assets")
    .select("id,bucket,object_path").eq("owner_id", user.id).in("id", sourceAssetIds)
    : { data: [], error: null };
  if (sourceAssets.error) return NextResponse.json({ error: "PACKAGE_SOURCE_UNAVAILABLE" }, { status: 500 });
  const allAssets = [...(assets.data ?? []), ...(sourceAssets.data ?? [])];
  const urls = new Map<string, string>();
  await Promise.all(allAssets.map(async asset => {
    const { data } = await svc.storage.from(asset.bucket).createSignedUrl(asset.object_path, 3600);
    if (data?.signedUrl) urls.set(asset.id, data.signedUrl);
  }));
  const jobsById = new Map((jobs.data ?? []).map(job => [job.id, job]));
  const sourceById = new Map((sources.data ?? []).map(source => [source.id, source]));
  const detailed = (items.data ?? []).map(item => ({ ...item,
    slides: (item.image_jobs ?? []).map((id: string, index: number) => {
      const job = jobsById.get(id);
      const use = (uses.data ?? []).filter(row => row.item_id === item.id && row.slide_no === index)
        .sort((a, b) => b.revision - a.revision)[0];
      const outputId = (job?.result as { assetIds?: string[] } | null)?.assetIds?.[0];
      const source = use ? sourceById.get(use.source_id) : null;
      return { index, job_id: id, status: job?.status ?? "unknown", output_url: outputId ? urls.get(outputId) ?? null : null,
        source_id: use?.source_id ?? null, source_url: source ? urls.get(source.asset_id) ?? null : null,
        review_status: use?.review_status ?? null, error: job?.error ?? null };
    }),
  }));
  return NextResponse.json({ accounts: accounts.data, characters: characters.data, items: detailed });
}

export async function PATCH(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Account.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const { id, ...changes } = parsed.data;
  const { data, error } = await serviceClient().from("model_accounts")
    .update(changes).eq("id", id).eq("owner_id", user.id).select("id").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "ACCOUNT_UPDATE_FAILED" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
