"use client";
// Teljes galéria: keresés, médiatípus-szűrés, albumok, tömeges kiválasztás/törlés, letöltés.
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { browserClient } from "@/lib/supabase/client";
import { zipFiles } from "@/lib/downloadZip";

interface Item {
  galleryItemId: string; assetId: string; mediaType: string; qcStatus: string;
  url: string | null; characterId: string | null; contentType: string; albumId: string | null; usedAt: string | null;
  usedByCharacterIds: string[];
}
interface Album { id: string; name: string; }
interface Character { id: string; name: string; }

export default function GalleryPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [characterFilter, setCharacterFilter] = useState<string | null>(null);
  const characterFilterRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [albumFilter, setAlbumFilter] = useState("all");
  const [view, setView] = useState<"available" | "used">("available");
  const [usageError, setUsageError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [savingUsage, setSavingUsage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedEdits, setFailedEdits] = useState(0);

  const getSb = () => browserClient();
  const token = useCallback(async () => (await getSb().auth.getSession()).data.session?.access_token ?? "", []);
  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: { user } } = await getSb().auth.getUser();
      if (!user) return;
      const { data } = await getSb().from("characters").select("id,name")
        .eq("owner_id", user.id).order("created_at", { ascending: false });
      if (!active) return;
      const available = (data ?? []) as Character[];
      setCharacters(available);
      const requested = new URLSearchParams(window.location.search).get("characterId");
      const initial = requested === "all" || requested === "unassigned" || available.some((c) => c.id === requested)
        ? requested! : "all";
      characterFilterRef.current = initial;
      setCharacterFilter(initial);
    })();
    return () => { active = false; };
  }, []);

  const load = useCallback(async () => {
    if (characterFilter === null) return;
    // Poll every unfinished character edit, including older jobs that were started
    // before the user navigated away from the Tools page. This never submits a new run.
    const { data: { user } } = await getSb().auth.getUser();
    if (!user) return;
    let pendingQuery = getSb().from("generation_jobs")
      .select("id").eq("owner_id", user.id).eq("type", "character_swap").eq("status", "processing")
      .order("created_at", { ascending: false }).limit(50);
    if (characterFilter === "unassigned") pendingQuery = pendingQuery.is("character_id", null);
    else if (characterFilter !== "all") pendingQuery = pendingQuery.eq("character_id", characterFilter);
    const { data: pending } = await pendingQuery;
    setPendingCount(pending?.length ?? 0);
    if (pending?.length) {
      const auth = { authorization: `Bearer ${await token()}` };
      await Promise.allSettled(pending.map((job) => fetch(`/api/jobs/${job.id}/refresh`, {
        method: "POST", headers: auth,
      })));
    }
    let failedQuery = getSb().from("generation_jobs")
      .select("id", { count: "exact", head: true }).eq("owner_id", user.id)
      .eq("type", "character_swap").eq("status", "refunded")
      .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
    if (characterFilter === "unassigned") failedQuery = failedQuery.is("character_id", null);
    else if (characterFilter !== "all") failedQuery = failedQuery.eq("character_id", characterFilter);
    const { count: failed } = await failedQuery;
    setFailedEdits(failed ?? 0);
    const qs = new URLSearchParams();
    if (characterFilter !== "all") qs.set("characterId", characterFilter);
    if (albumFilter !== "all") qs.set("albumId", albumFilter);
    qs.set("view", view);
    qs.set("page", String(page));
    const res = await fetch(`/api/gallery?${qs}`, { headers: { authorization: `Bearer ${await token()}` } });
    if (res.ok) {
      const body = await res.json();
      if (characterFilterRef.current === characterFilter) {
        setItems(body.items);
        setTotal(body.total ?? body.items.length);
        if (page > 0 && body.items.length === 0) setPage(page - 1);
      }
    }
    const alb = await fetch("/api/albums", { headers: { authorization: `Bearer ${await token()}` } });
    if (alb.ok) setAlbums((await alb.json()).albums);
  }, [token, albumFilter, characterFilter, view, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    // Avoid replacing every signed image URL and triggering new image requests
    // when there is no generation waiting for a gallery result.
    const timer = pendingCount > 0 ? window.setInterval(refresh, 20000) : null;
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load, pendingCount]);

  async function createAlbum() {
    const name = prompt("Album neve?");
    if (!name) return;
    await fetch("/api/albums", {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await load();
  }
  async function assignToAlbum(albumId: string) {
    const sb = getSb();
    for (const gid of selected) {
      await sb.from("gallery_items").update({ album_id: albumId }).eq("id", gid);
    }
    setSelected(new Set());
    await load();
  }
  async function removeMany() {
    if (!confirm(`${selected.size} elem törlése?`)) return;
    setDeleting(true); setUsageError("");
    try {
      const ids = [...selected];
      const t = await token();
      const results = await Promise.allSettled(ids.map(gid => fetch(`/api/gallery/${gid}`, {
        method: "DELETE", headers: { authorization: `Bearer ${t}` },
      })));
      const removed = ids.filter((_, i) => results[i].status === "fulfilled" && results[i].value.ok);
      if (removed.length !== ids.length) setUsageError(`${ids.length - removed.length} képet nem sikerült törölni. Próbáld újra.`);
      setItems(current => current?.filter(item => !removed.includes(item.galleryItemId)) ?? null);
      setSelected(new Set(ids.filter(id => !removed.includes(id))));
      setTotal(current => Math.max(0, current - removed.length));
    } catch {
      setUsageError("A képek törlése hálózati hiba miatt sikertelen.");
    } finally {
      setDeleting(false);
    }
  }
  async function removeOne(id: string) {
    if (!confirm("Törlöd ezt az elemet?")) return;
    setDeleting(true); setUsageError("");
    try {
      const result = await fetch(`/api/gallery/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${await token()}` } });
      if (!result.ok) { setUsageError("A kép törlése sikertelen. Próbáld újra."); return; }
      setItems(current => current?.filter(item => item.galleryItemId !== id) ?? null);
      setTotal(current => Math.max(0, current - 1));
      setSelected(current => { const next = new Set(current); next.delete(id); return next; });
    } catch { setUsageError("A kép törlése hálózati hiba miatt sikertelen."); }
    finally { setDeleting(false); }
  }
  async function setUsed(ids: string[], used: boolean) {
    setUsageError("");
    setSavingUsage(ids[0] ?? null);
    const auth = { authorization: `Bearer ${await token()}`, "content-type": "application/json" };
    const results = await Promise.allSettled(ids.map(id => fetch(`/api/gallery/${id}/usage`, {
      method: "PATCH", headers: auth, body: JSON.stringify({ used }),
    })));
    const failed = results.filter(result => result.status === "rejected" || !result.value.ok);
    if (failed.length) setUsageError(`${failed.length} kép állapotát nem sikerült menteni.`);
    setSelected(new Set());
    setSavingUsage(null);
    await load();
  }
  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function downloadSelected() {
    const chosen = (items ?? []).filter(it => selected.has(it.galleryItemId));
    if (!chosen.length) return;
    setDownloading(true);
    setDownloadStatus(`Letöltés: 0/${chosen.length}`);
    try {
      const files: { name: string; bytes: ArrayBuffer }[] = [];
      for (const [index, item] of chosen.entries()) {
        if (!item.url) throw new Error("Egy kijelölt fájl nem érhető el. Frissítsd a galériát.");
        const response = await fetch(item.url);
        if (!response.ok) throw new Error(`Nem sikerült letölteni a(z) ${index + 1}. fájlt.`);
        const bytes = await response.arrayBuffer();
        const ext = item.contentType === "image/png" ? "png" : item.contentType === "image/webp" ? "webp"
          : item.contentType === "image/jpeg" ? "jpg" : item.contentType === "video/mp4" ? "mp4"
          : item.contentType === "audio/mpeg" ? "mp3" : "bin";
        const model = (characters.find(c => c.id === item.characterId)?.name ?? "egyeb")
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]/g, "_");
        files.push({ name: `${String(index + 1).padStart(3, "0")}_${model}_${item.assetId.slice(0, 8)}.${ext}`, bytes });
        setDownloadStatus(`Letöltés: ${index + 1}/${chosen.length}`);
      }
      const url = URL.createObjectURL(zipFiles(files));
      const link = document.createElement("a");
      link.href = url;
      link.download = `castora-kepek-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setDownloadStatus(`${files.length} fájl ZIP-ben letöltve.`);
    } catch (error) {
      setDownloadStatus(error instanceof Error ? error.message : "A közös letöltés nem sikerült.");
    } finally {
      setDownloading(false);
    }
  }

  if (characterFilter === null || items === null) return <div className="skeleton" />;
  const filtered = items.filter((it) =>
    (typeFilter === "all" || it.mediaType === typeFilter)
    && (albumFilter === "all" || true)   // album-szűrés a client oldali join után egyszerűsítve
    && (q === "" || it.assetId.toLowerCase().includes(q.toLowerCase()) || (it.contentType ?? "").includes(q)));

  return (
    <main>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Galériám</h1>
        <button className={view === "available" ? "" : "ghost"} disabled={view === "available"}
          onClick={() => { setView("available"); setPage(0); setSelected(new Set()); setItems(null); }}>Használatlan képek</button>
        <button className={view === "used" ? "" : "ghost"} disabled={view === "used"}
          onClick={() => { setView("used"); setPage(0); setSelected(new Set()); setItems(null); }}>Felhasznált képek</button>
        <select aria-label="Modell galériája" value={characterFilter} onChange={(e) => {
          setItems(null); setPage(0);
          setSelected(new Set());
          characterFilterRef.current = e.target.value;
          setCharacterFilter(e.target.value);
          window.history.replaceState(null, "", `/gallery?characterId=${encodeURIComponent(e.target.value)}`);
        }}>
          <option value="all">Összes modell</option>
          {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="unassigned">Egyéb képek (modell nélkül)</option>
        </select>
        <input placeholder="keresés (asset típus)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
        <select value={albumFilter} onChange={(e) => { setAlbumFilter(e.target.value); setPage(0); }}>
          <option value="all">minden album</option>
          {albums.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">mind</option><option value="image">kép</option><option value="video">videó</option><option value="audio">hang</option>
        </select>
        <button className="ghost" onClick={createAlbum}>+ Album</button>
        {albums.length > 0 && selected.size > 0 && (
          <select value="" onChange={(e) => e.target.value && assignToAlbum(e.target.value)}>
            <option value="">→ albumba…</option>
            {albums.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {selected.size > 0 && <button className="ghost" disabled={deleting} onClick={removeMany}>{deleting ? "Törlés…" : `Törlés (${selected.size})`}</button>}
        {selected.size > 0 && <button className="ghost" disabled={downloading} onClick={() => void downloadSelected()}>
          {downloading ? "ZIP készítése…" : `Kijelöltek letöltése ZIP-ben (${selected.size})`}
        </button>}
        {selected.size > 0 && <button className="ghost" disabled={savingUsage !== null}
          onClick={() => void setUsed([...selected], view === "available")}>{view === "available" ? "Felhasználva jelölés" : "Vissza a használatlanokhoz"} ({selected.size})</button>}
      </div>
      {usageError && <p className="error" role="alert">{usageError}</p>}
      {downloadStatus && <p role="status">{downloadStatus}</p>}
      <p className="muted">{view === "available" ? "Az itt felhasználva jelölt képek átkerülnek a Felhasznált képek nézetbe." : "A felhasznált képek megmaradnak, innen letölthetők és visszaállíthatók."}</p>
      <p className="muted">{total} elem · {page + 1}. oldal{selected.size > 0 && ` · ${selected.size} kiválasztva`}</p>
      {total > 24 && <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <button className="ghost" disabled={page === 0} onClick={() => { setPage(page - 1); setSelected(new Set()); }}>Előző oldal</button>
        <span>{page + 1} / {Math.ceil(total / 24)}</span>
        <button className="ghost" disabled={(page + 1) * 24 >= total} onClick={() => { setPage(page + 1); setSelected(new Set()); }}>Következő oldal</button>
      </div>}
      {pendingCount > 0 && <p className="muted">{pendingCount} kép feldolgozás alatt. Az eredmények itt automatikusan frissülnek.</p>}
      {failedEdits > 0 && <p role="status" style={{ color: "#f29a9a" }}>{failedEdits} képszerkesztés meghiúsult az elmúlt órában; ezek krediteit a rendszer visszaadta.</p>}
      {filtered.length === 0 ? (
        <div className="empty">Nincs a szűrésnek megfelelő elem.</div>
      ) : (
        <div className="grid">
          {filtered.map((it) => (
            <div key={it.galleryItemId} className="card" style={{ padding: 10, outline: selected.has(it.galleryItemId) ? "2px solid var(--accent)" : "none" }}>
              {it.url && it.mediaType === "image" ? (
                <Image src={it.url} alt="" width={480} height={853} sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 25vw"
                  style={{ width: "100%", height: "auto", borderRadius: 8, cursor: "pointer" }}
                  onClick={() => toggle(it.galleryItemId)} />
              ) : it.url && it.mediaType === "video" ? (
                <video src={it.url} controls style={{ width: "100%", borderRadius: 8 }} onClick={() => toggle(it.galleryItemId)} />
              ) : <div className="skeleton" />}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <span className="badge">{characters.find((c) => c.id === it.characterId)?.name ?? "Egyéb"} · {it.mediaType} · {it.qcStatus}{selected.has(it.galleryItemId) && " ✓"}</span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="ghost" style={{ padding: "4px 10px" }} disabled={savingUsage !== null}
                    onClick={() => void setUsed([it.galleryItemId], view === "available")}>{view === "available" ? "Felhasználva" : "Vissza"}</button>
                  <a href={it.url ?? "#"} download><button className="ghost" style={{ padding: "4px 10px" }}>Letöltés</button></a>
                  <button className="ghost" style={{ padding: "4px 10px" }} disabled={deleting} onClick={() => removeOne(it.galleryItemId)}>Törlés</button>
                </span>
              </div>
              {it.usedByCharacterIds.length > 0 && <p className="muted" style={{ marginBottom: 0 }}>
                Ugyanez a forráskép már felhasználva: {it.usedByCharacterIds.map(id =>
                  characters.find(c => c.id === id)?.name ?? "Ismeretlen modell").join(", ")}
              </p>}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
