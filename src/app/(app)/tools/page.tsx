"use client";
// AI eszközök – minden eszköz VALÓDI folyamattal: assetválasztó/feltöltés, paraméterek,
// árbecslés, indítás, progress, eredmény (player/letöltés/galéria), retry.
// (Kulccsal futtatva valódi providert hív; kulcs nélkül NO_PROVIDER_CONFIGURED – nincs hamis eredmény.)
import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/client";
import { JobPoller, TERMINAL_STATUSES } from "@/lib/jobs/poller";
import { createAttemptTracker, type AttemptTracker } from "@/lib/jobs/attemptKey";
import { createSubmitGuard, type SubmitGuard } from "@/lib/jobs/submitGuard";
import { guardedRun } from "@/lib/jobs/guardedRun";
import { startJobWithTracker } from "@/lib/jobs/startJob";

interface GalItem { galleryItemId: string; assetId: string; mediaType: string; url: string | null; }
interface CharacterRow { id: string; name: string; }
interface JobRow { id: string; status: string; error: { message?: string } | null; }
interface Res { assetId: string; galleryItemId: string; mediaType: string; url: string | null; }
interface Cfg { mode: string; i2vModels: Array<{ id: string; label: string }>; }

export default function ToolsPage() {
  const [gallery, setGallery] = useState<GalItem[]>([]);
  const [characters, setCharacters] = useState<CharacterRow[]>([]);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [jobs, setJobs] = useState<Record<string, JobRow>>({});
  const [results, setResults] = useState<Record<string, Res[]>>({});
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const pollerRef = useRef<JobPoller | null>(null);
  const trackersRef = useRef<Record<string, AttemptTracker>>({});
  const submittingRef = useRef<Record<string, SubmitGuard>>({});

  // per-eszköz bemenetek
  const [edAsset, setEdAsset] = useState(""); const [edPrompt, setEdPrompt] = useState("");
  const [vPrompt, setVPrompt] = useState("");
  const [vDuration, setVDuration] = useState("5"); const [vRatio, setVRatio] = useState("16:9");
  const [vModel, setVModel] = useState("");
  const [toolChar, setToolChar] = useState("");
  const [ttsText, setTtsText] = useState(""); const [ttsVoice, setTtsVoice] = useState("Jennifer (en)");
  const [simpleAsset, setSimpleAsset] = useState("");           // i2p/upscale/bgremoval/skin/fix
  const [swapAsset, setSwapAsset] = useState(""); const [swapPhoto, setSwapPhoto] = useState("");
  const [talkVideo, setTalkVideo] = useState(""); const [talkAudio, setTalkAudio] = useState("");
  const [v2vVideo, setV2vVideo] = useState(""); const [v2vPrompt, setV2vPrompt] = useState("");

  const getSb = () => browserClient();
  const token = useCallback(async () => (await getSb().auth.getSession()).data.session?.access_token ?? "", []);

  const init = useCallback(async () => {
    const { data: { user } } = await getSb().auth.getUser();
    if (!user) return;
    const res = await fetch("/api/gallery", { headers: { authorization: `Bearer ${await token()}` } });
    if (res.ok) {
      const items = ((await res.json()) as { items: GalItem[] }).items.filter((i) => i.url);
      setGallery(items);
      // Az első látható kép legyen az alapértelmezett alapkép; a kézzel kiválasztottat megtartjuk.
      setSwapAsset((current) => current || items.find((item) => item.mediaType === "image")?.assetId || "");
    }
    const { data: chars } = await getSb().from("characters").select("id,name").eq("owner_id", user.id).eq("status", "active");
    setCharacters((chars ?? []) as unknown as CharacterRow[]);
    const c = await fetch("/api/config/provider");
    if (c.ok) { const j = await c.json() as Cfg; setCfg(j); if (j.i2vModels[0]) setVModel(j.i2vModels[0].id); }
  }, [token]);
  useEffect(() => { void init(); }, [init]);
  useEffect(() => {
    pollerRef.current ??= new JobPoller({ intervalMs: 2500, maxAttempts: 240, maxConsecutiveErrors: 3, isTerminal: (s) => TERMINAL_STATUSES.includes(s) });
    return () => pollerRef.current?.stopAll();
  }, []);

  async function loadJobResults(jobId: string, key: string) {
    const res = await fetch(`/api/jobs/${jobId}`, { headers: { authorization: `Bearer ${await token()}` } });
    if (!res.ok) return;
    const b = await res.json() as { results: Res[]; job: { result?: { meta?: { caption?: string } } | null } };
    setResults((m) => ({ ...m, [key]: b.results }));
    const cap = b.job.result?.meta?.caption;
    if (cap) setCaptions((m) => ({ ...m, [key]: cap }));
  }
  function poll(jobId: string, key: string) {
    pollerRef.current?.stop(jobId);
    pollerRef.current?.start(jobId,
      async () => {
        const { data } = await getSb().from("generation_jobs").select("status,error,result").eq("id", jobId).single();
        const j = data as { status: string; error: { message?: string } | null; result: { meta?: { caption?: string } } | null } | null;
        return { status: j?.status ?? "unknown", error: j?.error?.message ?? null };
      },
      async (_id, status, error) => {
        const errorMessage = typeof error === "string" && error.length > 0 ? error : null;
        setJobs((m) => ({ ...m, [key]: { id: jobId, status, error: errorMessage ? { message: errorMessage } : null } }));
        if (status === "completed") await loadJobResults(jobId, key);
      });
  }

  async function upload(accept: string): Promise<string | null> {
    const input = document.createElement("input");
    input.type = "file"; input.accept = accept;
    const file = await new Promise<File | null>((r) => { input.onchange = () => r(input.files?.[0] ?? null); input.click(); });
    if (!file) return null;
    const form = new FormData(); form.append("file", file);
    const res = await fetch("/api/assets/import", { method: "POST", headers: { authorization: `Bearer ${await token()}` }, body: form });
    if (!res.ok) { setMsg((m) => ({ ...m, upload: "Import hiba" })); return null; }
    return ((await res.json()) as { assetId: string }).assetId;
  }

  function run(key: string, type: string, payload: Record<string, unknown>, extra?: { characterId?: string }) {
    if (!submittingRef.current[key]) submittingRef.current[key] = createSubmitGuard();
    void guardedRun({
      guard: submittingRef.current[key],
      setBusy: (b) => setBusyKey(b ? key : null),
      onError: (m) => { setPrices((p) => ({ ...p, [key]: null })); setMsg((p) => ({ ...p, [key]: m })); },
      fn: async () => {
        setMsg((p) => ({ ...p, [key]: "" }));
        if (!trackersRef.current[key]) trackersRef.current[key] = createAttemptTracker();
        const headers = { authorization: `Bearer ${await token()}`, "content-type": "application/json" };
        const bodyObj = { type, characterId: extra?.characterId, payload };
        const est = await fetch("/api/jobs/estimate", { method: "POST", headers, body: JSON.stringify(bodyObj) });
        if (!est.ok) throw new Error("Árbecslés hiba – a job nem indult.");
        const estBody = await est.json().catch(() => { throw new Error("Árbecslés-válasz feldolgozása sikertelen."); });
        if (typeof (estBody as { credits?: number }).credits !== "number") throw new Error("Árbecslés-válasz érvénytelen.");
        setPrices((p) => ({ ...p, [key]: (estBody as { credits: number }).credits }));
        const result = await startJobWithTracker({ tracker: trackersRef.current[key], fetchImpl: fetch, token: await token(), body: bodyObj });
        if ("skipped" in result) throw new Error("A kérés már fut.");
        if (!result.ok) throw new Error(result.error ?? `Hiba ${result.status}`);
        return result;
      },
    }).then((r) => {
      if ("ok" in r && r.ok) {
        setJobs((p) => ({ ...p, [key]: { id: r.value.jobId!, status: "queued", error: null } }));
        setMsg((p) => ({ ...p, [key]: "Elindult – az eredmény a Galériában." }));
        poll(r.value.jobId!, key);
      }
    });
  }

  const Picker = ({ media, selected, onSelect }: { media: string; selected: string; onSelect: (id: string) => void }) => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      {gallery.filter((g) => g.mediaType === media).slice(0, 10).map((g) => (
        <button key={g.galleryItemId} className="ghost" disabled={busyKey !== null} onClick={() => onSelect(g.assetId)}
          style={{ padding: 2, borderRadius: 8, outline: selected === g.assetId ? "2px solid var(--accent)" : "1px solid var(--border)" }}>
          {media === "video" ? (
            <video src={g.url ?? ""} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, display: "block" }} muted />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element -- signed URL */
            <img src={g.url ?? ""} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, display: "block" }} />
          )}
        </button>
      ))}
      {gallery.filter((g) => g.mediaType === media).length === 0 && <span className="muted">nincs {media} a galériában – tölts fel</span>}
    </div>
  );
  const Badge = ({ k }: { k: string }) => jobs[k] ? <span className="badge">{jobs[k].status}{jobs[k].error?.message ? ` – ${jobs[k].error.message}` : ""}</span> : null;
  const Price = ({ k }: { k: string }) => <span className="badge">ár: {prices[k] == null ? "–" : `${prices[k]} kredit`}</span>;
  const Results = ({ k, kind }: { k: string; kind: "image" | "video" | "text" }) => (
    <>
      {(results[k] ?? []).filter((r) => r.mediaType === kind).map((r) => (
        <div key={r.galleryItemId} style={{ marginTop: 10 }}>
          {kind === "video" ? <video src={r.url ?? ""} controls style={{ width: "100%", borderRadius: 8 }} />
            : (
              /* eslint-disable-next-line @next/next/no-img-element -- signed URL */
              <img src={r.url ?? ""} alt="" style={{ width: "100%", borderRadius: 8 }} />
            )}
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <a href={r.url ?? "#"} download><button className="ghost" style={{ padding: "4px 10px" }}>Letöltés</button></a>
            <a href="/gallery"><button className="ghost" style={{ padding: "4px 10px" }}>Galéria</button></a>
          </div>
        </div>
      ))}
      {kind === "text" && captions[k] && <p className="muted" style={{ marginTop: 8 }}>Prompt: {captions[k]}</p>}
    </>
  );

  return (
    <main style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>AI eszközök</h1>
      <p className="muted">Minden eszköz teljes folyamattal. Kulcs nélkül a job őszintén elutasítódik (NO_PROVIDER_CONFIGURED) – hamis eredmény nincs.</p>

      <div className="card" style={{ marginBottom: 12 }}>
        <label>Karakter (opcionális, karakterhű eszközökhöz)</label>
        <select value={toolChar} onChange={(e) => setToolChar(e.target.value)} style={{ width: "100%" }}>
          <option value="">Nincs karakter</option>
          {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <p className="muted" style={{ marginBottom: 0 }}>Provider mód: {cfg?.mode ?? "betöltés…"}</p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Image-to-Prompt</h3>
        <Picker media="image" selected={simpleAsset} onSelect={setSimpleAsset} />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="ghost" disabled={busyKey !== null} onClick={async () => { const id = await upload("image/*"); if (id) setSimpleAsset(id); }}>Feltöltés</button>
          <input placeholder="asset ID" value={simpleAsset} onChange={(e) => setSimpleAsset(e.target.value)} style={{ flex: 1 }} />
          <button disabled={busyKey === "i2p" || !simpleAsset} onClick={() => run("i2p", "video_to_prompt", { sourceAssetId: simpleAsset })}>Prompt</button>
          <Badge k="i2p" /><Price k="i2p" />
        </div>
        <Results k="i2p" kind="text" />
        {msg.i2p && <p className="muted">{msg.i2p}</p>}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Character Swap</h3>
        <label>Alapkép</label>
        <Picker media="image" selected={swapAsset} onSelect={setSwapAsset} />
        <p className="muted" style={{ margin: "8px 0 12px" }}>Az alapkép kék kerettel van kijelölve. Másik képhez kattints a bélyegképére.</p>
        <label>Cserefotó</label>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ghost" disabled={busyKey !== null} onClick={async () => { const id = await upload("image/*"); if (id) setSwapPhoto(id); }}>Fotó feltöltése</button>
          <input placeholder="cserefotó asset ID" value={swapPhoto} onChange={(e) => setSwapPhoto(e.target.value)} style={{ flex: 1 }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <button disabled={busyKey !== null || !swapAsset || !swapPhoto}
            onClick={() => run("swap", "character_swap", { sourceAssetId: swapAsset, swapAssetId: swapPhoto })}>Csere</button>
          <Badge k="swap" /><Price k="swap" />
        </div>
        <Results k="swap" kind="image" />
        {msg.swap && <p className="muted">{msg.swap}</p>}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Upscale · Background Removal · Skin Enhancer · Fix Face</h3>
        <Picker media="image" selected={simpleAsset} onSelect={setSimpleAsset} />
        <input placeholder="asset ID" value={simpleAsset} onChange={(e) => setSimpleAsset(e.target.value)} style={{ marginTop: 8 }} />
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button className="ghost" disabled={busyKey !== null || !simpleAsset} onClick={() => run("up", "upscale", { sourceAssetId: simpleAsset })}>Upscale</button>
          <button className="ghost" disabled={busyKey !== null || !simpleAsset} onClick={() => run("bg", "background_removal", { sourceAssetId: simpleAsset })}>Háttér eltávolítás</button>
          <button className="ghost" disabled={busyKey !== null || !simpleAsset} onClick={() => run("skin", "skin_enhance", { sourceAssetId: simpleAsset })}>Skin Enhancer</button>
          <button className="ghost" disabled={busyKey !== null || !simpleAsset} onClick={() => run("face", "fix_face", { sourceAssetId: simpleAsset })}>Fix Face</button>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <Badge k="up" /><Price k="up" /><Badge k="bg" /><Price k="bg" /><Badge k="skin" /><Price k="skin" /><Badge k="face" /><Price k="face" />
        </div>
        <Results k="up" kind="image" /><Results k="bg" kind="image" /><Results k="skin" kind="image" /><Results k="face" kind="image" />
        {(msg.up || msg.bg || msg.skin || msg.face) && <p className="muted">{[msg.up, msg.bg, msg.skin, msg.face].filter(Boolean).join(" · ")}</p>}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Talking Video · Lip Sync</h3>
        <label>Videó</label>
        <Picker media="video" selected={talkVideo} onSelect={setTalkVideo} />
        <input placeholder="videó asset ID" value={talkVideo} onChange={(e) => setTalkVideo(e.target.value)} style={{ marginTop: 6 }} />
        <label>Hang (mp3/wav)</label>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ghost" disabled={busyKey !== null} onClick={async () => { const id = await upload("audio/mpeg,audio/wav"); if (id) setTalkAudio(id); }}>Hang feltöltése</button>
          <input placeholder="hang asset ID" value={talkAudio} onChange={(e) => setTalkAudio(e.target.value)} style={{ flex: 1 }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <button disabled={busyKey === "talk" || !talkVideo || !talkAudio}
            onClick={() => run("talk", "talking_video", { videoAssetId: talkVideo, audioAssetId: talkAudio })}>Talking Video</button>
          <button className="ghost" disabled={busyKey === "talk" || !talkVideo || !talkAudio}
            onClick={() => run("talk", "lip_sync", { videoAssetId: talkVideo, audioAssetId: talkAudio })}>Lip Sync</button>
          <Badge k="talk" /><Price k="talk" />
        </div>
        <Results k="talk" kind="video" />
        {msg.talk && <p className="muted">{msg.talk}</p>}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Video-to-Video · Image-to-Video</h3>
        <label>Forrás (videó az i2v-hez: kép fent)</label>
        <Picker media="video" selected={v2vVideo} onSelect={setV2vVideo} />
        <input placeholder="videó asset ID" value={v2vVideo} onChange={(e) => setV2vVideo(e.target.value)} style={{ marginTop: 6 }} />
        <input placeholder="stílus/mozgás prompt" value={v2vPrompt} onChange={(e) => setV2vPrompt(e.target.value)} style={{ marginTop: 6 }} />
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <button disabled={busyKey === "v2v" || !v2vVideo || !v2vPrompt.trim()}
            onClick={() => run("v2v", "video_to_video", { videoAssetId: v2vVideo, prompt: v2vPrompt, duration: vDuration, aspectRatio: vRatio })}>Videó→videó</button>
          <button className="ghost" disabled={busyKey === "motion" || !v2vVideo || !v2vPrompt.trim()}
            onClick={() => run("motion", "motion_control", { videoAssetId: v2vVideo, prompt: v2vPrompt, duration: vDuration, aspectRatio: vRatio }, { characterId: toolChar || undefined })}>Motion Control</button>
          <Badge k="v2v" /><Price k="v2v" />
        </div>
        <Results k="v2v" kind="video" />
        {msg.v2v && <p className="muted">{msg.v2v}</p>}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Image Editor · Pinterest Composition · Image-to-Video · TTS</h3>
        <Picker media="image" selected={edAsset} onSelect={setEdAsset} />
        <input placeholder="asset ID" value={edAsset} onChange={(e) => setEdAsset(e.target.value)} style={{ marginTop: 6 }} />
        <input placeholder="szerkesztési prompt" value={edPrompt} onChange={(e) => setEdPrompt(e.target.value)} style={{ marginTop: 6 }} />
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <button disabled={busyKey === "edit" || !edAsset || !edPrompt.trim()} onClick={() => run("edit", "image_edit", { imageAssetIds: [edAsset], prompt: edPrompt })}>Szerkesztés</button>
          <button className="ghost" disabled={busyKey === "pinterest" || !edAsset || !edPrompt.trim()}
            onClick={() => run("pinterest", "pinterest_composition", { sourceAssetId: edAsset, prompt: edPrompt }, { characterId: toolChar || undefined })}>Pinterest-kompozíció</button>
          <Badge k="edit" /><Price k="edit" />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <input placeholder="i2v prompt" value={vPrompt} onChange={(e) => setVPrompt(e.target.value)} style={{ flex: 1 }} />
          <select value={vDuration} onChange={(e) => setVDuration(e.target.value)}><option value="5">5 mp</option><option value="10">10 mp</option></select>
          <select value={vRatio} onChange={(e) => setVRatio(e.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option></select>
          <button disabled={busyKey === "i2v" || !edAsset || !vPrompt.trim() || !vModel}
            onClick={() => run("i2v", "video_from_image", { sourceAssetId: edAsset, prompt: vPrompt, duration: vDuration, aspectRatio: vRatio, model: vModel }, { characterId: toolChar || undefined })}>I2V</button>
          <Badge k="i2v" /><Price k="i2v" />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <input placeholder="TTS szöveg" value={ttsText} onChange={(e) => setTtsText(e.target.value)} style={{ flex: 1 }} />
          <select value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)}><option>Jennifer (en)</option><option>Dexter (en)</option><option>Arista (hu)</option></select>
          <button disabled={busyKey === "tts" || !ttsText.trim()} onClick={() => run("tts", "tts", { text: ttsText, voice: ttsVoice, speed: 1 })}>TTS</button>
          <Badge k="tts" /><Price k="tts" />
        </div>
        <Results k="edit" kind="image" /><Results k="i2v" kind="video" /><Results k="tts" kind="video" />
        {(msg.edit || msg.i2v || msg.tts) && <p className="muted">{[msg.edit, msg.i2v, msg.tts].filter(Boolean).join(" · ")}</p>}
      </div>
      <p className="muted" style={{ marginTop: 10 }}>Viral Reels, Trends, Niche, Carousel és TikTok-import a Tartalom menüben érhető el.</p>
    </main>
  );
}
