import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/apiAuth";
import { prepareContent } from "@/server/content/prepare";
import { serviceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// An authenticated owner may test the evening window without changing the system clock.
export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const localHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", hour: "2-digit", hourCycle: "h23" }).format(now));
  const simulated = new Date(now.getTime() + (19 - localHour) * 3600000);
  const seeded = await prepareContent(simulated, user.id, 0);
  if (!seeded.slot) return NextResponse.json({ error: "INVALID_TIME" }, { status: 500 });
  // Bring only this owner's 20:00 test queue forward. The post date and hour remain 20:00.
  await serviceClient().from("model_content_items").update({ due_at: now.toISOString() })
    .eq("owner_id", user.id).eq("local_date", seeded.slot.date).eq("post_hour", 20).eq("status", "planned");
  const result = await prepareContent(now, user.id, 1);
  return NextResponse.json({ ...result, created: seeded.created });
}
