"use client";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/client";

type Model = { id: string; name: string };
type Candidate = { id: string; username: string; name: string; description: string;
  location: string; image: string; postId: string };
type Saved = { id: string; x_user_id: string; x_username: string; display_name: string;
  description: string; source_post: string | null; status: "saved" | "reviewed" | "dismissed" };

export default function XCandidates() {
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [found, setFound] = useState<Candidate[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function token() { return (await browserClient().auth.getSession()).data.session?.access_token ?? ""; }
  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/model-studio", { headers: { authorization: `Bearer ${await token()}` } });
      if (!response.ok) { setMessage("A modellek nem tölthetők be."); return; }
      const data = await response.json();
      const available = (data.characters as Model[]).filter(c => ["Zsófia", "Petra", "Dorika", "Laura", "Dorina"].includes(c.name));
      setModels(available); setModel(available[0]?.id ?? "");
    })();
  }, []);
  useEffect(() => { if (model) void load(false); }, [model]);

  async function load(search: boolean) {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/x/candidates?characterId=${encodeURIComponent(model)}${search ? "&search=1" : ""}`,
      { headers: { authorization: `Bearer ${await token()}` } });
    const result = await response.json();
    if (result.saved) setSaved(result.saved);
    if (search) setFound(result.candidates ?? []);
    if (!response.ok) setMessage(result.error === "X_SEARCH_402" ? "Az X API-egyenleg nem elegendő a kereséshez."
      : result.error === "X_NOT_CONNECTED" ? "Ehhez a modellhez nincs X-fiók összekötve."
      : `A jelöltek nem tölthetők be: ${result.error ?? "ismeretlen hiba"}`);
    else if (search && !result.candidates?.length) setMessage("Nincs új találat ennél a keresésnél.");
    setBusy(false);
  }

  async function save(person: Candidate) {
    setBusy(true); setMessage("");
    const response = await fetch("/api/x/candidates", { method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify({ characterId: model, xUserId: person.id, username: person.username,
        name: person.name, description: person.description, postId: person.postId }) });
    if (response.ok) { setFound(prev => prev.filter(p => p.id !== person.id)); await load(false); }
    else { setMessage("A jelölt mentése nem sikerült."); setBusy(false); }
  }

  async function change(person: Saved, status: Saved["status"]) {
    setBusy(true); setMessage("");
    const response = await fetch("/api/x/candidates", { method: "PATCH",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify({ id: person.id, characterId: model, status }) });
    if (response.ok) await load(false);
    else { setMessage("Az állapot mentése nem sikerült."); setBusy(false); }
  }

  return <main style={{ maxWidth: 900 }}>
    <h1>X · követési jelöltek</h1>
    <p className="muted">Nyilvános, magyar nyelvű ismerkedős posztok szerzőit keresheted. A név, a nyelv és a profil leírása nem igazolja a nemet, kort, országot vagy szándékot. Nyisd meg a profilt, és csak te döntesz a követésről; a Castora nem követ automatikusan senkit.</p>
    <label htmlFor="candidate-model">Modell X-fiókja</label>
    <select id="candidate-model" value={model} onChange={e => { setModel(e.target.value); setFound([]); }}>
      {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
    </select>
    <div style={{ margin: "12px 0" }}><button disabled={!model || busy} onClick={() => void load(true)}>
      {busy ? "Betöltés…" : "Új nyilvános profilok keresése"}</button></div>
    <p className="muted">A keresés X API-hívást használhat, amelynek díja lehet. Csak a gombra kattintva indul.</p>
    {message && <p role="status">{message}</p>}
    {found.length > 0 && <section className="card"><h2>Találatok · {found.length}</h2>
      {found.map(person => <div key={person.id} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}>
        <strong>{person.name}</strong> · @{person.username}{person.location && <span> · {person.location}</span>}
        {person.description && <p>{person.description}</p>}
        <a href={`https://x.com/${person.username}`} target="_blank" rel="noopener noreferrer">Profil megnyitása ↗</a>
        {person.postId && <> · <a href={`https://x.com/${person.username}/status/${person.postId}`} target="_blank" rel="noopener noreferrer">Kapcsolódó poszt ↗</a></>}
        <div><button className="ghost" disabled={busy} onClick={() => void save(person)}>Jelölt mentése</button></div>
      </div>)}
    </section>}
    <section className="card" style={{ marginTop: 16 }}><h2>Mentett jelöltek · {saved.filter(p => p.status !== "dismissed").length}</h2>
      {saved.filter(p => p.status !== "dismissed").length === 0 && <p className="muted">Még nincs mentett jelölt ehhez a modellhez.</p>}
      {saved.filter(p => p.status !== "dismissed").map(person => <div key={person.id} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}>
        <strong>{person.display_name}</strong> · @{person.x_username} · {person.status === "reviewed" ? "Átnézve" : "Ellenőrzésre vár"}
        {person.description && <p>{person.description}</p>}
        <a href={`https://x.com/${person.x_username}`} target="_blank" rel="noopener noreferrer">Profil megnyitása ↗</a>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {person.status === "saved" && <button className="ghost" disabled={busy} onClick={() => void change(person, "reviewed")}>Átnéztem</button>}
          <button className="ghost" disabled={busy} onClick={() => void change(person, "dismissed")}>Elvetés</button>
        </div>
      </div>)}
    </section>
  </main>;
}
