export const runtime = "nodejs";

// Resend (Svix) webhook: hivatalos ellenőrzés időbélyeg-toleranciával +
// replay-védelem (webhook_events unique). Bounce/complaint → suppression.
import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { serviceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: false }, { status: 500 });

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Hivatalos Svix-verification (aláírás + timestamp tolerancia, alap 5 perc)
  let payload: unknown;
  try {
    payload = new Webhook(secret).verify(raw, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const sb = serviceClient();
  const body = (payload ?? {}) as { type?: string; data?: { email_id?: string } };
  const type: string = body.type ?? "";

  // Replay-védelem: svix-id (provider, event_id) unique
  const { error: insErr } = await sb.from("webhook_events").insert({
    provider: "resend", event_id: svixId, signature_valid: true, payload,
  });
  if (insErr) return NextResponse.json({ ok: true, replay: true });

  const messageId = body.data?.email_id;
  if (messageId) {
    if (type === "email.bounced") {
      await sb.from("email_events").update({ status: "bounced" }).eq("provider_message_id", messageId);
    } else if (type === "email.complained") {
      await sb.from("email_events").update({ status: "complained" }).eq("provider_message_id", messageId);
    } else if (type === "email.delivered") {
      await sb.from("email_events").update({ status: "delivered" }).eq("provider_message_id", messageId);
    } else if (type === "email.suppressed") {
      await sb.from("email_events").update({ status: "skipped_suppressed" }).eq("provider_message_id", messageId);
    }
  }

  await sb.from("webhook_events").update({ processed_at: new Date().toISOString() })
    .eq("provider", "resend").eq("event_id", svixId);
  return NextResponse.json({ ok: true });
}
