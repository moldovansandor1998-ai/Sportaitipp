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
import { buildZip, zipToDataUrl, sniffImage, TRAINING_LIMITS } from "@/lib/trainingDataset";

const LIMITS = TRAINING_LIMITS;
const ALLOWED_PROVIDERS = new Set(["fal", "replicate", "mock"]); // mock: dev/testben

async function downloadCapped(url: string, maxBytes: number): Promise<Buffer | null> {
  const res = await fetch(url);
  if (!res.ok || !res.body) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(Buffer.from(value));
    }
  } finally { reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

interface RefRow { assets: { bucket: string; object_path: string; content_type: string } | null; }

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

  // 4) approved referenciák
  const { data: refs } = await svc.from("character_reference_images")
    .select("asset_id,assets(bucket,object_path,content_type)")
    .eq("character_id", id).eq("qc_status", "approved").order("sort_order").limit(LIMITS.maxFiles);
  const usable = ((refs ?? []) as unknown as RefRow[]).filter((r) => r.assets);
  if (usable.length < LIMITS.minFiles) {
    return NextResponse.json({ error: "NOT_ENOUGH_APPROVED_REFS", need: LIMITS.minFiles, have: usable.length }, { status: 409 });
  }

  // 5) dataset-validáció (magic-byte + kumulatív korlát)
  const entries = [];
  let totalBytes = 0;
  for (const [i, r] of usable.entries()) {
    if (totalBytes >= LIMITS.maxTotalBytes) break;
    const { data: signed } = await svc.storage.from(r.assets!.bucket)
      .createSignedUrl(r.assets!.object_path, 120);
    const buf = signed?.signedUrl
      ? await downloadCapped(signed.signedUrl, Math.min(LIMITS.maxFileBytes, LIMITS.maxTotalBytes - totalBytes))
      : null;
    if (!buf) continue;
    totalBytes += buf.length;
    const sniffed = sniffImage(buf);
    if (!sniffed || r.assets!.content_type !== sniffed) continue;
    entries.push({ name: `ref_${String(i + 1).padStart(2, "0")}.${sniffed.split("/")[1].replace("jpeg", "jpg")}`, data: buf });
  }
  if (entries.length < LIMITS.minFiles || totalBytes > LIMITS.maxTotalBytes) {
    return NextResponse.json({ error: "DATASET_BUILD_FAILED" }, { status: 413 });
  }

  // 6) prefix + 7) provider-kiválasztás (a ROUTER dönt, nem hardcode; kliens nem választhat)
  const prefix = process.env.LORA_DESTINATION_PREFIX;
  if (!prefix) return NextResponse.json({ error: "LORA_DESTINATION_PREFIX_NOT_CONFIGURED" }, { status: 500 });
  const router = buildRouter();
  assertProviderConfigured(router, "character_training");
  const provider = router.candidates("character_training")[0].name;
  if (!ALLOWED_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: "PROVIDER_NOT_ALLOWED", provider }, { status: 500 });
  }

  const slug = ch.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "character";
  const prepKey = randomUUID();                      // stabil kulcs az idempotens claimhez
  const zip = buildZip(entries);
  const ttlSec = Number(process.env.TRAINING_SIGNED_URL_TTL_SECONDS ?? 3600); // KONFIGURÁLHATÓ (alap 1 óra)

  // 8) ATOMI verziófoglalás – a ZIP a catch-ben is elérhető (claim sikertelensége esetén is törlődik)
  let claim: { version_id: string; version_no: number } | null = null;
  let datasetPath: string | null = null;      // a try ELŐTT – a catch minden esetben látja
  try {
    // nagy dataset: ZIP feltöltése + signed URL (élettartam a queue-hoz igazítva)
    let dataset: Record<string, unknown>;
    let datasetExpires: string | null = null;
    if (zip.length > LIMITS.maxZipBytes) {
      datasetPath = `${user.id}/training/${id}/${randomUUID()}.zip`;
      const { error: upErr } = await svc.storage.from("assets").upload(datasetPath, zip, { contentType: "application/zip" });
      if (upErr) throw new Error(upErr.message);
      const { data: signed, error: signErr } = await svc.storage.from("assets")
        .createSignedUrl(datasetPath, ttlSec);
      if (signErr || !signed?.signedUrl) throw new Error("SIGNED_URL_FAILED"); // null URL soha nem megy ki
      dataset = { imagesZipUrl: signed.signedUrl };
      datasetExpires = new Date(Date.now() + ttlSec * 1000).toISOString();
    } else {
      dataset = { imagesDataUrl: zipToDataUrl(zip) };
    }

    const { data: claimed, error: claimErr } = await svc.rpc("claim_character_version", {
      p_character: id, p_provider: provider, p_job: null,
      p_destination: null, p_dataset_path: datasetPath, p_preparation_key: prepKey,
    });
    if (claimErr || !claimed) throw new Error(claimErr?.message ?? "VERSION_CLAIM_FAILED");
    claim = claimed as { version_id: string; version_no: number };

    // destination + lejárat a verzióra (a foglalt számmal)
    await svc.from("character_versions").update({
      destination: `${prefix}/${slug}-v${claim.version_no}`,
      dataset_expires_at: datasetExpires,
    }).eq("id", claim.version_id);

    return NextResponse.json({
      payload: {
        ...dataset,
        destination: `${prefix}/${slug}-v${claim.version_no}`,
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
