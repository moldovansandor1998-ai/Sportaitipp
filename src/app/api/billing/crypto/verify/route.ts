import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authed } from "@/lib/apiAuth";
import { serviceClient } from "@/lib/supabase/server";
import { USDT_TRC20_CONTRACT, type CryptoOrder } from "@/lib/billing/crypto";
import { readConfirmedReceipt, validateUsdtReceipt } from "@/server/billing/tron";

export const runtime = "nodejs";
export const maxDuration = 30;
const Input = z.object({ orderId: z.string().uuid(), txHash: z.string().trim().regex(/^[a-f0-9]{64}$/i).transform(s => s.toLowerCase()) }).strict();
const headers = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
  const user = await authed(req);
  if (!user) return NextResponse.json({ error: "Jelentkezz be újra." }, { status: 401, headers });
  const input = Input.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "A tranzakcióazonosító 64 karakteres betű- és számsor." }, { status: 400, headers });
  const { orderId, txHash } = input.data;
  const db = serviceClient();
  const { data: order } = await db.from("crypto_credit_orders").select("*").eq("id", orderId).eq("user_id", user.id).single();
  if (!order) return NextResponse.json({ error: "A fizetési kérelem nem található." }, { status: 404, headers });
  if (order.status === "completed") return NextResponse.json({ status: "completed" }, { headers });
  // Persistent conditional update limits chain calls across server instances.
  const { data: locked, error: lockError } = await db.from("crypto_credit_orders").update({ last_checked_at: new Date().toISOString(), submitted_tx_hash: txHash })
    .eq("id", orderId).eq("user_id", user.id).eq("status", "pending")
    .or(`last_checked_at.is.null,last_checked_at.lt.${new Date(Date.now() - 12_000).toISOString()}`).select("id").maybeSingle();
  if (lockError) return NextResponse.json({ error: "Az ellenőrzés most nem indítható." }, { status: 503, headers });
  if (!locked) return NextResponse.json({ status: "pending", message: "Az ellenőrzés folyamatban. Várj néhány másodpercet." }, { status: 202, headers });
  try {
    const proof = validateUsdtReceipt(await readConfirmedReceipt(txHash), txHash, order as CryptoOrder);
    if (proof.status === "pending") return NextResponse.json({ status: "pending", message: "A hálózati megerősítésre várunk. A kredit még nem lett jóváírva." }, { status: 202, headers });
    const { error } = await db.rpc("complete_crypto_credit_order", {
      p_order: orderId, p_user: user.id, p_tx: txHash, p_amount: proof.amountUnits,
      p_recipient: order.recipient, p_contract: USDT_TRC20_CONTRACT, p_block_time: proof.blockTime,
    });
    if (error) return NextResponse.json({ error: "A tranzakció nem írható jóvá ehhez a rendeléshez, vagy már felhasználták. Írj az ügyfélszolgálatnak." }, { status: 409, headers });
    return NextResponse.json({ status: "completed" }, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "CHAIN_UNAVAILABLE";
    const messages: Record<string, string> = {
      TRANSACTION_FAILED: "A tranzakció nem sikeres USDT-fizetés.",
      TRANSACTION_OUTSIDE_ORDER_WINDOW: "A tranzakció időpontja nem ehhez a fizetési kérelemhez tartozik. Keresd az ügyfélszolgálatot.",
      PAYMENT_AMOUNT_OR_RECIPIENT_MISMATCH: "Az összeg, a fogadó cím vagy a token nem egyezik. Csak a pontos összegű USDT TRC20 fizetés írható jóvá automatikusan. Keresd az ügyfélszolgálatot.",
    };
    return NextResponse.json({ error: messages[code] ?? "A hálózat most nem ellenőrizhető. Ne utalj újra; próbáld meg az ellenőrzést később." }, { status: messages[code] ? 422 : 503, headers });
  }
}
