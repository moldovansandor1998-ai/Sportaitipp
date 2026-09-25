// Admin összesítő: felhasználók, jobok státuszonként, moderációs jelzők, kreditmozgások.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = serviceClient();
  const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).single();
  if ((me as { role: string } | null)?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [users, jobsByStatus, flags, txSum] = await Promise.all([
    svc.from("profiles").select("id,email,role,created_at,banned_until").order("created_at", { ascending: false }).limit(100),
    svc.rpc("admin_jobs_by_status"),
    svc.from("moderation_flags").select("id,reason,status,created_at").eq("status", "open").order("created_at", { ascending: false }).limit(50),
    svc.from("credit_transactions").select("type,amount").gte("created_at", new Date(Date.now() - 30 * 864e5).toISOString()).limit(5000),
  ]);
  const burn = (txSum.data ?? []).reduce((n: number, t: { type: string; amount: number }) =>
    n + (["hold", "charge"].includes(t.type) ? -t.amount : 0), 0);
  return NextResponse.json({
    users: users.data ?? [],
    jobsByStatus: jobsByStatus.data ?? [],
    openFlags: flags.data ?? [],
    creditsBurned30d: burn,
  });
}
