import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/security/cron";
import { postDailyReddit } from "@/server/reddit/postDaily";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const verdict = isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (verdict === "no_secret") return NextResponse.json({ error: "CRON_SECRET_NOT_CONFIGURED" }, { status: 500 });
  if (verdict === "unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json(await postDailyReddit()); }
  catch { return NextResponse.json({ error: "REDDIT_PROCESS_FAILED" }, { status: 500 }); }
}
export const GET = POST;
