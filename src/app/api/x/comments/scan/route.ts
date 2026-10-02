import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/security/cron";
import { authed } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const verdict = isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (verdict === "no_secret") return NextResponse.json({ error: "CRON_SECRET_NOT_CONFIGURED" }, { status: 500 });
  if (verdict !== "ok") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ error: "COMMENT_SUGGESTIONS_PAUSED" }, { status: 410 });
}

export async function POST(req: NextRequest) {
  if (!await authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ error: "COMMENT_SUGGESTIONS_PAUSED" }, { status: 410 });
}
