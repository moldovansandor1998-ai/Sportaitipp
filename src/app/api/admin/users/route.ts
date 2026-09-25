// Admin: felhasználó role/ban kezelés (szerveroldali role-ellenőrzés + audit).
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";

const Body = z.object({
  userId: z.string().uuid(),
  action: z.enum(["set_role", "ban", "unban"]),
  role: z.enum(["user", "admin"]).optional(),
});

export async function POST(req: NextRequest) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = serviceClient();
  const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).single();
  if ((me as { role: string } | null)?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const { userId, action, role } = parsed.data;

  const patch: Record<string, unknown> = {};
  if (action === "set_role") patch.role = role ?? "user";
  if (action === "ban") patch.banned_until = new Date(Date.now() + 365 * 864e5).toISOString();
  if (action === "unban") patch.banned_until = null;
  const { error } = await svc.from("profiles").update(patch).eq("id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await svc.from("audit_logs").insert({
    actor_id: user.id, action: `admin.user.${action}`, target_type: "user", target_id: userId,
    meta: { role: role ?? null },
  });
  return NextResponse.json({ ok: true });
}
