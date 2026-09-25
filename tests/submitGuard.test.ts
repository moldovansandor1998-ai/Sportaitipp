// A Generator/Tools TÉNYLEGES indítási mintája: szinkron guard + estimate + startJobWithTracker.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createSubmitGuard, withSubmitGuard } from "@/lib/jobs/submitGuard";
import { createAttemptTracker } from "@/lib/jobs/attemptKey";
import { startJobWithTracker } from "@/lib/jobs/startJob";

afterEach(() => vi.unstubAllGlobals());

function spyRoutes(opts?: { failJobOnce?: boolean }): { counts: Record<string, number>; bodies: Array<Record<string, unknown>> } {
  const counts: Record<string, number> = { estimate: 0, jobs: 0 };
  const bodies: Array<Record<string, unknown>> = [];
  let fail = opts?.failJobOnce ? 1 : 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/jobs/estimate")) {
      counts.estimate += 1;
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ credits: 40 }), { status: 200 });
    }
    if (u.includes("/api/jobs")) {
      counts.jobs += 1;
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (fail > 0) { fail -= 1; throw new Error("network"); }
      return new Response(JSON.stringify({ jobId: "job-1" }), { status: 202 });
    }
    throw new Error("unexpected " + u);
  }));
  return { counts, bodies };
}

// A Generator run-mintája (ugyanaz a sorrend, mint a page-ben)
async function generatorStartOnce(guard: ReturnType<typeof createSubmitGuard>, tracker: ReturnType<typeof createAttemptTracker>) {
  return withSubmitGuard(guard, async () => {
    await Promise.resolve();                       // token lekérés helye
    await fetch("/api/jobs/estimate", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return startJobWithTracker({ tracker, fetchImpl: fetch, token: "t", body: { type: "image_generation", payload: {} } });
  });
}

describe("UI indítási minta – szinkron duplaindítás", () => {
  it("két SZINKRON Generator start → pontosan 1 estimate és 1 /api/jobs POST", async () => {
    const { counts } = spyRoutes();
    const guard = createSubmitGuard();
    const t1 = createAttemptTracker(() => "g1");
    const t2 = createAttemptTracker(() => "g2");
    const a = generatorStartOnce(guard, t1);
    const b = await generatorStartOnce(guard, t2);   // még az első await előtt érkezik
    await a;
    expect("skipped" in (b as object) ? (b as { skipped: true }).skipped : false).toBe(true);
    expect(counts.estimate).toBe(1);
    expect(counts.jobs).toBe(1);
  });

  it("két szinkron Tools/I2V run → 1 estimate + 1 job (eszközönkénti guard)", async () => {
    const { counts } = spyRoutes();
    const guard = createSubmitGuard();
    const t = createAttemptTracker(() => "i1");
    const run = () => withSubmitGuard(guard, async () => {
      await fetch("/api/jobs/estimate", { method: "POST", headers: {}, body: "{}" });
      return startJobWithTracker({ tracker: t, fetchImpl: fetch, token: "t", body: { type: "video_from_image", payload: {} } });
    });
    const a = run();
    const b = await run();
    await a;
    expect((b as { skipped?: true }).skipped).toBe(true);
    expect(counts.estimate).toBe(1);
    expect(counts.jobs).toBe(1);
  });

  it("biztos HTTP-válasz után a retry ÚJ kulcsot kap; hálózati újraküldés AZONOSAT", async () => {
    const { bodies } = spyRoutes({ failJobOnce: true });
    const guard = createSubmitGuard();
    let n = 0;
    const tracker1 = createAttemptTracker(() => `r${++n}`);
    // első attempt: hálózati hiba → AZONOS kulcs újraküldve
    const first = await generatorStartOnce(guard, tracker1);
    expect((first as { ok: boolean }).ok).toBe(true);
    // retry: guard feloldva (finally) → új tracker = új kulcs
    const tracker2 = createAttemptTracker(() => `r${++n}`);
    const second = await generatorStartOnce(guard, tracker2);
    expect((second as { idempotencyKey: string }).idempotencyKey).toBe("r2");
    const jobBodies = bodies.filter((b) => b.type !== undefined || b.idempotencyKey !== undefined);
    const keys = jobBodies.filter((b) => "idempotencyKey" in b).map((b) => b.idempotencyKey);
    expect(keys[0]).toBe("r1");          // első attempt + az újraküldés ugyanaz
    expect(keys[1]).toBe("r1");          // AZONOS kulcs a hálózati újraküldésben
    expect(keys[2]).toBe("r2");          // retry új kulcs
  });

  it("hiba esetén is felold a guard (finally) – a következő attempt mehet", async () => {
    const { counts } = spyRoutes();
    const guard = createSubmitGuard();
    await withSubmitGuard(guard, async () => { throw new Error("x"); }).catch(() => {});
    const t = createAttemptTracker(() => "z1");
    await generatorStartOnce(guard, t);
    expect(counts.jobs).toBe(1);
  });
});
