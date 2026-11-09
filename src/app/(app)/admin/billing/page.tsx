'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { loadOwnerFeeReport } from '@/lib/billing/owner-fee-report';
import { downloadOwnerFeePdf } from '@/lib/billing/fee-report-pdf';

const errors: Record<string, string> = {
  WHOP_FEE_HTTP_ERROR: 'A Whop hibás HTTP-választ adott. A válasz törzsét nem jelenítjük meg.',
  WHOP_FEE_SCHEMA_MISMATCH: 'A Whop válasza nem egyezik az ellenőrzött adatformátummal. Díjat nem becsültünk meg.',
  WHOP_FEE_RESPONSE_INVALID: 'A Whop válasza nem volt érvényes vagy túl nagy volt.',
  WHOP_FEE_TIMEOUT: 'A Whop díjlekérése túllépte az időkorlátot.',
  WHOP_FEE_NETWORK_ERROR: 'A Whop díjlekérésénél hálózati vagy válaszolvasási hiba történt.',
  AUTH_REQUIRED: 'Ebben a böngészőben nincs használható bejelentkezés. Nyisd meg ezt az oldalt abban a böngészőben, ahol már be vagy jelentkezve.',
  OWNER_REQUIRED: 'A díjkimutatás csak a tulajdonosi fiókkal érhető el.',
  WHOP_FEE_READ_NOT_CONFIGURED: 'Az éles díjlekérés nincs beállítva.',
  WHOP_FEE_READ_FORBIDDEN: 'A Whop megtagadta a díjak olvasását. Nem módosítottunk jogosultságot, és nem próbálkozunk újra automatikusan.',
  WHOP_FEE_READ_UNAUTHORIZED: 'A Whop nem fogadta el a szerver meglévő hozzáférését. A kulcs nem jelenik meg ezen az oldalon.',
};

export default function OwnerBillingPage() {
  const [report, setReport] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);

  async function readFees() {
    if (pending.current || denied) return;
    const controller = new AbortController(); pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    setBusy(true); setReport(''); setMessage('');
    try {
      const result = await loadOwnerFeeReport(controller.signal);
      if (controller.signal.aborted) return;
      if (result.ok) setReport(result.text);
      else {
        setDenied(['OWNER_REQUIRED', 'WHOP_FEE_READ_FORBIDDEN', 'WHOP_FEE_READ_UNAUTHORIZED'].includes(result.code));
        setMessage(`${errors[result.code] ?? 'A díjlekérés most nem sikerült.'} (${result.code})${result.detail ? ` ${result.detail}` : ''}`);
      }
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
        if (controller.signal.aborted) setMessage('A díjlekérés megszakadt vagy túllépte az időkorlátot.');
      }
    }
  }

  function downloadReport() {
    if (!report) return;
    try { downloadOwnerFeePdf(report); setMessage('A teljes PDF letöltését elindítottuk. A fájlt csatolhatod az üzenethez; másolás nem szükséges.'); }
    catch { setMessage('A PDF letöltése nem indult el. A kimutatás megmaradt; próbáld újra a letöltés gombját.'); }
  }

  return <main style={{ maxWidth: 900 }}>
    <Link href="/admin">Vissza az adminhoz</Link>
    <h1>Whop díjkimutatás</h1>
    <p>A már bejelentkezett tulajdonosi munkamenetet használja. Nem kér új jelszót, és nem jelenít meg hozzáférési kulcsot.</p>
    <p className="muted">Csak olvasás. Nem kapcsol be fizetést, és nem módosít kreditet vagy jogosultságot. A jelenlegi díjak nem garantált jövőbeli díjplafonok.</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button onClick={readFees} disabled={busy || denied}>{busy ? 'Lekérés…' : 'Whop-díjak lekérése'}</button>
      <button className="ghost" onClick={downloadReport} disabled={!report || busy}>Teljes díjkimutatás letöltése PDF-ben</button>
    </div>
    <p role="status" aria-live="polite">{message}</p>
    {report && <>
      <p>A PDF a teljes, ellenőrzött díjtáblázatot tartalmazza, oldalszámokkal. A fájl ebben a böngészőben készül, nincs külső szolgáltatásnak feltöltve, és nem tartalmaz hozzáférési kulcsot.</p>
      <details><summary>Kimutatás megtekintése</summary>
        <pre aria-label="Whop díjkimutatás" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>{report}</pre>
      </details>
    </>}
  </main>;
}
