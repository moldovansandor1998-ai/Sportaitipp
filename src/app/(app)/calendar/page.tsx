"use client";
// Content Calendar: listanézet, létrehozás, státuszkezelés (scheduled → posted/cancelled), törlés.
import { useCallback, useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/client";

interface Post {
  id: string; platform: string; body: string; status: string;
  scheduled_at: string; media_asset_id: string | null; character_id: string | null;
}
const PLATFORMS = ["instagram", "tiktok", "facebook", "x", "other"];

export default function CalendarPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [platform, setPlatform] = useState("instagram");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState("");
  const getSb = () => browserClient();
  const token = useCallback(async () => (await getSb().auth.getSession()).data.session?.access_token ?? "", []);

  const load = useCallback(async () => {
    const res = await fetch("/api/calendar", { headers: { authorization: `Bearer ${await token()}` } });
    if (res.ok) setPosts((await res.json()).posts);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!when) return;
    await fetch("/api/calendar", {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify({ platform: platform as never, body, mediaAssetId: null, scheduledAt: new Date(when).toISOString() }),
    });
    setBody(""); setWhen("");
    await load();
  }
  async function setStatus(id: string, status: string) {
    await fetch(`/api/calendar/${id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await load();
  }
  async function remove(id: string) {
    if (!confirm("Törlöd ezt a bejegyzést?")) return;
    await fetch(`/api/calendar/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${await token()}` } });
    await load();
  }

  const upcoming = posts.filter((p) => p.status === "scheduled").sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const past = posts.filter((p) => p.status !== "scheduled");

  return (
    <main style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Content Calendar</h1>
      <div className="card">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr auto", gap: 8 }}>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
          </select>
          <input placeholder="posztszöveg…" value={body} onChange={(e) => setBody(e.target.value)} />
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <button onClick={add} disabled={!when}>Ütemezés</button>
        </div>
      </div>
      <h3>Ütemezett ({upcoming.length})</h3>
      {upcoming.map((p) => (
        <div key={p.id} className="card" style={{ marginBottom: 8, padding: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="badge">{p.platform}</span>
            <span className="muted" style={{ flex: 1 }}>{new Date(p.scheduled_at).toLocaleString("hu-HU")} – {p.body || "(média)"}</span>
            <button className="ghost" style={{ padding: "4px 10px" }} onClick={() => setStatus(p.id, "posted")}>posted</button>
            <button className="ghost" style={{ padding: "4px 10px" }} onClick={() => setStatus(p.id, "cancelled")}>mégse</button>
            <button className="ghost" style={{ padding: "4px 10px" }} onClick={() => remove(p.id)}>törlés</button>
          </div>
        </div>
      ))}
      {upcoming.length === 0 && <p className="muted">Nincs ütemezett bejegyzés.</p>}
      {past.length > 0 && (<>
        <h3>Lezárt</h3>
        {past.map((p) => (
          <div key={p.id} className="card" style={{ marginBottom: 6, padding: 10, opacity: 0.7 }}>
            <span className="badge">{p.platform} · {p.status}</span>{" "}
            <span className="muted">{new Date(p.scheduled_at).toLocaleString("hu-HU")} – {p.body || "(média)"}</span>
          </div>
        ))}
      </>)}
    </main>
  );
}
