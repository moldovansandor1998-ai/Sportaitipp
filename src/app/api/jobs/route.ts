import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";
import { prepareValidatedJobInput, parseJobType } from "@/server/jobs/prepareJob";
import { createJobWithHold } from "@/lib/credits/rpc";
import { assertProviderConfigured, buildRouter } from "@/lib/providers";
import { scheduleKick } from "@/server/jobs/schedule";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const type = parseJobType(body?.type);                 // ismeretlen típus NEM okoz 500-at
  if (!type) return NextResponse.json({ error: "validation" }, { status: 400 });

  // KÖZÖS előkészítés (estimate-tel azonos út → árparitás)
  const prepared = await prepareValidatedJobInput({
    userId: user.id, type,
    characterId: body?.characterId, projectId: body?.projectId, payload: body?.payload ?? {},
  });
  if (prepared.error) {
    return NextResponse.json({ error: prepared.error }, { status: prepared.status ?? 400 });
  }

  const router = buildRouter();
  try {
    assertProviderConfigured(router, type as never);
  } catch {
    return NextResponse.json({ error: "NO_PROVIDER_CONFIGURED" }, { status: 503 });
  }
  const estimate = await router.estimate(type as never, prepared.payload);

  let jobId: string;
  try {
    jobId = await createJobWithHold({
      userId: user.id, type,
      characterId: prepared.characterId,
      projectId: prepared.projectId,
      payload: prepared.payload,
      idempotencyKey: body?.idempotencyKey ?? randomUUID(),
      costEstimate: estimate.credits,
    });
  } catch (e: unknown) {
    const code = (e as { code?: string } | null)?.code ?? (e as Error)?.message;
    if (code === "INSUFFICIENT_CREDITS") return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 402 });
    if (code === "JOB_ALREADY_EXISTS") return NextResponse.json({ error: "JOB_ALREADY_EXISTS" }, { status: 409 });
    if (prepared.error === "PROJECT_NOT_OWNED") { /* már fent kezelve */ }
    if (typeof code === "string" && code.startsWith("NO_PROVIDER_CONFIGURED")) {
      return NextResponse.json({ error: "NO_PROVIDER_CONFIGURED" }, { status: 503 });
    }
    if (typeof code === "string" && ["CHARACTER_NOT_OWNED", "PROJECT_NOT_OWNED"].includes(code)) {
      return NextResponse.json({ error: code }, { status: 403 });
    }
    if (typeof code === "string" && ["NO_REFERENCES", "CHARACTER_NOT_READY", "CHARACTER_NOT_TEST_PENDING",
      "NO_VERSION", "CHARACTER_FLOW_INCOMPLETE", "IDENTITY_REQUIRES_REAL_PROVIDER",
      "NO_ACTIVE_LORA", "CHARACTER_NOT_ACTIVE"].includes(code)) {
      return NextResponse.json({ error: code }, { status: 409 });
    }
    console.error(JSON.stringify({ level: "error", scope: "jobs.post", error: String(code) }));
    return NextResponse.json({ error: "JOB_FAILED" }, { status: 500 });
  }

  // Scheduling-hiba NEM lehet néma és NEM omolhat át: fail-fast 500 (a job queued marad –
  // a reaper dokumentáltan veszi később). A válasz SOSEM hamis 202.
  try {
    scheduleKick(jobId);
  } catch {
    return NextResponse.json({ error: "JOB_SCHEDULING_FAILED" }, { status: 500 });
  }
  return NextResponse.json({ jobId }, { status: 202 });
}

export async function GET(req: NextRequest) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await serviceClient().from("generation_jobs")
    .select("id,type,status,cost_estimate,cost_final,queued_at,finished_at,error")
    .eq("owner_id", user.id).order("created_at", { ascending: false }).limit(50);
  return NextResponse.json({ jobs: data ?? [] });
}
