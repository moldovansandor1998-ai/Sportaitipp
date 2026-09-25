"use client";
import { use, useCallback, useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/client";
import Image from "next/image";

interface CharacterRow { id: string; name: string; status: string; }
interface RefRow { id: string; asset_id: string; kind: string; qc_status: string; is_primary: boolean; sort_order: number; }
interface VersionRow {
  id: string; version_no: number; status: string; provider: string | null; identity_score: number | null;
  provider_model_ref: string | null;
  test_image_asset_id: string | null;
}
interface JobMini { id: string; type: string; status: string; cost_estimate: number; }

export default function CharacterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [character, setCharacter] = useState<CharacterRow | null>(null);
  const [refs, setRefs] = useState<RefRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [jobs, setJobs] = useState<JobMini[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [providers, setProviders] = useState<{
    referenceQc: boolean; training: boolean; testImage: boolean;
    identityCheck: boolean; generation: boolean;
  } | null>(null);

  useEffect(() => {
    fetch("/api/providers/status").then((response) => response.ok ? response.json() : null)
      .then(setProviders).catch(() => setProviders(null));
  }, []);

  const load = useCallback(async () => {
    const getSb = () => browserClient();
    const { data: c } = await getSb().from("characters").select("*").eq("id", id).single();
    setCharacter(c);
    const { data: r } = await getSb().from("character_reference_images")
      .select("*").eq("character_id", id).order("sort_order");
    setRefs(r ?? []);
    const { data: v } = await getSb().from("character_versions")
      .select("*").eq("character_id", id).order("version_no", { ascending: false });
    setVersions(v ?? []);
    const { data: j } = await getSb().from("generation_jobs")
      .select("id,type,status,cost_estimate").eq("character_id", id)
      .order("created_at", { ascending: false }).limit(10);
    setJobs(j ?? []);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ids = [...refs.map((r) => r.asset_id), ...versions.map((v) => v.test_image_asset_id).filter((x): x is string => Boolean(x))];
    if (ids.length === 0) return;
    let active = true;
    (async () => {
      const { data: { session } } = await browserClient().auth.getSession();
      if (!session) return;
      const urls = await Promise.all(ids.map(async (assetId) => {
        const result = await fetch(`/api/assets/${assetId}/url`, { headers: { authorization: `Bearer ${session.access_token}` } });
        const body = result.ok ? await result.json() : null;
        return [assetId, typeof body?.url === "string" ? body.url : ""] as const;
      }));
      if (active) setPreviews(Object.fromEntries(urls));
    })().catch(() => {});
    return () => { active = false; };
  }, [refs, versions]);

  useEffect(() => {
    (async () => {
      const getSb = () => browserClient();
      const { data: { user } } = await getSb().auth.getUser();
      if (!user) return;
      const { data } = await getSb().from("credit_accounts").select("balance").eq("user_id", user.id).single();
      setCredits(data?.balance ?? 0);
    })();
  }, []);

  async function uploadFiles(files: FileList | null, kind: string) {
    if (!files?.length) return;
    setBusy(true); setError(null);
    const getSb = () => browserClient();
    const { data: { session } } = await getSb().auth.getSession();
    try {
      for (const file of Array.from(files)) {
        // 1) Aláírt URL (szerver)
        const sign = await fetch("/api/uploads/sign", {
          method: "POST",
          headers: { authorization: `Bearer ${session?.access_token}`, "content-type": "application/json" },
          body: JSON.stringify({ filename: file.name, kind }),
        });
        if (!sign.ok) {
          const detail = await sign.json().catch(() => ({}));
          throw new Error(detail.error === "UPLOAD_SERVICE_NOT_CONFIGURED"
            ? "A képfeltöltés szerveroldali beállítása hiányzik. Kérjük, jelezd az üzemeltetőnek."
            : detail.error === "unauthorized"
              ? "A munkamenet lejárt. Jelentkezz be újra."
              : `Nem sikerült előkészíteni a feltöltést (${detail.error ?? `HTTP ${sign.status}`}).`);
        }
        const { objectPath, token } = await sign.json();

        // 2) Feltöltés közvetlenül a privát bucketbe
        const { error: uploadError } = await getSb().storage.from("references")
          .uploadToSignedUrl(objectPath, token, file, { contentType: file.type });
        if (uploadError) throw new Error(`Feltöltés sikertelen: ${file.name} (${uploadError.message})`);

        // 3) Szerveroldali finalize: méret/MIME/tulajdon/SHA-256 ellenőrzés + rekordok
        const fin = await fetch("/api/references/finalize", {
          method: "POST",
          headers: { authorization: `Bearer ${session?.access_token}`, "content-type": "application/json" },
          body: JSON.stringify({ objectPath, characterId: id, kind }),
        });
        if (!fin.ok) {
          const b = await fin.json();
          throw new Error(b.error === "DUPLICATE_IMAGE" ? `Duplikált kép: ${file.name}` : b.error ?? "Finalize hiba");
        }
      }
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ismeretlen hiba");
    } finally { setBusy(false); }
  }

  async function startJob(type: string, payload: Record<string, unknown>) {
    setBusy(true); setError(null);
    const getSb = () => browserClient();
    const { data: { session } } = await getSb().auth.getSession();
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { authorization: `Bearer ${session?.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ type, characterId: id, payload }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json();
      setError(body.error === "INSUFFICIENT_CREDITS" ? "Nincs elég kredited." : body.error ?? "Hiba");
    }
    setTimeout(load, 1500); // after() aszinkron kick – állapot frissítés
    await load();
  }

  async function manualReview(stage: "references" | "test_image", versionId?: string) {
    const message = stage === "references"
      ? "Átnézted a képeket, és megerősíted, hogy mind ugyanazt az általad használható karaktert mutatják? A szerver ezután a fájlokat is ellenőrzi."
      : "Átnézted a tesztképet, és elfogadod a karakter hasonlóságát? Ez kézi jóváhagyás, nem automatikus arcazonosság-mérés.";
    if (!window.confirm(message)) return;
    setBusy(true); setError(null);
    try {
      const { data: { session } } = await browserClient().auth.getSession();
      const res = await fetch(`/api/characters/${id}/manual-review`, {
        method: "POST",
        headers: { authorization: `Bearer ${session?.access_token}`, "content-type": "application/json" },
        body: JSON.stringify({ stage, versionId, confirmed: true }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Az ellenőrzés nem sikerült");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Ellenőrzési hiba"); }
    finally { setBusy(false); }
  }

  // Tesztkép: a legújabb verzió LoRA-refjével (provider_model_ref)
  async function startTestImage() {
    const latest = versions[0];
    if (!latest) { setError("Nincs verzió – előbb tréning."); return; }
    await startJob("test_image", {
      prompt: "portrait of the character, studio lighting, neutral background",
      loraPath: latest.provider_model_ref ?? undefined,
      steps: 28,
    });
  }

  // Tréning: SZERVEROLDALI dataset + destination (training-prep), majd job a visszakapott payloadból
  async function startTraining() {
    setBusy(true); setError(null);
    const getSb = () => browserClient();
    const { data: { session } } = await getSb().auth.getSession();
    try {
      const res = await fetch(`/api/characters/${id}/training-prep`, {
        method: "POST",
        headers: { authorization: `Bearer ${session?.access_token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "training-prep hiba");
      await startJob("character_training", body.payload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Tréning-hiba");
    } finally { setBusy(false); }
  }

  if (!character) return <div className="skeleton" />;

  const approvedRefs = refs.filter((r) => r.qc_status === "approved");
  // Identity check: csak valódi (nem mock) providerről tanított verzióval
  const latestRealVersion = versions.find((v) => v.provider && v.provider !== "mock");
  const active = character.status === "active";

  return (
    <main>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>{character.name}</h1>
      <p className="muted">
        Státusz: {character.status} · Kredit: {credits ?? "…"} ·{" "}
        {active ? "Aktív – generálható" : "A generáláshoz active státusz kell (QC → tréning → tesztkép → identity check)"}
      </p>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Referenciafotók ({refs.length})</h3>
        <p className="muted">Arc-, félalakos és teljes alakos képek, különböző szögekből. Javasolt: min. 10 db, egy személy/kép.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["face", "half_body", "full_body"] as const).map((kind) => (
            <label key={kind} style={{ display: "inline-flex", gap: 6, alignItems: "center", margin: 0 }}>
              <button className="ghost" disabled={busy}
                onClick={() => document.getElementById(`up-${kind}`)?.click()}>
                + {kind === "face" ? "Arc" : kind === "half_body" ? "Félalak" : "Teljes alak"}
              </button>
              <input id={`up-${kind}`} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
                onChange={(e) => uploadFiles(e.target.files, kind)} />
            </label>
          ))}
        </div>
        <ul style={{ marginTop: 12, paddingLeft: 18 }}>
          {refs.map((r) => (
            <li key={r.id} className="muted">
              {previews[r.asset_id] && <Image unoptimized width={70} height={70} src={previews[r.asset_id]} alt={`${r.kind} referencia`} style={{ objectFit: "cover", borderRadius: 8, verticalAlign: "middle", marginRight: 8 }} />}
              {r.kind} · {r.qc_status}{r.is_primary && " · elsődleges"}
            </li>
          ))}
        </ul>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Karakter létrehozása</h3>
        <p className="muted">A referenciafájlok épségét a szerver ellenőrzi. A szereplő azonosságát és a tesztkép hasonlóságát jelenleg te hagyod jóvá a képek megtekintése után.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="ghost" disabled={busy || refs.length === 0 || !providers?.referenceQc}
            onClick={() => startJob("reference_qc", { refIds: refs.map((r) => r.id) })}>1. Referencia-QC</button>
          <button className="ghost" disabled={busy || refs.length < 3 || character.status !== "collecting_refs"}
            onClick={() => manualReview("references")}>1. Referenciák kézi jóváhagyása</button>
          <button className="ghost" disabled={busy || approvedRefs.length < 3 || !providers?.training}
            onClick={startTraining}>2. Tréning (LoRA)</button>
          <button className="ghost" disabled={busy || versions.length === 0 || !providers?.testImage}
            onClick={startTestImage}>3. Tesztkép</button>
          <button className="ghost" disabled={busy || !latestRealVersion || !providers?.identityCheck}
            title={latestRealVersion ? "" : "Mock tréning után nem elérhető – éles providerrel (fal/Replicate) tanított verzió kell"}
            onClick={() => startJob("identity_check", {})}>4. Azonosság-ellenőrzés</button>
          <button className="ghost" disabled={busy || character.status !== "test_pending" || !latestRealVersion?.test_image_asset_id || !previews[latestRealVersion.test_image_asset_id]}
            onClick={() => manualReview("test_image", latestRealVersion?.id)}>4. Tesztkép kézi jóváhagyása</button>
          <button disabled={busy || !active || !providers?.generation}
            onClick={() => startJob("image_generation", { prompt: "portrait, studio light" })}>5. Képgenerálás</button>
        </div>
        {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
      </div>

      {versions.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Verziók</h3>
          {versions.map((v) => (
            <div key={v.id} style={{ display: "flex", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
              <span style={{ flex: 1 }}>v{v.version_no} · {v.provider ?? "–"}</span>
              <span className="badge">{v.status}</span>
              <span className="muted">{v.identity_score != null ? `identity: ${v.identity_score}` : "identity: –"}</span>
              {v.test_image_asset_id && previews[v.test_image_asset_id] && <Image unoptimized width={90} height={90} src={previews[v.test_image_asset_id]} alt="Generált tesztkép" style={{ objectFit: "cover", borderRadius: 8 }} />}
            </div>
          ))}
        </div>
      )}

      {jobs.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Feladatok</h3>
          {jobs.map((j) => (
            <div key={j.id} style={{ display: "flex", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
              <span style={{ flex: 1 }}>{j.type}</span>
              <span className="badge">{j.status}</span>
              <span className="muted">{j.cost_estimate} kr</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
