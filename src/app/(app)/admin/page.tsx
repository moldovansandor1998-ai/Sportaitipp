"use client";
// Admin munkaasztal: submission_uncertain jobok kezelése (reconcile) + kreditmódosítás.
// Jogosultság a szerveren ellenőrzött (profiles.role) – az oldal csak adminnak mutat adatot.
import { useCallback, useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/client";

interface UncertainJob {
  id: string; type: string; owner_id: string; cost_estimate: number;
  idempotency_key: string | null; error: { message?: string } | null;
}

export default function AdminPage() {
  const [jobs, setJobs] = useState<UncertainJob[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [creditUser, setCreditUser] = useState("");
  interface Summary {
    creditsBurned30d: number;
    openFlags: Array<{ id: string; reason: string; created_at: string }>;
    jobsByStatus: Record<string, number>;
    users: Array<{ id: string; email: string; role: string; created_at: string; banned_until: string | null }>;
  }
  const [summary, setSummary] = useState<Summary | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [providerSel, setProviderSel] = useState<"fal" | "replicate">("fal");
  const [confirmJob, setConfirmJob] = useState<string | null>(null);

  const load = useCallback(async () => {
    const getSb = () => browserClient();
    const { data: { user } } = await getSb().auth.getUser();
    if (!user) return;
    const { data: profile } = await getSb().from("profiles").select("role").eq("id", user.id).single();
    const admin = (profile as { role: string } | null)?.role === "admin";
    setIsAdmin(admin);
    if (!admin) return;
    // RLS: a generation_jobs select own – service-szintű lista kell; egyszerű megoldás:
    // az admin a sajátjait látja RLS-sel, az uncertain lista a reconcile API-n keresztül megy (M5 teljes lista).
    const { data } = await getSb().from("generation_jobs")
      .select("id,type,owner_id,cost_estimate,idempotency_key,error")
      .eq("status", "submission_uncertain");
    setJobs((data ?? []) as unknown as UncertainJob[]);
    const sess = await browserClient().auth.getSession();
    const sum = await fetch("/api/admin/summary", { headers: { authorization: `Bearer ${sess.data.session?.access_token}` } });
    if (sum.ok) setSummary(await sum.json() as Summary);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function callReconcile(body: Record<string, unknown>) {
    setBusy(true); setMsg("");
    const getSb = () => browserClient();
    const { data: { session } } = await getSb().auth.getSession();
    const res = await fetch("/api/admin/jobs/reconcile", {
      method: "POST",
      headers: { authorization: `Bearer ${session?.access_token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const b = await res.json();
    setMsg(res.ok ? `OK: ${JSON.stringify(b)}` : `Hiba ${res.status}: ${b.error}`);
    await load();
  }

  async function adjustCredits() {
    setBusy(true); setMsg("");
    const getSb = () => browserClient();
    const { data: { session } } = await getSb().auth.getSession();
    const res = await fetch("/api/admin/credits", {
      method: "POST",
      headers: { authorization: `Bearer ${session?.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ userId: creditUser, amount: Number(creditAmount), note: creditNote || undefined }),
    });
    setBusy(false);
    const b = await res.json();
    setMsg(res.ok ? "Kreditmódosítás végrehajtva (auditálva)." : `Hiba ${res.status}: ${b.error}`);
  }

  if (isAdmin === null) return <div className="skeleton" />;
  if (!isAdmin) return <main><div className="empty">Admin jogosultság szükséges.</div></main>;

  return (
    <main style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Admin</h1>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>submission_uncertain jobok ({jobs.length})</h3>
        {jobs.length === 0 && <p className="muted">Nincs bizonytalan job.</p>}
        {jobs.map((j) => (
          <div key={j.id} style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: 13 }}>{j.type} · {j.cost_estimate} kr · {j.error?.message ?? ""}</span>
              <button className="ghost" disabled={busy} onClick={() => setConfirmJob(j.id)}>művelet…</button>
            </div>
            {confirmJob === j.id && (
              <div style={{ background: "var(--panel-2)", borderRadius: 8, padding: 10, marginTop: 8 }}>
                <p className="muted" style={{ margin: "0 0 8px" }}>
                  Megerősítés: a mark_failed refundot, a restart újraküldést eredményez. A mark_submittedhez
                  add meg a provider dashboardján ELLENŐRZÖTT request ID-t és a providert.
                </p>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <select value={providerSel} onChange={(e) => setProviderSel(e.target.value as "fal" | "replicate")}>
                    <option value="fal">fal.ai</option>
                    <option value="replicate">Replicate</option>
                  </select>
                  <button className="ghost" disabled={busy} onClick={() => {
                    if (!window.confirm("Biztosan nem fut provideroldali munka? A kredit visszatérítésre kerül.")) return;
                    callReconcile({ lookupJobId: j.id, action: "mark_failed", reason: "admin UI megerősítéssel: nem fut provideroldali munka" });
                    setConfirmJob(null);
                  }}>mark_failed (refund)</button>
                  <button className="ghost" disabled={busy} onClick={() => {
                    if (!window.confirm("Ellenőrizted a provider dashboardján, hogy NEM fut a munka?")) return;
                    callReconcile({ lookupJobId: j.id, action: "restart", reason: "admin UI megerősítéssel", confirmNotRunning: true });
                    setConfirmJob(null);
                  }}>restart (confirmNotRunning)</button>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input placeholder="provider request ID (dashboard)" id={`rid-${j.id}`} style={{ flex: 1 }} />
                  <button disabled={busy} onClick={() => {
                    callReconcile({
                      lookupJobId: j.id, action: "mark_submitted", reason: "admin UI: dashboard-ellenőrzéssel",
                      verifiedProvider: providerSel,
                      verifiedProviderJobId: (document.getElementById(`rid-${j.id}`) as HTMLInputElement).value,
                    });
                    setConfirmJob(null);
                  }}>mark_submitted</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {summary && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Platform-összesítő</h3>
          <p className="muted">Kreditégetés (30 nap): {summary.creditsBurned30d} · Nyitott moderációs jelző: {summary.openFlags.length}</p>
          <p className="muted">Jobok státuszonként: {JSON.stringify(summary.jobsByStatus)}</p>
          {summary.openFlags.length > 0 && (
            <ul>{summary.openFlags.slice(0, 10).map((f: { id: string; reason: string; created_at: string }) => (
              <li key={f.id} className="muted">{f.reason} – {new Date(f.created_at).toLocaleDateString("hu-HU")}</li>
            ))}</ul>
          )}
          <h4 style={{ marginBottom: 6 }}>Felhasználók ({summary.users.length})</h4>
          <div style={{ maxHeight: 220, overflow: "auto" }}>
            {summary.users.map((u: { id: string; email: string; role: string; created_at: string; banned_until: string | null }) => (
              <div key={u.id} style={{ display: "flex", gap: 8, fontSize: 13, padding: "3px 0", borderTop: "1px solid var(--border)" }}>
                <span style={{ flex: 1 }}>{u.email}</span>
                <span className="badge">{u.role}</span>
                {u.banned_until && <span className="badge">bannolt</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Kreditmódosítás (auditált)</h3>
        <label>Felhasználó UUID</label>
        <input value={creditUser} onChange={(e) => setCreditUser(e.target.value)} />
        <label>Összeg (negatív is lehet)</label>
        <input value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} inputMode="numeric" />
        <label>Megjegyzés</label>
        <input value={creditNote} onChange={(e) => setCreditNote(e.target.value)} />
        <button style={{ marginTop: 12 }} disabled={busy || !creditUser || !creditAmount} onClick={adjustCredits}>Módosítás</button>
      </div>
      {msg && <p className="muted" style={{ marginTop: 12 }}>{msg}</p>}
    </main>
  );
}
