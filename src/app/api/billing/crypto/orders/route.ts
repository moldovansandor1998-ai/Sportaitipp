import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const Input = z.object({ planId: z.enum(["starter", "pro", "studio"]) }).strict();
const fields = "id,plan_id,credits,amount_units,recipient,status,created_at,expires_at,tx_hash,submitted_tx_hash";
const headers = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "Jelentkezz be újra." }, { status: 401, headers });
  const db = serviceClient();
  const [plans, orders, account] = await Promise.all([
    db.from("plans").select("id,name,credits,price_usdt").eq("active", true).order("credits"),
    db.from("crypto_credit_orders").select(fields).eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    db.from("credit_accounts").select("balance").eq("user_id", user.id).single(),
  ]);
  if (plans.error || orders.error || account.error) return NextResponse.json({ error: "A kreditadatok most nem tölthetők be." }, { status: 503, headers });
  return NextResponse.json({ plans: plans.data, orders: orders.data, balance: account.data.balance }, { headers });
}

export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "Jelentkezz be újra." }, { status: 401, headers });
  const input = Input.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Érvénytelen csomag." }, { status: 400, headers });
  const db = serviceClient();
  const { data: id, error } = await db.rpc("create_crypto_credit_order", { p_user: user.id, p_plan: input.data.planId });
  if (error) return NextResponse.json({ error: "A fizetés most nem indítható. Próbáld újra később." }, { status: 503, headers });
  const { data: order, error: readError } = await db.from("crypto_credit_orders").select(fields).eq("id", id).eq("user_id", user.id).single();
  if (readError) return NextResponse.json({ error: "A fizetési kérelem nem tölthető be." }, { status: 503, headers });
  return NextResponse.json({ order }, { headers });
}
