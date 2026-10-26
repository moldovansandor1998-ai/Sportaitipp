import "server-only";
import { createHash } from "node:crypto";
import { USDT_TRC20_CONTRACT, type CryptoOrder } from "@/lib/billing/crypto";

const TRANSFER = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function tronAddressHex(address: string): string {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw new Error("INVALID_TRON_ADDRESS");
  let n = 0n;
  for (const c of address) n = n * 58n + BigInt(alphabet.indexOf(c));
  const bytes = Buffer.from(n.toString(16).padStart(50, "0"), "hex");
  const checksum = createHash("sha256").update(createHash("sha256").update(bytes.subarray(0, 21)).digest()).digest();
  if (bytes.length !== 25 || bytes[0] !== 0x41 || !bytes.subarray(21).equals(checksum.subarray(0, 4)))
    throw new Error("INVALID_TRON_ADDRESS");
  return bytes.subarray(1, 21).toString("hex");
}

export interface TronReceipt {
  id?: string;
  blockNumber?: number;
  blockTimeStamp?: number;
  receipt?: { result?: string };
  log?: Array<{ address?: string; topics?: string[]; data?: string }>;
}

/** The caller must obtain this receipt from the mainnet SolidityNode, never from a browser. */
export function validateUsdtReceipt(receipt: TronReceipt, txHash: string, order: CryptoOrder) {
  if (!/^[a-f0-9]{64}$/.test(txHash)) throw new Error("INVALID_TX_HASH");
  if (!receipt.id) return { status: "pending" as const };
  if (receipt.id.toLowerCase() !== txHash || receipt.receipt?.result !== "SUCCESS")
    throw new Error("TRANSACTION_FAILED");
  const time = receipt.blockTimeStamp;
  if (!Number.isSafeInteger(receipt.blockNumber) || !Number.isSafeInteger(time)
    || time! < Date.parse(order.created_at) || time! > Date.parse(order.expires_at))
    throw new Error("TRANSACTION_OUTSIDE_ORDER_WINDOW");
  const contract = tronAddressHex(USDT_TRC20_CONTRACT);
  const recipient = tronAddressHex(order.recipient);
  let amount = 0n;
  for (const log of receipt.log ?? []) {
    const address = (log.address ?? "").toLowerCase().replace(/^0x/, "");
    const topics = log.topics ?? [];
    if (address !== contract && address !== `41${contract}`) continue;
    if (topics.length !== 3 || topics[0]?.toLowerCase() !== TRANSFER
      || topics[2]?.toLowerCase() !== recipient.padStart(64, "0")
      || !/^[a-f0-9]{64}$/i.test(log.data ?? "")) continue;
    amount += BigInt(`0x${log.data}`);
  }
  if (amount !== BigInt(order.amount_units)) throw new Error("PAYMENT_AMOUNT_OR_RECIPIENT_MISMATCH");
  return { status: "confirmed" as const, amountUnits: Number(amount), blockTime: new Date(time!).toISOString() };
}

export async function readConfirmedReceipt(txHash: string): Promise<TronReceipt> {
  if (!/^[a-f0-9]{64}$/.test(txHash)) throw new Error("INVALID_TX_HASH");
  const response = await fetch("https://api.trongrid.io/walletsolidity/gettransactioninfobyid", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000),
    headers: { "content-type": "application/json", ...(process.env.TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY } : {}) },
    body: JSON.stringify({ value: txHash }),
  });
  if (!response.ok) throw new Error("CHAIN_UNAVAILABLE");
  const body = await response.json();
  if (!body || typeof body !== "object" || body.Error || body.error) throw new Error("CHAIN_UNAVAILABLE");
  return body as TronReceipt;
}
