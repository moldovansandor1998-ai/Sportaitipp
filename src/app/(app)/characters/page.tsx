"use client";
import { useAppTranslation } from "@/components/i18n/AppLanguageProvider";
import { useEffect, useState } from "react";
import Link from "next/link";
import { browserClient } from "@/lib/supabase/client";

export default function CharactersPage() {
  const { t } = useAppTranslation();
  interface CharacterRow {
  id: string; name: string; status: string;
  character_versions?: { id: string; version_no: number; status: string; identity_score: number | null }[];
}
const [items, setItems] = useState<CharacterRow[] | null>(null);

  useEffect(() => {
    (async () => {
      const getSb = () => browserClient();
      const { data: { user } } = await getSb().auth.getUser();
      if (!user) return;
      const { data } = await getSb().from("characters")
        .select("id,name,status,created_at,character_versions(version_no,status,identity_score)")
        .eq("owner_id", user.id).order("created_at", { ascending: false });
      setItems((data ?? []) as unknown as CharacterRow[]);
    })();
  }, []);

  if (items === null) return <div className="skeleton" />;
  return (
    <main>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{t("My Models")}</h1>
        <Link href="/characters/new"><button>{t("+ Új karakter")}</button></Link>
      </div>
      {items.length === 0 ? (
        <div className="empty" style={{ marginTop: 20 }}>
          {t("Még nincs karaktered. Hozd létre az elsőt – referenciafotókkal, minőségellenőrzéssel.")}</div>
      ) : (
        <div className="grid" style={{ marginTop: 20 }}>
          {items.map((c) => (
            <Link key={c.id} href={`/characters/${c.id}`} className="card">
              <h3 style={{ marginTop: 0 }}>{c.name}</h3>
              <p className="muted" style={{ margin: 0 }}>{t("Státusz:")}{" "}{t(c.status)}</p>
              {(c.character_versions ?? []).map((v) => (
                <span key={v.id} className="badge" style={{ marginRight: 6 }}>
                  {t("v")}{v.version_no} · {t(v.status)}{v.identity_score != null && ` · ${v.identity_score}`}
                </span>
              ))}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
