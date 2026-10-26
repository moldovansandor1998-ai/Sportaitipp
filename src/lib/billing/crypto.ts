/** Public payment instructions. No private key is needed or stored. */
export const USDT_TRC20_ADDRESS = "THMbEe1gpmyM96gY4VpNT6fHSf1HfbGwdY";
export const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export const CRYPTO_NETWORK = "TRON (TRC20)";

export interface CryptoOrder {
  id: string;
  plan_id: string;
  credits: number;
  amount_units: number;
  recipient: string;
  status: "pending" | "completed";
  created_at: string;
  expires_at: string;
  tx_hash: string | null;
  submitted_tx_hash: string | null;
}

/** Integer micro-USDT throughout; never compare floating point token amounts. */
export function formatUsdt(units: number): string {
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error("INVALID_USDT_AMOUNT");
  return `${Math.floor(units / 1_000_000)}.${String(units % 1_000_000).padStart(6, "0")}`;
}
