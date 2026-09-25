"use client";
// AI Image Generator – TELJES felület. A loraPath-et KIZÁRÓLAG a szerver állítja be;
// kreditár a generálás ELŐTT (estimate), állapot-poll, retry, eredmény + letöltés + galéria.
import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/client";
import { EASY_FIELDS, buildEasyPrompt, normalizeEasyInput, type EasyInput } from "@/lib/promptBuilder";
import { JobPoller, TERMINAL_STATUSES } from "@/lib/jobs/poller";
import { createAttemptTracker, type AttemptTracker } from "@/lib/jobs/attemptKey";
import { createSubmitGuard, type SubmitGuard } from "@/lib/jobs/submitGuard";
import { guardedRun } from "@/lib/jobs/guardedRun";
import { startJobWithTracker } from "@/lib/jobs/startJob";

interface CharacterRow { id: string; name: string; active_version_id: string | null; }
interface JobRow { id: string; type: string; status: string; error: { message?: string } | null; }
interface ResultItem { assetId: string; galleryItemId: string; mediaType: string; url: string | null; }

export default function GeneratePage() {
  const [characters, setCharacters] = useState<CharacterRow[]>([]);
  const [mode, setMode] = useState<"easy" | "expert">("easy");
  const [characterId, setCharacterId] = useState("");
  const [easy, setEasy] = useState<EasyInput>({ scene: "", outfit: "", location: "", pose: "", cameraAngle: "", lighting: "", visualStyle: "" });
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [seed, setSeed] = useState("");
  const [steps, setSteps] = useState("28");
  const [guidance, setGuidance] = useState("");
  const [numImages, setNumImages] = useState("1");
  const [imageSize, setImageSize] = useState("square_hd");
  const [estimate, setEstimate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobRow | null>(null);
  const [results, setResults] = useState<ResultItem[]>([]);
  const pollerRef = useRef<JobPoller | null>(null);
  const trackerRef = useRef<AttemptTracker | null>(null);   // minden felhasználói attempt új tracker
  const submittingRef = useRef<SubmitGuard>(createSubmitGuard());  // SZINKRON duplaindítás-védelem

  const getSb = () => browserClient();
  // stabil callback – a hook-warning megszüntetve
  const token = useCallback(async () => (await getSb().auth.getSession()).data.session?.access_token ?? "", []);

  const loadCharacters = useCallback(async () => {
    const { data: { user } } = await getSb().auth.getUser();
    if (!user) return;
    const { data } = await getSb().from("characters").select("id,name,active_version_id").eq("owner_id", user.id).eq("status", "active");
    const list = (data ?? []) as unknown as CharacterRow[];
    setCharacters(list);
    if (list.length && !characterId) setCharacterId(list[0].id);
  }, [characterId]);
  useEffect(() => { loadCharacters(); }, [loadCharacters]);

  const finalPrompt = mode === "easy" ? buildEasyPrompt(normalizeEasyInput(easy as unknown as Record<string, unknown>)) : prompt;
  const payload = (): Record<string, unknown> => {
    const p: Record<string, unknown> = mode === "easy"
      ? { ...normalizeEasyInput(easy as unknown as Record<string, unknown>), mode: "easy", imageSize, numImages: Number(numImages) || 1 }
      : { prompt, imageSize, numImages: Number(numImages) || 1, steps: Number(steps) || 28 };
    if (mode === "expert") {
      if (seed.trim()) p.seed = Number(seed);
      if (negative.trim()) p.negativePrompt = negative.trim();
      if (guidance.trim()) p.guidance = Number(guidance);
    }
    return p;
  };

  // becslés: mezőváltásra (debounce nélkül, egyszerűen minden változásnál)
  useEffect(() => {
    (async () => {
      if (!characterId || !finalPrompt.trim()) { setEstimate(null); return; }
      const res = await fetch("/api/jobs/estimate", {
        method: "POST",
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: JSON.stringify({ type: "image_generation", characterId, payload: payload() }),
      });
      if (res.ok) setEstimate(((await res.json()) as { credits: number }).credits);
      else setEstimate(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a payload függvény minden mezőt lefed
  }, [mode, characterId, easy, prompt, negative, seed, steps, guidance, numImages, imageSize]);

  function poll(jobId: string) {
    pollerRef.current ??= new JobPoller({
      intervalMs: 2500, maxAttempts: 240, maxConsecutiveErrors: 3,
      isTerminal: (s) => TERMINAL_STATUSES.includes(s),
    });
    pollerRef.current.stop(jobId);                 // újraindítás előtt régi kezelés egyértelmű
    pollerRef.current.start(
      jobId,
      async () => {
        const { data } = await getSb().from("generation_jobs").select("status,error").eq("id", jobId).single();
        const j = data as { status: string; error: { message?: string } | null } | null;
        return { status: j?.status ?? "unknown", error: j?.error?.message ?? null };
      },
      async (_id, status, error) => {
        const errorMessage = typeof error === "string" && error.length > 0 ? error : null;
        setJob({ id: jobId, type: "image_generation", status, error: errorMessage ? { message: errorMessage } : null });
        if (status === "completed") await loadResults(jobId);   // CSAK ennek a jobnak az eredményei
      },
    );
  }

  // stabil callback – a hook-warning megszüntetve (token függőség a getSb-n keresztül oldódik)
  const loadResults = useCallback(async (jobId: string) => {
    const res = await fetch(`/api/jobs/${jobId}`, { headers: { authorization: `Bearer ${await token()}` } });
    if (!res.ok) return;
    const b = await res.json() as { results: ResultItem[] };
    setResults(b.results.filter((r) => r.mediaType === "image" && r.url));
  }, [token]);
  useEffect(() => () => { pollerRef.current?.stopAll(); }, []);   // unmount: minden polling leáll

  function start() {
    // SZINKRON zár + try/catch/finally: busy MINDEN hibánál visszaáll, nincs unhandled rejection
    void guardedRun({
      guard: submittingRef.current,
      setBusy,
      onError: (msg) => setError(msg === "INSUFFICIENT_CREDITS" ? "Nincs elég kredited." : msg),
      fn: async () => {
        setError(null); setJob(null);
        // új tracker CSAK szabad guardnál – a futó attempt alatt nem íródik felül
        trackerRef.current = createAttemptTracker();
        const result = await startJobWithTracker({
          tracker: trackerRef.current, fetchImpl: fetch, token: await token(),
          body: { type: "image_generation", characterId, payload: payload() },
        });
        if ("skipped" in result) throw new Error("A kérés már fut.");
        if (!result.ok) throw new Error(result.error ?? `Hiba ${result.status}`);
        return result;
      },
    }).then((r) => {
      if ("ok" in r && r.ok) {
        setJob({ id: r.value.jobId!, type: "image_generation", status: "queued", error: null });
        poll(r.value.jobId!);
      }
    });
  }

  async function retry() {
    if (!job) return;
    await start();   // új job (a régi hibáját a feladatlista mutatja)
  }

  const activeChar = characters.find((c) => c.id === characterId);

  return (
    <main style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>AI Image Generator</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className={mode === "easy" ? "" : "ghost"} onClick={() => setMode("easy")}>Easy Mode</button>
        <button className={mode === "expert" ? "" : "ghost"} onClick={() => setMode("expert")}>Expert Mode</button>
      </div>
      <div className="card">
        <label>Karakter (kötelező – csak aktív)</label>
        <select value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
          {!characterId && <option value="">– nincs aktív karaktered –</option>}
          {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {activeChar && (
          <p className="muted" style={{ margin: "6px 0 0" }}>Aktív verzió: {activeChar.active_version_id ? activeChar.active_version_id.slice(0, 8) + "…" : "–"} · a loraPath-et a szerver állítja be</p>
        )}

        {mode === "easy" ? (
          <>
            {EASY_FIELDS.map((f) => (
              <div key={f.key}>
                <label>{f.label}</label>
                <input value={easy[f.key]} onChange={(e) => setEasy({ ...easy, [f.key]: e.target.value })} placeholder={f.placeholder} />
              </div>
            ))}
          </>
        ) : (
          <>
            <label>Prompt</label>
            <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <label>Negative prompt (opcionális)</label>
            <input value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="amit NE szeretnél a képen" />
          </>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div>
            <label>Méret</label>
            <select value={imageSize} onChange={(e) => setImageSize(e.target.value)}>
              <option value="square_hd">1:1</option>
              <option value="portrait_4_3">3:4 álló</option>
              <option value="landscape_4_3">4:3 fekvő</option>
            </select>
          </div>
          <div>
            <label>Képek száma</label>
            <input value={numImages} onChange={(e) => setNumImages(e.target.value)} inputMode="numeric" />
          </div>
          {mode === "expert" && (
            <>
              <div>
                <label>Steps</label>
                <input value={steps} onChange={(e) => setSteps(e.target.value)} inputMode="numeric" />
              </div>
              <div>
                <label>Seed</label>
                <input value={seed} onChange={(e) => setSeed(e.target.value)} inputMode="numeric" placeholder="véletlen" />
              </div>
              <div>
                <label>Guidance</label>
                <input value={guidance} onChange={(e) => setGuidance(e.target.value)} inputMode="decimal" placeholder="pl. 3.5" />
              </div>
            </>
          )}
        </div>
        {mode === "easy" && (
          <>
            <label style={{ marginTop: 10 }}>Prompt előnézet</label>
            <div className="muted" style={{ background: "var(--panel-2)", borderRadius: 8, padding: 10 }}>{finalPrompt || "…"}</div>
          </>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16 }}>
          <button onClick={start} disabled={busy || !characterId || !finalPrompt.trim()}>Generálás</button>
          <span className="badge">{estimate === null ? "ár: –" : `ár: ${estimate} kredit`}</span>
          {job && <span className="badge">{job.status}{job.error?.message ? ` – ${job.error.message}` : ""}</span>}
        </div>
        {error && <p className="error">{error}</p>}
        {job && ["failed", "refunded", "cancelled"].includes(job.status) && (
          <button className="ghost" style={{ marginTop: 8 }} onClick={retry} disabled={busy}>Újrapróbálás</button>
        )}
      </div>

      {results.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Legutóbbi eredményeid (galériába mentve)</h3>
          <div className="grid">
            {results.map((r) => (
              <div key={r.galleryItemId} className="card" style={{ padding: 8 }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URL */}
                <img src={r.url ?? ""} alt="" style={{ width: "100%", borderRadius: 6 }} />
                <a href={r.url ?? "#"} download><button className="ghost" style={{ marginTop: 6, padding: "4px 10px" }}>Letöltés</button></a>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
