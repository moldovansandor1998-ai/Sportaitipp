"use client";
import { useCallback, useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/client";

type Model = { id: string; name: string };
type Suggestion = { id: string; x_post_id: string; x_author_username: string; post_text: string;
  like_count: number; reply_count: number; repost_count: number; view_count: number | null;
  post_created_at: string; suggestion: string };

export default function XComments() {
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [queue, setQueue] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const token = useCallback(async () => (await browserClient().auth.getSession()).data.session?.access_token ?? "", []);
  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/model-studio", { headers: { authorization: `Bearer ${await token()}` } });
      if (!response.ok) { setMessage("A modellek nem tölthetők be."); return; }
      const data = await response.json();
      const available = (data.characters as Model[]).filter(c => ["Zsófia", "Petra", "Dorika", "Laura", "Dorina"].includes(c.name));
      setModels(available); setModel(available[0]?.id ?? "");
    })();
  }, [token]);
  const load = useCallback(async () => {
    if (!model) return;
    const response = await fetch(`/api/x/comments?characterId=${encodeURIComponent(model)}`,
      { headers: { authorization: `Bearer ${await token()}` }, cache: "no-store" });
    const result = await response.json();
    if (response.ok) setQueue(result.suggestions ?? []);
    else setMessage(result.error === "X_NOT_CONNECTED" ? "Ehhez a modellhez nincs X-fiók összekötve."
      : "A kommentjavaslatok nem tölthetők be.");
  }, [model, token]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30000); return () => clearInterval(timer); }, [load]);

  async function act(item: Suggestion, action: "approve" | "reject") {
    setBusy(true); setMessage("");
    const response = await fetch("/api/x/comments", { method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify({ id: item.id, characterId: model, action }) });
    const result = await response.json();
    if (response.ok) {
      setQueue(prev => prev.filter(row => row.id !== item.id));
      setMessage(action === "approve" ? "A komment megjelent az X-en." : "Elutasítva. Jön a következő poszt.");
      await load();
    } else if (result.skipped || result.error === "ALREADY_HANDLED") {
      setQueue(prev => prev.filter(row => row.id !== item.id));
      await load();
      setMessage(result.skipped ? "Az X nem engedte a választ ehhez a poszthoz. Nem jelent meg komment; jön a következő."
        : "Ezt a javaslatot már feldolgozták. Betöltöttem a következőt.");
    } else setMessage(result.error === "POST_TOO_OLD" ? "Ez a poszt már túl régi. Utasítsd el, és jön a következő."
      : result.error === "DAILY_LIMIT" ? "Ma már 35 komment jelent meg erről a fiókról."
      : `A komment nem igazoltan jelent meg (${result.error ?? "hiba"}). Ellenőrizd az X-en, mielőtt újra próbálkozol.`);
    setBusy(false);
  }

  async function scan() {
    setBusy(true); setMessage("");
    const response = await fetch("/api/x/comments/scan", { method: "POST",
      headers: { authorization: `Bearer ${await token()}` } });
    const result = await response.json();
    await load();
    setMessage(response.ok ? result.errors?.some((error: string) => error === "X_COMMENT_SEARCH_402")
      ? "Az X API-egyenleg nem elegendő a kereséshez."
      : result.errors?.length ? `A keresés hibába ütközött: ${result.errors[0]}`
      : result.created ? `${result.created} új javaslat készült az öt modellhez.`
      : "Ebben a félórás körben már lefutott a keresés, vagy nincs új megfelelő poszt."
      : "A keresés nem sikerült. Próbáld később.");
    setBusy(false);
  }

  const item = queue[0];
  return <main style={{ maxWidth: 800 }}>
    <h1>X · magyar kommentjavaslatok</h1>
    <p className="muted">A rendszer félóránként keres friss, magyar nyelvű posztokat legalább 1000 megtekintéssel; ha az X nem ad megtekintésszámot, legalább 50 kedvelést kér. Minden modellnek külön kommentötletet készít. Egy poszt az öt modellnél összesen egyszer kerül sorra. Komment csak a Jóváhagyás gombbal megy ki.</p>
    <label htmlFor="comment-model">Modell X-fiókja</label>
    <select id="comment-model" value={model} onChange={event => { setModel(event.target.value); setQueue([]); setMessage(""); }}>
      {models.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
    </select>
    <p className="muted">{queue.length} javaslat vár ennél a modellnél. <button className="ghost" onClick={() => void load()}>Lista frissítése</button> <button className="ghost" disabled={busy || !model} onClick={() => void scan()}>Friss posztok keresése</button></p>
    {message && <p role="status">{message}</p>}
    {!item && <section className="card"><p>Most nincs új javaslat. A következő keresés legkésőbb fél órán belül fut.</p></section>}
    {item && <section className="card">
      <h2>Friss poszt · @{item.x_author_username}</h2>
      <p style={{ whiteSpace: "pre-wrap" }}>{item.post_text}</p>
      <p className="muted">{item.view_count !== null ? `${item.view_count.toLocaleString("hu-HU")} megtekintés · ` : ""}
        {item.like_count.toLocaleString("hu-HU")} kedvelés · {item.reply_count.toLocaleString("hu-HU")} válasz · {item.repost_count.toLocaleString("hu-HU")} újraposztolás</p>
      <p><a href={`https://x.com/${item.x_author_username}/status/${item.x_post_id}`}
        target="_blank" rel="noopener noreferrer">Eredeti poszt megnyitása ↗</a></p>
      <h3>Javasolt magyar komment</h3>
      <blockquote style={{ marginLeft: 0, borderLeft: "3px solid var(--border)", paddingLeft: 14 }}>{item.suggestion}</blockquote>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button disabled={busy} onClick={() => void act(item, "approve")}>{busy ? "Feldolgozás…" : "Jóváhagyás és közzététel"}</button>
        <button className="ghost" disabled={busy} onClick={() => void act(item, "reject")}>Elutasítás · következő</button>
      </div>
    </section>}
  </main>;
}
