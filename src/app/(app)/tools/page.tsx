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
interface Cfg { mode: string; faceSwapConfigured: boolean; i2vModels: Array<{ id: string; label: string }>; }

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
  const [swapAsset, setSwapAsset] = useState(""); const [swapPreview, setSwapPreview] = useState("");
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkStatus, setBulkStatus] = useState<Array<{ name: string; state: string; jobId?: string }>>([]);
  const bulkBusyRef = useRef(false);
  const [pinterestQuery, setPinterestQuery] = useState("");
  const [pinterestPins, setPinterestPins] = useState<Array<{ id: string; imageUrl: string; pinUrl: string }>>([]);
  const [pinterestMessage, setPinterestMessage] = useState("");
  const [swapPinUrl, setSwapPinUrl] = useState("");
  const [characterEditModel, setCharacterEditModel] = useState<"seedream-v4.5" | "nano-banana">("seedream-v4.5");
  const [talkVideo, setTalkVideo] = useState(""); const [talkAudio, setTalkAudio] = useState("");
  const [v2vVideo, setV2vVideo] = useState(""); const [v2vPrompt, setV2vPrompt] = useState("");
  const [videoResolution, setVideoResolution] = useState<"480p" | "720p">("720p");
  const [motionQuality, setMotionQuality] = useState<"pro" | "standard">("pro");
  const [videoPreview, setVideoPreview] = useState("");

  const getSb = () => browserClient();
  const token = useCallback(async () => (await getSb().auth.getSession()).data.session?.access_token ?? "", []);

  const init = useCallback(async () => {
    const { data: { user } } = await getSb().auth.getUser();
    if (!user) return;
    const batchResponse = await fetch("/api/jobs/batch", { headers: { authorization: `Bearer ${await token()}` } });
    if (batchResponse.ok) {
      const batch = await batchResponse.json() as { items: Array<{ filename: string; status: string; job_id: string | null; jobStatus: string | null; error: string | null }> };
      setBulkStatus(batch.items.map((item) => ({
        name: item.filename, jobId: item.job_id ?? undefined,
        state: item.jobStatus ?? (item.status === "pending" || item.status === "claimed" ? "sorban" : item.error ?? item.status),
      })));
    }
    const res = await fetch("/api/gallery", { headers: { authorization: `Bearer ${await token()}` } });
    if (res.ok) {
      const items = ((await res.json()) as { items: GalItem[] }).items.filter((i) => i.url);
      setGallery(items);
    }
    const { data: lastVideo } = await getSb().from("assets").select("id")
      .eq("owner_id", user.id).eq("media_type", "video").eq("source", "upload")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (lastVideo?.id) setV2vVideo((current) => current || lastVideo.id);
    const { data: chars } = await getSb().from("characters").select("id,name").eq("owner_id", user.id).not("active_version_id", "is", null);
    setCharacters((chars ?? []) as unknown as CharacterRow[]);
    if (chars?.length === 1) setToolChar((current) => current || chars[0].id);
    const c = await fetch("/api/config/provider");
    if (c.ok) { const j = await c.json() as Cfg; setCfg(j); if (j.i2vModels[0]) setVModel(j.i2vModels[0].id); }
    // A karakteres képszerkesztés állapota oldalváltás után is visszatölthető.
    const { data: latestEdits } = await getSb().from("generation_jobs")
      .select("id,status,error").eq("owner_id", user.id).eq("type", "character_swap")
      .not("character_id", "is", null).order("created_at", { ascending: false }).limit(50);
    const latestEdit = latestEdits?.[0] as JobRow | undefined;
    if (latestEdit) {
      setJobs((current) => ({ ...current, fullSwap: latestEdit }));
      for (const edit of (latestEdits ?? []) as JobRow[]) {
        if (edit.status === "processing") poll(edit.id, edit.id === latestEdit.id ? "fullSwap" : `fullSwap:${edit.id}`);
      }
      if (latestEdit.status === "completed") await loadJobResults(latestEdit.id, "fullSwap");
      let restored = 0;
      for (const edit of (latestEdits ?? []) as JobRow[]) {
        if (edit.status !== "refunded" || edit.error?.message !== "URL_HOST_NOT_ALLOWED") continue;
        const recovered = await fetch(`/api/jobs/${edit.id}/recover-face-swap`, {
          method: "POST", headers: { authorization: `Bearer ${await token()}` },
        });
        if (recovered.ok) {
          restored++;
          if (edit.id === latestEdit.id) await loadJobResults(edit.id, "fullSwap");
        }
      }
      if (restored > 0) {
        const updatedGallery = await fetch("/api/gallery", { headers: { authorization: `Bearer ${await token()}` } });
        if (updatedGallery.ok) setGallery(((await updatedGallery.json()) as { items: GalItem[] }).items.filter((i) => i.url));
        setMsg((current) => ({ ...current, fullSwap: `${restored} korábbi kép helyreállítva a Galériában.` }));
      }
    }
  }, [token]);
  useEffect(() => { void init(); }, [init]);
  useEffect(() => {
    pollerRef.current ??= new JobPoller({ intervalMs: 8000, maxAttempts: 240, maxConsecutiveErrors: 3, isTerminal: (s) => TERMINAL_STATUSES.includes(s) });
    return () => pollerRef.current?.stopAll();
  }, []);
  useEffect(() => {
    const refresh = async () => {
      const accessToken = await token();
      if (!accessToken) return;
      const response = await fetch("/api/jobs/batch", { headers: { authorization: `Bearer ${accessToken}` } });
      if (!response.ok) return;
      const batch = await response.json() as { items: Array<{ filename: string; status: string; job_id: string | null; jobStatus: string | null; error: string | null }> };
      if (batch.items.length) setBulkStatus(batch.items.map((item) => ({
        name: item.filename, jobId: item.job_id ?? undefined,
        state: item.jobStatus ?? (item.status === "pending" || item.status === "claimed" ? "sorban" : item.error ?? item.status),
      })));
    };
    const timer = window.setInterval(() => { if (!bulkBusyRef.current) void refresh(); }, 15000);
    return () => window.clearInterval(timer);
  }, [token]);

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
        // A webhook késhet; a már benyújtott provider-feladatot szerveren lekérdezzük.
        await fetch(`/api/jobs/${jobId}/refresh`, {
          method: "POST", headers: { authorization: `Bearer ${await token()}` },
        });
        const { data } = await getSb().from("generation_jobs").select("status,error,result").eq("id", jobId).single();
        const j = data as { status: string; error: { message?: string } | null; result: { meta?: { caption?: string } } | null } | null;
        return { status: j?.status ?? "unknown", error: j?.error?.message ?? null };
      },
      async (_id, status, error) => {
        const errorMessage = typeof error === "string" && error.length > 0 ? error : null;
        setJobs((m) => ({ ...m, [key]: { id: jobId, status, error: errorMessage ? { message: errorMessage } : null } }));
        if (status === "completed") { await loadJobResults(jobId, key); void init(); }
      });
  }

  async function upload(accept: string, onFile?: (file: File) => void): Promise<string | null> {
    const input = document.createElement("input");
    input.type = "file"; input.accept = accept;
    const file = await new Promise<File | null>((r) => { input.onchange = () => r(input.files?.[0] ?? null); input.click(); });
    if (!file) return null;
    const form = new FormData(); form.append("file", file);
    const res = await fetch("/api/assets/import", { method: "POST", headers: { authorization: `Bearer ${await token()}` }, body: form });
    if (!res.ok) { setMsg((m) => ({ ...m, upload: "Import hiba" })); return null; }
    onFile?.(file);
    return ((await res.json()) as { assetId: string }).assetId;
  }

  async function uploadVideo() {
    const picker = document.createElement("input");
    picker.type = "file"; picker.accept = "video/mp4,.mp4";
    const file = await new Promise<File | null>((resolve) => { picker.onchange = () => resolve(picker.files?.[0] ?? null); picker.click(); });
    if (!file) return;
    setBusyKey("videoUpload");
    setMsg((m) => ({ ...m, videoUpload: "Videó feltöltése…" }));
    try {
      if (file.type !== "video/mp4" || file.size < 1 || file.size > 48 * 1024 * 1024)
        throw new Error("MP4 videót válassz, legfeljebb 48 MB méretben.");
      const headers = { authorization: `Bearer ${await token()}`, "content-type": "application/json" };
      const signed = await fetch("/api/assets/video-upload", { method: "POST", headers,
        body: JSON.stringify({ contentType: file.type, size: file.size }) });
      const sign = await signed.json() as { objectPath?: string; token?: string; error?: string };
      if (!signed.ok || !sign.objectPath || !sign.token) throw new Error(sign.error ?? "Feltöltési hiba");
      const uploaded = await getSb().storage.from("assets").uploadToSignedUrl(sign.objectPath, sign.token, file, { contentType: file.type });
      if (uploaded.error) throw new Error(uploaded.error.message);
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
      const finalized = await fetch("/api/assets/video-upload", { method: "PUT", headers,
        body: JSON.stringify({ objectPath: sign.objectPath, sha256 }) });
      const result = await finalized.json() as { assetId?: string; error?: string };
      if (!finalized.ok || !result.assetId) throw new Error(result.error ?? "Nem sikerült menteni a videót.");
      setV2vVideo(result.assetId);
      setVideoPreview(URL.createObjectURL(file));
      setMsg((m) => ({ ...m, videoUpload: "Videó feltöltve. Válassz modellt, majd indítsd az átalakítást." }));
    } catch (error) {
      setMsg((m) => ({ ...m, videoUpload: error instanceof Error ? error.message : "Feltöltési hiba" }));
    } finally { setBusyKey(null); }
  }

  async function startBulkEdits(allModels = false) {
    if (bulkBusyRef.current || !bulkFiles.length || (!allModels && !toolChar) || (allModels && !characters.length) || !cfg?.faceSwapConfigured) return;
    bulkBusyRef.current = true;
    setBusyKey("bulkSwap");
    setBulkStatus(bulkFiles.map((file) => ({ name: file.name, state: "várakozik" })));
    const update = (index: number, change: Partial<{ name: string; state: string; jobId: string }>) =>
      setBulkStatus((current) => current.map((row, i) => i === index ? { ...row, ...change } : row));
    let queuedSources = 0;
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("Jelentkezz be újra a feltöltéshez.");
      const uploadedFiles: Array<{ assetId: string; name: string }> = [];
      for (let i = 0; i < bulkFiles.length; i++) {
        const file = bulkFiles[i];
        update(i, { state: "feltöltés" });
        try {
          const form = new FormData(); form.append("file", file);
          const uploaded = await fetch("/api/assets/import", { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: form });
          const imported = await uploaded.json() as { assetId?: string; error?: string };
          if (!uploaded.ok || !imported.assetId) throw new Error(imported.error ?? "Feltöltési hiba");
          uploadedFiles.push({ assetId: imported.assetId, name: file.name });
          update(i, { state: "feltöltve" });
        } catch (error) {
          update(i, { state: `hiba: ${error instanceof Error ? error.message : "ismeretlen hiba"}` });
        }
      }
      if (uploadedFiles.length) {
        for (let offset = 0; offset < uploadedFiles.length; offset += 20) {
          const part = uploadedFiles.slice(offset, offset + 20);
          const response = await fetch("/api/jobs/batch", {
            method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
            body: JSON.stringify({ ...(allModels ? { characterIds: characters.map((c) => c.id) } : { characterId: toolChar }), editModel: characterEditModel, files: part }),
          });
          if (!response.ok) throw new Error(`${queuedSources} forráskép már sorban van, a következő adag indítása nem sikerült. Ne indítsd újra az egész csomagot.`);
          queuedSources += part.length;
          setMsg((current) => ({ ...current, bulkSwap: `${queuedSources}/${uploadedFiles.length} forráskép sorba állítva…` }));
        }
        setBulkStatus(allModels ? characters.flatMap((c) => uploadedFiles.map((f) => ({ name: `${c.name} · ${f.name}`, state: "sorban" })))
          : uploadedFiles.map((f) => ({ name: f.name, state: "sorban" })));
        setMsg((current) => ({ ...current, bulkSwap: `${uploadedFiles.length} forráskép × ${allModels ? characters.length : 1} modell = ${uploadedFiles.length * (allModels ? characters.length : 1)} kép sorba állítva. Most már elhagyhatod vagy frissítheted az oldalt.` }));
        setBulkFiles([]);
        const picker = document.getElementById("character-source-images") as HTMLInputElement | null;
        if (picker) picker.value = "";
      }
    } catch (error) {
      setMsg((current) => ({ ...current, bulkSwap: error instanceof Error ? error.message : "Hiba történt" }));
      if (queuedSources > 0) {
        setBulkFiles([]);
        const picker = document.getElementById("character-source-images") as HTMLInputElement | null;
        if (picker) picker.value = "";
      }
    } finally {
      bulkBusyRef.current = false;
      setBusyKey(null);
    }
  }

  async function searchPinterest() {
    if (pinterestQuery.trim().length < 2) return;
    setPinterestMessage("Keresés…");
    setPinterestPins([]);
    try {
      const res = await fetch(`/api/pinterest/search?q=${encodeURIComponent(pinterestQuery.trim())}`, {
        headers: { authorization: `Bearer ${await token()}` },
      });
      const data = await res.json() as { error?: string; pins?: Array<{ id: string; imageUrl: string; pinUrl: string }> };
      if (!res.ok) {
        setPinterestMessage(data.error === "PINTEREST_ACCESS_REQUIRED" || data.error === "PINTEREST_SEARCH_ACCESS_REQUIRED"
          ? "A Pinterest kereséshez jóváhagyott Pinterest API hozzáférés szükséges."
          : "A Pinterest keresés most nem érhető el.");
        return;
      }
      setPinterestPins(data.pins ?? []);
      setPinterestMessage(data.pins?.length ? "Válassz egy képet az átalakításhoz." : "Nincs találat.");
    } catch { setPinterestMessage("A Pinterest keresés most nem érhető el."); }
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
        <label>Karakter</label>
        <select value={toolChar} onChange={(e) => setToolChar(e.target.value)} style={{ width: "100%" }}>
          <option value="">Nincs karakter</option>
          {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <p className="muted" style={{ marginBottom: 0 }}>Válaszd ki, kinek kell szerepelnie az új képen.</p>
      </div>

      <details className="card">
        <summary>Image-to-Prompt (egyéb eszköz)</summary>
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
      </details>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>{characters.find((c) => c.id === toolChar)?.name ?? "Karakter"} arca a feltöltött képen</h3>
        <p className="muted">A kiválasztott karakter arca és haja automatikusan kerül a képre. A rendszer a pózt és a hátteret megtartja; a látható telefont szürke iPhone 14 Pro Maxra állítja, és nem hagy tetoválást vagy vízjelet a kész képen.</p>
        <label>Szerkesztő modell <select value={characterEditModel} onChange={(e) => setCharacterEditModel(e.target.value as "seedream-v4.5" | "nano-banana")}>
          <option value="seedream-v4.5">Seedream 4.5 Edit</option>
          <option value="nano-banana">Nano Banana Edit</option>
        </select></label>
        {cfg && !cfg.faceSwapConfigured && <p className="muted">A WaveSpeed API-kulcs még nincs beállítva; az arccsere ezután válik elérhetővé.</p>}
        <label htmlFor="character-source-images" style={{ display: "block", margin: "12px 0 8px" }}>
          Átalakítandó képek tömeges feltöltése
        </label>
        <input id="character-source-images" type="file" accept="image/png,image/jpeg,image/webp,image/*"
          multiple disabled={busyKey !== null} aria-describedby="character-source-hint"
          onChange={(event) => {
            const selected = Array.from(event.currentTarget.files ?? []);
            setBulkFiles(selected);
            setBulkStatus([]);
            setSwapAsset(""); setSwapPinUrl(""); setSwapPreview("");
            setMsg((current) => ({ ...current, bulkSwap: "" }));
          }} />
        <p id="character-source-hint" className="muted">A telefon fotóválasztójában több képet is jelölj ki, majd nyomd meg a Kész gombot.</p>
        <p className="muted">A feltöltés befejezéséig maradj az oldalon. Amikor megjelenik a „sorba állítva” üzenet, a képek és videók az oldal bezárása után is feldolgozódnak.</p>
        {bulkFiles.length > 0 && <div role="status" style={{ margin: "8px 0 16px" }}>
          <p>{bulkFiles.length} kép kiválasztva</p>
          <button disabled={busyKey !== null || !toolChar || !cfg?.faceSwapConfigured}
            onClick={() => void startBulkEdits()}>Mind a {bulkFiles.length} kép elkészítése</button>
          <button className="ghost" style={{ marginLeft: 8 }} disabled={busyKey !== null || !characters.length || !cfg?.faceSwapConfigured}
            onClick={() => void startBulkEdits(true)}>Készítés az összes modellre ({bulkFiles.length * characters.length} kép)</button>
        </div>}
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <input aria-label="Pinterest keresés" placeholder="Keresés Pinterest képek között…" value={pinterestQuery}
            onChange={(e) => setPinterestQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void searchPinterest(); }} style={{ flex: 1, minWidth: 180 }} />
          <button className="ghost" disabled={pinterestQuery.trim().length < 2} onClick={() => void searchPinterest()}>Pinterest keresés</button>
          <a href={`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(pinterestQuery.trim())}`}
            target="_blank" rel="noopener noreferrer" className="ghost" style={{ padding: "10px 14px", textDecoration: "none" }}>
            Megnyitás Pinteresten
          </a>
        </div>
        <p className="muted">Ha a Pinterest kereséshez még nincs API-hozzáférés, nyisd meg a Pinterestet, mentsd le a kiválasztott képet, majd töltsd fel itt az „Átalakítandó kép feltöltése” gombbal.</p>
        {pinterestMessage && <p className="muted" role="status">{pinterestMessage}</p>}
        {pinterestPins.length > 0 && <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(125px, 1fr))" }}>
          {pinterestPins.map((pin) => <div key={pin.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Pinterest CDN preview */}
            <img src={pin.imageUrl} alt="Pinterest találat" style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 8 }} />
            <button className="ghost" disabled={busyKey !== null} onClick={() => { setSwapPinUrl(pin.imageUrl); setSwapAsset(""); setSwapPreview(pin.imageUrl); }}>Ezzel készítem</button>
            <a href={pin.pinUrl} target="_blank" rel="noreferrer" style={{ display: "block" }}>Megnyitás a Pinteresten</a>
          </div>)}</div>}
        {(swapAsset || swapPinUrl) && (swapPreview || gallery.find((item) => item.assetId === swapAsset)?.url) && (
          /* eslint-disable-next-line @next/next/no-img-element -- local preview or signed URL */
          <img src={swapPreview || gallery.find((item) => item.assetId === swapAsset)?.url || ""} alt="Átalakítandó kép előnézete" style={{ display: "block", maxWidth: "100%", maxHeight: 350, objectFit: "contain", borderRadius: 8 }} />
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <button disabled={busyKey !== null || (!swapAsset && !swapPinUrl) || !toolChar || !cfg?.faceSwapConfigured}
            onClick={() => run("fullSwap", "character_swap", {
              ...(swapPinUrl ? { imageUrl: swapPinUrl } : { sourceAssetId: swapAsset }), useCharacterReference: true, editModel: characterEditModel,
            }, { characterId: toolChar })}>{characters.find((c) => c.id === toolChar)?.name ?? "Karakter"} arcának behelyezése</button>
          <Badge k="fullSwap" /><Price k="fullSwap" />
        </div>
        <Results k="fullSwap" kind="image" />
        {msg.fullSwap && <p className="muted">{msg.fullSwap}</p>}
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 20, paddingTop: 16 }}>
          <h4 style={{ margin: "0 0 8px" }}>Tömeges feldolgozás állapota</h4>
          {msg.bulkSwap && <p role="status" className="muted">{msg.bulkSwap}</p>}
          {bulkStatus.length > 0 && <div role="status" style={{ marginTop: 12 }}>
            {bulkStatus.map((item, index) => <p key={`${index}-${item.name}`} style={{ margin: "4px 0" }}>
              {index + 1}. {item.name}: {item.jobId ? (jobs[`bulkSwap:${item.jobId}`]?.status ?? item.state) : item.state}
            </p>)}
          </div>}
        </div>
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
        <h4>Képből videó: a modell átveszi a feltöltött videó mozgását</h4>
        <p className="muted">A Kling a kiválasztott modell teljes alakos referenciafotójából készít új videót. A feltöltött MP4 a mozgás és a kamera nézőpontjának mintája. 3–30 másodperces videó ajánlott; a hosszabbat a szolgáltató levághatja.</p>
        <button className="ghost" type="button" disabled={busyKey !== null} onClick={() => void uploadVideo()}>Mozgásvideó feltöltése (MP4, max. 48 MB)</button>
        {msg.videoUpload && <p className="muted">{msg.videoUpload}</p>}
        {videoPreview && <video controls src={videoPreview} style={{ display: "block", maxWidth: "100%", maxHeight: 320, marginTop: 8 }} />}
        {v2vVideo && <p className="muted">Mozgásvideó kiválasztva. Fent válaszd ki a modellt.</p>}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <select aria-label="Kling videóminőség" value={motionQuality} onChange={(e) => setMotionQuality(e.target.value as "pro" | "standard")}>
            <option value="pro">Kling 3.0 Pro – jobb minőség</option><option value="standard">Kling 3.0 Standard</option>
          </select>
          <button disabled={busyKey !== null || !toolChar || !v2vVideo} onClick={() => run("modelMotion", "character_motion_video", { videoAssetId: v2vVideo, quality: motionQuality }, { characterId: toolChar })}>
            Videó készítése a kiválasztott modellel
          </button>
          <Badge k="modelMotion" /><Price k="modelMotion" />
        </div>
        <Results k="modelMotion" kind="video" />
        {msg.modelMotion && <p className="muted">{msg.modelMotion}</p>}
        <details style={{ marginTop: 14 }}>
          <summary>Csak arc és haj cseréje az eredeti videóban</summary>
          <p className="muted">Az eredeti test és háttér megtartásához válaszd ezt. A fenti Kling művelet új videót készít a modell fotójából.</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <select aria-label="Videó felbontás" value={videoResolution} onChange={(e) => setVideoResolution(e.target.value as "480p" | "720p")}>
            <option value="720p">720p</option><option value="480p">480p</option>
          </select>
          <button disabled={busyKey !== null || !toolChar || !v2vVideo} onClick={() => run("videoSwap", "video_character_swap", { videoAssetId: v2vVideo, resolution: videoResolution }, { characterId: toolChar })}>
            Csak arc és haj áthelyezése
          </button>
          <Badge k="videoSwap" /><Price k="videoSwap" />
        </div>
        <Results k="videoSwap" kind="video" />
        {msg.videoSwap && <p className="muted">{msg.videoSwap}</p>}
        </details>
        <details style={{ marginTop: 14 }}>
          <summary>Egyéb videós eszközök</summary>
        <label>Forrás (videó az i2v-hez: kép fent)</label>
        <Picker media="video" selected={v2vVideo} onSelect={setV2vVideo} />
        <input placeholder="videó asset ID" value={v2vVideo} onChange={(e) => setV2vVideo(e.target.value)} style={{ marginTop: 6 }} />
        <input placeholder="stílus/mozgás prompt" value={v2vPrompt} onChange={(e) => setV2vPrompt(e.target.value)} style={{ marginTop: 6 }} />
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <button disabled={busyKey === "v2v" || !v2vVideo || !v2vPrompt.trim()}
            onClick={() => run("v2v", "video_to_video", { videoAssetId: v2vVideo, prompt: v2vPrompt, duration: vDuration, aspectRatio: vRatio })}>Videó→videó</button>
          <button className="ghost" disabled={busyKey === "motion" || !v2vVideo || !v2vPrompt.trim()}
            onClick={() => run("motion", "motion_control", { videoAssetId: v2vVideo, prompt: v2vPrompt, duration: vDuration, aspectRatio: vRatio }, { characterId: toolChar || undefined })}>Kameramozgás (régi)</button>
          <Badge k="v2v" /><Price k="v2v" />
        </div>
        <Results k="v2v" kind="video" />
        {msg.v2v && <p className="muted">{msg.v2v}</p>}
        </details>
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
