"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/client";

export default function NewCharacterPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [consentType, setConsentType] = useState("ai_persona");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function create() {
    setLoading(true); setError(null);
    const getSb = () => browserClient();
    const { data: { user } } = await getSb().auth.getUser();
    if (!user) { router.push("/login"); return; }

    const { data, error: err } = await getSb().from("characters").insert({
      owner_id: user.id, name, description: description || null,
      consent_type: consentType, status: "collecting_refs",
    }).select("id").single();

    setLoading(false);
    if (err) setError(err.message);
    else router.push(`/characters/${data.id}`);
  }

  return (
    <main style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Új karakter</h1>
      <div className="card">
        <label>Karakter neve</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <label>Leírás (opcionális)</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} />
        <label>Jogalap</label>
        <select value={consentType} onChange={(e) => setConsentType(e.target.value)}>
          <option value="ai_persona">Teljesen mesterséges karakter (AI persona)</option>
          <option value="self">Saját magam (hozzájáruló dokumentum kell)</option>
          <option value="third_party_documented">Harmadik fél – dokumentált hozzájárulással</option>
        </select>
        {consentType !== "ai_persona" && (
          <p className="error">Dokumentált hozzájárulás szükséges – az admin QC-vel hagyja jóvá. (Feltöltés a 2. mérföldkőben.)</p>
        )}
        {error && <p className="error">{error}</p>}
        <button onClick={create} disabled={loading || !name.trim()} style={{ marginTop: 16 }}>Létrehozás</button>
      </div>
    </main>
  );
}
