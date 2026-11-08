"use client";
import { useAppTranslation } from "@/components/i18n/AppLanguageProvider";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { browserClient } from "@/lib/supabase/client";

type Account = { id: string; character_id: string | null; model_name: string; platform: string; login_email: string | null; account_url: string | null; notes: string | null };
type Character = { id: string; name: string; status: string; active_version_id: string | null; birth_date: string | null; occupation: string | null; elevenlabs_voice_id: string | null; elevenlabs_hungarian_tts: boolean };
type Slide = { index: number; job_id: string; status: string; output_url: string | null; source_id: string | null; source_url: string | null; review_status: string | null; favorite: boolean; error: unknown };
type Item = { id: string; character_id: string; platform: string; local_date: string; post_hour: number; due_at: string; aspect_ratio: string; status: string; trend_title: string | null; trend_url: string | null; copy: { slides?: string[]; caption?: string }; image_jobs: string[]; slides: Slide[]; error: string | null };
type Source = { id: string; pool: "tiktok" | "telegram" | "fanvue_public"; preview_url: string | null; used_at: string | null };
type XAccount = { character_id: string; x_username: string; enabled: boolean;
  timezone: string; morning_minute: number; evening_minute: number };
type XPost = { character_id: string; local_date: string; slot: string; status: string; x_post_id: string | null; error: string | null };

export default function ModelStudio() {
  const { t, locale } = useAppTranslation();
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
  const [xAccounts, setXAccounts] = useState<XAccount[]>([]);
  const [xHistory, setXHistory] = useState<XPost[]>([]);
  const [xConfigured, setXConfigured] = useState(false);
  const [xBusy, setXBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const token = (await browserClient().auth.getSession()).data.session?.access_token;
    const [response, sourceResponse, xResponse] = await Promise.all([
      fetch("/api/model-studio", { headers: { authorization: `Bearer ${token}` } }),
      fetch("/api/model-studio/sources", { headers: { authorization: `Bearer ${token}` } }),
      fetch("/api/x/accounts", { headers: { authorization: `Bearer ${token}` } }),
    ]);
    if (!response.ok) { setError("A modellközpont nem tölthető be."); return; }
    const data = await response.json();
    setAccounts(data.accounts); setCharacters(data.characters); setItems(data.items);
    if (sourceResponse.ok) setSources((await sourceResponse.json()).sources);
    if (xResponse.ok) { const x = await xResponse.json(); setXAccounts(x.accounts ?? []);
      setXHistory(x.history ?? []); setXConfigured(x.configured === true); }
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => { void load(); }, 30000); return () => clearInterval(timer); }, [load]);

  async function save(account: Account) {
    setSaving(account.id); setError("");
    const token = (await browserClient().auth.getSession()).data.session?.access_token;
    const response = await fetch("/api/model-studio", {
      method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ id: account.id, account_url: account.account_url || null, notes: account.notes || null }),
    });
    if (!response.ok) setError(t("A fiókadat mentése sikertelen."));
    setSaving(null);
  }

  async function saveVoice(character: Character) {
    setSaving(character.id); setError("");
    try {
      const token = (await browserClient().auth.getSession()).data.session?.access_token;
      const response = await fetch(`/api/characters/${character.id}/voice`, { method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ voiceId: character.elevenlabs_voice_id?.trim() || null, hungarianTts: character.elevenlabs_hungarian_tts }) });
      if (!response.ok) throw new Error(t("A hang mentése nem sikerült. Ellenőrizd az ElevenLabs voice ID-t."));
      await load();
    } catch (error) { setError(error instanceof Error ? error.message : t("A hang nem menthető.")); }
    finally { setSaving(null); }
  }

  async function connectX(characterId: string) {
    setXBusy(characterId); setError("");
    try {
      const token = (await browserClient().auth.getSession()).data.session?.access_token;
      const response = await fetch("/api/x/connect", { method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ characterId }) });
      if (!response.ok) throw new Error(t("Az X összekötése nem indult el."));
      const result = await response.json();
      window.location.assign(result.url);
    } catch { setError(t("Az X összekötése nem indult el. Ellenőrizd az X API beállításait.")); setXBusy(null); }
  }

  async function setXEnabled(characterId: string, enabled: boolean) {
    setXBusy(characterId); setError("");
    const token = (await browserClient().auth.getSession()).data.session?.access_token;
    const response = await fetch("/api/x/accounts", { method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ characterId, enabled }) });
    if (!response.ok) setError(t("Az X időzítés állapotát nem sikerült menteni."));
    await load(); setXBusy(null);
  }

  async function previewEvening() {
    setPreviewing(true); setError("");
    const token = (await browserClient().auth.getSession()).data.session?.access_token;
    const response = await fetch("/api/model-studio/preview", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) setError(response.status === 503 ? t("Az automatikus képkészítés minőségi ellenőrzésig szünetel.") : t("A 19:00-s próba nem indult el."));
    else {
      const result = await response.json();
      setPreviewResult(t("18:00-s próba: {p0} új poszt, {p1} képfeladat sorba állítva. A továbbiakat a percenkénti feldolgozó indítja.", {p0: result.created, p1: result.processed}));
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
        if (!signResponse.ok) { failures.push(t("{p0}: {p1}", {p0: file.name, p1: (await signResponse.json()).error ?? t("aláírási hiba")})); continue; }
        const { objectPath, token: uploadToken } = await signResponse.json();
        const { error: uploadError } = await browserClient().storage.from("assets")
          .uploadToSignedUrl(objectPath, uploadToken, file, { contentType: file.type });
        if (uploadError) { failures.push(`${file.name}: ${uploadError.message}`); continue; }
        const response = await fetch("/api/model-studio/sources/finalize", { method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ pool, objectPath }) });
        if (response.ok) saved++;
        else failures.push(t("{p0}: {p1}", {p0: file.name, p1: (await response.json()).error ?? t("lezárási hiba")}));
      } catch { failures.push(t("{p0}: hálózati hiba", {p0: file.name})); }
      finally { setUploadProgress(index + 1); }
    }
    setUploadResult(t("{p0} kép feltöltve.{p1}", {p0: saved, p1: failures.length ? ` ${failures.join("; ")}` : ""}));
    setUploading(null); await load();
  }

  async function regenerate(item: Item, slide: Slide) {
    setSaving(slide.job_id); setError("");
    const token = (await browserClient().auth.getSession()).data.session?.access_token;
    const response = await fetch(`/api/model-studio/items/${item.id}/slides/${slide.index}/regenerate`, {
      method: "POST", headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) setError((await response.json()).error ?? t("Az újragenerálás sikertelen."));
    else setPreviewResult(t("{p0}. kép új forrásképpel sorba állítva.", {p0: slide.index + 1}));
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
    if (!response.ok) setError((await response.json()).error ?? t("A kedvenc forrás mentése sikertelen."));
    setSaving(null); await load();
  }

  const publicItems = items.filter(item => item.platform !== "fanvue_paid");
  const archivedPaid = items.filter(item => item.platform === "fanvue_paid");
  const dates = [...new Set(publicItems.map(item => item.local_date))].sort().reverse();
  const platformName = (platform: string) => ({ tiktok: "TikTok", telegram: "Telegram", fanvue_public: t("Fanvue · nyilvános") }[platform] ?? platform);
  const birthDetails = (birthDate: string) => {
    const [year, month, day] = birthDate.split("-").map(Number);
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const [currentYear, currentMonth, currentDay] = today.split("-").map(Number);
    const age = currentYear - year - (currentMonth < month || (currentMonth === month && currentDay < day) ? 1 : 0);
    return t("{p0} · {p1} éves", {p0: new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day))), p1: age});
  };

  return <main style={{ maxWidth: 1050 }}>
    <h1>{t("Modellközpont")}</h1>
    <p className="muted">{t("Fiókok, aktív karakterek és napi tartalmak egy helyen. A belépési e-mail itt azonosító; jelszót nem tárolunk.")}</p>
    {error && <p className="error" role="alert">{t(error)}</p>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))", gap: 12 }}>
      {[...new Set(accounts.map(a => a.model_name))].map(name => {
        const list = accounts.filter(a => a.model_name === name);
        const character = characters.find(c => c.id === list[0]?.character_id);
        return <section className="card" key={name}>
          <h2 style={{ marginTop: 0 }}>{name}</h2>
          {character?.birth_date && <p>{t("Született:")}{" "}{birthDetails(character.birth_date)}</p>}
          {character?.occupation && <p>{t("Foglalkozás:")}{" "}{character.occupation}</p>}
          <p className="muted">{character ? t("Karakter: {status}", { status: t(character.status) }) : t("Karakter még nincs létrehozva")}</p>
          {character && <Link href={`/characters/${character.id}`}>{t("Karakter megnyitása")}</Link>}
          {character && <div style={{ marginTop: 12 }}>
            <label htmlFor={`voice-${character.id}`}>{t("Karakter ElevenLabs voice ID")}</label>
            <input id={`voice-${character.id}`} value={character.elevenlabs_voice_id ?? ""}
              onChange={event => setCharacters(current => current.map(item => item.id === character.id
                ? { ...item, elevenlabs_voice_id: event.target.value } : item))} />
            <label><input type="checkbox" checked={character.elevenlabs_hungarian_tts}
              onChange={event => setCharacters(current => current.map(item => item.id === character.id
                ? { ...item, elevenlabs_hungarian_tts: event.target.checked } : item))} />{t("Magyar beszéd újramondása hangcserekor")}</label>
            <button className="ghost" disabled={saving === character.id} onClick={() => void saveVoice(character)}>
              {saving === character.id ? t("Hang mentése…") : t("Karakterhang mentése")}</button>
          </div>}
          {list.map(a => <div key={a.id} style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}>
            <strong>{a.platform === "fanvue" ? "Fanvue" : a.platform === "tiktok" ? "TikTok" : "Telegram"}</strong>
            {a.login_email && <p style={{ overflowWrap: "anywhere", margin: "6px 0" }}>{a.login_email}</p>}
            {a.account_url && <p style={{ overflowWrap: "anywhere", margin: "6px 0" }}><a href={a.account_url} target="_blank" rel="noopener noreferrer">{t("Profil megnyitása ↗")}</a></p>}
            <input aria-label={`${name} ${a.platform} profil URL`} placeholder={t("Profil URL")} value={a.account_url ?? ""}
              onChange={e => setAccounts(prev => prev.map(x => x.id === a.id ? { ...x, account_url: e.target.value } : x))} />
            <input aria-label={t("{p0} {p1} megjegyzés", {p0: name, p1: a.platform})} placeholder={t("Megjegyzés")} value={a.notes ?? ""}
              onChange={e => setAccounts(prev => prev.map(x => x.id === a.id ? { ...x, notes: e.target.value } : x))} />
            <button className="ghost" disabled={saving === a.id} onClick={() => void save(a)}>{t("Mentés")}</button>
          </div>)}
        </section>;
      })}
    </div>
    <section className="card" style={{ marginTop: 16 }}>
      <h2>{t("X · napi 10 automatikus képes poszt")}</h2>
      <p className="muted">{t("A modell TikTok galériájának már felhasznált képeiből választ; ugyanazt a képet X-en soha nem posztolja újra. Minden poszt a kiválasztott képhez illő kérdést tartalmaz; a Fanvue-link csak a 20:49-es posztba kerül. Budapesti idő szerint: 06:13, 08:37, 10:23, 12:03, 14:46, 17:06, 19:38, 20:49, 22:58, 23:29. Ha elfogynak a még nem posztolt képek, a következő időpont kimarad, amíg új TikTok-képek nem érkeznek.")}</p>
      {xAccounts.some(account => !account.enabled && xHistory.some(post => post.character_id === account.character_id && post.error === "X_POST_402"))
        && <p className="error" role="alert">{t("Az X API 402-es számlázási hibát adott, ezért az érintett fiókok automatikus posztolása leállt. Ellenőrizd a")}{" "}<a href="https://console.x.com/account" target="_blank" rel="noopener noreferrer">{t("Credits · Remaining balance")}</a>{" "}{t("részt. Ha újra van felhasználható egyenleg, az alábbi „Automatika indítása” gombbal kapcsold vissza az érintett fiókokat.")}</p>}
      {!xConfigured && <p className="error">{t("Az X fejlesztői alkalmazás kulcsai még hiányoznak. Az összekötés addig nem indítható.")}</p>}
      {typeof window !== "undefined" && new URLSearchParams(window.location.search).get("x") === "failed"
        && <p className="error">{t("Az X összekötése nem sikerült. Ellenőrizd az engedélyezést és próbáld újra.")}</p>}
      {characters.map(character => {
        const linked = xAccounts.find(a => a.character_id === character.id);
        const fanvue = accounts.find(a => a.character_id === character.id && a.platform === "fanvue" && a.account_url);
        const recent = xHistory.find(p => p.character_id === character.id);
        return <div key={character.id} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}>
          <strong>{character.name}</strong> · {linked ? `@${linked.x_username}` : t("X nincs összekötve")}
          {!fanvue && <p className="error">{t("Hiányzik a Fanvue-profil linkje. Írd be fent a modell Fanvue-fiókjánál és mentsd el.")}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <button className="ghost" disabled={!xConfigured || xBusy !== null}
              onClick={() => void connectX(character.id)}>{linked ? t("X újra összekötése") : t("X-fiók összekötése")}</button>
            {linked && <button className="ghost" disabled={xBusy !== null}
              onClick={() => void setXEnabled(character.id, !linked.enabled)}>{linked.enabled ? t("Automatika szüneteltetése") : t("Automatika indítása")}</button>}
            {linked && <span>{linked.enabled ? t("Aktív") : t("Szünetel")}{" "}{t("· napi 10 poszt (Budapest)")}</span>}
          </div>
          {recent && <small>{t("Legutóbbi:")}{" "}{recent.local_date} {recent.slot === "morning" ? "08:30" : recent.slot === "evening" ? "20:30" : recent.slot} · {recent.status === "posted" ? t("közzétéve") : recent.error === "X_POST_402" ? t("X API számlázási hiba (402), automatika leállítva") : recent.status === "failed" ? t("hiba: {detail}", { detail: recent.error ?? t("ismeretlen") }) : t("folyamatban")}</small>}
        </div>;
      })}
    </section>
    <section className="card" style={{ marginTop: 16 }}>
      <h2>{t("Forrásképek tömeges feltöltése")}</h2>
      <p className="muted">{t("Ezek a képek a jelenetet adják. A modell arcát és haját a saját, jóváhagyott referenciafotói adják. Egy forrásképet csak egyetlen eredményhez használunk fel.")}</p>
      <p className="muted">{characters.filter(c => c.status === "active").length}{" "}{t("aktív modell teljes napjához")}{" "}{characters.filter(c => c.status === "active").length * 9}{" "}{t("TikTok-forrás,")}{" "}{characters.filter(c => c.status === "active").length}{" "}{t("Telegram-forrás és")}{" "}{characters.filter(c => c.status === "active").length}{" "}{t("Fanvue-forrás szükséges. Ha elfogynak, a következő poszt várakozik.")}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))", gap: 16 }}>
        {([ ["tiktok", "TikTok · 9:16"], ["telegram", "Telegram"], ["fanvue_public", t("Fanvue · nyilvános, nem explicit")] ] as const).map(([pool, label]) => {
          const list = sources.filter(s => s.pool === pool);
          return <div key={pool}>
            <h3>{label}</h3>
            <label htmlFor={`sources-${pool}`}>{t("Képek kiválasztása")}</label>
            <input id={`sources-${pool}`} type="file" accept="image/jpeg,image/png,image/webp" multiple
              disabled={uploading !== null} onChange={e => {
                const selected = Array.from(e.currentTarget.files ?? []);
                e.currentTarget.value = "";
                void uploadSources(pool, selected);
              }} />
            <p className="muted">{uploading === pool ? t("Feltöltés: {p0} feldolgozva", {p0: uploadProgress}) : t("{p0} szabad · {p1} felhasznált", {p0: list.filter(s => !s.used_at).length, p1: list.filter(s => s.used_at).length})}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6 }}>
              {list.slice(0, 24).map(s => <div key={s.id} style={{ position: "relative" }}>
                {s.preview_url && <img src={s.preview_url} alt={t("Feltöltött jelenetminta")} style={{ width: "100%", aspectRatio: "9 / 16", objectFit: "cover" }} />}
                <small style={{ display: "block" }}>{s.used_at ? t("Felhasználva") : "Szabad"}</small>
              </div>)}
            </div>
          </div>;
        })}
      </div>
      {uploadResult && <p role="status">{uploadResult}</p>}
    </section>
    <section className="card" style={{ marginTop: 16 }}>
      <h2>{t("Posztok és képcsomagok")}</h2>
      <p className="muted">{t("Budapesti idő: TikTok 12, 16, 20 óra; előkészítés 10, 14, 18 órakor, cél a poszt előtt egy órával kész képcsomag. Minden új képcsomag képei 9:16 arányúak.")}</p>
      <button disabled={previewing} onClick={() => void previewEvening()}>{previewing ? t("Előkészítés…") : t("18:00-s előkészítés kipróbálása")}</button>
      {previewResult && <p role="status">{previewResult}</p>}
      {publicItems.length === 0 && <p>{t("Még nincs előkészített tartalom.")}</p>}
      {dates.map(date => <section key={date} style={{ borderTop: "2px solid var(--border)", marginTop: 24, paddingTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>{new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { timeZone: "Europe/Budapest", year: "numeric", month: "long", day: "numeric" })}</h3>
        {[...new Set(publicItems.filter(item => item.local_date === date).map(item => item.post_hour))].sort((a, b) => b - a).map(hour => <div key={hour} style={{ margin: "16px 0 24px", padding: 14, border: "1px solid var(--border)", borderRadius: 12 }}>
          <h4 style={{ margin: "0 0 12px" }}>{String(hour).padStart(2, "0")}{t(":00-s posztok · budapesti idő")}</h4>
          {publicItems.filter(item => item.local_date === date && item.post_hour === hour)
            .sort((a, b) => (characters.find(c => c.id === a.character_id)?.name ?? "").localeCompare(characters.find(c => c.id === b.character_id)?.name ?? "", "hu")
              || ["tiktok", "telegram", "fanvue_public"].indexOf(a.platform) - ["tiktok", "telegram", "fanvue_public"].indexOf(b.platform))
            .map(item => <details key={item.id} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          {characters.find(c => c.id === item.character_id)?.name ?? t("Modell")} · {platformName(item.platform)} · {item.slides?.some(slide => slide.status === "deleted") ? t("galériából törölt kép") : item.status === "ready" ? t("kész") : item.status === "generating" ? t("készül") : item.status === "planned" ? "tervezett" : t("hiba")} · {item.slides?.length ?? 0}{" "}{t("kép")}</summary>
        <p className="muted">{item.aspect_ratio}{" "}{t("· elkészítési célidő:")}{" "}{new Date(item.due_at).toLocaleString(locale, { timeZone: "Europe/Budapest" })}</p>
        {item.trend_url && <a href={item.trend_url} target="_blank" rel="noreferrer">{t("Trend forrása:")}{" "}{item.trend_title}</a>}
        {item.slides?.length ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
          {item.slides.map(slide => <div className="card" key={slide.job_id} style={{ padding: 12 }}>
            <strong>{slide.index + 1}{t(". kép ·")}{" "}{slide.status === "completed" ? t("kész") : slide.status === "deleted" ? t("törölve") : slide.status === "processing" || slide.status === "queued" ? t("készül") : t("hiba")}</strong>
            {slide.output_url ? <a href={slide.output_url} target="_blank" rel="noreferrer"><img src={slide.output_url} alt={t("{p0}. elkészült kép", {p0: slide.index + 1})} style={{ display: "block", width: "100%", maxHeight: 390, objectFit: "contain", marginTop: 8 }} /></a>
              : <p className="muted">{slide.status === "deleted" ? t("A kép elkészült, de később törölték a galériából.") : slide.status === "completed" ? t("A kép elkészült, de a fájl nem elérhető.") : ["failed", "cancelled"].includes(slide.status) ? t("A képkészítés sikertelen volt.") : t("A kép még készül.")}</p>}
            {item.copy?.slides?.[slide.index] && <p><strong>{t("Képszöveg:")}</strong> {item.copy.slides[slide.index]}</p>}
            <p className="muted">{t("Forráskép:")}{" "}{slide.source_id ? slide.source_id.slice(0, 8) : t("még nincs")} · {slide.review_status ?? "—"}</p>
            {slide.source_url && <a href={slide.source_url} target="_blank" rel="noreferrer"><img src={slide.source_url} alt={t("{p0}. kép forrása", {p0: slide.index + 1})} style={{ width: 80, height: 100, objectFit: "cover" }} /></a>}
            {slide.source_id && slide.status === "completed" && slide.review_status !== "rejected" &&
              <button className="ghost" disabled={saving === slide.job_id} onClick={() => void favorite(item, slide)}>
                {slide.favorite ? t("Kedvenc forrás kikapcsolása") : t("Jó forrás · használd újra ehhez a modellhez")}
              </button>}
            {["completed", "deleted", "failed", "cancelled"].includes(slide.status) && ["ready", "failed"].includes(item.status)
              && slide.review_status !== "rejected" && <button className="ghost" disabled={saving === slide.job_id}
                onClick={() => void regenerate(item, slide)}>{slide.status === "deleted" ? t("Törölt kép pótlása") : t("Ez a kép nem jó · újragenerálás")}</button>}
          </div>)}
        </div> : <p className="muted">{t("A csomaghoz még nem indult képfeladat.")}</p>}
        {item.copy?.caption && <p><strong>{t("Posztleírás:")}</strong> {item.copy.caption}</p>}
        {item.error && <p className="error">{item.error}</p>}
            </details>)}
        </div>)}
      </section>)}
      {archivedPaid.length > 0 && <details style={{ marginTop: 20 }}>
        <summary>{t("Régi, nem aktív Fanvue-feladatok (")}{archivedPaid.length})</summary>
        <p className="muted">{t("Ezek nem részei a most elkészült nyilvános Fanvue-csomagoknak.")}</p>
        {archivedPaid.map(item => <p key={item.id}>{characters.find(c => c.id === item.character_id)?.name ?? t("Modell")} · {item.local_date} {item.post_hour}:00 · {t(item.status)}</p>)}
      </details>}
    </section>
  </main>;
}
