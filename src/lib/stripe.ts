import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// Production-ready Stripe-integráció (kulcsok nélkül: konfigurációs hiba – őszinte 503).
export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function requireStripe(): string {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new Error("STRIPE_NOT_CONFIGURED");
  return k;
}

export async function stripePost(path: string, params: URLSearchParams): Promise<Response> {
  const key = requireStripe();
  return fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(20_000),
  });
}

/** Stripe webhook-aláírás (Stripe-Signature: t=...,v1=...). */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const ts = Number(parts.t);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const sig = parts.v1 ?? "";
  if (sig.length !== expected.length) return false;
  try { return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8")); }
  catch { return false; }
}
