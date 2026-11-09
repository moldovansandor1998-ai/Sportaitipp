'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { loadOwnerFeeReport } from '@/lib/billing/owner-fee-report';

const errors: Record<string, string> = {
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
        setMessage(`${errors[result.code] ?? 'A díjlekérés most nem sikerült.'} (${result.code})`);
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

  async function copyReport() {
    if (!report) return;
    try { await navigator.clipboard.writeText(report); setMessage('A díjkimutatás másolva.'); }
    catch { setMessage('A másolás nem sikerült. A kimutatás szövege kézzel is kijelölhető.'); }
  }

  return <main style={{ maxWidth: 900 }}>
    <Link href="/admin">Vissza az adminhoz</Link>
    <h1>Whop díjkimutatás</h1>
    <p>A már bejelentkezett tulajdonosi munkamenetet használja. Nem kér új jelszót, és nem jelenít meg hozzáférési kulcsot.</p>
    <p className="muted">Csak olvasás. Nem kapcsol be fizetést, és nem módosít kreditet vagy jogosultságot. A jelenlegi díjak nem garantált jövőbeli díjplafonok.</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button onClick={readFees} disabled={busy || denied}>{busy ? 'Lekérés…' : 'Whop-díjak lekérése'}</button>
      <button className="ghost" onClick={copyReport} disabled={!report || busy}>Díjkimutatás másolása</button>
    </div>
    <p role="status" aria-live="polite">{message}</p>
    {report && <pre aria-label="Whop díjkimutatás" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>{report}</pre>}
  </main>;
}
