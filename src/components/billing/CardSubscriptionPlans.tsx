"use client";
import { useEffect, useRef, useState } from "react";
import { SUBSCRIPTION_PLANS } from "@/lib/billing/subscriptionPlans";
import { cardPaymentsReady } from "@/lib/billing/card-readiness";
import { safeWhopCheckoutUrl } from "@/lib/billing/whop";
import { browserClient } from "@/lib/supabase/client";
import { useAppTranslation } from "@/components/i18n/AppLanguageProvider";

export default function CardSubscriptionPlans() {
  const { t, locale } = useAppTranslation();
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const starting = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/billing/whop/plans", { cache: "no-store", signal: controller.signal })
      .then(async response => response.ok && cardPaymentsReady(await response.json()))
      .then(value => { if (!controller.signal.aborted) setReady(value); })
      .catch(() => { if (!controller.signal.aborted) setReady(false); });
    return () => controller.abort();
  }, []);
  async function checkout(plan: string) {
    if (!ready || starting.current) return;
    starting.current = true; setPending(true); setError("");
    try {
      const { data: { session } } = await browserClient().auth.getSession();
      if (!session) throw new Error("Jelentkezz be újra.");
      const response = await fetch("/api/billing/whop/checkout", { method: "POST", cache: "no-store", headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ plan }) });
      const result = await response.json();
      if (!response.ok || result.code !== "CHECKOUT_READY" || typeof result.url !== "string") throw new Error("A kártyás fizetés jelenleg nem indítható. Próbáld újra később.");
      window.location.assign(safeWhopCheckoutUrl(result.url, false));
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "Jelentkezz be újra." ? cause.message : "A kártyás fizetés jelenleg nem indítható. Próbáld újra később.");
    } finally { starting.current = false; setPending(false); }
  }
  return <section aria-labelledby="card-subscriptions" style={{ marginBottom: 32 }}>
    <h2 id="card-subscriptions">{t("Kártyás előfizetések")}</h2>
    <p className="muted">{t("A kártyás előfizetés 30 naponta automatikusan megújul. A kriptós fizetés külön, kézi fizetés marad.")}</p>
    {!ready && <p role="status">{t("A kártyás fizetés még tesztelés alatt áll, jelenleg nem vásárolható meg.")}</p>}
    <div className="grid">
      {SUBSCRIPTION_PLANS.map(plan => <section key={plan.key} className="card">
        <h3>{plan.name}</h3>
        <p><strong>{new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(Number(plan.monthlyBasePrice))}</strong> {t("/ 30 nap")}</p>
        <p>{t("{count} kredit időszakonként", { count: plan.monthlyCredits.toLocaleString(locale) })}</p>
        <button disabled={!ready || pending} onClick={() => void checkout(plan.key)}>{pending ? t("Fizetési oldal megnyitása…") : ready ? t("Előfizetés bankkártyával") : t("Hamarosan elérhető")}</button>
      </section>)}
    </div>
    <p className="muted">{t("Az esetleges adókat, a végösszeget és a lemondás feltételeit a fizetési oldalon látod a jóváhagyás előtt.")}</p>
    {error && <p role="alert" className="error">{t(error)}</p>}
  </section>;
}
