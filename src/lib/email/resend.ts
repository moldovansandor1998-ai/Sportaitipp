import "server-only";
import { serviceClient } from "@/lib/supabase/server";
import { renderTemplate, type EmailTemplate } from "./templates";

// Idempotencia: a küldés ELŐTT atomi adatbázis-foglalás (email_events unique kulcs),
// majd a Resend hívás is idempotency-key fejléccel megy. Dupla retry = max 1 levél.
// Ez a függvény SOHA nem dob – az e-mailhiba nem ronthatja el az elkészült generálást.

async function isSuppressed(email: string): Promise<boolean> {
  const sb = serviceClient();
  const { data } = await sb.from("email_events")
    .select("id").eq("to_email", email).in("status", ["bounced", "complained"]).limit(1);
  return (data?.length ?? 0) > 0;
}

export async function sendEmail(params: {
  userId: string | null;
  to: string;
  template: EmailTemplate;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<void> {
  const sb = serviceClient();
  try {
    // 1) Atomi foglalás: első beíró nyer, a többi kiesik (unique violation → némán vissza)
    const { data: claimed, error: claimErr } = await sb.from("email_events").insert({
      user_id: params.userId, template: params.template, to_email: params.to,
      payload: params.payload ?? {}, status: "pending", idempotency_key: params.idempotencyKey,
    }).select("id").single();
    if (claimErr || !claimed) return;

    const mark = async (status: string, providerMessageId?: string | null) => {
      await sb.from("email_events").update({ status, provider_message_id: providerMessageId ?? null })
        .eq("id", claimed.id);
    };

    if (!process.env.RESEND_API_KEY) {
      await mark("skipped_no_key");
      return;
    }
    if (await isSuppressed(params.to)) {
      await mark("skipped_suppressed");
      return;
    }

    // 2) Küldés Resend idempotency-key fejléccel
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { html, subject } = renderTemplate(params.template, params.payload ?? {});
    // Idempotencia-kulcs a SDK requestOptions paraméterében (nem a levél fejléceként!)
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to: params.to,
      subject,
      html,
    }, { idempotencyKey: params.idempotencyKey });
    await mark(error ? "failed" : "sent", data?.id);
  } catch {
    // szándékosan lenyelve – a generálás sikeressége nem függhet az e-mailtől
  }
}
