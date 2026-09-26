"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { browserClient } from "@/lib/supabase/client";

type Account = { id: string; character_id: string | null; model_name: string; platform: string; login_email: string; account_url: string | null; notes: string | null };
type Character = { id: string; name: string; status: string; active_version_id: string | null };
type Item = { id: string; character_id: string; platform: string; local_date: string; post_hour: number; due_at: string; aspect_ratio: string; status: string; trend_title: string | null; trend_url: string | null; copy: { slides?: string[]; caption?: string }; image_jobs: string[]; error: string | null };

export default function ModelStudio() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState("");
  const load = useCallback(async () => {
    const token = (await browserClient().auth.getSession()).data.session?.access_token;
    const response = await fetch("/api/model-studio", { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) { setError("A modellközpont nem tölthető be."); return; }
    const data = await response.json();
    setAccounts(data.accounts); setCharacters(data.characters); setItems(data.items);
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => { void load(); }, 30000); return () => clearInterval(timer); }, [load]);

  async function save(account: Account) {
    setSaving(account.id); setError("");
    const token = (await browserClient().auth.getSession()).data.session?.access_token;
    const response = await fetch("/api/model-studio", {
      method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ id: account.id, account_url: account.account_url || null, notes: account.notes || null }),
    });
    if (!response.ok) setError("A fiókadat mentése sikertelen.");
    setSaving(null);
  }

  async function previewEvening() {
    setPreviewing(true); setError("");
    const token = (await browserClient().auth.getSession()).data.session?.access_token;
    const response = await fetch("/api/model-studio/preview", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) setError(response.status === 503 ? "Az automatikus képkészítés minőségi ellenőrzésig szünetel." : "A 19:00-s próba nem indult el.");
    else {
      const result = await response.json();
      setPreviewResult(`19:00-s próba: ${result.created} új poszt, ${result.processed} képfeladat sorba állítva. A továbbiakat a percenkénti feldolgozó indítja.`);
      await load();
    }
    setPreviewing(false);
  }

  return <main style={{ maxWidth: 1050 }}>
    <h1>Modellközpont</h1>
    <p className="muted">Fiókok, aktív karakterek és napi tartalmak egy helyen. A belépési e-mail itt azonosító; jelszót nem tárolunk.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))", gap: 12 }}>
      {[...new Set(accounts.map(a => a.model_name))].map(name => {
        const list = accounts.filter(a => a.model_name === name);
        const character = characters.find(c => c.id === list[0]?.character_id);
        return <section className="card" key={name}>
          <h2 style={{ marginTop: 0 }}>{name}</h2>
          <p className="muted">{character ? `Karakter: ${character.status}` : "Karakter még nincs létrehozva"}</p>
          {character && <Link href={`/characters/${character.id}`}>Karakter megnyitása</Link>}
          {list.map(a => <div key={a.id} style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}>
            <strong>{a.platform === "fanvue" ? "Fanvue" : a.platform === "tiktok" ? "TikTok" : "Telegram"}</strong>
            <p style={{ overflowWrap: "anywhere", margin: "6px 0" }}>{a.login_email}</p>
            <input aria-label={`${name} ${a.platform} profil URL`} placeholder="Profil URL" value={a.account_url ?? ""}
              onChange={e => setAccounts(prev => prev.map(x => x.id === a.id ? { ...x, account_url: e.target.value } : x))} />
            <input aria-label={`${name} ${a.platform} megjegyzés`} placeholder="Megjegyzés" value={a.notes ?? ""}
              onChange={e => setAccounts(prev => prev.map(x => x.id === a.id ? { ...x, notes: e.target.value } : x))} />
            <button className="ghost" disabled={saving === a.id} onClick={() => void save(a)}>Mentés</button>
          </div>)}
        </section>;
      })}
    </div>
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Posztok és képcsomagok</h2>
      <p className="muted">Budapesti idő: TikTok 12, 16, 20 óra; a képek 11, 15, 19 órára készülnek. TikTok 9:16, Fanvue és Telegram szabad képarány.</p>
      <button disabled={previewing} onClick={() => void previewEvening()}>{previewing ? "Előkészítés…" : "19:00-s előkészítés kipróbálása"}</button>
      {previewResult && <p role="status">{previewResult}</p>}
      {items.length === 0 && <p>Még nincs előkészített tartalom.</p>}
      {items.map(item => <article key={item.id} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}>
        <strong>{characters.find(c => c.id === item.character_id)?.name ?? "Modell"} · {item.platform} · {item.local_date} {item.post_hour}:00</strong>
        <p className="muted">{item.status} · {item.aspect_ratio} · határidő: {new Date(item.due_at).toLocaleString("hu-HU", { timeZone: "Europe/Budapest" })}</p>
        {item.trend_url && <a href={item.trend_url} target="_blank" rel="noreferrer">Trend forrása: {item.trend_title}</a>}
        {item.copy?.slides?.map((slide, i) => <p key={i}>{i + 1}. kép szövege: {slide}</p>)}
        {item.copy?.caption && <p>Posztleírás: {item.copy.caption}</p>}
        {item.image_jobs?.length > 0 && <p className="muted">Képfeladatok: {item.image_jobs.join(", ")}</p>}
        {item.error && <p className="error">{item.error}</p>}
      </article>)}
    </section>
  </main>;
}
