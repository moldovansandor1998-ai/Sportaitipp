"use client";
import { useAppTranslation } from "@/components/i18n/AppLanguageProvider";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/client";

export default function NewCharacterPage() {
  const { t } = useAppTranslation();
  const [gender, setGender] = useState<"" | "female" | "male">("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [consentType, setConsentType] = useState("ai_persona");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function create() {
    if (!gender) { setError(t("Válaszd ki, hogy női vagy férfi karaktert készítesz.")); return; }
    setLoading(true); setError(null);
    const getSb = () => browserClient();
    const { data: { user } } = await getSb().auth.getUser();
    if (!user) { router.push("/login"); return; }

    const { data, error: err } = await getSb().from("characters").insert({
      owner_id: user.id, name, gender, description: description || null,
      consent_type: consentType, status: "collecting_refs",
    }).select("id").single();

    setLoading(false);
    if (err) setError(err.message);
    else router.push(`/characters/${data.id}`);
  }

  return (
    <main style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>{t("Új karakter")}</h1>
      <div className="card">
        <label>{t("Karakter neve")}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <label htmlFor="character-gender">{t("Karakter neme")}</label>
        <select id="character-gender" value={gender} onChange={(e) => setGender(e.target.value as "" | "female" | "male")} required>
          <option value="" disabled>{t("Válassz…")}</option>
          <option value="female">{t("Nő")}</option>
          <option value="male">{t("Férfi")}</option>
        </select>
        <label>{t("Leírás (opcionális)")}</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} />
        <label>{t("Jogalap")}</label>
        <select value={consentType} onChange={(e) => setConsentType(e.target.value)}>
          <option value="ai_persona">{t("Teljesen mesterséges karakter (AI persona)")}</option>
          <option value="self">{t("Saját magam (hozzájáruló dokumentum kell)")}</option>
          <option value="third_party_documented">{t("Harmadik fél – dokumentált hozzájárulással")}</option>
        </select>
        {consentType !== "ai_persona" && (
          <p className="error">{t("Dokumentált hozzájárulás és jóváhagyás szükséges.")}</p>
        )}
        {error && <p className="error">{t(error)}</p>}
        <button onClick={create} disabled={loading || !name.trim() || !gender} style={{ marginTop: 16 }}>{t("Létrehozás")}</button>
      </div>
    </main>
  );
}
