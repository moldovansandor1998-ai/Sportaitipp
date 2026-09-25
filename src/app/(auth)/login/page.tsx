"use client";
import { useState } from "react";
import { browserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function login() {
    setLoading(true); setMsg(null);
    const { error } = await browserClient().auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setMsg(error.message);
    else location.href = "/dashboard";
  }

  async function google() {
    await browserClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  }

  return (
    <main style={{ maxWidth: 400, margin: "80px auto", padding: 16 }}>
      <div className="card">
        <h1 style={{ marginTop: 0, fontSize: 22 }}>Bejelentkezés</h1>
        <label>E-mail</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label>Jelszó</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {msg && <p className="error">{msg}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={login} disabled={loading}>Belépés</button>
          <button className="ghost" onClick={google}>Google</button>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          <a href="/register">Regisztráció</a> · <a href="/auth/reset">Elfelejtett jelszó</a>
        </p>
      </div>
    </main>
  );
}
