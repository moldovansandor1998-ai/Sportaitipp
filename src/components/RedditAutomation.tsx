"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/client";

type RedditAccount = {
  character_id: string; reddit_username: string; enabled: boolean; subreddit: string;
  timezone: string; posting_minutes: number[]; rules_confirmed: boolean; pause_reason: string | null;
};
type RedditPost = {
  character_id: string; local_date: string; slot: string | number; status: string;
  reddit_post_id: string | null; permalink: string | null; error: string | null;
};
type Candidate = { subreddit: string; title: string; description: string; over18: boolean;
  status: "eligible" | "needs_review" | "blocked"; reason: string; rules: { name: string; description: string }[]; checked_at: string };
type Settings = { subreddit: string; timezone: string; times: string[]; rulesConfirmed: boolean };
type Snapshot = { configured: boolean; apiApproved: boolean; accounts: RedditAccount[]; history: RedditPost[] };
const defaultSettings = (): Settings => ({ subreddit: "", timezone: "Europe/Budapest", times: ["09:00", "18:00"], rulesConfirmed: false });
const asTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function validateRedditSettings(settings: Settings): number[] {
  if (!/^(?:r\/)?[A-Za-z0-9_]{3,21}$/.test(settings.subreddit.trim()) && !/^u_[A-Za-z0-9_-]{3,20}$/.test(settings.subreddit.trim())) {
    throw new Error("Add meg a célközösséget (r/kozosseg) vagy a profilt (u_felhasznalonev).");
  }
  try { new Intl.DateTimeFormat("hu-HU", { timeZone: settings.timezone.trim() }).format(); }
  catch { throw new Error("Érvényes időzónát adj meg, például Europe/Budapest."); }
  if (!settings.timezone.trim()) throw new Error("Add meg az időzónát.");
  if (settings.times.length < 1 || settings.times.length > 4 || settings.times.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    throw new Error("Naponta 1–4 érvényes időpontot adj meg.");
  }
  const minutes = settings.times.map(time => { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute; }).sort((a, b) => a - b);
  if (minutes.length > 1 && minutes.some((minute, index) => ((minutes[(index + 1) % minutes.length] - minute + 1440) % 1440) < 120)) {
    throw new Error("A posztok között legalább 2 óra legyen, éjfélen át is.");
  }
  return minutes;
}

export function redditPostLink(value: string | null): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value, "https://www.reddit.com");
    if (url.protocol === "https:" && ["reddit.com", "www.reddit.com"].includes(url.hostname) && !url.username && !url.password) return url.href;
  } catch { /* Invalid stored URLs are never rendered as links. */ }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = (await browserClient().auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("A munkamenet lejárt. Jelentkezz be újra.");
  const response = await fetch(path, { ...options, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...options.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body?.error === "string" ? body.error : null;
    const descriptions: Record<string, string> = {
      REDDIT_DISCOVERY_COOLDOWN: "A közösségkeresés naponta egyszer frissíthető. A korábbi javaslatokat lent találod.",
      REDDIT_DISCOVERY_BUSY: "A közösségkeresés már folyamatban van. Később frissítsd az oldalt az eredményhez.",
      REDDIT_API_NOT_APPROVED: "A Reddit API használata még nincs jóváhagyva.",
      FANVUE_LINK_REQUIRED: "Előbb mentsd el a modell Fanvue-profiljának linkjét a Model Studióban.",
    };
    if (code && descriptions[code]) throw new Error(descriptions[code]);
    throw new Error(response.status === 401 ? "A munkamenet lejárt. Jelentkezz be újra."
      : `A Reddit-kérés nem sikerült${code ? ` (${code})` : ` (HTTP ${response.status})`}.`);
  }
  return body as T;
}

export default function RedditAutomation({ characterId }: { characterId: string }) {
  // Changing models resets drafts and prevents old requests from updating the next model's form.
  return <RedditSettings key={characterId} characterId={characterId} />;
}

function RedditSettings({ characterId }: { characterId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [discoveryError, setDiscoveryError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const locked = useRef(false);
  const account = snapshot?.accounts.find(item => item.character_id === characterId);
  const history = snapshot?.history.filter(item => item.character_id === characterId).slice(0, 10) ?? [];

  const load = useCallback(async (adoptSettings: boolean, signal?: AbortSignal) => {
    const next = await request<Snapshot>("/api/reddit/accounts", { signal, cache: "no-store" });
    if (signal?.aborted) return;
    if (!next || !Array.isArray(next.accounts) || !Array.isArray(next.history)) throw new Error("A Reddit-adatok formátuma hibás.");
    setSnapshot(next);
    if (adoptSettings) {
      const linked = next.accounts.find(item => item.character_id === characterId);
      setSettings(linked ? { subreddit: linked.subreddit || "", timezone: linked.timezone || "Europe/Budapest",
        times: linked.posting_minutes.map(asTime), rulesConfirmed: linked.rules_confirmed } : defaultSettings());
      setDirty(false);
    }
  }, [characterId]);

  useEffect(() => {
    const callbackStatus = new URLSearchParams(window.location.search).get("reddit");
    if (callbackStatus === "connected") setNotice("A Reddit-fiók összekötése sikerült. A posztolás szünetel, amíg külön nem engedélyezed.");
    if (callbackStatus === "failed") setError("A Reddit-fiók összekötése nem sikerült vagy megszakadt. Próbáld újra az összekötést.");
    const controller = new AbortController();
    setBusy(true);
    void load(true, controller.signal).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "A Reddit-adatok nem tölthetők be.");
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!account?.reddit_username) { setCandidates([]); return; }
    const controller = new AbortController();
    void request<{ candidates: Candidate[] }>(`/api/reddit/discover?characterId=${encodeURIComponent(characterId)}`, { signal: controller.signal, cache: "no-store" })
      .then(result => { if (!controller.signal.aborted) setCandidates(result.candidates ?? []); })
      .catch(cause => { if (!controller.signal.aborted) setDiscoveryError(cause instanceof Error ? cause.message : "A közösségjavaslatok nem tölthetők be."); });
    return () => controller.abort();
  }, [characterId, account?.reddit_username]);

  function edit(change: Partial<Settings>) { setSettings(previous => ({ ...previous, ...change })); setDirty(true); setNotice(""); }

  async function act(action: "connect" | "save" | "enable" | "pause" | "disconnect" | "refresh" | "discover") {
    if (locked.current || busy) return;
    if (action === "disconnect" && !window.confirm("Megszünteted a modell Reddit-összekötését? Az automatikus posztolás leáll, a már közzétett posztok megmaradnak.")) return;
    locked.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (action === "connect") {
        if (dirty && !window.confirm("Az összekötéshez elhagyod ezt az oldalt. A nem mentett beállítások elvesznek. Folytatod?")) return;
        const result = await request<{ url: string }>("/api/reddit/connect", { method: "POST", body: JSON.stringify({ characterId }) });
        const url = new URL(result.url);
        if (url.protocol !== "https:" || !["reddit.com", "www.reddit.com"].includes(url.hostname) || url.username || url.password) throw new Error("Érvénytelen Reddit-engedélyezési cím.");
        window.location.assign(url.href);
        return;
      }
      if (action === "discover") {
        setDiscoveryError("");
        const result = await request<{ candidates: Candidate[] }>("/api/reddit/discover", { method: "POST", body: JSON.stringify({ characterId }) });
        setCandidates(result.candidates ?? []);
        setNotice("A közösségkeresés elkészült. Választás előtt ellenőrizd a közösség aktuális szabályait."); return;
      }
      if (action === "refresh") { await load(!snapshot && !dirty); setNotice(dirty ? "Az állapot frissült; a nem mentett beállításaid megmaradtak." : "Az állapot frissült."); return; }
      if (action === "disconnect") {
        await request(`/api/reddit/accounts?characterId=${encodeURIComponent(characterId)}`, { method: "DELETE" });
        await load(true); setNotice("A Reddit-összekötés megszűnt."); return;
      }
      if (action === "pause") {
        await request("/api/reddit/accounts", { method: "PATCH", body: JSON.stringify({ characterId, enabled: false }) });
        await load(false); setNotice("Az automatika szünetel. A folyamatban lévő közzététel még befejeződhet."); return;
      }
      const postingMinutes = validateRedditSettings(settings);
      if (action === "enable" && !settings.rulesConfirmed) throw new Error("Előbb ellenőrizd és erősítsd meg a célhely szabályait.");
      await request("/api/reddit/accounts", { method: "PATCH", body: JSON.stringify({ characterId,
        enabled: action === "enable", subreddit: settings.subreddit.trim(), timezone: settings.timezone.trim(), postingMinutes, rulesConfirmed: settings.rulesConfirmed }) });
      await load(true);
      setNotice(action === "enable" ? "Az időzített posztolás engedélyezve. A közzététel állapotát az előzményekben látod." : "Beállítások mentve. Az automatika szünetel.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "A művelet nem sikerült."); }
    finally { locked.current = false; setBusy(false); }
  }

  const statusLabel: Record<string, string> = { posted: "Közzétéve", failed: "Sikertelen", queued: "Várakozik", processing: "Folyamatban", skipped: "Kihagyva", uncertain: "Ellenőrzés szükséges" };
  return <section id="reddit-automation" className="card" style={{ marginTop: 16 }} aria-busy={busy} aria-labelledby={`reddit-heading-${characterId}`}>
    <h2 id={`reddit-heading-${characterId}`}>Reddit · időzített posztolás</h2>
    <p className="muted">Naponta 1–4 különböző poszt, a modell Model Studióban elmentett Fanvue-linkjével. Csak olyan célhelyet válassz, ahol az AI-modellek tartalma, a Fanvue-linkek és az ilyen gyakoriság megengedett.</p>
    <p className="muted"><a href="/model-studio">Fanvue-link szerkesztése a Model Studióban</a></p>
    <p className="muted">Az összekötés önmagában nem indít posztolást. Az időpontok a megadott időzóna szerint értendők. A kezdéshez külön engedélyezés szükséges.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {snapshot && !snapshot.configured && <p className="error">A Reddit szerveroldali beállítása hiányzik. Az összekötés és a posztolás egyelőre nem indítható.</p>}
    {snapshot && !snapshot.apiApproved && <p className="error">A Reddit API használatának jóváhagyása még nincs beállítva. A posztolás addig nem engedélyezhető.</p>}
    <p><strong>{account ? `u/${account.reddit_username}` : "Nincs összekötött Reddit-fiók"}</strong>{account && ` · ${account.enabled ? "Engedélyezve" : "Szünetel"}`}</p>
    {account?.pause_reason && <p className="muted">Szünet oka: {account.pause_reason}</p>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="ghost" disabled={busy || !snapshot?.configured} onClick={() => void act("connect")}>{account ? "Reddit újra összekötése" : "Reddit-fiók összekötése"}</button>
      <button type="button" className="ghost" disabled={busy} onClick={() => void act("refresh")}>Állapot frissítése</button>
    </div>
    {account && <div style={{ marginTop: 16 }}>
      <h3>Illő közösségek keresése</h3>
      <p className="muted">Az engedélyezett Reddit-fiókhoz a rendszer naponta keres közösségjavaslatokat. A találat nem jelent posztolási engedélyt: az AI-tartalom, a Fanvue-link és a gyakoriság szabályait külön ellenőrizned kell.</p>
      {discoveryError && <p className="error" role="alert">{discoveryError}</p>}
      <button type="button" className="ghost" disabled={busy || !snapshot?.configured || !snapshot.apiApproved} onClick={() => void act("discover")}>Közösségek keresése most</button>
      {!candidates.length && <p className="muted">Még nincs megjeleníthető közösségjavaslat.</p>}
      <ul style={{ paddingLeft: 20 }}>{candidates.map(candidate => <li key={candidate.subreddit} style={{ marginTop: 12 }}>
        <strong>r/{candidate.subreddit.replace(/^r\//, "")}</strong> · {candidate.title} {candidate.over18 && "· 18+"}
        <p>{candidate.description}</p>
        <p><strong>{candidate.status === "blocked" ? "Nem választható" : candidate.status === "eligible" ? "Lehetséges célhely, kézi ellenőrzés szükséges" : "További ellenőrzést igényel"}</strong> · {candidate.reason}</p>
        <details><summary>Megtalált szabályok</summary>
          {candidate.rules.length ? <ul>{candidate.rules.map((rule, index) => <li key={index}><strong>{rule.name}</strong>: {rule.description}</li>)}</ul> : <p>Nem érkezett szabálylista. Ellenőrizd a közösség oldalán.</p>}
          <small>Ellenőrzés: {candidate.checked_at}</small>
        </details>
        <button type="button" className="ghost" disabled={busy || candidate.status === "blocked"} onClick={() => edit({ subreddit: `r/${candidate.subreddit.replace(/^r\//, "")}`, rulesConfirmed: false })}>Kiválasztás célhelynek</button>
      </li>)}</ul>
    </div>}
    {account && <fieldset disabled={busy} style={{ border: 0, padding: 0, marginTop: 16 }}>
      <legend>Időzítés és célhely</legend>
      <label htmlFor={`reddit-target-${characterId}`}>Célközösség vagy profil</label>
      <input id={`reddit-target-${characterId}`} value={settings.subreddit} placeholder="r/kozosseg vagy u_felhasznalonev" onChange={event => edit({ subreddit: event.target.value, rulesConfirmed: false })} />
      <label htmlFor={`reddit-timezone-${characterId}`}>Időzóna</label>
      <input id={`reddit-timezone-${characterId}`} value={settings.timezone} placeholder="Europe/Budapest" onChange={event => edit({ timezone: event.target.value })} />
      <p className="muted">Napi időpontok, legalább 2 óra különbséggel, éjfélen át is.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {settings.times.map((time, index) => <div key={index}>
          <label htmlFor={`reddit-time-${characterId}-${index}`}>{index + 1}. poszt</label>
          <input id={`reddit-time-${characterId}-${index}`} type="time" value={time} onChange={event => edit({ times: settings.times.map((previous, i) => i === index ? event.target.value : previous) })} />
          <button type="button" className="ghost" aria-label={`${index + 1}. időpont eltávolítása`} disabled={settings.times.length <= 1} onClick={() => edit({ times: settings.times.filter((_, i) => i !== index) })}>Eltávolítás</button>
        </div>)}
      </div>
      <button type="button" className="ghost" style={{ marginTop: 8 }} disabled={settings.times.length >= 4} onClick={() => edit({ times: [...settings.times, ""] })}>Időpont hozzáadása</button>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 16 }}>
        <input type="checkbox" style={{ width: "auto", marginTop: 4 }} checked={settings.rulesConfirmed} onChange={event => edit({ rulesConfirmed: event.target.checked })} />
        <span>Ellenőriztem: ez a célhely engedélyezi az AI-modell tartalmait, a Fanvue-linkeket és a beállított posztolási gyakoriságot.</span>
      </label>
      {dirty && <p className="muted">Nem mentett változtatások. Mentésig a korábban elmentett beállítások érvényesek.</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <button type="button" className="ghost" onClick={() => void act("save")}>Mentés szüneteltetve</button>
        <button type="button" disabled={!snapshot?.configured || !snapshot.apiApproved || !settings.rulesConfirmed} onClick={() => void act("enable")}>Mentés és posztolás engedélyezése</button>
        {account.enabled && <button type="button" className="ghost" onClick={() => void act("pause")}>Az automatika szüneteltetése</button>}
        <button type="button" className="ghost" onClick={() => void act("disconnect")}>Összekötés megszüntetése</button>
      </div>
    </fieldset>}
    <h3>Legutóbbi posztok</h3>
    {!history.length && <p className="muted">{busy && !snapshot ? "Betöltés…" : "Még nincs megjeleníthető posztelőzmény."}</p>}
    <ul>{history.map((post, index) => {
      const link = redditPostLink(post.permalink);
      return <li key={`${post.local_date}-${post.slot}-${index}`}>
        {post.local_date} · {post.slot} · {statusLabel[post.status] ?? post.status}{" "}
        {link && <a href={link} target="_blank" rel="noopener noreferrer">Poszt megnyitása</a>}
        {post.error && <span className="error"> · {post.error}</span>}
      </li>;
    })}</ul>
  </section>;
}
