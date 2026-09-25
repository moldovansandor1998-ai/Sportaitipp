export const runtime = "nodejs";

// Admin kreditmódosítás: a VÉGPONT hitelesíti a hívót (JWT + role), majd explicit,
// auditált szerverművelet fut (credit_admin_adjust validálja az admin azonosítót is).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase/server";

const BodySchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().min(-1000000).max(1000000),
  note: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = serviceClient();
  const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).single();
  if ((profile as { role: string } | null)?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const { userId, amount, note } = parsed.data;

  const { error } = await svc.rpc("credit_admin_adjust", {
    p_user: userId,
    p_amount: amount,
    p_admin: user.id,                      // a függvény is validálja, hogy ez tényleg admin
    p_note: note ?? "admin credit adjust",
    p_key: `admin:${user.id}:${crypto.randomUUID()}`,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
