// Kreditár-becslés generálás ELŐTT – NINCS hold, NINCS job, NINCS adatbázis-módosítás.
// UGYANAZ a prepareValidatedJobInput fut, mint a valódi job route-nál → árparitás garantált.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildRouter, assertProviderConfigured, ProviderError } from "@/lib/providers";
import { prepareValidatedJobInput, parseJobType } from "@/server/jobs/prepareJob";

export async function POST(req: NextRequest) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const type = parseJobType(body?.type);                 // ismeretlen típus → 400, nem 500
  if (!type) return NextResponse.json({ error: "validation" }, { status: 400 });

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
  try {
    const estimate = await router.estimate(type as never, prepared.payload);
    return NextResponse.json({ credits: estimate.credits, secondsExpected: estimate.secondsExpected });
  } catch (e: unknown) {
    if (e instanceof ProviderError) {
      return NextResponse.json({ error: "PROVIDER_ESTIMATE_FAILED", retryable: e.retryable }, { status: 502 });
    }
    throw e;
  }
}
