"use client";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/client";

interface ProfileRow {
  email: string; terms_accepted_at: string | null; privacy_accepted_at: string | null; age_verified_at: string | null;
}
interface SettingsRow {
  user_id: string; email_generation_done: boolean; email_generation_failed: boolean;
  email_credit_refund: boolean; email_low_credit: boolean; email_calendar_reminder: boolean;
}

const TOGGLES = [
  ["email_generation_done", "Generálás sikeresen elkészült"],
  ["email_generation_failed", "Generálás sikertelen"],
  ["email_credit_refund", "Kredit-visszatérítés"],
  ["email_low_credit", "Alacsony kritegyenleg"],
  ["email_calendar_reminder", "Tartalomnaptár-emlékeztető"],
] as const;

export default function SettingsPage() {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const getSb = () => browserClient();
      const { data: { user } } = await getSb().auth.getUser();
      if (!user) return;
      const { data: p } = await getSb().from("profiles").select("*").eq("id", user.id).single();
      const { data: s } = await getSb().from("user_settings").select("*").eq("user_id", user.id).single();
      setProfile(p); setSettings(s);
    })();
  }, []);

  async function save() {
    if (!settings) return;
    const getSb = () => browserClient();
    const { user_id, ...patch } = settings;
    const { error } = await getSb().from("user_settings").update(patch).eq("user_id", user_id);
    setMsg(error ? error.message : "Mentve.");
  }

  if (!profile || !settings) return <div className="skeleton" />;
  const toggle = (key: keyof SettingsRow) => setSettings({ ...settings, [key]: !settings[key] });

  return (
    <main style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Fiókbeállítások</h1>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>{profile.email}</p>
        <p className="muted">
          ÁSZF: {profile.terms_accepted_at ? "elfogadva" : "–"} · Adatkezelés: {profile.privacy_accepted_at ? "elfogadva" : "–"} ·
          Nagykorúság: {profile.age_verified_at ? "igazolva" : "–"}
        </p>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>E-mail-értesítések</h3>
        {TOGGLES.map(([key, label]) => (
          <label key={key} style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text)" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={!!settings[key]} onChange={() => toggle(key)} />
            {label}
          </label>
        ))}
        <button onClick={save} style={{ marginTop: 12 }}>Mentés</button>
        {msg && <p className="muted">{msg}</p>}
      </div>
    </main>
  );
}
