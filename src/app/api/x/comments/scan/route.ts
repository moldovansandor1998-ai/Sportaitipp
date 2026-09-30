import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/security/cron";
import { authed } from "@/lib/apiAuth";
import { scanCommentSuggestions } from "@/server/x/commentSuggestions";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const verdict = isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (verdict === "no_secret") return NextResponse.json({ error: "CRON_SECRET_NOT_CONFIGURED" }, { status: 500 });
  if (verdict !== "ok") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json(await scanCommentSuggestions()); }
  catch (error) { console.error("x.comment.cron", error); return NextResponse.json({ error: "SCAN_FAILED" }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json(await scanCommentSuggestions(user.id)); }
  catch (error) { console.error("x.comment.manual_scan", error); return NextResponse.json({ error: "SCAN_FAILED" }, { status: 500 }); }
}
