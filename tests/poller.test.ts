import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JobPoller, TERMINAL_STATUSES } from "@/lib/jobs/poller";

describe("JobPoller életciklus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const opts = { intervalMs: 100, maxAttempts: 5, maxConsecutiveErrors: 2,
    isTerminal: (s: string) => TERMINAL_STATUSES.includes(s) };

  it("terminal státusznál leáll és nincs további callback", async () => {
    const p = new JobPoller(opts);
    const updates: string[] = [];
    const seq = ["queued", "processing", "completed"];
    let i = 0;
    p.start("j1", async () => ({ status: seq[Math.min(i++, seq.length - 1)] }), (_id, s) => updates.push(s));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(updates).toContain("completed");
    const countAfter = updates.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(updates.length).toBe(countAfter);   // terminal után NINCS több hívás
    expect(p.activeCount()).toBe(0);           // interval leállt
  });

  it("stopAll (unmount) minden jobot leállít", async () => {
    const p = new JobPoller(opts);
    const cb = vi.fn();
    p.start("a", async () => ({ status: "queued" }), cb);
    p.start("b", async () => ({ status: "queued" }), cb);
    await vi.advanceTimersByTimeAsync(0);
    expect(p.activeCount()).toBe(2);
    p.stopAll();                                // unmount
    expect(p.activeCount()).toBe(0);
    const n = cb.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb.mock.calls.length).toBe(n);       // unmount után nincs update
  });

  it("max attempts után leáll (timeout-védelem)", async () => {
    const p = new JobPoller({ ...opts, maxAttempts: 3 });
    const cb = vi.fn();
    p.start("t", async () => ({ status: "processing" }), cb);
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.activeCount()).toBe(0);            // ~3 kísérlet után leállt
    const n = cb.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb.mock.calls.length).toBe(n);
  });

  it("hálózati hibák sorozata után leáll (végtelen polling nincs)", async () => {
    const p = new JobPoller(opts);
    const cb = vi.fn();
    p.start("e", async () => { throw new Error("net"); }, cb);
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.activeCount()).toBe(0);
    expect(cb).not.toHaveBeenCalled();
  });

  it("több job PÁRHUZAMOSAN megy, az egyik terminalja a másikat nem állítja le", async () => {
    const p = new JobPoller(opts);
    const done: string[] = [];
    p.start("x", async () => ({ status: "completed" }), (id) => done.push(id));
    p.start("y", async () => ({ status: "processing" }), () => {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toContain("x");
    expect(p.activeCount()).toBe(1);            // y tovább fut
    p.stopAll();
  });

  it("stop terminal előtt: a folyamatban lévő fetch eredménye NEM hív onUpdate-et", async () => {
    const p = new JobPoller(opts);
    const cb = vi.fn();
    let resolveFetch: ((v: { status: string }) => void) | null = null;
    p.start("s1", () => new Promise((res) => { resolveFetch = res; }), cb);
    await vi.advanceTimersByTimeAsync(0);          // fetch elindult (inFlight)
    p.stop("s1");                                   // stop a fetch ELŐTT
    resolveFetch!({ status: "completed" });
    await vi.advanceTimersByTimeAsync(50);
    expect(cb).not.toHaveBeenCalled();              // elvetett eredmény
  });

  it("lassú fetch hosszabb, mint az interval – nem indul párhuzamos fetch", async () => {
    const p = new JobPoller({ ...opts, intervalMs: 50 });
    const fetches: string[] = [];
    let release: (() => void) | null = null;
    p.start("slow", () => {
      fetches.push("call");
      return new Promise((res) => { release = () => res({ status: "processing" }); });
    }, () => {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(200);         // több interval is elmegy a fetch alatt
    expect(fetches).toHaveLength(1);                // CSAK egy fetch fut
    expect(p.isInFlight("slow")).toBe(true);
    release!();
    await vi.advanceTimersByTimeAsync(100);
    p.stopAll();
  });

  it("stopAll után feloldódó Promise NEM hív callbacket", async () => {
    const p = new JobPoller(opts);
    const cb = vi.fn();
    let resolveFetch: ((v: { status: string }) => void) | null = null;
    p.start("u1", () => new Promise((res) => { resolveFetch = res; }), cb);
    await vi.advanceTimersByTimeAsync(0);
    p.stopAll();                                    // unmount
    resolveFetch!({ status: "completed" });
    await vi.advanceTimersByTimeAsync(50);
    expect(cb).not.toHaveBeenCalled();
    expect(p.activeCount()).toBe(0);
  });

  it("dupla start ugyanazon jobra nem indul újra", async () => {
    const p = new JobPoller(opts);
    const cb = vi.fn();
    p.start("d", async () => ({ status: "queued" }), cb);
    p.start("d", async () => ({ status: "queued" }), cb);
    await vi.advanceTimersByTimeAsync(300);
    p.stopAll();
    expect(cb.mock.calls.length).toBeLessThanOrEqual(4);   // 1 interval, nem 2
  });
});
