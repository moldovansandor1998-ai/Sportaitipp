import { authed } from "@/lib/apiAuth";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase/server";


const Body = z.object({
  niche: z.string().trim().min(1).max(120),
  persist: z.boolean().default(false),
  idempotencyKey: z.string().min(8).max(120),
});
const Trend = z.object({ title: z.string(), platform: z.enum(["instagram", "tiktok", "other"]), score: z.number().min(0).max(100), why: z.string() });
const Output = z.object({ trends: z.array(Trend).min(1).max(10) });

export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const { contentAiConfigured } = await import("@/lib/contentAi");
  if (!contentAiConfigured()) return NextResponse.json({ error: "CONTENT_AI_NOT_CONFIGURED" }, { status: 503 });
  const { generateContentJson } = await import("@/lib/contentAi");
  const { runBilledTask } = await import("@/lib/billedTask");
  const r = await runBilledTask({
    userId: user.id, type: "trends", cost: 5, idempotencyKey: parsed.data.idempotencyKey,
    fn: async () => {
      const { trends } = Output.parse(await generateContentJson(
        "Generate current-looking social content concepts without claiming live trend data. Return only JSON: {trends:[{title,platform,score,why}]}",
        `Niche: ${parsed.data.niche}`,
      ));
      if (parsed.data.persist) {
        const svc = serviceClient();
        await svc.from("viral_trends").insert({
          owner_id: user.id, title: `Trendek: ${parsed.data.niche}`, platform: "other",
          status: "ready", analysis: { trends },
        });
      }
      return { trends };
    },
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === "TASK_ALREADY_PROCESSED" ? 409 : r.error === "CONTENT_AI_NOT_CONFIGURED" ? 503 : 500 });
  return NextResponse.json(r.value);
}
