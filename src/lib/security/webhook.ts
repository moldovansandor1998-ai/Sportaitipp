// Webhook-hitelesítés biztonságos primitívjei (szolgáltatónként külön titokkal).
import { createHmac, timingSafeEqual } from "crypto";

/** HMAC-összehasonlítás: rossz hosszúságú aláírást NEM dobjuk el kivétellel. */
export function safeHmacEqual(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = signature.replace(/^sha256=/, "");
  if (got.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(got, "utf8"));
  } catch {
    return false;
  }
}

/** Stabil eseményazonosító kötelező – replay-védelem alapja.
 *  Elfogadja a body eventId/id/request_id mezőket ÉS a hitelesített webhook header-fallbackot
 *  (pl. X-Fal-Webhook-Request-Id, webhook-id) – az adapter már ellenőrizte az aláírást. */
export function requireStableEventId(raw: unknown, headerId?: string | null): string {
  const r = (raw ?? {}) as Record<string, unknown>;
  const bodyId = r.eventId ?? r.id ?? r.request_id;
  const id = (typeof bodyId === "string" && bodyId.length > 0) ? bodyId : headerId;
  if (typeof id !== "string" || id.length === 0 || id.length > 200) {
    throw new Error("MISSING_STABLE_EVENT_ID");
  }
  return id;
}

/** Szolgáltatónkénti titok – csak ahol KÖZÖS titokkal írnak alá.
 *  fal.ai NINCS itt: az Ed25519/JWKS-publikus kulccsal ellenőriz (nincs shared secret). */
export function providerWebhookSecret(provider: string): string | undefined | null {
  const map: Record<string, string | undefined | null> = {
    mock: process.env.PROVIDER_WEBHOOK_SECRET,
    fal: null,                    // JWKS-alapú: a verifyWebhook(secret nélkül) hitelesít
    replicate: process.env.REPLICATE_WEBHOOK_SECRET,
  };
  return map[provider] ?? undefined;
}
