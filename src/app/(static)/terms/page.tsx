import Link from "next/link";

export default function TermsPage() {
  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16, lineHeight: 1.7 }}>
      <h1>Felhasználási feltételek</h1>
      <p className="muted">Minta-szöveg – végleges változat jogi szakértői átnézés után.</p>
      <h3>1. Szolgáltatás</h3>
      <p>A Castora AI-tartalomgeneráló eszközöket biztosít saját, mesterséges karakterek létrehozásához.</p>
      <h3>2. Tiltott tartalmak</h3>
      <p>Tilos kiskorúakat ábrázoló, valós személyről beleegyezés nélkül készült, vagy jogellenes tartalom generálása. A megszegés fiókzárást eredményez.</p>
      <h3>3. Hozzájárulás</h3>
      <p>Valós személy (saját magad kivételével) csak írásos, ellenőrizhető hozzájárulással használható.</p>
      <h3>4. Kreditek</h3>
      <p>A generálások kreditekkel fizetendők; sikertelen feladatoknál a kredit automatikusan visszatérítésre kerül.</p>
      <p><Link href="/">Vissza</Link></p>
    </main>
  );
}
