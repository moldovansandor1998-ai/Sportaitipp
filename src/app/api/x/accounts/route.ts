import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { xConfigured } from "@/server/x/client";

export const runtime = "nodejs";
const Settings = z.object({ characterId: z.string().uuid(), enabled: z.boolean().optional(),
  morningMinute: z.number().int().min(0).max(1439).optional(),
  eveningMinute: z.number().int().min(0).max(1439).optional() });

export async function GET(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = serviceClient();
  const [accounts, history] = await Promise.all([
    sb.from("x_social_connections")
      .select("character_id,x_username,enabled,timezone,morning_minute,evening_minute")
      .eq("owner_id", user.id),
    sb.from("x_social_posts").select("character_id,local_date,slot,status,x_post_id,error")
      .eq("owner_id", user.id).order("created_at", { ascending: false }).limit(30),
  ]);
  if (accounts.error || history.error) return NextResponse.json({ error: "X_STATUS_FAILED" }, { status: 500 });
  return NextResponse.json({ configured: xConfigured(), accounts: accounts.data, history: history.data });
}

export async function PATCH(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input = Settings.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "INVALID_SETTINGS" }, { status: 400 });
  const { characterId, enabled, morningMinute, eveningMinute } = input.data;
  if (morningMinute !== undefined && eveningMinute !== undefined && morningMinute >= eveningMinute)
    return NextResponse.json({ error: "INVALID_POST_TIMES" }, { status: 400 });
  const update = { ...(enabled !== undefined && { enabled }),
    ...(morningMinute !== undefined && { morning_minute: morningMinute }),
    ...(eveningMinute !== undefined && { evening_minute: eveningMinute }),
    updated_at: new Date().toISOString() };
  const { data, error } = await serviceClient().from("x_social_connections")
    .update(update).eq("owner_id", user.id).eq("character_id", characterId)
    .select("character_id").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "X_SETTINGS_FAILED" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const characterId = req.nextUrl.searchParams.get("characterId");
  if (!characterId || !z.string().uuid().safeParse(characterId).success)
    return NextResponse.json({ error: "INVALID_CHARACTER" }, { status: 400 });
  const { error } = await serviceClient().from("x_social_connections").delete()
    .eq("owner_id", user.id).eq("character_id", characterId);
  if (error) return NextResponse.json({ error: "X_DISCONNECT_FAILED" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
