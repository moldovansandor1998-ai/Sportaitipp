"use client";
import { useAppTranslation } from "@/components/i18n/AppLanguageProvider";
import { useCallback, useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/client";

interface Project { id: string; name: string; kind: string; created_at: string; }

export default function ProjectsPage() {
  const { t } = useAppTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("general");
  const getSb = () => browserClient();
  const token = useCallback(async () => (await getSb().auth.getSession()).data.session?.access_token ?? "", []);

  const load = useCallback(async () => {
    const res = await fetch("/api/projects", { headers: { authorization: `Bearer ${await token()}` } });
    if (res.ok) setProjects((await res.json()).projects);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    await fetch("/api/projects", {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify({ name, kind }),
    });
    setName(""); await load();
  }
  async function remove(id: string) {
    if (!confirm(t("Törlöd a projektet?"))) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${await token()}` } });
    await load();
  }
  async function rename(project: Project) {
    const nextName = prompt(t("Új projektnév"), project.name)?.trim();
    if (!nextName || nextName === project.name) return;
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
      body: JSON.stringify({ name: nextName }),
    });
    if (res.ok) await load();
  }

  return (
    <main style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>{t("Projektek")}</h1>
      <div className="card">
        <div style={{ display: "flex", gap: 8 }}>
          <input placeholder={t("projekt neve")} value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="general">{t("general")}</option><option value="carousel">{t("carousel")}</option>
            <option value="viral_trend">{t("viral_trend")}</option><option value="ppv_set">{t("ppv_set")}</option>
          </select>
          <button onClick={create} disabled={!name.trim()}>{t("Létrehozás")}</button>
        </div>
      </div>
      {projects.length === 0 ? <div className="empty" style={{ marginTop: 16 }}>{t("Nincs projekted.")}</div> : (
        <div style={{ marginTop: 12 }}>
          {projects.map((p) => (
            <div key={p.id} className="card" style={{ marginBottom: 8, padding: 12, display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1 }}>{p.name}</span>
              <span className="badge">{t(p.kind)}</span>
              <button className="ghost" style={{ padding: "4px 10px" }} onClick={() => rename(p)}>{t("Átnevezés")}</button>
              <button className="ghost" style={{ padding: "4px 10px" }} onClick={() => remove(p.id)}>{t("Törlés")}</button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
