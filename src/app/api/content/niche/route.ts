import { authed } from "@/lib/apiAuth";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
const Body = z.object({
  interests: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  idempotencyKey: z.string().min(8).max(120),
});
const Idea = z.object({ niche: z.string(), angle: z.string(), monetization: z.string(), difficulty: z.enum(["easy", "medium", "hard"]) });
const Output = z.object({ ideas: z.array(Idea).min(1).max(10) });

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
    userId: user.id, type: "niche", cost: 5, idempotencyKey: parsed.data.idempotencyKey,
    fn: async () => Output.parse(await generateContentJson(
      "You are a creator business strategist. Return only JSON: {ideas:[{niche,angle,monetization,difficulty}]}; difficulty is easy, medium or hard.",
      `Interests: ${parsed.data.interests.join(", ") || "general creator economy"}`,
    )),
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === "TASK_ALREADY_PROCESSED" ? 409 : r.error === "CONTENT_AI_NOT_CONFIGURED" ? 503 : 500 });
  return NextResponse.json(r.value);
}
