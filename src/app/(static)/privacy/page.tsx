import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16, lineHeight: 1.7 }}>
      <h1>Adatkezelési tájékoztató</h1>
      <p className="muted">Minta-szöveg – végleges változat jogi szakértői átnézés után.</p>
      <h3>1. Adatkezelő</h3>
      <p>A Castora üzemeltetője (adatok a regisztráció során megadottak szerint).</p>
      <h3>2. Kezelt adatok</h3>
      <p>E-mail-cím, fiókadatok, feltöltött referenciák és generált tartalmak, kredittranzakciók. Adatokat más felhasználó nem láthat (RLS).</p>
      <h3>3. Tárolás</h3>
      <p>Adatok EU-s régióban, titkosított, privát tárhelyen.</p>
      <h3>4. Jogok</h3>
      <p>Törléshez a fiókbeállításokban, adatletöltéshez ügyfélszolgálatunkon keresztül fordulhatsz.</p>
      <p><Link href="/">Vissza</Link></p>
    </main>
  );
}
