"use client";
import { useAppTranslation } from "@/components/i18n/AppLanguageProvider";
import { useState } from "react";
import { browserClient } from "@/lib/supabase/client";

export default function RegisterPage() {
  const { t } = useAppTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [age, setAge] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function register() {
    if (!terms || !privacy || !age) { setMsg(t("Az elfogadások és a nagykorúsági nyilatkozat kötelező.")); return; }
    setLoading(true); setMsg(null);
    const { error } = await browserClient().auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${location.origin}/auth/callback`,
        data: { terms_accepted: true, privacy_accepted: true, age_verified: true },
      },
    });
    setLoading(false);
    if (error) setMsg(error.message);
    else setDone(true);
  }

  if (done) {
    return (
      <main style={{ maxWidth: 400, margin: "80px auto", padding: 16 }}>
        <div className="card"><h1 style={{ fontSize: 20, marginTop: 0 }}>{t("Megerősítés elküldve")}</h1>
        <p className="muted">{t("Nézd meg az e-mail fiókodat, és erősítsd meg a címed.")}</p></div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 400, margin: "80px auto", padding: 16 }}>
      <div className="card">
        <h1 style={{ marginTop: 0, fontSize: 22 }}>{t("Regisztráció")}</h1>
        <label>{t("E-mail")}</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label>{t("Jelszó (min. 8 karakter)")}</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text)" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          {t("Elfogadom a")}{" "}<a href="/terms" target="_blank">{t("felhasználási feltételeket")}</a>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text)" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
          {t("Elfogadom az")}{" "}<a href="/privacy" target="_blank">{t("adatkezelési tájékoztatót")}</a>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text)" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={age} onChange={(e) => setAge(e.target.checked)} />
          {t("Kijelentem, hogy elmúltam 18 éves")}</label>
        {msg && <p className="error">{t(msg)}</p>}
        <button onClick={register} disabled={loading} style={{ marginTop: 16 }}>{t("Regisztrálok")}</button>
        <p className="muted"><a href="/login">{t("Már van fiókom")}</a></p>
      </div>
    </main>
  );
}
