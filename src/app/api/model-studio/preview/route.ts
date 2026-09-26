import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/apiAuth";
import { prepareContent } from "@/server/content/prepare";

export const runtime = "nodejs";
// An authenticated owner may test the evening window without changing the system clock.
export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const localHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", hour: "2-digit", hourCycle: "h23" }).format(now));
  const simulated = new Date(now.getTime() + (19 - localHour) * 3600000);
  const result = await prepareContent(simulated, user.id, 1);
  return NextResponse.json(result);
}
