import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

async function userId(req: NextRequest) {
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await auth.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  return user?.id ?? null;
}

// A feltöltött fájlok egyetlen tartós sorba kerülnek; a böngésző bezárása nem szakítja meg.
export async function POST(req: NextRequest) {
  const owner = await userId(req);
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { characterId?: string; editModel?: string; files?: Array<{ assetId: string; name: string }> } | null;
  const files = body?.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > 20 ||
    !files.every((f) => typeof f.assetId === "string" && typeof f.name === "string" && f.name.length <= 255) ||
    new Set(files.map((f) => f.assetId)).size !== files.length ||
    !["seedream-v4.5", "nano-banana"].includes(body?.editModel ?? "") || !body?.characterId)
    return NextResponse.json({ error: "validation" }, { status: 400 });
  const svc = serviceClient();
  const [{ data: character }, { data: assets }] = await Promise.all([
    svc.from("characters").select("id,active_version_id").eq("id", body.characterId).eq("owner_id", owner).maybeSingle(),
    svc.from("assets").select("id").eq("owner_id", owner).eq("media_type", "image").in("id", files.map((f) => f.assetId)),
  ]);
  if (!character?.active_version_id || assets?.length !== files.length)
    return NextResponse.json({ error: "INVALID_CHARACTER_OR_ASSET" }, { status: 400 });
  const batchId = randomUUID();
  const { error } = await svc.from("bulk_generation_items").insert(files.map((f) => ({
    owner_id: owner, batch_id: batchId, character_id: body.characterId,
    asset_id: f.assetId, edit_model: body.editModel, filename: f.name,
  })));
  if (error) return NextResponse.json({ error: "QUEUE_FAILED" }, { status: 500 });
  return NextResponse.json({ batchId, count: files.length }, { status: 202 });
}

export async function GET(req: NextRequest) {
  const owner = await userId(req);
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = serviceClient();
  const { data, error } = await svc.from("bulk_generation_items")
    .select("id,batch_id,filename,status,job_id,error,created_at")
    .eq("owner_id", owner).order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "QUEUE_UNAVAILABLE" }, { status: 500 });
  const ids = (data ?? []).map((row) => row.job_id).filter((id): id is string => !!id);
  const { data: jobs } = ids.length ? await svc.from("generation_jobs").select("id,status,error").eq("owner_id", owner).in("id", ids) : { data: [] };
  return NextResponse.json({ items: (data ?? []).map((row) => ({
    ...row, jobStatus: jobs?.find((j) => j.id === row.job_id)?.status ?? null,
    jobError: jobs?.find((j) => j.id === row.job_id)?.error ?? null,
  })) });
}
