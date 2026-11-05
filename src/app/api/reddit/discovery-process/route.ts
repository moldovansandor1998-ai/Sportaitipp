import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/security/cron";
import { discoverDueCommunities } from "@/server/reddit/discoveryRunner";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: NextRequest) {
  const verdict = isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (verdict === "no_secret") return NextResponse.json({ error: "CRON_SECRET_NOT_CONFIGURED" }, { status: 500 });
  if (verdict === "unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json(await discoverDueCommunities()); }
  catch { return NextResponse.json({ error: "REDDIT_DISCOVERY_FAILED" }, { status: 500 }); }
}
export const GET = POST;
