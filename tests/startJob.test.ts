// A tényleges /api/jobs FETCH BODY assertálva – az idempotency-kulcs életciklusa a UI-úton.
import { describe, it, expect, vi, afterEach } from "vitest";
import { startJobWithTracker } from "@/lib/jobs/startJob";
import { createAttemptTracker } from "@/lib/jobs/attemptKey";

afterEach(() => vi.unstubAllGlobals());

function captureBodies(): { bodies: Array<Record<string, unknown>>; failNext: () => void } {
  const bodies: Array<Record<string, unknown>> = [];
  let fails = 0;
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (fails > 0) { fails -= 1; throw new Error("network down"); }
    return new Response(JSON.stringify({ jobId: "job-x" }), { status: 202 });
  }));
  return { bodies, failNext: () => { fails = 1; } };
}

describe("startJobWithTracker – a fetch body valódi kulcsa", () => {
  it("első indítás: explicit UUID megy a body-ban", async () => {
    const { bodies } = captureBodies();
    const r = await startJobWithTracker({
      tracker: createAttemptTracker(() => "uuid-1"), fetchImpl: fetch, token: "t",
      body: { type: "image_generation", payload: { prompt: "x" } },
    });
    expect(r).toMatchObject({ ok: true, status: 202, idempotencyKey: "uuid-1" });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].idempotencyKey).toBe("uuid-1");
  });

  it("hálózati hiba: ugyanaz a kulcs megy az újraküldésben (2 kérés, azonos idempotencyKey)", async () => {
    const { bodies, failNext } = captureBodies();
    failNext();
    const r = await startJobWithTracker({
      tracker: createAttemptTracker(() => "uuid-2"), fetchImpl: fetch, token: "t",
      body: { type: "video_from_image", payload: { prompt: "x" } },
    });
    expect(r).toMatchObject({ ok: true, status: 202 });
    expect(bodies).toHaveLength(2);
    expect(bodies[0].idempotencyKey).toBe("uuid-2");
    expect(bodies[1].idempotencyKey).toBe("uuid-2");   // AZONOS kulcs
  });

  it("felhasználói retry (finish után) ÚJ kulcsot küld – számlálós generátorral", async () => {
    const { bodies } = captureBodies();
    let n = 0;
    const tracker = createAttemptTracker(() => `uuid-${++n}`);   // uuid-1, majd finish után uuid-2
    await startJobWithTracker({ tracker, fetchImpl: fetch, token: "t", body: { type: "tts", payload: { text: "a" } } });
    await startJobWithTracker({ tracker, fetchImpl: fetch, token: "t", body: { type: "tts", payload: { text: "a" } } }); // retry
    expect(bodies.map((b) => b.idempotencyKey)).toEqual(["uuid-1", "uuid-2"]);
  });

  it("dupla indítás közben: begin null → NINCS második POST", async () => {
    const { bodies } = captureBodies();
    const tracker = createAttemptTracker(() => "uuid-4");
    const first = startJobWithTracker({ tracker, fetchImpl: fetch, token: "t", body: { type: "image_generation", payload: {} } });
    const second = await startJobWithTracker({ tracker, fetchImpl: fetch, token: "t", body: { type: "image_generation", payload: {} } });
    await first;
    expect(second).toEqual({ skipped: true });
    expect(bodies).toHaveLength(1);                     // pontosan egy POST
  });

  it("külön trackerrel a retry ÚJ kulcsot kap (a valódi UI-minta)", async () => {
    const { bodies } = captureBodies();
    const t1 = createAttemptTracker(() => "k-1");
    const t2 = createAttemptTracker(() => "k-2");
    await startJobWithTracker({ tracker: t1, fetchImpl: fetch, token: "t", body: { type: "tts", payload: {} } });
    await startJobWithTracker({ tracker: t2, fetchImpl: fetch, token: "t", body: { type: "tts", payload: {} } });
    expect(bodies.map((b) => b.idempotencyKey)).toEqual(["k-1", "k-2"]);
  });
});
