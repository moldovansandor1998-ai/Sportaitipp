"use client";
import { useAppTranslation } from "@/components/i18n/AppLanguageProvider";
import type { AppLocale } from "@/lib/app-i18n";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { isInternalOwner } from "@/lib/security/internalAccess";
import { AppPreferences, LanguagePicker, useAppPreferences } from "@/components/AppPreferences";
import { browserClient } from "@/lib/supabase/client";


const NAV = [
  { href: "/dashboard", icon: "⌂", label: "Felfedezés" },
  { href: "/characters", icon: "◉", label: "Saját modellek" },
  { href: "/model-studio", icon: "▥", label: "Modellközpont" },
  { href: "/gallery", icon: "▦", label: "Galéria" },
  { href: "/generate", icon: "✦", label: "Generátor" },
  { href: "/tools", icon: "⧉", label: "AI-eszközök" },
  { href: "/content", icon: "✎", label: "Tartalom" },
  { href: "/projects", icon: "▣", label: "Projektek" },
  { href: "/jobs", icon: "⚙", label: "Feladataim" },
  { href: "/admin", icon: "♛", label: "Admin" },
  { href: "/calendar", icon: "▤", label: "Tartalomnaptár" },
  { href: "/plans", icon: "◈", label: "Kreditvásárlás" },
  { href: "/settings", icon: "☰", label: "Fiókbeállítások" },
];
// Mérföldkő-szintek: a menü az implementáltakat mutatja; a többi a 3–6. mérföldkőben érkezik.

export default function AppLayout({ children, initialLocale }: { children: React.ReactNode; initialLocale?: AppLocale }) {
  const [isAdmin, setIsAdmin] = useState(false);
  return <AppPreferences isAdmin={isAdmin} initialLocale={initialLocale}><AppShell setIsAdmin={setIsAdmin}>{children}</AppShell></AppPreferences>;
}

function AppShell({ children, setIsAdmin }: { children: React.ReactNode; setIsAdmin: (value: boolean) => void }) {
  const { isAdmin } = useAppPreferences();
  const { t } = useAppTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [providerMode, setProviderMode] = useState<string>("…");
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const sb = browserClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      setEmail(user.email ?? "");
      const [creditResult, profileResult, cfg] = await Promise.all([
        sb.from("credit_accounts").select("balance").eq("user_id", user.id).single(),
        sb.from("profiles").select("role").eq("id", user.id).single(),
        fetch("/api/config/provider"),
      ]);
      const { data } = creditResult;
      setCredits(data?.balance ?? 0);
      void profileResult;
      setIsAdmin(isInternalOwner(user.email));
      if (cfg.ok) setProviderMode(((await cfg.json()) as { mode: string }).mode);
    })();
  }, [pathname, setIsAdmin]);

  useEffect(() => {
    const refreshCredits = async () => {
      const sb = browserClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data } = await sb.from("credit_accounts").select("balance").eq("user_id", user.id).single();
      if (data) setCredits(data.balance);
    };
    window.addEventListener("castora:credits-changed", refreshCredits);
    return () => window.removeEventListener("castora:credits-changed", refreshCredits);
  }, []);

  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  async function logout() {
    await browserClient().auth.signOut();
    router.push("/login");
  }

  return (
    <div className={`app-shell ${isAdmin ? "owner-workspace" : "customer-workspace"}`}>
      {mobileOpen && <button className="sidebar-backdrop" aria-label={t("Menü bezárása")} onClick={() => setMobileOpen(false)} />}
      <aside id="app-navigation" className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          {!collapsed && <strong>Start AI Creator</strong>}
          <button className="ghost" style={{ padding: "4px 10px" }} aria-label={t("Menü összecsukása")} onClick={() => { setCollapsed(!collapsed); setMobileOpen(false); }}>☰</button>
        </div>
        {NAV.filter((item) => !(["/admin", "/model-studio"].includes(item.href)) || isAdmin).map((item) => (
          <Link key={item.href} href={item.href} className={`nav ${pathname.startsWith(item.href) ? "active" : ""}`}>
            <span>{item.icon}</span><span className="nav-label">{t(item.label)}</span>
          </Link>
        ))}
      </aside>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div className="topbar">
          <button className="ghost mobile-menu-toggle" aria-controls="app-navigation" aria-expanded={mobileOpen} aria-label={t("Menü megnyitása")} onClick={() => setMobileOpen(!mobileOpen)}>☰</button>
          <LanguagePicker />
          {isAdmin && <span className="badge">{
            providerMode === "fal" ? "fal.ai" :
            providerMode === "replicate" ? "Replicate" :
            providerMode === "mock" ? t("Mock motor (teszt)") : t("Nincs konfigurált provider")
          }</span>}
          <span style={{ flex: 1 }} />
          <span className="badge">{credits === null ? "…" : t("{count} kredit", { count: credits })}</span>
          <span className="muted app-account-email" title={email}>{email}</span>
          <button className="ghost" onClick={logout}>{t("Kilépés")}</button>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
