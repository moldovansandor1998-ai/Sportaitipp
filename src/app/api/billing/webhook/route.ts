// Stripe webhook: aláírás-ellenőrzés, replay-védelem, kreditjóváírás checkout.session.completed-nél.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSignature } from "@/lib/stripe";
import { serviceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  const raw = await req.text();
  const valid = verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret);
  const sb = serviceClient();
  let event: { id?: string; type?: string; data?: { object?: { id?: string; metadata?: { userId?: string; planId?: string } } } };
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const eventId = String(event.id ?? "");
  if (!eventId) return NextResponse.json({ ok: false }, { status: 400 });

  if (!valid) {
    console.warn(JSON.stringify({ level: "warn", scope: "stripe.invalid_signature" }));
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const meta = event.data?.object?.metadata ?? {};
  const sessionId = event.data?.object?.id ?? null;
  const { data, error } = await sb.rpc("process_stripe_event", {
    p_event_id: eventId,
    p_type: String(event.type ?? ""),
    p_payload: event,
    p_session_id: sessionId,
    p_user: meta.userId ?? null,
    p_plan: meta.planId ?? null,
  });
  if (error) {
    console.error(JSON.stringify({ level: "error", scope: "stripe.process", eventId, message: error.message }));
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  const replay = data === "replay";
  return NextResponse.json({ ok: true, ...(replay ? { replay: true } : {}) });
}
