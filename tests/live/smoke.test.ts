// LIVE SMOKE – valódi fal.ai kulccsal (LIVE=1 + FAL_KEY).
// Valódi aszinkron folyamat: submit → status_url poll → response_url → eredmény letöltés.
// CI-ben külön, manuálisan indítható job; kulcs nélkül skip.
import { describe, it, expect } from "vitest";

const ENABLED = process.env.LIVE === "1" && !!process.env.FAL_KEY;
const QUEUE = "https://queue.fal.run";

interface QueueSubmit {
  request_id: string;
  status_url: string;
  response_url: string;
  cancel_url?: string;
}

describe.skipIf(!ENABLED)("LIVE smoke: valódi aszinkron képgenerálás fal.ai-val", () => {
  it("submit → poll → result → letöltött fájl", async () => {
    const key = process.env.FAL_KEY!;
    const res = await fetch(`${QUEUE}/fal-ai/flux/schnell`, {
      method: "POST",
      headers: { authorization: `Key ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "a red apple on a wooden table", image_size: "square_hd", num_inference_steps: 4 }),
    });
    expect(res.ok).toBe(true);
    const submit = (await res.json()) as QueueSubmit;
    expect(submit.request_id).toBeTruthy();
    expect(submit.status_url).toContain(submit.request_id);
    expect(submit.response_url).toContain(submit.request_id);

    let status = "";
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const s = await fetch(submit.status_url, { headers: { authorization: `Key ${key}` } });
      expect(s.ok).toBe(true);
      status = String(((await s.json()) as { status: string }).status);
      if (status === "COMPLETED" || status === "FAILED") break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    expect(status).toBe("COMPLETED");

    const r2 = await fetch(submit.response_url, { headers: { authorization: `Key ${key}` } });
    expect(r2.ok).toBe(true);
    const out = (await r2.json()) as { images?: { url: string }[] };
    const url = out.images?.[0]?.url;
    expect(url).toBeTruthy();

    const img = await fetch(url!);
    expect(img.ok).toBe(true);
    const buf = Buffer.from(await img.arrayBuffer());
    expect(buf.length).toBeGreaterThan(10_000);
  }, 150_000);
});
