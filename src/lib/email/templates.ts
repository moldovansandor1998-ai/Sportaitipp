// Egyszerű, függőség nélküli HTML-sablonok (Resend html mező).
export type EmailTemplate =
  | "welcome" | "verify_email" | "reset_password"
  | "generation_completed" | "generation_failed" | "credits_refunded"
  | "low_credit" | "purchase_receipt" | "subscription_changed" | "calendar_reminder";

function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#0b0d12;color:#e7e9ee;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px">
    <h1 style="font-size:20px;margin:0 0 16px">${title}</h1>
    <div style="font-size:14px;line-height:1.6;color:#b8bdcb">${body}</div>
    <hr style="border:none;border-top:1px solid #232838;margin:24px 0"/>
    <p style="font-size:12px;color:#6b7385">Castora – saját AI-karakterplatform</p>
  </div></body></html>`;
}

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPE[c]);

export function renderTemplate(template: EmailTemplate, p: Record<string, unknown>): { subject: string; html: string } {
  switch (template) {
    case "welcome":
      return { subject: "Üdvözlünk a Castorában!", html: layout("Üdvözlünk!", `<p>Köszönjük a regisztrációt. A kezdőkreditek jóváíródtak a fiókodon.</p>`) };
    case "verify_email":
      return { subject: "E-mail-cím megerősítése", html: layout("Megerősítés", `<p>Kattints a megerősítő linkre: <a href="${esc(p.confirmUrl)}" style="color:#7cc4ff">${esc(p.confirmUrl)}</a></p>`) };
    case "reset_password":
      return { subject: "Jelszó-visszaállítás", html: layout("Jelszó-visszaállítás", `<p>Link: <a href="${esc(p.resetUrl)}" style="color:#7cc4ff">${esc(p.resetUrl)}</a></p>`) };
    case "generation_completed":
      return { subject: "A generálás elkészült", html: layout("Kész a generálás", `<p>A(z) <strong>${esc(p.jobType)}</strong> feladat sikeresen lefutott. Megnézheted a galériában.</p>`) };
    case "generation_failed":
      return { subject: "A generálás nem sikerült", html: layout("Sikertelen generálás", `<p>A(z) <strong>${esc(p.jobType)}</strong> feladat hibába futott: ${esc(p.error)}. A krediteket visszatérítettük.</p>`) };
    case "credits_refunded":
      return { subject: "Kredit-visszatérítés", html: layout("Visszatérítés", `<p><strong>${esc(p.amount)}</strong> kredit visszatérítésre került (${esc(p.reason)}).</p>`) };
    case "low_credit":
      return { subject: "Fogyó kreditek", html: layout("Alacsony egyenleg", `<p>Kevés kredit maradt (${esc(p.balance)}). Vásárolj a Plans oldalon.</p>`) };
    case "purchase_receipt":
      return { subject: "Vásárlási nyugta", html: layout("Köszönjük a vásárlást", `<p>${esc(p.credits)} kredit jóváírva. Összeg: ${esc(p.amount)}.</p>`) };
    case "subscription_changed":
      return { subject: "Előfizetés módosult", html: layout("Előfizetés", `<p>Új csomag: <strong>${esc(p.plan)}</strong>.</p>`) };
    case "calendar_reminder":
      return { subject: "Bejegyzésed esedékes", html: layout("Emlékeztető", `<p>Ma esedékes: <strong>${esc(p.title)}</strong> (${esc(p.platform)}).</p>`) };
  }
}
