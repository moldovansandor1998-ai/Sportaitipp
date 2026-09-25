// Stripe Checkout session (production-ready; kulcs nélkül 503 STRIPE_NOT_CONFIGURED).
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { stripeConfigured, stripePost } from "@/lib/stripe";
import { serviceClient } from "@/lib/supabase/server";

const Body = z.object({ planId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user } } = await sb.auth.getUser(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!stripeConfigured()) return NextResponse.json({ error: "STRIPE_NOT_CONFIGURED" }, { status: 503 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const { data: plan } = await serviceClient().from("plans").select("*").eq("id", parsed.data.planId).eq("active", true).single();
  if (!plan) return NextResponse.json({ error: "PLAN_NOT_FOUND" }, { status: 404 });

  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${process.env.APP_URL}/plans?success=1`,
    cancel_url: `${process.env.APP_URL}/plans?canceled=1`,
    "line_items[0][price_data][currency]": "huf",
    "line_items[0][price_data][unit_amount]": String((plan as { price_huf: number }).price_huf * 100),
    "line_items[0][price_data][product_data][name]": `Castora ${(plan as { name: string }).name} – ${(plan as { credits: number }).credits} kredit`,
    "line_items[0][quantity]": "1",
    "metadata[userId]": user.id,
    "metadata[planId]": (plan as { id: string }).id,
  });
  const res = await stripePost("/checkout/sessions", params);
  if (!res.ok) return NextResponse.json({ error: `stripe_${res.status}` }, { status: 502 });
  const data = (await res.json()) as { id: string; url: string };
  const { error: purchaseError } = await serviceClient().from("credit_purchases").insert({
    user_id: user.id, plan_id: (plan as { id: string }).id,
    credits: (plan as { credits: number }).credits, amount_huf: (plan as { price_huf: number }).price_huf,
    status: "pending", stripe_session_id: data.id,
  });
  if (purchaseError) return NextResponse.json({ error: "PURCHASE_RECORD_FAILED" }, { status: 500 });
  return NextResponse.json({ url: data.url });
}
