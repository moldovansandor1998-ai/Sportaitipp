import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";
import { buildRouter } from "@/lib/providers";
import { failJob, finalizeJob, type JobRow } from "@/server/jobs/runJob";

export const runtime = "nodejs";

// A már beküldött szolgáltatói kérés állapotának lekérdezése; soha nem submitol új feladatot.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await auth.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = serviceClient();
  const { data: job, error } = await svc.from("generation_jobs").select("*").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (error || !job) return NextResponse.json({ error: "JOB_NOT_FOUND" }, { status: 404 });
  const row = job as unknown as JobRow & { provider_meta?: Record<string, unknown> };
  if (row.status !== "processing" || !row.provider || !row.provider_job_id) {
    return NextResponse.json({ status: row.status });
  }
  const adapter = buildRouter().getAdapter(row.provider);
  if (!adapter) return NextResponse.json({ error: "NO_PROVIDER_CONFIGURED" }, { status: 503 });
  try {
    const state = await adapter.getStatus(row.provider_job_id, row.provider_meta);
    if (state === "done") {
      const output = await adapter.getResult(row.provider_job_id, row.provider_meta, row.type);
      await finalizeJob(row.id, output);
    } else if (state === "failed") {
      await failJob(row, "provider status: failed");
    }
    const { data: updated } = await svc.from("generation_jobs").select("status,error")
      .eq("id", id).eq("owner_id", user.id).single();
    return NextResponse.json({ status: updated?.status ?? row.status, error: updated?.error ?? null });
  } catch (e) {
    console.error(JSON.stringify({ scope: "jobs.refresh", jobId: id, error: String(e) }));
    return NextResponse.json({ error: "PROVIDER_STATUS_UNAVAILABLE" }, { status: 502 });
  }
}
