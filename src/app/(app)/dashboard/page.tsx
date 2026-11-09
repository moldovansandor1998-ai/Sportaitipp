"use client";
import { useAppPreferences } from "@/components/AppPreferences";
import { useAppTranslation } from "@/components/i18n/AppLanguageProvider";
import Link from "next/link";
import CustomerDashboard from "@/components/CustomerDashboard";

export default function DashboardPage() {
  const { t } = useAppTranslation();
  const { isAdmin } = useAppPreferences();
  if (!isAdmin) return <CustomerDashboard />;
  return (
    <main>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>{t("Explore")}</h1>
      <p className="muted">{t("Az első mérföldkő célja a teljes, működő alapfolyamat. Indulj a karaktereddel.")}</p>
      <div className="grid" style={{ marginTop: 20 }}>
        <Link href="/characters/new" className="card">
          <h3 style={{ marginTop: 0 }}>{t("◉ Saját karakter létrehozása")}</h3>
          <p className="muted">{t("Referenciafotók feltöltése, QC, tréning, tesztkép.")}</p>
        </Link>
        <Link href="/gallery" className="card">
          <h3 style={{ marginTop: 0 }}>{t("▦ Galéria")}</h3>
          <p className="muted">{t("Kész generálásaid, letöltés, további szerkesztés.")}</p>
        </Link>
        <Link href="/jobs" className="card">
          <h3 style={{ marginTop: 0 }}>{t("⚙ Feladataim")}</h3>
          <p className="muted">{t("Élő állapotok: nincs kitalált százalék, csak tényleges státusz.")}</p>
        </Link>
      </div>
      <p className="muted" style={{ marginTop: 24 }}>
        {t("A további modulok (Social Media Studio, Viral Trends, Carousels, PPV, Spicy, Affiliate, Admin) a 3–6. mérföldkőben épülnek – üres menüpontokat szándékosan nem mutatunk.")}</p>
    </main>
  );
}
