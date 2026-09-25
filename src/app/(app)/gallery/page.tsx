"use client";
// Teljes galéria: keresés, médiatípus-szűrés, albumok, tömeges kiválasztás/törlés, letöltés.
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { browserClient } from "@/lib/supabase/client";

interface Item {
  galleryItemId: string; assetId: string; mediaType: string; qcStatus: string;
  url: string | null; characterId: string | null; contentType: string; albumId: string | null;
}
interface Album { id: string; name: string; }

export default function GalleryPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [albumFilter, setAlbumFilter] = useState("all");
  const [pendingCount, setPendingCount] = useState(0);
  const [failedEdits, setFailedEdits] = useState(0);

  const getSb = () => browserClient();
  const token = useCallback(async () => (await getSb().auth.getSession()).data.session?.access_token ?? "", []);

  const load = useCallback(async () => {
    // Poll every unfinished character edit, including older jobs that were started
    // before the user navigated away from the Tools page. This never submits a new run.
    const { data: { user } } = await getSb().auth.getUser();
    if (!user) return;
    const { data: pending } = await getSb().from("generation_jobs")
      .select("id").eq("owner_id", user.id).eq("type", "character_swap").eq("status", "processing")
      .order("created_at", { ascending: false }).limit(50);
    setPendingCount(pending?.length ?? 0);
    if (pending?.length) {
      const auth = { authorization: `Bearer ${await token()}` };
      await Promise.allSettled(pending.map((job) => fetch(`/api/jobs/${job.id}/refresh`, {
        method: "POST", headers: auth,
      })));
    }
    const { count: failed } = await getSb().from("generation_jobs")
      .select("id", { count: "exact", head: true }).eq("owner_id", user.id)
      .eq("type", "character_swap").eq("status", "refunded")
      .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
    setFailedEdits(failed ?? 0);
    const qs = albumFilter !== "all" ? `?albumId=${albumFilter}` : "";
    const res = await fetch(`/api/gallery${qs}`, { headers: { authorization: `Bearer ${await token()}` } });
    if (res.ok) setItems((await res.json()).items);
    const alb = await fetch("/api/albums", { headers: { authorization: `Bearer ${await token()}` } });
    if (alb.ok) setAlbums((await alb.json()).albums);
  }, [token, albumFilter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 20000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

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
    const t = await token();
    for (const gid of selected) {
      await fetch(`/api/gallery/${gid}`, { method: "DELETE", headers: { authorization: `Bearer ${t}` } });
    }
    setSelected(new Set());
    await load();
  }
  async function removeOne(id: string) {
    if (!confirm("Törlöd ezt az elemet?")) return;
    await fetch(`/api/gallery/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${await token()}` } });
    await load();
  }
  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  if (items === null) return <div className="skeleton" />;
  const filtered = items.filter((it) =>
    (typeFilter === "all" || it.mediaType === typeFilter)
    && (albumFilter === "all" || true)   // album-szűrés a client oldali join után egyszerűsítve
    && (q === "" || it.assetId.toLowerCase().includes(q.toLowerCase()) || (it.contentType ?? "").includes(q)));

  return (
    <main>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Galériám</h1>
        <input placeholder="keresés (asset típus)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
        <select value={albumFilter} onChange={(e) => setAlbumFilter(e.target.value)}>
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
        {selected.size > 0 && <button className="ghost" onClick={removeMany}>Törlés ({selected.size})</button>}
      </div>
      <p className="muted">{filtered.length} / {items.length} elem{selected.size > 0 && ` · ${selected.size} kiválasztva`}</p>
      {pendingCount > 0 && <p className="muted">{pendingCount} kép feldolgozás alatt. Az eredmények itt automatikusan frissülnek.</p>}
      {failedEdits > 0 && <p role="status" style={{ color: "#f29a9a" }}>{failedEdits} képszerkesztés meghiúsult az elmúlt órában; ezek krediteit a rendszer visszaadta.</p>}
      {filtered.length === 0 ? (
        <div className="empty">Nincs a szűrésnek megfelelő elem.</div>
      ) : (
        <div className="grid">
          {filtered.map((it) => (
            <div key={it.galleryItemId} className="card" style={{ padding: 10, outline: selected.has(it.galleryItemId) ? "2px solid var(--accent)" : "none" }}>
              {it.url && it.mediaType === "image" ? (
                <Image src={it.url} alt="" width={480} height={480}
                  style={{ width: "100%", height: "auto", borderRadius: 8, cursor: "pointer" }}
                  onClick={() => toggle(it.galleryItemId)} />
              ) : it.url && it.mediaType === "video" ? (
                <video src={it.url} controls style={{ width: "100%", borderRadius: 8 }} onClick={() => toggle(it.galleryItemId)} />
              ) : <div className="skeleton" />}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <span className="badge">{it.mediaType} · {it.qcStatus}{selected.has(it.galleryItemId) && " ✓"}</span>
                <span style={{ display: "flex", gap: 6 }}>
                  <a href={it.url ?? "#"} download><button className="ghost" style={{ padding: "4px 10px" }}>Letöltés</button></a>
                  <button className="ghost" style={{ padding: "4px 10px" }} onClick={() => removeOne(it.galleryItemId)}>Törlés</button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
