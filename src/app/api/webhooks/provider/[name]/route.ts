// Provider webhook – a szolgáltatók VALÓDI sémái szerint.
// Sorrend: parse → adapter.verifyWebhook(MINDEN headerrel) → ÉRVÉNYES esetén replay-védelem
// (hibás aláírás NEM foglalja le az eseményazonosítót – külön napló, 401).
// Feldolgozás idempotens: terminal állapotú job újrafutása kizárt (finalize_claim + dedup).
import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/server";
import { requireStableEventId, providerWebhookSecret } from "@/lib/security/webhook";

export const runtime = "nodejs";
import { buildRouter } from "@/lib/providers";
import { finalizeJob, failJob, type JobRow } from "@/server/jobs/runJob";

function collectHeaders(req: NextRequest): Record<string, string | null> {
  const wanted = [
    "x-fal-webhook-request-id", "x-fal-webhook-user-id", "x-fal-webhook-timestamp", "x-fal-webhook-signature",
    "webhook-id", "webhook-timestamp", "webhook-signature", "x-castora-signature",
  ];
  const out: Record<string, string | null> = {};
  for (const h of wanted) out[h] = req.headers.get(h);
  return out;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const sb = serviceClient();

  const adapter = buildRouter().getAdapter(name);
  if (!adapter) {
    console.warn(JSON.stringify({ level: "warn", scope: "webhook.unknown_provider", provider: name }));
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }

  // Fail-closed: ahol közös titok kell, annak hiányában nem fogadunk el semmit.
  // fal.ai JWKS-alapú: titok NEM kell (a publikus kulcs hitelesít).
  const secret = providerWebhookSecret(name);
  if (secret === undefined) {
    console.error(JSON.stringify({ level: "error", scope: "webhook.no_secret", provider: name }));
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }
  const sharedSecret = secret ?? undefined;

  const raw = await req.text();
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // 1) ALÁÍRÁS ELŐSZÖR (aszinkron – JWKS) – hibás aláírás NEM rögzít event azonosítót
  const headers = collectHeaders(req);
  const valid = await adapter.verifyWebhook(raw, headers, sharedSecret);
  if (!valid) {
    console.warn(JSON.stringify({
      level: "warn", scope: "webhook.invalid_signature",
      provider: name, ip: req.headers.get("x-forwarded-for"),
    }));
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // 2) Stabil eseményazonosító: body (eventId/id/request_id) vagy hitelesített header fallback
  let eventId: string;
  try {
    eventId = requireStableEventId(body, headers["x-fal-webhook-request-id"] ?? headers["webhook-id"]);
  } catch {
    return NextResponse.json({ error: "missing stable event id" }, { status: 400 });
  }

  // 3) Replay-védelem csak érvényes eseményre
  const { error: insErr } = await sb.from("webhook_events").insert({
    provider: name, event_id: eventId, signature_valid: true, payload: body,
  });
  if (insErr) return NextResponse.json({ ok: true, replay: true });

  // 4) Job megkeresése
  const norm = adapter.normalizeWebhook(body);
  const providerJobId = norm.providerJobId;
  if (!providerJobId) {
    return NextResponse.json({ error: "missing provider job id" }, { status: 400 });
  }
  const { data: job } = await sb.from("generation_jobs").select("*")
    .eq("provider", name).eq("provider_job_id", providerJobId).maybeSingle();
  if (!job) {
    console.warn(JSON.stringify({ level: "warn", scope: "webhook.unknown_job", provider: name, providerJobId }));
    return NextResponse.json({ ok: true }); // ismeretlen job: naplózva, nem hiba
  }
  const row = job as unknown as JobRow;

  // 5) Terminal állapotú job: idempotens no-op (nincs dupla charge/asset/finalize)
  if (["completed", "failed", "cancelled", "refunded"].includes(row.status)) {
    await sb.from("webhook_events").update({ processed_at: new Date().toISOString() })
      .eq("provider", name).eq("event_id", eventId);
    return NextResponse.json({ ok: true, already_terminal: true });
  }

  // 6) Feldolgozás (finalize_claim lease + idempotens finalize véd a duplázódástól)
  const meta = (row as unknown as { provider_meta?: Record<string, unknown> }).provider_meta ?? undefined;
  if (norm.status === "done") {
    // Lehetőleg KÖZVETLENÜL a webhook payloadja (már aláírás-ellenőrzött)
    // A fal webhook általános képfájl-listája nem tartalmazza a tréning súlyfájlját.
    // A modell-specifikus eredményt mindig a provider válaszából normalizáljuk.
    const output = row.type === "character_training"
      ? await adapter.getResult(providerJobId, meta, row.type)
      : norm.output ?? await adapter.getResult(providerJobId, meta, row.type);
    await finalizeJob(row.id, output);
  } else if (norm.status === "failed") {
    await failJob(row, "provider webhook: failed");
  }

  await sb.from("webhook_events").update({ processed_at: new Date().toISOString() })
    .eq("provider", name).eq("event_id", eventId);
  return NextResponse.json({ ok: true });
}
