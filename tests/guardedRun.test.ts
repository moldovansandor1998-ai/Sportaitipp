// A UI-folyamatok állapotkezelése (guardedRun): token/estimate/JSON/fetch hiba → busy visszaáll,
// szabályozott üzenet, a következő attempt mehet, nincs unhandled rejection.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createSubmitGuard } from "@/lib/jobs/submitGuard";
import { guardedRun } from "@/lib/jobs/guardedRun";
import { createAttemptTracker } from "@/lib/jobs/attemptKey";
import { startJobWithTracker } from "@/lib/jobs/startJob";

afterEach(() => vi.unstubAllGlobals());

function state() {
  return { busy: false as boolean, errors: [] as string[], jobs: 0, estimates: 0 };
}

describe("guardedRun – busy/busyKey helyreállítás minden hibaágon", () => {
  it("Generator: token() dob → busy false, szabályozott üzenet, nincs rejection", async () => {
    const st = state();
    const res = await guardedRun({
      guard: createSubmitGuard(),
      setBusy: (b) => { st.busy = b; },
      onError: (m) => st.errors.push(m),
      fn: async () => { throw new Error("token failed"); },   // token hiba az fn elején
    });
    expect(res).toMatchObject({ ok: false, error: "token failed" });
    expect(st.busy).toBe(false);
    expect(st.errors).toEqual(["token failed"]);
  });

  it("Generator: váratlan fetchhiba → busy false, következő attempt sikeres (guard feloldva)", async () => {
    const st = state();
    // MINDEN fetch mockolva – a teszt nem függ DNS-től/hálózattól (v0.5.5 timeout javítva)
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch failed"); }));
    const guard = createSubmitGuard();
    const first = await guardedRun({
      guard, setBusy: (b) => { st.busy = b; }, onError: (m) => st.errors.push(m),
      fn: async () => { await fetch("http://x/api/jobs"); return null; },   // fetch dob
    });
    expect("ok" in first && first.ok === false).toBe(true);
    expect(st.busy).toBe(false);
    expect(st.errors[0]).toContain("fetch");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ jobId: "j" }), { status: 202 })));
    const second = await guardedRun({
      guard, setBusy: (b) => { st.busy = b; }, onError: (m) => st.errors.push(m),
      fn: () => startJobWithTracker({ tracker: createAttemptTracker(() => "a2"), fetchImpl: fetch, token: "t", body: { type: "image_generation", payload: {} } }),
    });
    expect("ok" in second && second.ok === true).toBe(true);
  });

  it("Tools: estimate fetch dob → busyKey null, job POST nem történt", async () => {
    const st = state();
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).includes("estimate")) throw new Error("estimate net");
      st.jobs += 1;
      return new Response("{}", { status: 202 });
    }));
    const res = await guardedRun({
      guard: createSubmitGuard(),
      setBusy: (b) => { st.busy = b; },
      onError: (m) => st.errors.push(m),
      fn: async () => {
        await fetch("/api/jobs/estimate", { method: "POST" });   // dob
        st.jobs += 1;
        return null;
      },
    });
    expect("ok" in res && res.ok === false).toBe(true);
    expect(st.busy).toBe(false);
    expect(st.errors[0]).toContain("estimate net");
    expect(st.jobs).toBe(0);                 // a job POST-ig nem jutott el
  });

  it("Tools: hibás estimate JSON → busyKey null, job nem indult", async () => {
    const st = state();
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).includes("estimate")) return new Response("not-json{{", { status: 200 });
      st.jobs += 1;
      return new Response("{}", { status: 202 });
    }));
    const res = await guardedRun({
      guard: createSubmitGuard(),
      setBusy: (b) => { st.busy = b; },
      onError: (m) => st.errors.push(m),
      fn: async () => {
        const est = await fetch("/api/jobs/estimate", { method: "POST" });
        const body = await est.json().catch(() => { throw new Error("Árbecslés-válasz feldolgozása sikertelen."); });
        const price = (body as { credits?: number }).credits;
        if (typeof price !== "number") throw new Error("Árbecslés-válasz érvénytelen.");
        st.jobs += 1;
        return null;
      },
    });
    expect("ok" in res && res.ok === false).toBe(true);
    expect(st.busy).toBe(false);
    expect(st.jobs).toBe(0);
    expect(st.errors[0]).toContain("Árbecslés");
  });

  it("Tools: job fetch kétszer elbukik → busyKey null, következő attempt mehet", async () => {
    const st = state();
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { attempts += 1; throw new Error("down " + attempts); }));
    const guard = createSubmitGuard();
    const first = await guardedRun({
      guard, setBusy: (b) => { st.busy = b; }, onError: (m) => st.errors.push(m),
      fn: async () => {
        const result = await startJobWithTracker({ tracker: createAttemptTracker(() => "b1"), fetchImpl: fetch, token: "t", body: { type: "tts", payload: {} } });
        if ("skipped" in result) throw new Error("fut");
        if (!result.ok) throw new Error(result.error ?? "job failed");   // a UI így dob tovább
        return result;
      },
    });
    expect("ok" in first && first.ok === false).toBe(true);
    expect(st.busy).toBe(false);
    expect(attempts).toBe(2);                 // eredeti + AZONOS kulcsú újraküldés
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ jobId: "j2" }), { status: 202 })));
    const second = await guardedRun({
      guard, setBusy: (b) => { st.busy = b; }, onError: (m) => st.errors.push(m),
      fn: () => startJobWithTracker({ tracker: createAttemptTracker(() => "b2"), fetchImpl: fetch, token: "t", body: { type: "tts", payload: {} } }),
    });
    expect("ok" in second && second.ok === true).toBe(true);
  });

  it("sikeres futás: busy true→false, guard felold, érték visszaadva", async () => {
    const st = state();
    const seenBusy: boolean[] = [];
    const res = await guardedRun({
      guard: createSubmitGuard(),
      setBusy: (b) => { seenBusy.push(b); st.busy = b; },
      onError: (m) => st.errors.push(m),
      fn: async () => 42,
    });
    expect(res).toEqual({ ok: true, value: 42 });
    expect(seenBusy).toEqual([true, false]);
    expect(st.errors).toEqual([]);
  });
});
