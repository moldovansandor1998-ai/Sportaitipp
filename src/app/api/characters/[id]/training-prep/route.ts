// Tréning-előkészítés v2 – sorrend: auth → tulajdon → állapot → approved refek → dataset-validáció
// → prefix → PROVIDER-kiválasztás (router, nem hardcode) → ATOMI claim → payload (versionId+destination).
// Hiba esetén a claimelt verzió failed – nincs árva „training" verzió.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";
import { buildRouter } from "@/lib/providers";
import { assertProviderConfigured } from "@/lib/providers";
import { buildZip, sniffImage, TRAINING_LIMITS } from "@/lib/trainingDataset";
import sharp from "sharp";

const LIMITS = TRAINING_LIMITS;
const ALLOWED_PROVIDERS = new Set(["fal", "replicate", "mock"]); // mock: dev/testben

interface RefRow { id: string; asset_id: string; }
interface AssetRow { id: string; bucket: string; object_path: string; content_type: string; }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // 1) auth + 2) tulajdon
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = serviceClient();
  const { data: character } = await svc.from("characters")
    .select("id,owner_id,status,name").eq("id", id).eq("owner_id", user.id).single();
  if (!character) return NextResponse.json({ error: "CHARACTER_NOT_OWNED" }, { status: 403 });
  const ch = character as { id: string; status: string; name: string };

  // 3) állapot
  if (ch.status !== "ready_to_train") {
    return NextResponse.json({ error: "CHARACTER_NOT_READY" }, { status: 409 });
  }

  // Resume the unsubmitted version before inspecting mutable references. The ZIP is
  // the exact snapshot approved when this version was prepared.
  const router = buildRouter();
  try { assertProviderConfigured(router, "character_training"); }
  catch { return NextResponse.json({ error: "NO_PROVIDER_CONFIGURED" }, { status: 503 }); }
  const provider = router.candidates("character_training")[0].name;
  if (!ALLOWED_PROVIDERS.has(provider)) return NextResponse.json({ error: "PROVIDER_NOT_ALLOWED" }, { status: 500 });
  const ttlSec = Number(process.env.TRAINING_SIGNED_URL_TTL_SECONDS ?? 3600);
  const slug = ch.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "character";
  // A job elküldése elbukhat az előkészítés után. A már tárolt, jobhoz még nem
  // kötött datasetet ilyenkor új aláírt URL-lel használjuk, nem foglalunk új verziót.
  const { data: prepared, error: preparedError } = await svc.from("character_versions")
    .select("id,provider,destination,dataset_object_path,generation_job_id")
    .eq("character_id", id).eq("status", "prepared")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (preparedError) return NextResponse.json({ error: "VERSION_LOOKUP_FAILED" }, { status: 500 });
  if (prepared && (prepared.generation_job_id || prepared.provider !== provider || !prepared.dataset_object_path)) {
    return NextResponse.json({ error: "PREPARED_VERSION_CONFLICT" }, { status: 409 });
  }
  if (prepared && !prepared.generation_job_id && prepared.provider === provider && prepared.dataset_object_path) {
    // A signed URL may be created even if the object was removed; verify the ZIP.
    const { data: dataset, error: datasetError } = await svc.storage.from("assets")
      .download(prepared.dataset_object_path);
    if (datasetError || !dataset) return NextResponse.json({ error: "PREPARED_DATASET_MISSING" }, { status: 409 });
    const { data: signed, error: signError } = await svc.storage.from("assets")
      .createSignedUrl(prepared.dataset_object_path, ttlSec);
    if (signError || !signed?.signedUrl) {
      return NextResponse.json({ error: "DATASET_SIGN_FAILED" }, { status: 500 });
    }
    await svc.from("character_versions").update({ dataset_expires_at: new Date(Date.now() + ttlSec * 1000).toISOString() })
      .eq("id", prepared.id).eq("status", "prepared");
    return NextResponse.json({ payload: {
      imagesZipUrl: signed.signedUrl,
      triggerWord: `char_${slug.replace(/-/g, "_")}`,
      steps: 1000,
      versionId: prepared.id,
      ...(prepared.destination ? { destination: prepared.destination } : {}),
    }, provider, signedUrlTtlSeconds: ttlSec });
  }

  // 4) approved referenciák
  const { data: refs, error: refsError } = await svc.from("character_reference_images")
    .select("id,asset_id")
    .eq("character_id", id).eq("qc_status", "approved").order("sort_order").limit(LIMITS.maxFiles);
  if (refsError) return NextResponse.json({ error: "REFERENCE_LOOKUP_FAILED" }, { status: 500 });
  const approvedRefs = (refs ?? []) as RefRow[];
  const refIds = approvedRefs.map((r) => r.asset_id);
  const { data: assets, error: assetsError } = refIds.length
    ? await svc.from("assets").select("id,bucket,object_path,content_type").in("id", refIds)
    : { data: [], error: null };
  if (assetsError) return NextResponse.json({ error: "ASSET_LOOKUP_FAILED" }, { status: 500 });
  const byId = new Map(((assets ?? []) as AssetRow[]).map((asset) => [asset.id, asset]));
  const usable = approvedRefs.map((ref) => ({ ref, asset: byId.get(ref.asset_id) }))
    .filter((item): item is { ref: RefRow; asset: AssetRow } => Boolean(item.asset));
  if (usable.length < LIMITS.minFiles) {
    return NextResponse.json({ error: "NOT_ENOUGH_APPROVED_REFS", need: LIMITS.minFiles, have: usable.length }, { status: 409 });
  }

  // 5) dataset-validáció (magic-byte + kumulatív korlát)
  const entries: { name: string; data: Buffer }[] = [];
  let totalBytes = 0;
  let zipImageBytes = 0;
  for (const [i, { ref, asset: r }] of usable.entries()) {
    if (totalBytes >= LIMITS.maxTotalBytes) return NextResponse.json({ error: "REFERENCE_SET_TOO_LARGE" }, { status: 413 });
    // Read private storage directly; signed URL fetches can fail on server egress rules.
    const { data: blob, error: downloadError } = await svc.storage.from(r.bucket).download(r.object_path);
    if (downloadError || !blob) return NextResponse.json({ error: "REFERENCE_DOWNLOAD_FAILED", referenceId: ref.id }, { status: 502 });
    const buf = Buffer.from(await blob.arrayBuffer());
    if (buf.length > LIMITS.maxFileBytes || totalBytes + buf.length > LIMITS.maxTotalBytes)
      return NextResponse.json({ error: "REFERENCE_SET_TOO_LARGE", referenceId: ref.id }, { status: 413 });
    totalBytes += buf.length;
    const sniffed = sniffImage(buf);
    if (!sniffed || r.content_type !== sniffed) return NextResponse.json({ error: "INVALID_REFERENCE_ASSET", referenceId: ref.id }, { status: 422 });
    // The originals stay in the references bucket. Normalize only the training dataset
    // so a full set of 25 high-resolution photographs fits into a single provider ZIP.
    let resized: Buffer;
    try {
      resized = await sharp(buf, { limitInputPixels: 40_000_000 }).rotate()
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    } catch { return NextResponse.json({ error: "INVALID_REFERENCE_ASSET", referenceId: ref.id }, { status: 422 }); }
    zipImageBytes += resized.length;
    if (zipImageBytes + usable.length * 128 > LIMITS.maxZipBytes)
      return NextResponse.json({ error: "TRAINING_DATASET_TOO_LARGE" }, { status: 413 });
    entries.push({ name: `ref_${String(i + 1).padStart(2, "0")}.jpg`, data: resized });
  }
  if (entries.length !== usable.length || entries.length < LIMITS.minFiles || totalBytes > LIMITS.maxTotalBytes) {
    return NextResponse.json({ error: "DATASET_BUILD_FAILED" }, { status: 413 });
  }

  // The provider and version were checked before rebuilding the dataset.
  const prefix = process.env.LORA_DESTINATION_PREFIX;
  if (provider === "replicate" && !prefix) {
    return NextResponse.json({ error: "LORA_DESTINATION_PREFIX_NOT_CONFIGURED" }, { status: 500 });
  }
  const prepKey = randomUUID();                      // stabil kulcs az idempotens claimhez
  const zip = buildZip(entries);
  if (zip.length > LIMITS.maxZipBytes) return NextResponse.json({ error: "TRAINING_DATASET_TOO_LARGE" }, { status: 413 });

  // 8) ATOMI verziófoglalás – a ZIP a catch-ben is elérhető (claim sikertelensége esetén is törlődik)
  let claim: { version_id: string; version_no: number } | null = null;
  let datasetPath: string | null = null;      // a try ELŐTT – a catch minden esetben látja
  try {
    // A fájl URL-je önmagában is ZIP-ként azonosítható a szolgáltatónál.
    datasetPath = `${user.id}/training/${id}/${randomUUID()}.zip`;
    const { error: upErr } = await svc.storage.from("assets").upload(datasetPath, zip, { contentType: "application/zip" });
    if (upErr) throw new Error(upErr.message);
    const { data: signed, error: signErr } = await svc.storage.from("assets")
      .createSignedUrl(datasetPath, ttlSec);
    if (signErr || !signed?.signedUrl) throw new Error("SIGNED_URL_FAILED");
    const dataset = { imagesZipUrl: signed.signedUrl };
    const datasetExpires = new Date(Date.now() + ttlSec * 1000).toISOString();

    const { data: claimed, error: claimErr } = await svc.rpc("claim_character_version", {
      p_character: id, p_provider: provider, p_job: null,
      p_destination: null, p_dataset_path: datasetPath, p_preparation_key: prepKey,
    });
    if (claimErr || !claimed) throw new Error(claimErr?.message ?? "VERSION_CLAIM_FAILED");
    claim = claimed as { version_id: string; version_no: number };

    // destination + lejárat a verzióra (a foglalt számmal)
    const destination = provider === "replicate" ? `${prefix}/${slug}-v${claim.version_no}` : null;
    const { error: versionErr } = await svc.from("character_versions").update({
      destination,
      dataset_expires_at: datasetExpires,
    }).eq("id", claim.version_id);
    if (versionErr) throw new Error(`VERSION_UPDATE_FAILED: ${versionErr.message}`);

    return NextResponse.json({
      payload: {
        ...dataset,
        ...(destination ? { destination } : {}),
        triggerWord: `char_${slug.replace(/-/g, "_")}`,
        steps: 1000,
        versionId: claim.version_id,
      },
      refsUsed: entries.length,
      zipBytes: zip.length,
      provider,
      signedUrlTtlSeconds: ttlSec,
      limits: LIMITS,
    });
  } catch (e: unknown) {
    // 9) hibaág: AZONNALI takarítás – claim-, adatbázis- VAGY provider-kiválasztási hiba esetén is.
    // A ZIP-et akkor is töröljük, ha a verziófoglalás még nem történt meg (csak a feltöltés igen).
    if (datasetPath) {
      await svc.storage.from("assets").remove([datasetPath]).catch(() => {});
    }
    if (claim) {
      const { data: v } = await svc.from("character_versions").select("dataset_object_path").eq("id", claim.version_id).single();
      const p = (v as { dataset_object_path: string | null } | null)?.dataset_object_path;
      if (p) await svc.storage.from("assets").remove([p]).catch(() => {});
      await svc.from("character_versions").update({ status: "failed", dataset_object_path: null })
        .eq("id", claim.version_id).eq("status", "training");
    }
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg.includes("TRAINING_ALREADY_ACTIVE") ? "TRAINING_ALREADY_ACTIVE" : "PREP_FAILED", detail: msg }, { status: 409 });
  }
}
