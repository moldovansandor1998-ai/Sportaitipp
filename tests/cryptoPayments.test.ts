import { describe, expect, it, vi, afterEach } from "vitest";
import { formatUsdt, USDT_TRC20_ADDRESS, USDT_TRC20_CONTRACT, type CryptoOrder } from "@/lib/billing/crypto";
import { tronAddressHex, validateUsdtReceipt, readConfirmedReceipt, type TronReceipt } from "@/server/billing/tron";
import { FalAdapter } from "@/lib/providers/fal";
import { CreateJobSchema } from "@/lib/security/validation";

const tx = "a".repeat(64);
const order: CryptoOrder = { id: "order-a", plan_id: "starter", credits: 1000, amount_units: 14999999,
  recipient: USDT_TRC20_ADDRESS, status: "pending", created_at: "2026-10-26T10:00:00Z", expires_at: "2026-10-27T10:00:00Z", tx_hash: null, submitted_tx_hash: null };
function receipt(): TronReceipt {
  return { id: tx, blockNumber: 80000000, blockTimeStamp: Date.parse("2026-10-26T11:00:00Z"), receipt: { result: "SUCCESS" }, log: [{
    address: tronAddressHex(USDT_TRC20_CONTRACT), topics: ["ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0".repeat(64), tronAddressHex(USDT_TRC20_ADDRESS).padStart(64, "0")],
    data: BigInt(order.amount_units).toString(16).padStart(64, "0"),
  }] };
}
afterEach(() => vi.unstubAllGlobals());
describe("USDT mainnet payment verification", () => {
  it("validates the exact recipient checksum and token", () => {
    expect(tronAddressHex(USDT_TRC20_ADDRESS)).toBe("5104977e28bdb89438776baaa420659ea49607f2");
    expect(() => tronAddressHex(USDT_TRC20_ADDRESS.slice(0, -1) + "X")).toThrow("INVALID_TRON_ADDRESS");
  });
  it("formats six decimal places without floating point loss", () => {
    expect(formatUsdt(14999999)).toBe("14.999999");
    expect(() => formatUsdt(1.5)).toThrow();
  });
  it("accepts an exact finalized USDT transfer", () => {
    expect(validateUsdtReceipt(receipt(), tx, order)).toEqual({status: "confirmed", amountUnits: 14999999, blockTime: "2026-10-26T11:00:00.000Z"});
  });
  it("does not credit an unconfirmed or unknown transaction", () => {
    expect(validateUsdtReceipt({}, tx, order)).toEqual({status: "pending"});
  });
  it.each(["OUT_OF_ENERGY", "REVERT", undefined])("rejects failed or missing execution status %s", result => {
    const r = receipt(); r.receipt = {result};
    expect(() => validateUsdtReceipt(r, tx, order)).toThrow("TRANSACTION_FAILED");
  });
  it("rejects a different receipt hash", () => {
    const r = receipt(); r.id = "b".repeat(64);
    expect(() => validateUsdtReceipt(r, tx, order)).toThrow();
  });
  it("rejects spoofed USDT tokens", () => {
    const r = receipt(); r.log![0].address = "f".repeat(40);
    expect(() => validateUsdtReceipt(r, tx, order)).toThrow("PAYMENT_AMOUNT_OR_RECIPIENT_MISMATCH");
  });
  it("rejects another recipient or another order's exact amount", () => {
    const r = receipt(); r.log![0].topics![2] = "0".repeat(64);
    expect(() => validateUsdtReceipt(r, tx, order)).toThrow();
    expect(() => validateUsdtReceipt(receipt(), tx, {...order, amount_units: 14999998})).toThrow();
  });
  it.each([14999998, 15000000])("rejects under/overpaid %i micro-USDT", amount => {
    const r = receipt(); r.log![0].data = amount.toString(16).padStart(64, "0");
    expect(() => validateUsdtReceipt(r, tx, order)).toThrow();
  });
  it.each(["2026-10-25T23:00:00Z", "2026-10-28T00:00:00Z"])("rejects transfers outside order window %s", date => {
    const r = receipt(); r.blockTimeStamp = Date.parse(date);
    expect(() => validateUsdtReceipt(r, tx, order)).toThrow("TRANSACTION_OUTSIDE_ORDER_WINDOW");
  });
  it("ignores fake transfer event topics and malformed amount data", () => {
    const r = receipt(); r.log![0].topics![0] = "0".repeat(64);
    expect(() => validateUsdtReceipt(r, tx, order)).toThrow();
    const bad = receipt(); bad.log![0].data = "NaN";
    expect(() => validateUsdtReceipt(bad, tx, order)).toThrow();
  });
  it("only reads mainnet solidified receipts and fails closed on provider error", async () => {
    const fetcher = vi.fn().mockResolvedValue({ok: true, json: async () => ({Error: "rate limit"})});
    vi.stubGlobal("fetch", fetcher);
    await expect(readConfirmedReceipt(tx)).rejects.toThrow("CHAIN_UNAVAILABLE");
    expect(fetcher.mock.calls[0][0]).toBe("https://api.trongrid.io/walletsolidity/gettransactioninfobyid");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({value: tx});
  });
});
describe("quantity-aware credit pricing", () => {
  const fal = new FalAdapter();
  it("charges all generated images", async () => {
    expect((await fal.estimate("image_generation", {numImages: 4})).credits).toBe(160);
  });
  it("scales video cost with duration", async () => {
    expect((await fal.estimate("video_from_image", {duration: 10})).credits).toBe(800);
  });
  it("uses measured lipsync duration, never caller supplied duration", async () => {
    await expect(fal.estimate("lip_sync", {duration: 1})).rejects.toThrow();
    expect((await fal.estimate("lip_sync", {duration: 1, billableSeconds: 60})).credits).toBe(2640);
  });
  it("scales training and speech", async () => {
    expect((await fal.estimate("character_training", {steps: 2000})).credits).toBe(3000);
    expect((await fal.estimate("tts", {text: "x".repeat(1000)})).credits).toBe(100);
  });
  it("rejects unbounded raw generation parameters before holding credits", () => {
    for (const payload of [{numImages: 100}, {steps: 100000}, {imageSize: {width: 99999, height: 99999}}])
      expect(CreateJobSchema.safeParse({type: "image_generation", payload: {prompt: "photo", ...payload}}).success).toBe(false);
  });
});
