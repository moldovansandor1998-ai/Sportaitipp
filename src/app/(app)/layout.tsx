"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/client";

const NAV = [
  { href: "/dashboard", icon: "⌂", label: "Explore" },
  { href: "/characters", icon: "◉", label: "My Models" },
  { href: "/model-studio", icon: "▥", label: "Modellközpont" },
  { href: "/gallery", icon: "▦", label: "Galéria" },
  { href: "/generate", icon: "✦", label: "Generator" },
  { href: "/tools", icon: "⧉", label: "AI Tools" },
  { href: "/content", icon: "✎", label: "Content" },
  { href: "/projects", icon: "▣", label: "Projects" },
  { href: "/jobs", icon: "⚙", label: "Feladataim" },
  { href: "/admin", icon: "♛", label: "Admin" },
  { href: "/calendar", icon: "▤", label: "Content Calendar" },
  { href: "/plans", icon: "◈", label: "Plans" },
  { href: "/settings", icon: "☰", label: "Account Settings" },
];
// Mérföldkő-szintek: a menü az implementáltakat mutatja; a többi a 3–6. mérföldkőben érkezik.

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [providerMode, setProviderMode] = useState<string>("…");
  const [isAdmin, setIsAdmin] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const sb = browserClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      setEmail(user.email ?? "");
      const { data } = await sb.from("credit_accounts").select("balance").eq("user_id", user.id).single();
      setCredits(data?.balance ?? 0);
      const { data: prof } = await sb.from("profiles").select("role").eq("id", user.id).single();
      setIsAdmin((prof as { role: string } | null)?.role === "admin");
      const cfg = await fetch("/api/config/provider");
      if (cfg.ok) setProviderMode(((await cfg.json()) as { mode: string }).mode);
    })();
  }, [pathname]);

  async function logout() {
    await browserClient().auth.signOut();
    router.push("/login");
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          {!collapsed && <strong>Castora</strong>}
          <button className="ghost" style={{ padding: "4px 10px" }} onClick={() => setCollapsed(!collapsed)}>☰</button>
        </div>
        {NAV.filter((item) => item.href !== "/admin" || isAdmin).map((item) => (
          <Link key={item.href} href={item.href} className={`nav ${pathname.startsWith(item.href) ? "active" : ""}`}>
            <span>{item.icon}</span><span className="nav-label">{item.label}</span>
          </Link>
        ))}
      </aside>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div className="topbar">
          <span className="badge">{
            providerMode === "fal" ? "fal.ai" :
            providerMode === "replicate" ? "Replicate" :
            providerMode === "mock" ? "Mock motor (teszt)" : "Nincs konfigurált provider"
          }</span>
          <span style={{ flex: 1 }} />
          <span className="badge">{credits === null ? "…" : `${credits} kredit`}</span>
          <span className="muted">{email}</span>
          <button className="ghost" onClick={logout}>Kilépés</button>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
