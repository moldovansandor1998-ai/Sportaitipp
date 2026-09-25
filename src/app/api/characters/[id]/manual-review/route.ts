import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";
import { inspectReferenceFile } from "@/lib/referenceQuality";
import { TRAINING_LIMITS } from "@/lib/trainingDataset";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await auth.auth.getUser(bearer);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.confirmed !== true || !["references", "test_image"].includes(body.stage)) {
    return NextResponse.json({ error: "REVIEW_CONFIRMATION_REQUIRED" }, { status: 400 });
  }
  const svc = serviceClient();
  const { data: character } = await svc.from("characters").select("id,status")
    .eq("id", id).eq("owner_id", user.id).single();
  if (!character) return NextResponse.json({ error: "CHARACTER_NOT_OWNED" }, { status: 403 });

  if (body.stage === "test_image") {
    if (character.status !== "test_pending" || typeof body.versionId !== "string") {
      return NextResponse.json({ error: "TEST_IMAGE_NOT_READY" }, { status: 409 });
    }
    const { data, error } = await svc.rpc("approve_character_test_image_manual", {
      p_character: id, p_owner: user.id, p_version: body.versionId,
    });
    if (error) return NextResponse.json({ error: "REVIEW_FAILED", detail: error.message }, { status: 409 });
    return NextResponse.json({ ok: data === true, method: "owner_visual_review" });
  }

  if (character.status !== "collecting_refs") {
    return NextResponse.json({ error: "REFERENCES_NOT_READY" }, { status: 409 });
  }
  const { data: refs, error: refsError } = await svc.from("character_reference_images")
    .select("id,asset_id").eq("character_id", id).eq("qc_status", "pending").limit(TRAINING_LIMITS.maxFiles + 1);
  if (refsError || !refs || refs.length < 3 || refs.length > TRAINING_LIMITS.maxFiles) {
    return NextResponse.json({ error: "INVALID_REFERENCE_COUNT" }, { status: 409 });
  }
  const seen = new Set<string>();
  let total = 0;
  for (const ref of refs) {
    const { data: asset } = await svc.from("assets")
      .select("id,bucket,object_path,content_type,bytes,sha256")
      .eq("id", ref.asset_id).eq("owner_id", user.id).single();
    if (!asset || asset.bucket !== "references" || asset.bytes > TRAINING_LIMITS.maxFileBytes) {
      return NextResponse.json({ error: "INVALID_REFERENCE_ASSET" }, { status: 422 });
    }
    total += asset.bytes;
    if (total > TRAINING_LIMITS.maxTotalBytes) {
      return NextResponse.json({ error: "REFERENCE_SET_TOO_LARGE" }, { status: 413 });
    }
    const { data: blob, error: downloadError } = await svc.storage.from("references").download(asset.object_path);
    if (downloadError || !blob) return NextResponse.json({ error: "REFERENCE_DOWNLOAD_FAILED" }, { status: 502 });
    const check = inspectReferenceFile(Buffer.from(await blob.arrayBuffer()), asset, seen);
    if (!check.ok) return NextResponse.json({ error: check.error, referenceId: ref.id }, { status: 422 });
    if (check.contentType !== asset.content_type) {
      const { error: correctionError } = await svc.from("assets")
        .update({ content_type: check.contentType }).eq("id", asset.id).eq("owner_id", user.id);
      if (correctionError) return NextResponse.json({ error: "IMAGE_METADATA_UPDATE_FAILED" }, { status: 500 });
    }
  }
  const { data, error } = await svc.rpc("approve_character_references_manual", {
    p_character: id, p_owner: user.id, p_ref_ids: refs.map((r) => r.id),
  });
  if (error) return NextResponse.json({ error: "REVIEW_FAILED", detail: error.message }, { status: 409 });
  return NextResponse.json({ approved: data, method: "integrity_and_owner_visual_review" });
}
