"use client";
import { useAppTranslation } from "@/components/i18n/AppLanguageProvider";
import { useCallback, useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/client";

type Model = { id: string; name: string };
type Suggestion = { id: string; x_post_id: string; x_author_username: string; post_text: string;
  like_count: number; reply_count: number; repost_count: number; view_count: number | null;
  post_created_at: string; suggestion: string };

export default function XComments() {
  const { t, locale } = useAppTranslation();
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

  async function act(item: Suggestion, action: "confirm" | "reject") {
    setBusy(true); setMessage("");
    const response = await fetch("/api/x/comments", { method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify({ id: item.id, characterId: model, action }) });
    const result = await response.json();
    if (response.ok) {
      setQueue(prev => prev.filter(row => row.id !== item.id));
      setMessage(action === "confirm" ? t("Elküldöttként jelölve. Jön a következő poszt.") : t("Elutasítva. Jön a következő poszt."));
      await load();
    } else if (result.skipped || result.error === "ALREADY_HANDLED") {
      setQueue(prev => prev.filter(row => row.id !== item.id));
      await load();
      setMessage(result.skipped ? t("Az X nem engedte a választ ehhez a poszthoz. Nem jelent meg komment; jön a következő.")
        : t("Ezt a javaslatot már feldolgozták. Betöltöttem a következőt."));
    } else setMessage(result.error === "POST_TOO_OLD" ? t("Ez a poszt már túl régi. Utasítsd el, és jön a következő.")
      : result.error === "DAILY_LIMIT" ? t("Ma már 35 komment jelent meg erről a fiókról.")
      : t("A komment nem igazoltan jelent meg ({p0}). Ellenőrizd az X-en, mielőtt újra próbálkozol.", {p0: result.error ?? t("hiba")}));
    setBusy(false);
  }

  async function copyComment(item: Suggestion) {
    // Android in-app browsers often deny the async clipboard API after opening another tab.
    const field = document.createElement("textarea");
    field.value = item.suggestion;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.focus(); field.select(); field.setSelectionRange(0, field.value.length);
    let copied = false;
    try { copied = document.execCommand("copy"); }
    finally { field.remove(); }
    if (copied) { setMessage(t("Komment kimásolva. Nyisd meg az X-posztot, és illeszd be válaszként.")); return; }
    try {
      await navigator.clipboard.writeText(item.suggestion);
      setMessage(t("Komment kimásolva. Nyisd meg az X-posztot, és illeszd be válaszként."));
    } catch {
      setMessage(t("A böngésző nem engedte a másolást. Jelöld ki a fenti komment szövegét, és másold ki kézzel."));
    }
  }

  async function scan() {
    setBusy(true); setMessage("");
    const response = await fetch("/api/x/comments/scan", { method: "POST",
      headers: { authorization: `Bearer ${await token()}` } });
    const result = await response.json();
    await load();
    setMessage(response.ok ? result.errors?.some((error: string) => error === "X_COMMENT_SEARCH_402")
      ? t("Az X API-egyenleg nem elegendő a kereséshez.")
      : result.errors?.length ? t("A keresés hibába ütközött: {p0}", {p0: result.errors[0]})
      : result.created ? t("{p0} új javaslat készült az öt modellhez.", {p0: result.created})
      : t("Ebben az ötperces körben már lefutott a keresés, vagy nincs új megfelelő poszt.")
      : t("A keresés nem sikerült. Próbáld később."));
    setBusy(false);
  }

  const item = queue[0];
  return <main style={{ maxWidth: 800 }}>
    <h1>{t("X · magyar kommentjavaslatok")}</h1>
    <p className="muted">{t("Ötpercenként keresünk magyar posztokat több témában. Az X API nem engedi, hogy a fiókok idegen posztokra innen közvetlenül válaszoljanak. Másold ki a kommentet, majd nyisd meg az eredeti posztot; a választ az X-en, a kiválasztott modell fiókjából küldd el. Egy poszt az öt modellnél összesen egyszer kerül sorra.")}</p>
    <label htmlFor="comment-model">{t("Modell X-fiókja")}</label>
    <select id="comment-model" value={model} onChange={event => { setModel(event.target.value); setQueue([]); setMessage(""); }}>
      {models.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
    </select>
    <p className="muted">{queue.length}{" "}{t("javaslat vár ennél a modellnél.")}{" "}<button className="ghost" onClick={() => void load()}>{t("Lista frissítése")}</button> <button className="ghost" disabled={busy || !model} onClick={() => void scan()}>{t("Friss posztok keresése")}</button></p>
    {message && <p role="status">{t(message)}</p>}
    {!item && <section className="card"><p>{t("Most nincs új javaslat. A következő keresés legkésőbb öt percen belül fut.")}</p></section>}
    {item && <section className="card">
      <h2>{t("Friss poszt · @")}{item.x_author_username}</h2>
      <p style={{ whiteSpace: "pre-wrap" }}>{item.post_text}</p>
      <p className="muted">{item.view_count !== null ? t("{p0} megtekintés · ", {p0: item.view_count.toLocaleString(locale)}) : ""}
        {item.like_count.toLocaleString(locale)}{" "}{t("kedvelés ·")}{" "}{item.reply_count.toLocaleString(locale)}{" "}{t("válasz ·")}{" "}{item.repost_count.toLocaleString(locale)}{" "}{t("újraposztolás")}</p>
      <p><a href={`https://x.com/${item.x_author_username}/status/${item.x_post_id}`}
        target="_blank" rel="noopener noreferrer">{t("Eredeti poszt megnyitása ↗")}</a></p>
      <h3>{t("Javasolt magyar komment")}</h3>
      <blockquote style={{ marginLeft: 0, borderLeft: "3px solid var(--border)", paddingLeft: 14, userSelect: "text" }}>{item.suggestion}</blockquote>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button disabled={busy} onClick={() => void copyComment(item)}>{t("Komment másolása")}</button>
        <a href={`https://x.com/${item.x_author_username}/status/${item.x_post_id}`} target="_blank" rel="noopener noreferrer"
          style={{ display: "inline-block", background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 16px", fontSize: 14, fontWeight: 600 }}>{t("X-poszt megnyitása ↗")}</a>
        <button className="ghost" disabled={busy} onClick={() => void act(item, "confirm")}>{t("Elküldtem az X-en · következő")}</button>
        <button className="ghost" disabled={busy} onClick={() => void act(item, "reject")}>{t("Elutasítás · következő")}</button>
      </div>
    </section>}
  </main>;
}
