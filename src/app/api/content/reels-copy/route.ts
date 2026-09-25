import { authed } from "@/lib/apiAuth";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
const Body = z.object({
  topic: z.string().trim().min(1).max(200),
  audience: z.string().max(200).default(""),
  tone: z.enum(["energetic", "calm", "expert", "funny"]).default("energetic"),
  cta: z.string().max(200).default(""),
  idempotencyKey: z.string().min(8).max(120),
});
const Output = z.object({ hook: z.string(), script: z.array(z.string()).min(1).max(12), caption: z.string(), hashtags: z.array(z.string()).max(20) });

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
    userId: user.id, type: "reels_copy", cost: 5, idempotencyKey: parsed.data.idempotencyKey,
    fn: async () => Output.parse(await generateContentJson(
      "You are a social video copywriter. Return only JSON with hook, script (string array), caption and hashtags (without #).",
      JSON.stringify(parsed.data),
    )),
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === "TASK_ALREADY_PROCESSED" ? 409 : r.error === "CONTENT_AI_NOT_CONFIGURED" ? 503 : 500 });
  return NextResponse.json({ copy: r.value });
}
