import { afterEach, describe, expect, it, vi } from "vitest";

import { TokenBucketRateLimiter, loadRateLimitConfig, normalizeRateLimitConfig } from "../../../js/agents/llm/rate-limit.js";

import { createFakeTime, createMockStorage } from "./vitest-utils.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agents/llm/rate-limit", () => {
  it("normalizes rate limit config (defaults + clamping + fallback)", () => {
    expect(normalizeRateLimitConfig({ enabled: false, rps: 5, burst: 3, concurrency: 2, maxQueue: 0 })).toEqual({
      enabled: false,
      rps: 5,
      burst: 3,
      concurrency: 2,
      maxQueue: 0,
    });

    // rps<=0 => Infinity; burst/concurrency clamp to >=1; maxQueue<0 => default 500.
    expect(normalizeRateLimitConfig({ rps: 0, burst: 0, concurrency: 0, maxQueue: -1 })).toEqual({
      enabled: true,
      rps: Infinity,
      burst: 1,
      concurrency: 1,
      maxQueue: 500,
    });

    // Fallback merges, and `enabled` defaults to true when absent.
    expect(normalizeRateLimitConfig({}, { enabled: false, rps: 9, burst: 2, concurrency: 4, maxQueue: 10 })).toEqual({
      enabled: false,
      rps: 9,
      burst: 2,
      concurrency: 4,
      maxQueue: 10,
    });
  });

  it("loads config from storage and handles bad/empty JSON safely", () => {
    const defaults = loadRateLimitConfig();
    expect(defaults.enabled).toBe(true);
    expect(typeof defaults.rps).toBe("number");
    expect(defaults.burst).toBeGreaterThanOrEqual(1);
    expect(defaults.concurrency).toBeGreaterThanOrEqual(1);

    const { store, storage } = createMockStorage();
    store.set("k", JSON.stringify({ enabled: false, rps: 10, burst: 2, concurrency: 3, maxQueue: 4 }));
    expect(loadRateLimitConfig({ storageKey: "k", storage })).toEqual({
      enabled: false,
      rps: 10,
      burst: 2,
      concurrency: 3,
      maxQueue: 4,
    });

    store.set("bad", "{not-json");
    const parsedBad = loadRateLimitConfig({ storageKey: "bad", storage });
    expect(parsedBad).toMatchObject({ enabled: true });
  });

  it("schedule() validates input and aborts early when signal already aborted", async () => {
    const time = createFakeTime(0);
    const limiter = new TokenBucketRateLimiter({ rps: Infinity, burst: 1, concurrency: 1, time });

    // execute must be a function
    // @ts-expect-error: invalid input for test
    await expect(limiter.schedule(null)).rejects.toThrow(/execute must be a function/);

    const ac = new AbortController();
    ac.abort();
    await expect(limiter.schedule(() => "x", { signal: ac.signal, label: "t" })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("respects token bucket pacing (rps + burst)", async () => {
    const time = createFakeTime(0);
    const limiter = new TokenBucketRateLimiter({ rps: 2, burst: 2, concurrency: 1, time });

    const starts = [];
    const mk = (id) =>
      limiter.schedule(async () => {
        starts.push({ id, t: time.now() });
        return id;
      });

    const out = await Promise.all([mk("a"), mk("b"), mk("c")]);
    expect(out).toEqual(["a", "b", "c"]);
    expect(starts.map((s) => s.t)).toEqual([0, 0, 500]);
  });

  it("enforces concurrency and starts next after in-flight completes", async () => {
    const time = createFakeTime(0);
    const limiter = new TokenBucketRateLimiter({ rps: Infinity, burst: 1, concurrency: 2, time });

    const started = [];
    const gates = new Map();
    const gate = (id) =>
      new Promise((resolve) => {
        gates.set(id, resolve);
      });

    const p1 = limiter.schedule(async () => {
      started.push("a");
      await gate("a");
      return "a";
    });
    const p2 = limiter.schedule(async () => {
      started.push("b");
      await gate("b");
      return "b";
    });
    const p3 = limiter.schedule(async () => {
      started.push("c");
      return "c";
    });

    await Promise.resolve();
    expect(started).toEqual(["a", "b"]);

    gates.get("a")?.();
    await p1;
    await Promise.resolve();
    expect(started).toEqual(["a", "b", "c"]);

    gates.get("b")?.();
    expect(await p2).toBe("b");
    expect(await p3).toBe("c");
  });

  it("rejects queued work on abort without running execute()", async () => {
    const time = createFakeTime(0);
    const limiter = new TokenBucketRateLimiter({ rps: Infinity, burst: 1, concurrency: 1, time });

    let release = null;
    const hold = new Promise((resolve) => {
      release = resolve;
    });

    const p1 = limiter.schedule(async () => {
      await hold;
      return "a";
    });

    const ac = new AbortController();
    const execute = vi.fn(async () => "b");
    const p2 = limiter.schedule(execute, { signal: ac.signal, label: "b" });
    ac.abort();

    await expect(p2).rejects.toMatchObject({ name: "AbortError" });
    expect(execute).not.toHaveBeenCalled();

    release?.();
    expect(await p1).toBe("a");
  });

  it("enforces maxQueue (including maxQueue=0 edge) and blockFor delays execution", async () => {
    const time = createFakeTime(0);
    const limiter = new TokenBucketRateLimiter({ rps: Infinity, burst: 1, concurrency: 1, maxQueue: 0, time });

    let release = null;
    const hold = new Promise((resolve) => {
      release = resolve;
    });

    const p1 = limiter.schedule(async () => {
      await hold;
      return "a";
    });
    const p2 = limiter.schedule(async () => "b");

    // With concurrency=1, p2 remains queued; a third enqueue should fail immediately.
    await expect(limiter.schedule(async () => "c")).rejects.toThrow(/queue full/);

    release?.();
    expect(await p1).toBe("a");
    expect(await p2).toBe("b");

    limiter.blockFor(1000);
    const startedAt = [];
    const out = await limiter.schedule(() => {
      startedAt.push(time.now());
      return "ok";
    });
    expect(out).toBe("ok");
    expect(startedAt).toEqual([1000]);
  });

  it("getState() exposes internal counters for observability", async () => {
    const time = createFakeTime(123);
    const limiter = new TokenBucketRateLimiter({ rps: 3, burst: 2, concurrency: 1, maxQueue: 5, time });

    const s1 = limiter.getState();
    expect(s1).toMatchObject({ rps: 3, burst: 2, concurrency: 1, maxQueue: 5, inFlight: 0, queueSize: 0, nowMs: 123 });

    const p = limiter.schedule(async () => "x");
    await p;

    const s2 = limiter.getState();
    expect(s2.inFlight).toBe(0);
    expect(s2.queueSize).toBe(0);
  });

  it("covers internal pump helpers: requestPumpSoon microtask + pumpRequested flush + shiftRunnable edge cases", async () => {
    // Custom time where sleep is controllable so we can trigger the `_pumpRequested` flush path.
    let nowMs = 0;
    let unblock = null;
    const time = {
      now: () => nowMs,
      sleep: (ms) =>
        new Promise((resolve) => {
          unblock = () => {
            nowMs += Math.max(0, Math.floor(ms || 0));
            resolve();
          };
        }),
    };

    const limiter = new TokenBucketRateLimiter({ rps: Infinity, burst: 1, concurrency: 1, time });

    // Ensure the queue is blocked so `_pump()` awaits sleep.
    limiter.blockFor(1000);
    const p = limiter.schedule(async () => "ok");

    // Let pump start and reach the awaited sleep.
    await Promise.resolve();

    // While pumping, _requestPump() should set `_pumpRequested=true`.
    limiter._requestPump();
    expect(limiter._pumpRequested).toBe(true);

    // Unblock sleep -> pump should finish and schedule a microtask via _requestPumpSoon.
    unblock?.();
    expect(await p).toBe("ok");
    await Promise.resolve();

    // Directly exercise _shiftRunnable skip paths.
    const reject = vi.fn();
    limiter._queue.push(null);
    limiter._queue.push({ settled: () => true });
    limiter._queue.push({ settled: () => false, canceled: true });
    limiter._queue.push({
      settled: () => false,
      canceled: false,
      label: "x",
      signal: { aborted: true },
      reject,
    });

    const shifted = limiter._shiftRunnable();
    expect(shifted).toBe(null);
    expect(reject).toHaveBeenCalled();
    expect(reject.mock.calls[0][0]).toMatchObject({ name: "AbortError" });
  });

  it("uses defaultTime() when no time is provided, and logs pump errors when _pump() throws", async () => {
    const limiter = new TokenBucketRateLimiter({ rps: Infinity, burst: 1, concurrency: 1 });

    // defaultTime.now and defaultTime.sleep
    const s = limiter.getState();
    expect(typeof s.nowMs).toBe("number");
    await limiter._time.sleep(0);

    // Force _requestPump() to hit the `.catch()` handler.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    limiter._pump = vi.fn(async () => {
      throw new Error("boom");
    });
    limiter._requestPump();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
  });

  it("settle guards prevent double-resolve/double-reject when manipulating queue items", async () => {
    const time = createFakeTime(0);
    const limiter = new TokenBucketRateLimiter({ rps: Infinity, burst: 1, concurrency: 1, time });

    // Keep pump disabled so the queued item is not consumed.
    limiter._pumping = true;
    const p = limiter.schedule(async () => "ignored");

    const item = limiter._queue[0];
    item.resolve("a");
    item.resolve("b"); // should be ignored (covers the settled-guard)
    await expect(p).resolves.toBe("a");

    // Similar guard for reject.
    const p2 = limiter.schedule(async () => "ignored-2");
    const item2 = limiter._queue[1];
    item2.reject(new Error("x"));
    item2.reject(new Error("y"));
    await expect(p2).rejects.toThrow(/x/);
  });

  it("loadRateLimitConfig: non-storage input and throwing getItem() return defaults", () => {
    expect(loadRateLimitConfig({ storage: { nope: true } })).toMatchObject({ enabled: true });

    const storage = {
      getItem() {
        throw new Error("boom");
      },
      setItem() {},
    };
    expect(loadRateLimitConfig({ storageKey: "k", storage })).toMatchObject({ enabled: true });
  });

  it("blockFor ignores invalid ms and msUntilToken handles common edge cases", async () => {
    const time = createFakeTime(0);
    const limiter = new TokenBucketRateLimiter({ rps: 2, burst: 1, concurrency: 1, time });

    limiter.blockFor(0);
    limiter.blockFor(-1);
    limiter.blockFor(Number.NaN);
    expect(limiter.getState().blockedUntilMs).toBe(0);

    // Force msUntilToken branches.
    limiter._tokens = 1;
    expect(limiter._msUntilToken(time.now())).toBe(0);
    limiter._tokens = 0;
    expect(limiter._msUntilToken(time.now())).toBe(500);

    const limiter2 = new TokenBucketRateLimiter({ rps: Infinity, burst: 1, concurrency: 1, time });
    limiter2._tokens = 0;
    expect(limiter2._msUntilToken(time.now())).toBe(0);
  });

  it("_pump() returns early when already pumping (sets _pumpRequested)", async () => {
    const time = createFakeTime(0);
    const limiter = new TokenBucketRateLimiter({ rps: Infinity, burst: 1, concurrency: 1, time });
    limiter._pumping = true;
    await limiter._pump();
    expect(limiter._pumpRequested).toBe(true);
  });
});
