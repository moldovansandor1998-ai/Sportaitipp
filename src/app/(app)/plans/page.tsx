"use client";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/client";

interface Plan { id: string; name: string; credits: number; price_huf: number; }

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    (async () => {
      const sb = browserClient();
      const { data } = await sb.from("plans").select("*").eq("active", true);
      setPlans((data ?? []) as Plan[]);
    })();
  }, []);

  async function buy(planId: string) {
    setMsg("");
    const sb = browserClient();
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { authorization: `Bearer ${session?.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ planId }),
    });
    const b = await res.json() as { url?: string; error?: string };
    if (res.ok && b.url) location.href = b.url;
    else setMsg(b.error === "STRIPE_NOT_CONFIGURED"
      ? "A fizetés nincs konfigurálva (STRIPE_SECRET_KEY hiányzik) – kód kész, kulcs szükséges."
      : b.error ?? "Hiba");
  }

  return (
    <main style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Plans</h1>
      <div className="grid">
        {plans.map((p) => (
          <div key={p.id} className="card">
            <h3 style={{ marginTop: 0 }}>{p.name}</h3>
            <p style={{ fontSize: 22, margin: "6px 0" }}>{p.price_huf.toLocaleString("hu-HU")} Ft</p>
            <p className="muted">{p.credits.toLocaleString("hu-HU")} kredit</p>
            <button onClick={() => buy(p.id)}>Vásárlás</button>
          </div>
        ))}
      </div>
      {msg && <p className="muted" style={{ marginTop: 12 }}>{msg}</p>}
    </main>
  );
}
