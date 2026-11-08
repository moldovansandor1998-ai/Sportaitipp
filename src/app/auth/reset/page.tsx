"use client";
import { useAppTranslation } from "@/components/i18n/AppLanguageProvider";
import { useState } from "react";
import { browserClient } from "@/lib/supabase/client";

export default function ResetPage() {
  const { t } = useAppTranslation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function request() {
    setLoading(true); setError(null);
    const { error } = await browserClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/callback`,
    });
    setLoading(false);
    if (error) setError(error.message); else setSent(true);
  }

  return (
    <main style={{ maxWidth: 400, margin: "80px auto", padding: 16 }}>
      <div className="card">
        <h1 style={{ marginTop: 0, fontSize: 22 }}>{t("Elfelejtett jelszó")}</h1>
        {sent ? (
          <p className="muted">{t("Ha a cím regisztrálva van, visszaállító linket küldtünk.")}</p>
        ) : (
          <>
            <label>{t("E-mail")}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <p className="error">{t(error)}</p>}
            <button onClick={request} disabled={loading || !email} style={{ marginTop: 16 }}>{t("Link küldése")}</button>
          </>
        )}
        <p className="muted"><a href="/login">{t("Vissza a belépéshez")}</a></p>
      </div>
    </main>
  );
}
