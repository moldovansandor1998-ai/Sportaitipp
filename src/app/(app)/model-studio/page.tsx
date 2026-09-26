"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { browserClient } from "@/lib/supabase/client";

type Account = { id: string; character_id: string | null; model_name: string; platform: string; login_email: string; account_url: string | null; notes: string | null };
type Character = { id: string; name: string; status: string; active_version_id: string | null; birth_date: string | null };
type Slide = { index: number; job_id: string; status: string; output_url: string | null; source_id: string | null; source_url: string | null; review_status: string | null; favorite: boolean; error: unknown };
type Item = { id: string; character_id: string; platform: string; local_date: string; post_hour: number; due_at: string; aspect_ratio: string; status: string; trend_title: string | null; trend_url: string | null; copy: { slides?: string[]; caption?: string }; image_jobs: string[]; slides: Slide[]; error: string | null };
type Source = { id: string; pool: "tiktok" | "telegram" | "fanvue_public"; preview_url: string | null; used_at: string | null };

export default function ModelStudio() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState("");
  const load = useCallback(async () => {
    const token = (await browserClient().auth.getSession()).data.session?.access_token;
    const [response, sourceResponse] = await Promise.all([
      fetch("/api/model-studio", { headers: { authorization: `Bearer ${token}` } }),
      fetch("/api/model-studio/sources", { headers: { authorization: `Bearer ${token}` } }),
    ]);
    if (!response.ok) { setError("A modellközpont nem tölthető be."); return; }
    const data = await response.json();
    setAccounts(data.accounts); setCharacters(data.characters); setItems(data.items);
    if (sourceResponse.ok) setSources((await sourceResponse.json()).sources);
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
      setPreviewResult(`18:00-s próba: ${result.created} új poszt, ${result.processed} képfeladat sorba állítva. A továbbiakat a percenkénti feldolgozó indítja.`);
      await load();
    }
    setPreviewing(false);
  }

  async function uploadSources(pool: Source["pool"], files: File[]) {
    if (!files.length) return;
    setUploading(pool); setError(""); setUploadResult("");
    setUploadProgress(0);
    const token = (await browserClient().auth.getSession()).data.session?.access_token;
    let saved = 0;
    const failures: string[] = [];
    for (const [index, file] of files.entries()) {
      try {
        const signResponse = await fetch("/api/model-studio/sources/sign", { method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ pool, contentType: file.type, size: file.size }) });
        if (!signResponse.ok) { failures.push(`${file.name}: ${(await signResponse.json()).error ?? "aláírási hiba"}`); continue; }
        const { objectPath, token: uploadToken } = await signResponse.json();
        const { error: uploadError } = await browserClient().storage.from("assets")
          .uploadToSignedUrl(objectPath, uploadToken, file, { contentType: file.type });
        if (uploadError) { failures.push(`${file.name}: ${uploadError.message}`); continue; }
        const response = await fetch("/api/model-studio/sources/finalize", { method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ pool, objectPath }) });
        if (response.ok) saved++;
        else failures.push(`${file.name}: ${(await response.json()).error ?? "lezárási hiba"}`);
      } catch { failures.push(`${file.name}: hálózati hiba`); }
      finally { setUploadProgress(index + 1); }
    }
    setUploadResult(`${saved} kép feltöltve.${failures.length ? ` ${failures.join("; ")}` : ""}`);
    setUploading(null); await load();
  }

  async function regenerate(item: Item, slide: Slide) {
    setSaving(slide.job_id); setError("");
    const token = (await browserClient().auth.getSession()).data.session?.access_token;
    const response = await fetch(`/api/model-studio/items/${item.id}/slides/${slide.index}/regenerate`, {
      method: "POST", headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) setError((await response.json()).error ?? "Az újragenerálás sikertelen.");
    else setPreviewResult(`${slide.index + 1}. kép új forrásképpel sorba állítva.`);
    setSaving(null); await load();
  }

  async function favorite(item: Item, slide: Slide) {
    if (!slide.source_id) return;
    setSaving(slide.job_id); setError("");
    const token = (await browserClient().auth.getSession()).data.session?.access_token;
    const response = await fetch(`/api/model-studio/sources/${slide.source_id}/preferred`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ characterId: item.character_id, preferred: !slide.favorite }),
    });
    if (!response.ok) setError((await response.json()).error ?? "A kedvenc forrás mentése sikertelen.");
    setSaving(null); await load();
  }

  const publicItems = items.filter(item => item.platform !== "fanvue_paid");
  const archivedPaid = items.filter(item => item.platform === "fanvue_paid");
  const dates = [...new Set(publicItems.map(item => item.local_date))].sort().reverse();
  const platformName = (platform: string) => ({ tiktok: "TikTok", telegram: "Telegram", fanvue_public: "Fanvue · nyilvános" }[platform] ?? platform);
  const birthDetails = (birthDate: string) => {
    const [year, month, day] = birthDate.split("-").map(Number);
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const [currentYear, currentMonth, currentDay] = today.split("-").map(Number);
    const age = currentYear - year - (currentMonth < month || (currentMonth === month && currentDay < day) ? 1 : 0);
    return `${new Intl.DateTimeFormat("hu-HU", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)))} · ${age} éves`;
  };

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
          {character?.birth_date && <p>Született: {birthDetails(character.birth_date)}</p>}
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
      <h2>Forrásképek tömeges feltöltése</h2>
      <p className="muted">Ezek a képek a jelenetet adják. A modell arcát és haját a saját, jóváhagyott referenciafotói adják. Egy forrásképet csak egyetlen eredményhez használunk fel.</p>
      <p className="muted">{characters.filter(c => c.status === "active").length} aktív modell teljes napjához {characters.filter(c => c.status === "active").length * 9} TikTok-forrás, {characters.filter(c => c.status === "active").length} Telegram-forrás és {characters.filter(c => c.status === "active").length} Fanvue-forrás szükséges. Ha elfogynak, a következő poszt várakozik.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))", gap: 16 }}>
        {([ ["tiktok", "TikTok · 9:16"], ["telegram", "Telegram"], ["fanvue_public", "Fanvue · nyilvános, nem explicit"] ] as const).map(([pool, label]) => {
          const list = sources.filter(s => s.pool === pool);
          return <div key={pool}>
            <h3>{label}</h3>
            <label htmlFor={`sources-${pool}`}>Képek kiválasztása</label>
            <input id={`sources-${pool}`} type="file" accept="image/jpeg,image/png,image/webp" multiple
              disabled={uploading !== null} onChange={e => {
                const selected = Array.from(e.currentTarget.files ?? []);
                e.currentTarget.value = "";
                void uploadSources(pool, selected);
              }} />
            <p className="muted">{uploading === pool ? `Feltöltés: ${uploadProgress} feldolgozva` : `${list.filter(s => !s.used_at).length} szabad · ${list.filter(s => s.used_at).length} felhasznált`}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6 }}>
              {list.slice(0, 24).map(s => <div key={s.id} style={{ position: "relative" }}>
                {s.preview_url && <img src={s.preview_url} alt="Feltöltött jelenetminta" style={{ width: "100%", aspectRatio: "9 / 16", objectFit: "cover" }} />}
                <small style={{ display: "block" }}>{s.used_at ? "Felhasználva" : "Szabad"}</small>
              </div>)}
            </div>
          </div>;
        })}
      </div>
      {uploadResult && <p role="status">{uploadResult}</p>}
    </section>
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Posztok és képcsomagok</h2>
      <p className="muted">Budapesti idő: TikTok 12, 16, 20 óra; előkészítés 10, 14, 18 órakor, cél a poszt előtt egy órával kész képcsomag. TikTok 9:16, Fanvue és Telegram szabad képarány.</p>
      <button disabled={previewing} onClick={() => void previewEvening()}>{previewing ? "Előkészítés…" : "18:00-s előkészítés kipróbálása"}</button>
      {previewResult && <p role="status">{previewResult}</p>}
      {publicItems.length === 0 && <p>Még nincs előkészített tartalom.</p>}
      {dates.map(date => <section key={date} style={{ borderTop: "2px solid var(--border)", marginTop: 24, paddingTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>{new Date(`${date}T12:00:00Z`).toLocaleDateString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "long", day: "numeric" })}</h3>
        {[...new Set(publicItems.filter(item => item.local_date === date).map(item => item.post_hour))].sort((a, b) => b - a).map(hour => <div key={hour} style={{ margin: "16px 0 24px", padding: 14, border: "1px solid var(--border)", borderRadius: 12 }}>
          <h4 style={{ margin: "0 0 12px" }}>{String(hour).padStart(2, "0")}:00-s posztok · budapesti idő</h4>
          {publicItems.filter(item => item.local_date === date && item.post_hour === hour)
            .sort((a, b) => (characters.find(c => c.id === a.character_id)?.name ?? "").localeCompare(characters.find(c => c.id === b.character_id)?.name ?? "", "hu")
              || ["tiktok", "telegram", "fanvue_public"].indexOf(a.platform) - ["tiktok", "telegram", "fanvue_public"].indexOf(b.platform))
            .map(item => <details key={item.id} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          {characters.find(c => c.id === item.character_id)?.name ?? "Modell"} · {platformName(item.platform)} · {item.slides?.some(slide => slide.status === "deleted") ? "galériából törölt kép" : item.status === "ready" ? "kész" : item.status === "generating" ? "készül" : item.status === "planned" ? "tervezett" : "hiba"} · {item.slides?.length ?? 0} kép
        </summary>
        <p className="muted">{item.aspect_ratio} · elkészítési célidő: {new Date(item.due_at).toLocaleString("hu-HU", { timeZone: "Europe/Budapest" })}</p>
        {item.trend_url && <a href={item.trend_url} target="_blank" rel="noreferrer">Trend forrása: {item.trend_title}</a>}
        {item.slides?.length ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
          {item.slides.map(slide => <div className="card" key={slide.job_id} style={{ padding: 12 }}>
            <strong>{slide.index + 1}. kép · {slide.status === "completed" ? "kész" : slide.status === "deleted" ? "törölve" : slide.status === "processing" || slide.status === "queued" ? "készül" : "hiba"}</strong>
            {slide.output_url ? <a href={slide.output_url} target="_blank" rel="noreferrer"><img src={slide.output_url} alt={`${slide.index + 1}. elkészült kép`} style={{ display: "block", width: "100%", maxHeight: 390, objectFit: "contain", marginTop: 8 }} /></a>
              : <p className="muted">{slide.status === "deleted" ? "A kép elkészült, de később törölték a galériából." : slide.status === "completed" ? "A kép elkészült, de a fájl nem elérhető." : ["failed", "cancelled"].includes(slide.status) ? "A képkészítés sikertelen volt." : "A kép még készül."}</p>}
            {item.copy?.slides?.[slide.index] && <p><strong>Képszöveg:</strong> {item.copy.slides[slide.index]}</p>}
            <p className="muted">Forráskép: {slide.source_id ? slide.source_id.slice(0, 8) : "még nincs"} · {slide.review_status ?? "—"}</p>
            {slide.source_url && <a href={slide.source_url} target="_blank" rel="noreferrer"><img src={slide.source_url} alt={`${slide.index + 1}. kép forrása`} style={{ width: 80, height: 100, objectFit: "cover" }} /></a>}
            {slide.source_id && slide.status === "completed" && slide.review_status !== "rejected" &&
              <button className="ghost" disabled={saving === slide.job_id} onClick={() => void favorite(item, slide)}>
                {slide.favorite ? "Kedvenc forrás kikapcsolása" : "Jó forrás · használd újra ehhez a modellhez"}
              </button>}
            {["completed", "deleted", "failed", "cancelled"].includes(slide.status) && ["ready", "failed"].includes(item.status)
              && slide.review_status !== "rejected" && <button className="ghost" disabled={saving === slide.job_id}
                onClick={() => void regenerate(item, slide)}>{slide.status === "deleted" ? "Törölt kép pótlása" : "Ez a kép nem jó · újragenerálás"}</button>}
          </div>)}
        </div> : <p className="muted">A csomaghoz még nem indult képfeladat.</p>}
        {item.copy?.caption && <p><strong>Posztleírás:</strong> {item.copy.caption}</p>}
        {item.error && <p className="error">{item.error}</p>}
            </details>)}
        </div>)}
      </section>)}
      {archivedPaid.length > 0 && <details style={{ marginTop: 20 }}>
        <summary>Régi, nem aktív Fanvue-feladatok ({archivedPaid.length})</summary>
        <p className="muted">Ezek nem részei a most elkészült nyilvános Fanvue-csomagoknak.</p>
        {archivedPaid.map(item => <p key={item.id}>{characters.find(c => c.id === item.character_id)?.name ?? "Modell"} · {item.local_date} {item.post_hour}:00 · {item.status}</p>)}
      </details>}
    </section>
  </main>;
}
