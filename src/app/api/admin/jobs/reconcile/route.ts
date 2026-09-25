// Admin recovery v2 – mezők: lookupJobId | lookupIdempotencyKey, verifiedProviderJobId,
// verifiedProvider (fal|replicate), action, confirmNotRunning, reason.
// Minden művelet atomi, auditált adatbázis-RPC – a route csak hitelesít és továbbít.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";
import { parseReconcileInput } from "@/lib/admin/reconcileInput";

export async function POST(req: NextRequest) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = serviceClient();
  // Jogosultság KIZÁRÓLAG szerveroldali profiles.role-ból (user_metadata tiltott)
  const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).single();
  if ((profile as { role: string } | null)?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const b = await req.json();
  const parsed = parseReconcileInput(b);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const reason = typeof b.reason === "string" && b.reason.trim().length > 0 ? b.reason.trim() : null;

  // 1) Helyi job megkeresése
  const q = svc.from("generation_jobs").select("id,status");
  if (parsed.lookup.kind === "job") q.eq("id", parsed.lookup.value);
  else q.eq("idempotency_key", parsed.lookup.value);
  const { data: job } = await q.maybeSingle();
  if (!job) return NextResponse.json({ error: "JOB_NOT_FOUND" }, { status: 404 });
  const j = job as { id: string; status: string };
  if (j.status !== "submission_uncertain") {
    return NextResponse.json({ jobId: j.id, status: j.status, note: "already_resolved" });
  }

  const rpc = async (fn: string, params: Record<string, unknown>) => {
    const { data, error } = await svc.rpc(fn, params);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, result: data === true };
  };

  // 2) Műveletek – mindegyik az adatbázis-RPC-ben atomi és auditált
  if (b.action === "mark_submitted") {
    const provider = String(b.verifiedProvider);
    const rid = String(b.verifiedProviderJobId).trim();
    const r = await rpc("admin_mark_submitted", {
      p_job: j.id, p_provider: provider, p_provider_job_id: rid, p_admin: user.id, p_reason: reason,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
    return NextResponse.json({ jobId: j.id, action: "mark_submitted", applied: r.result });
  }

  if (b.action === "mark_failed") {
    if (!reason) return NextResponse.json({ error: "REASON_REQUIRED" }, { status: 400 });
    const r = await rpc("admin_mark_failed", { p_job: j.id, p_admin: user.id, p_reason: reason });
    if (!r.ok) {
      // refund/állapot tranzakciós hiba – NEM állítjuk refunded-nek
      return NextResponse.json({ error: r.error, refunded: false }, { status: 500 });
    }
    return NextResponse.json({ jobId: j.id, action: "mark_failed", applied: r.result, refunded: r.result });
  }

  if (b.action === "restart") {
    // Csak explicit providerellenőrzés és indoklás után
    if (b.confirmNotRunning !== true) {
      return NextResponse.json({ error: "CONFIRM_NOT_RUNNING_REQUIRED" }, { status: 400 });
    }
    if (!reason) return NextResponse.json({ error: "REASON_REQUIRED" }, { status: 400 });
    const r = await rpc("admin_restart", { p_job: j.id, p_admin: user.id, p_reason: reason });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
    return NextResponse.json({ jobId: j.id, action: "restart", applied: r.result });
  }

  return NextResponse.json({ jobId: j.id, status: j.status });
}
