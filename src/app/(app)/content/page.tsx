"use client";
// Tartalom-eszközök: Viral Reels Copy, Trends, Niche, Carousel, TikTok-import – teljes folyamatok.
import { useCallback, useState } from "react";
import { browserClient } from "@/lib/supabase/client";

interface Trend { title: string; platform: string; score: number; why: string; }
interface Idea { niche: string; angle: string; monetization: string; difficulty: string; }

export default function ContentPage() {
  const getSb = () => browserClient();
  const token = useCallback(async () => (await getSb().auth.getSession()).data.session?.access_token ?? "", []);
  const [topic, setTopic] = useState(""); const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("energetic"); const [cta, setCta] = useState("");
  const [copy, setCopy] = useState<Record<string, unknown> | null>(null);
  const [niche, setNiche] = useState(""); const [trends, setTrends] = useState<Trend[]>([]);
  const [interests, setInterests] = useState(""); const [ideas, setIdeas] = useState<Idea[]>([]);
  const [carTitle, setCarTitle] = useState(""); const [bullets, setBullets] = useState("");
  const [carResult, setCarResult] = useState<{ pageCount: number } | null>(null);
  const [ttUrl, setTtUrl] = useState(""); const [ttResult, setTtResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");

  async function call(path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true); setErr("");
    const res = await fetch(path, {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify({ ...body, idempotencyKey: crypto.randomUUID() }),
    });
    setBusy(false);
    const b = await res.json() as Record<string, unknown>;
    if (!res.ok) { setErr(String(b.error ?? res.status)); return null; }
    return b;
  }

  return (
    <main style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Tartalom-eszközök</h1>
      {err && <p className="error">{err}</p>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Viral Reels Copy</h3>
        <input placeholder="téma" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <input placeholder="célközönség" value={audience} onChange={(e) => setAudience(e.target.value)} />
        <div style={{ display: "flex", gap: 8 }}>
          <select value={tone} onChange={(e) => setTone(e.target.value)}>
            <option value="energetic">energetic</option><option value="calm">calm</option>
            <option value="expert">expert</option><option value="funny">funny</option>
          </select>
          <input placeholder="CTA" value={cta} onChange={(e) => setCta(e.target.value)} style={{ flex: 1 }} />
        </div>
        <button style={{ marginTop: 8 }} disabled={busy || !topic.trim()}
          onClick={async () => { const r = await call("/api/content/reels-copy", { topic, audience, tone, cta }); if (r) setCopy(r.copy as Record<string, unknown>); }}>
          Generálás (5 kredit)</button>
        {copy && (
          <div style={{ marginTop: 10, background: "var(--panel-2)", borderRadius: 8, padding: 12 }}>
            <p><strong>{String(copy.hook)}</strong></p>
            {(copy.script as string[]).map((s, i) => <p key={i} className="muted">{i + 1}. {s}</p>)}
            <p className="muted">{String(copy.caption)} {(copy.hashtags as string[]).map((h) => `#${h}`).join(" ")}</p>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Viral Trends</h3>
        <input placeholder="niche (pl. fitness)" value={niche} onChange={(e) => setNiche(e.target.value)} />
        <button style={{ marginTop: 8 }} disabled={busy || !niche.trim()}
          onClick={async () => { const r = await call("/api/content/trends", { niche, persist: true }); if (r) setTrends((r.trends as Trend[]) ?? []); }}>
          Trendek (5 kredit)</button>
        {trends.length > 0 && (
          <ul style={{ marginTop: 10 }}>
            {trends.map((t) => <li key={t.title} className="muted">{t.title} – {t.platform} ({t.score}) · {t.why}</li>)}
          </ul>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Niche Generator</h3>
        <input placeholder="érdeklődések, vesszővel" value={interests} onChange={(e) => setInterests(e.target.value)} />
        <button style={{ marginTop: 8 }} disabled={busy}
          onClick={async () => { const r = await call("/api/content/niche", { interests: interests.split(",").map((x) => x.trim()).filter(Boolean) }); if (r) setIdeas((r.ideas as Idea[]) ?? []); }}>
          Niche-ek (5 kredit)</button>
        {ideas.length > 0 && (
          <ul style={{ marginTop: 10 }}>
            {ideas.map((i) => <li key={i.niche} className="muted">{i.niche} – {i.monetization} ({i.difficulty})</li>)}
          </ul>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Carousel Generator</h3>
        <input placeholder="cím" value={carTitle} onChange={(e) => setCarTitle(e.target.value)} />
        <textarea rows={3} placeholder="bullet-pontok (soronként egy)" value={bullets} onChange={(e) => setBullets(e.target.value)} />
        <button style={{ marginTop: 8 }} disabled={busy || !carTitle.trim() || !bullets.trim()}
          onClick={async () => {
            const r = await call("/api/content/carousel", {
                title: carTitle, bullets: bullets.split("\n").map((x) => x.trim()).filter(Boolean),
            });
            if (r) setCarResult({ pageCount: Number(r.pageCount) });
          }}>Készítés (10 kredit)</button>
        {carResult && <p className="muted" style={{ marginTop: 8 }}>{carResult.pageCount} oldal kész – a Galériában.</p>}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>TikTok-link import</h3>
        <input placeholder="https://www.tiktok.com/@user/video/..." value={ttUrl} onChange={(e) => setTtUrl(e.target.value)} />
        <button style={{ marginTop: 8 }} disabled={busy || !ttUrl.trim()}
          onClick={async () => { const r = await call("/api/trends/import", { url: ttUrl }); if (r) setTtResult(r); }}>
          Import (5 kredit)</button>
        {ttResult && <p className="muted" style={{ marginTop: 8 }}>Importálva: {String(ttResult.title)} ({String(ttResult.author)}) – trendId: {String(ttResult.trendId)}</p>}
      </div>
    </main>
  );
}
