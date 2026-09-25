"use client";
import { useState } from "react";
import { browserClient } from "@/lib/supabase/client";

export default function ResetPage() {
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
        <h1 style={{ marginTop: 0, fontSize: 22 }}>Elfelejtett jelszó</h1>
        {sent ? (
          <p className="muted">Ha a cím regisztrálva van, visszaállító linket küldtünk.</p>
        ) : (
          <>
            <label>E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <p className="error">{error}</p>}
            <button onClick={request} disabled={loading || !email} style={{ marginTop: 16 }}>Link küldése</button>
          </>
        )}
        <p className="muted"><a href="/login">Vissza a belépéshez</a></p>
      </div>
    </main>
  );
}
