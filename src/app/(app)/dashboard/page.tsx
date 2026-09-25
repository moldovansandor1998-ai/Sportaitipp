"use client";
import Link from "next/link";

export default function DashboardPage() {
  return (
    <main>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Explore</h1>
      <p className="muted">Az első mérföldkő célja a teljes, működő alapfolyamat. Indulj a karaktereddel.</p>
      <div className="grid" style={{ marginTop: 20 }}>
        <Link href="/characters/new" className="card">
          <h3 style={{ marginTop: 0 }}>◉ Saját karakter létrehozása</h3>
          <p className="muted">Referenciafotók feltöltése, QC, tréning, tesztkép.</p>
        </Link>
        <Link href="/gallery" className="card">
          <h3 style={{ marginTop: 0 }}>▦ Galéria</h3>
          <p className="muted">Kész generálásaid, letöltés, további szerkesztés.</p>
        </Link>
        <Link href="/jobs" className="card">
          <h3 style={{ marginTop: 0 }}>⚙ Feladataim</h3>
          <p className="muted">Élő állapotok: nincs kitalált százalék, csak tényleges státusz.</p>
        </Link>
      </div>
      <p className="muted" style={{ marginTop: 24 }}>
        A további modulok (Social Media Studio, Viral Trends, Carousels, PPV, Spicy, Affiliate, Admin)
        a 3–6. mérföldkőben épülnek – üres menüpontokat szándékosan nem mutatunk.
      </p>
    </main>
  );
}
