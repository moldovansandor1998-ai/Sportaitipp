"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/client";
import { CRYPTO_NETWORK, formatUsdt, type CryptoOrder } from "@/lib/billing/crypto";

interface Plan { id: string; name: string; credits: number; price_usdt: number; }

async function api(path: string, body?: Record<string, unknown>) {
  const { data: { session } } = await browserClient().auth.getSession();
  if (!session) throw new Error("Jelentkezz be újra.");
  const response = await fetch(`/api/billing/crypto/${path}`, {
    method: body ? "POST" : "GET", cache: "no-store",
    headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "A kérés nem sikerült.");
  return result;
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [orders, setOrders] = useState<CryptoOrder[]>([]);
  const [selected, setSelected] = useState<CryptoOrder | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [tx, setTx] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [watch, setWatch] = useState(false);
  const verifying = useRef(false);

  const refresh = useCallback(async () => {
    const result = await api("orders");
    setPlans(result.plans); setOrders(result.orders); setBalance(result.balance);
    window.dispatchEvent(new Event("castora:credits-changed"));
  }, []);
  useEffect(() => { refresh().catch(e => setError(e.message)); }, [refresh]);

  function select(order: CryptoOrder) {
    setSelected(order); setTx(order.submitted_tx_hash ?? ""); setWatch(false); setMsg(""); setError("");
  }
  async function buy(planId: string) {
    setBusy(true); setError(""); setWatch(false);
    try { const result = await api("orders", { planId }); select(result.order); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "A vásárlás nem indítható."); }
    finally { setBusy(false); }
  }
  const verify = useCallback(async () => {
    if (!selected || verifying.current) return;
    verifying.current = true; setBusy(true); setError("");
    try {
      const result = await api("verify", { orderId: selected.id, txHash: tx.trim() });
      if (result.status === "completed") {
        setSelected({ ...selected, status: "completed" }); setWatch(false);
        setMsg(`${selected.credits.toLocaleString("hu-HU")} kreditet jóváírtunk a fiókodban.`);
        await refresh();
      } else { setMsg(result.message); setWatch(true); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Az ellenőrzés nem sikerült."); setWatch(false);
    } finally { verifying.current = false; setBusy(false); }
  }, [selected, tx, refresh]);
  useEffect(() => {
    if (!watch) return;
    const timer = setInterval(() => { void verify(); }, 16_000);
    return () => clearInterval(timer);
  }, [watch, verify]);

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setMsg("Vágólapra másolva."); }
    catch { setError("A másolás nem sikerült. Jelöld ki és másold ki a szöveget."); }
  }
  const expired = selected ? Date.parse(selected.expires_at) < Date.now() : false;

  return <main style={{ maxWidth: 920 }}>
    <h1 style={{ fontSize: 26, marginTop: 0 }}>Kreditvásárlás</h1>
    <p className="muted">Egyszeri feltöltés USDT-vel a TRON (TRC20) hálózaton. Nincs automatikus megújítás.</p>
    <p><strong>Egyenleged: {balance === null ? "…" : balance.toLocaleString("hu-HU")} kredit</strong></p>
    <div className="grid">
      {plans.map(p => <section key={p.id} className="card">
        <h2 style={{ marginTop: 0, fontSize: 20 }}>{p.name}</h2>
        <p style={{ fontSize: 28, margin: "8px 0" }}>{Number(p.price_usdt)} <span style={{ fontSize: 16 }}>USDT</span></p>
        <p><strong>{p.credits.toLocaleString("hu-HU")} kredit</strong></p>
        <p className="muted">Saját karakterekhez, képekhez, videókhoz és hangeszközökhöz.</p>
        <button disabled={busy} onClick={() => buy(p.id)}>Fizetés USDT TRC20-val</button>
      </section>)}
    </div>
    <p className="muted" style={{ fontSize: 13 }}>A fizetéskor néhány milliomod–legfeljebb 0,10 USDT egyedi kedvezményt kapsz. Pontosan a fizetési kérelemben szereplő összeget küldd: ez azonosítja a rendelésedet.</p>
    {selected && <section className="card" style={{ marginTop: 24, border: "1px solid var(--accent, #8b5cf6)" }}>
      <h2 style={{ marginTop: 0, fontSize: 21 }}>{selected.status === "completed" ? "Sikeres kreditfeltöltés" : "Fizetési adatok"}</h2>
      {selected.status === "completed" ? <p>{selected.credits.toLocaleString("hu-HU")} kredit jóváírva.</p> : <>
        {expired ? <p role="alert"><strong>A fizetési határidő lejárt. Erre a kérelemre már ne utalj.</strong> A határidő előtt elküldött tranzakciót továbbra is ellenőrizheted.</p> : <>
          <p>Hálózat: <strong>{CRYPTO_NETWORK}</strong> · Token: <strong>USDT</strong></p>
          <p style={{ fontSize: 27, overflowWrap: "anywhere" }}><strong>{formatUsdt(Number(selected.amount_units))} USDT</strong></p>
          <button className="ghost" onClick={() => copy(formatUsdt(Number(selected.amount_units)))}>Pontos összeg másolása</button>
          <p className="muted">Fogadó cím</p>
          <code style={{ display: "block", overflowWrap: "anywhere", userSelect: "all", marginBottom: 12 }}>{selected.recipient}</code>
          <button className="ghost" onClick={() => copy(selected.recipient)}>Tárcacím másolása</button>
          <p className="muted">Határidő: {new Date(selected.expires_at).toLocaleString("hu-HU")}</p>
          <p>Csak USDT-t küldj, TRC20 hálózaton. A hálózati vagy kiutalási díjon felül a fenti pontos összegnek kell megérkeznie. Ne kerekítsd az összeget.</p>
        </>}
        <label htmlFor="tx-hash" style={{ display: "block", marginTop: 20 }}>Utalás után illeszd be a tranzakcióazonosítót (TXID)</label>
        <input id="tx-hash" value={tx} onChange={e => { setTx(e.target.value); setWatch(false); }} autoComplete="off" spellCheck={false}
          placeholder="64 karakteres tranzakcióazonosító" style={{ width: "100%", margin: "8px 0 12px" }} disabled={busy} />
        <button onClick={() => void verify()} disabled={busy || !/^[a-f0-9]{64}$/i.test(tx.trim())}>{busy ? "Ellenőrzés…" : "Fizetés ellenőrzése és kredit jóváírása"}</button>
        <p className="muted">A jóváírás a hálózati megerősítés után automatikus. Egy tranzakció egyszer használható fel. Megerősítésre várva ne utalj újra.</p>
      </>}
    </section>}
    {msg && <p role="status" style={{ marginTop: 16 }}>{msg}</p>}
    {error && <p role="alert" style={{ marginTop: 16, color: "#fca5a5" }}>{error}</p>}
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 19 }}>Korábbi feltöltések és fizetési kérelmek</h2>
      {orders.length === 0 ? <p className="muted">Még nincs USDT-fizetési kérelmed.</p> : orders.map(order => <div className="card" key={order.id} style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <span>{order.credits.toLocaleString("hu-HU")} kredit · {formatUsdt(Number(order.amount_units))} USDT<br /><small className="muted">{new Date(order.created_at).toLocaleString("hu-HU")} · {order.status === "completed" ? "Jóváírva" : Date.parse(order.expires_at) < Date.now() ? "Lejárt fizetési határidő" : "Fizetésre / megerősítésre vár"}</small></span>
        <button className="ghost" disabled={busy} onClick={() => select(order)}>Megnyitás</button>
      </div>)}
    </section>
    <p className="muted">Eltérő összeg vagy elakadt fizetés esetén: <a href="mailto:moldovansandor1998@gmail.com">moldovansandor1998@gmail.com</a>. Írd meg a TXID-t és a rendelésazonosítót{selected ? ` (${selected.id})` : ""}.</p>
  </main>;
}
