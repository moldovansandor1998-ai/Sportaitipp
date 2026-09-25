"use client";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/client";

interface JobListRow {
  id: string; type: string; status: string;
  cost_estimate: number; cost_final: number | null; error: { message?: string } | null;
}
interface JobEventRow { id: number; created_at: string; from_status: string | null; to_status: string; }

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobListRow[]>([]);
  const [events, setEvents] = useState<JobEventRow[]>([]);

  async function load() {
    const getSb = () => browserClient();
    const { data: { user } } = await getSb().auth.getUser();
    if (!user) return;
    const { data } = await getSb().from("generation_jobs")
      .select("id,type,status,cost_estimate,cost_final,queued_at,started_at,finished_at,error")
      .eq("owner_id", user.id).order("created_at", { ascending: false }).limit(50);
    setJobs(data ?? []);
    if (data?.[0]) {
      const { data: ev } = await getSb().from("generation_job_events")
        .select("*").eq("job_id", data[0].id).order("created_at");
      setEvents(ev ?? []);
    }
  }
  useEffect(() => { const t = setInterval(load, 4000); load(); return () => clearInterval(t); }, []);

  return (
    <main>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Feladataim</h1>
      <div className="card">
        <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
              <th>Típus</th><th>Állapot</th><th>Becsült</th><th>Tényleges</th><th>Hiba</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} style={{ borderTop: "1px solid var(--border)", fontSize: 14 }}>
                <td>{j.type}</td><td><span className="badge">{j.status}</span></td>
                <td>{j.cost_estimate}</td><td>{j.cost_final ?? "–"}</td>
                <td className="error">{j.error?.message ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {events.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Legutóbbi feladat eseményei</h3>
          {events.map((e) => (
            <div key={e.id} className="muted" style={{ padding: "4px 0" }}>
              {new Date(e.created_at).toLocaleTimeString("hu-HU")} — {e.from_status ?? "–"} → {e.to_status}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
