import { NextRequest, NextResponse } from "next/server";
import { authed } from "@/lib/apiAuth";
import { prepareContent } from "@/server/content/prepare";
import { serviceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// An authenticated owner may test the evening window without changing the system clock.
export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (process.env.CONTENT_AUTOMATION_ENABLED === "false")
    return NextResponse.json({ error: "QUALITY_REVIEW_REQUIRED" }, { status: 503 });
  const now = new Date();
  const localHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", hour: "2-digit", hourCycle: "h23" }).format(now));
  const simulated = new Date(now.getTime() + (18 - localHour) * 3600000);
  const seeded = await prepareContent(simulated, user.id, 0);
  if (!seeded.slot) return NextResponse.json({ error: "INVALID_TIME" }, { status: 500 });
  // Old quality-review failures can be retried now that the owner has uploaded
  // scenes. Only today's public 20:00 drafts are included.
  const sb = serviceClient();
  await sb.from("model_content_items").update({ status: "planned", error: null, prepare_at: now.toISOString() })
    .eq("owner_id", user.id).eq("local_date", seeded.slot.date).eq("post_hour", 20)
    .in("platform", ["tiktok", "telegram", "fanvue_public"])
    .eq("status", "failed").like("error", "QUALITY_REVIEW_REQUIRED%");
  await sb.from("model_content_items").update({ prepare_at: now.toISOString() })
    .eq("owner_id", user.id).eq("local_date", seeded.slot.date).eq("post_hour", 20).eq("status", "planned");
  const result = await prepareContent(now, user.id, 1);
  return NextResponse.json({ ...result, created: seeded.created });
}
