import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EmbeddingService,
  createEmbeddingService,
  normalizeEmbeddingConfig,
} from '../../../../js/agents/shared/embeddings/embedding-service.js';
import { VectorIndex } from '../../../../js/agents/shared/embeddings/vector-index.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shared/embeddings/vector-index", () => {
  it("upsert: rejects invalid ids/vectors and enforces dimension consistency", () => {
    const index = new VectorIndex({ maxItems: 10 });

    expect(index.upsert("", [1, 0])).toBe(false);
    expect(index.upsert("a", null)).toBe(false);
    expect(index.upsert("a", [])).toBe(false);
    expect(index.upsert("a", [0, 0])).toBe(false);
    // Note: NaN is coerced to 0 by the implementation (via `v || 0`), so use Infinity here.
    expect(index.upsert("a", [Infinity, 1])).toBe(false);

    expect(index.upsert("a", [1, 0], { tag: "a" })).toBe(true);
    expect(index.dimension).toBe(2);

    expect(() => index.upsert("b", [1, 0, 0])).toThrow(/dimension mismatch/);
  });

  it("has/delete/clear: supports typed vectors and evicts oldest when maxItems exceeded", () => {
    const index = new VectorIndex({ maxItems: 2 });

    expect(index.has(null)).toBe(false);
    expect(index.delete("")).toBe(false);

    // ArrayBuffer.isView path (non-Float32 view, but byte-compatible with Float32Array)
    expect(index.upsert("a", new Uint8Array(new Float32Array([1, 0]).buffer))).toBe(true);
    // ArrayBuffer path
    expect(index.upsert("b", new Float32Array([0, 1]).buffer)).toBe(true);

    expect(index.size).toBe(2);
    expect(index.has("a")).toBe(true);

    // Evict oldest ("a")
    expect(index.upsert("c", [1, 0])).toBe(true);
    expect(index.size).toBe(2);
    expect(index.has("a")).toBe(false);
    expect(index.has("b")).toBe(true);
    expect(index.has("c")).toBe(true);

    expect(index.delete("b")).toBe(true);
    expect(index.size).toBe(1);

    index.clear();
    expect(index.size).toBe(0);
    expect(index.dimension).toBe(null);
  });

  it("search: returns [] for empty index / invalid query / dimension mismatch", () => {
    const index = new VectorIndex();
    expect(index.search([1, 0])).toEqual([]);

    index.upsert("a", [1, 0]);
    expect(index.search([0, 0])).toEqual([]); // cannot normalize query
    expect(index.search([1, 0, 0])).toEqual([]); // dim mismatch
  });

  it("search: treats NaN Date.now() as 'cold' for partition classification", () => {
    vi.spyOn(Date, "now").mockReturnValue(Number.NaN);
    const index = new VectorIndex();
    index.upsert("a", [1, 0], { ts: 123 });
    index.upsert("b", [1, 0], { ts: "not-finite" });

    // When `now` is not finite, everything is classified as "cold".
    const hits = index.search([1, 0], { partitions: "cold" });
    expect(hits).toHaveLength(2);
  });

  it("search: supports minScore/predicate filtering and safe partition filtering", () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const index = new VectorIndex({ maxItems: 10 });

    // hot/warm/cold partitioning based on meta.ts
    index.upsert("hot", [1, 0], { ts: now - 10 * 60 * 1000, kind: "k1" }); // 10 min ago
    index.upsert("warm", [1, 0], { ts: now - 2 * 60 * 60 * 1000, kind: "k1" }); // 2h ago
    index.upsert("cold", [1, 0], { ts: now - 3 * 24 * 60 * 60 * 1000, kind: "k2" }); // 3d ago

    // Non-positive topK is normalized to a sane default (toPositiveInt fallback).
    expect(index.search([1, 0], { topK: 0 })).toHaveLength(3);

    // minScore filters out the weaker match
    const minScoreHits = index.search([1, 0], { topK: 3, minScore: 0.999 });
    expect(minScoreHits.map((h) => h.id)).toContain("hot");

    // predicate filter keeps only kind==="k2"
    const predicateHits = index.search([1, 0], { filter: (meta) => meta?.kind === "k2" });
    expect(predicateHits.map((h) => h.id)).toEqual(["cold"]);

    // partitions: string -> Set([string])
    const hotOnly = index.search([1, 0], { partitions: "hot" });
    expect(hotOnly.map((h) => h.id)).toEqual(["hot"]);

    // partitions: array -> Set([...])
    const warmOrCold = index.search([1, 0], { partitions: ["warm", "cold"] });
    expect(new Set(warmOrCold.map((h) => h.id))).toEqual(new Set(["warm", "cold"]));

    // partitions: invalid value -> treated as no partition filter
    const noFilter = index.search([1, 0], { partitions: 123 });
    expect(noFilter.length).toBe(3);
  });

  it("getPartitionStats: returns totals using classifyPartition fallbacks", () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const index = new VectorIndex({ maxItems: 10 });
    index.upsert("a", [1, 0], { ts: now - 1 }); // hot
    index.upsert("b", [1, 0], { ts: now - 2 * 60 * 60 * 1000 }); // warm
    index.upsert("c", [1, 0], { ts: "not-a-number" }); // cold (invalid ts)

    expect(index.getPartitionStats()).toEqual({ hot: 1, warm: 1, cold: 1, total: 3 });
  });
});

describe("shared/embeddings/embedding-service", () => {
  it("normalizeEmbeddingConfig: rejects invalid/disabled configs", () => {
    expect(normalizeEmbeddingConfig(null)).toBe(null);
    expect(normalizeEmbeddingConfig("nope")).toBe(null);
    expect(normalizeEmbeddingConfig({})).toBe(null);
    expect(normalizeEmbeddingConfig({ endpoint: "https://example.test", enabled: false })).toBe(null);
  });

  it("normalizeEmbeddingConfig: accepts url/baseUrl and sanitizes headers", () => {
    const cfg = normalizeEmbeddingConfig({
      url: " https://example.test/v1/embeddings ",
      model: " m ",
      apiKey: " k ",
      headers: { "X-Test": 1, "   ": "ignored", authorization: "Bearer preset" },
      timeoutMs: "10",
      batchSize: "7",
      flushIntervalMs: "0",
      maxQueue: "9",
      cooldownMs: "123",
    });

    expect(cfg).toEqual({
      endpoint: "https://example.test/v1/embeddings",
      model: "m",
      apiKey: "k",
      headers: { "X-Test": "1", authorization: "Bearer preset" },
      timeoutMs: 10,
      batchSize: 7,
      flushIntervalMs: 0,
      maxQueue: 9,
      cooldownMs: 123,
    });
  });

  it("embed/enqueue: filters empty inputs and resolves [] without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const svc = new EmbeddingService(
      { endpoint: "https://example.test/v1/embeddings", model: "m", flushIntervalMs: 0, timeoutMs: 100, cooldownMs: 1000 },
      { fetchImpl }
    );

    await expect(svc.embed(["", "  ", "\n"])).resolves.toEqual([]);
    await expect(svc.embed("")).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("callEmbeddings: attaches Authorization header unless already provided", async () => {
    /** @type {any[]} */
    const calls = [];

    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ headers: init.headers, body });
      return {
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: [1, 2] }] }),
      };
    });

    const svc1 = new EmbeddingService(
      {
        endpoint: "https://example.test/v1/embeddings",
        model: null,
        apiKey: "k",
        headers: { "X-Test": "1" },
        flushIntervalMs: 0,
        timeoutMs: 100,
        cooldownMs: 1000,
      },
      { fetchImpl }
    );

    await expect(svc1._callEmbeddings(["a"])).resolves.toHaveLength(1);
    expect(calls[0].headers).toMatchObject({ Authorization: "Bearer k" });
    expect(calls[0].body).toEqual({ input: ["a"] });

    const svc2 = new EmbeddingService(
      {
        endpoint: "https://example.test/v1/embeddings",
        model: "m",
        apiKey: "k",
        headers: { authorization: "Bearer preset" },
        flushIntervalMs: 0,
        timeoutMs: 100,
        cooldownMs: 1000,
      },
      { fetchImpl }
    );

    await expect(svc2._callEmbeddings(["a"])).resolves.toHaveLength(1);
    expect(calls[1].headers.authorization).toBe("Bearer preset");
    expect(calls[1].headers.Authorization).toBeUndefined();
    expect(calls[1].body).toEqual({ model: "m", input: ["a"] });
  });

  it("callEmbeddings: normalizes multiple response shapes and sorts by index", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      const inputs = body.input;

      // Return out-of-order indices to ensure sorting is applied.
      if (inputs.length === 2) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { index: 1, embedding: [2] },
              { index: 0, embedding: [1] },
            ],
          }),
        };
      }

      // Single input: alternate shape.
      return { ok: true, json: async () => ({ embedding: [3] }) };
    });

    const svc = new EmbeddingService(
      { endpoint: "https://example.test/v1/embeddings", model: null, flushIntervalMs: 0, timeoutMs: 100, cooldownMs: 1000 },
      { fetchImpl }
    );

    const r1 = await svc._callEmbeddings(["a", "bb"]);
    expect(r1?.map((v) => v[0])).toEqual([1, 2]);

    const r2 = await svc._callEmbeddings(["ccc"]);
    expect(r2?.map((v) => v[0])).toEqual([3]);
  });

  it("callEmbeddings: marks failure on count mismatch and respects cooldown before retry", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    const fetchImpl = vi.fn(async () => {
      return { ok: true, json: async () => ({ data: [{ index: 0, embedding: [1] }] }) };
    });

    const svc = new EmbeddingService(
      { endpoint: "https://example.test/v1/embeddings", model: null, flushIntervalMs: 0, timeoutMs: 100, cooldownMs: 500 },
      { fetchImpl }
    );

    // Expecting 2 embeddings but get 1 -> normalizeEmbeddingResponse() fails -> markFailure().
    await expect(svc._callEmbeddings(["a", "b"])).resolves.toBeNull();
    const s1 = svc.getStatus();
    expect(s1.failures).toBe(1);
    expect(s1.available).toBe(false);

    // Before cooldown elapses, _canAttemptNow() short-circuits without calling fetch.
    await expect(svc._callEmbeddings(["c"])).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 500;
    fetchImpl.mockResolvedValueOnce({ ok: true, json: async () => ({ vector: [9] }) });
    const r = await svc._callEmbeddings(["d"]);
    expect(r?.[0][0]).toBe(9);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(svc.getStatus().available).toBe(true);
  });

  it("flush: splits a single request across multiple batches and resolves in-order vectors", async () => {
    /** @type {string[][]} */
    const inputsPerCall = [];

    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      const inputs = Array.isArray(body.input) ? body.input : [];
      inputsPerCall.push(inputs);

      return {
        ok: true,
        json: async () => ({
          data: inputs.map((t, index) => ({ index, embedding: [String(t).length] })),
        }),
      };
    });

    const svc = new EmbeddingService(
      {
        endpoint: "https://example.test/v1/embeddings",
        model: "m",
        flushIntervalMs: 9999,
        batchSize: 2,
        timeoutMs: 100,
        cooldownMs: 1000,
      },
      { fetchImpl }
    );

    const p = svc.enqueue(["a", "bb", "ccc"]);
    await expect(svc.flush()).resolves.toBe(true);
    const out = await p;
    expect(out?.map((v) => v[0])).toEqual([1, 2, 3]);
    expect(inputsPerCall).toEqual([["a", "bb"], ["ccc"]]);
  });

  it("scheduleFlush: delay>0 uses setTimeout and eventually flushes the queue", async () => {
    vi.useFakeTimers();

    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      const inputs = Array.isArray(body.input) ? body.input : [];
      return {
        ok: true,
        json: async () => ({
          data: inputs.map((t, index) => ({ index, embedding: [String(t).length] })),
        }),
      };
    });

    const svc = new EmbeddingService(
      { endpoint: "https://example.test/v1/embeddings", model: null, flushIntervalMs: 10, timeoutMs: 100, cooldownMs: 1000 },
      { fetchImpl }
    );

    const p = svc.enqueue(["a"], { immediate: false });
    expect(fetchImpl).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("embed: returns null on wrapper timeout when enqueue does not settle in time", async () => {
    vi.useFakeTimers();

    const svc = new EmbeddingService(
      { endpoint: "https://example.test/v1/embeddings", model: null, flushIntervalMs: 0, timeoutMs: 100, cooldownMs: 1000 },
      { fetchImpl: vi.fn() }
    );

    // Stub enqueue() to simulate a slow provider without involving the full flush machinery.
    svc.enqueue = vi.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([new Float32Array([1])]), 100);
        })
    );

    const p = svc.embed(["a"], { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    await expect(p).resolves.toBeNull();

    // Let the underlying enqueue() promise resolve so the internal `p.then()` handler
    // runs and hits the "already settled" branch.
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
  });

  it("embed: returns result (and clears wrapper timeout) when request resolves in time", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ embedding: [1] }) }));
    const svc = new EmbeddingService(
      { endpoint: "https://example.test/v1/embeddings", model: null, flushIntervalMs: 0, timeoutMs: 100, cooldownMs: 1000 },
      { fetchImpl }
    );

    const out = await svc.embed(["a"], { timeoutMs: 1000 });
    expect(out).toHaveLength(1);
  });

  it("flush: clears the microtask flush flag (_flushTimer===true) when flushing manually", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ embedding: [1] }) }));
    const svc = new EmbeddingService(
      { endpoint: "https://example.test/v1/embeddings", model: null, flushIntervalMs: 0, timeoutMs: 100, cooldownMs: 1000 },
      { fetchImpl }
    );

    const p = svc.enqueue(["a"], { immediate: true });
    await expect(svc.flush()).resolves.toBe(true);
    await expect(p).resolves.toHaveLength(1);
  });

  it("createEmbeddingService: returns a service instance and disabled services short-circuit", async () => {
    const svc = createEmbeddingService({});
    expect(svc).toBeInstanceOf(EmbeddingService);
    expect(svc.enabled).toBe(false);
    await expect(svc.flush()).resolves.toBe(false);
    await expect(svc.embed(["a"])).resolves.toBeNull();
  });

  it("scheduleFlush: delay<=0 uses microtask (Promise fallback when queueMicrotask is missing)", async () => {
    vi.stubGlobal("queueMicrotask", undefined);

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: [1] }),
    }));

    const svc = new EmbeddingService(
      { endpoint: "https://example.test/v1/embeddings", model: null, flushIntervalMs: 0, timeoutMs: 100, cooldownMs: 1000 },
      { fetchImpl }
    );

    const p = svc.enqueue(["a"], { immediate: false });
    await expect(p).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enqueue: enforces maxQueue and flush cancels a scheduled timer", async () => {
    vi.useFakeTimers();

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: [1] }),
    }));

    const svc = new EmbeddingService(
      {
        endpoint: "https://example.test/v1/embeddings",
        model: null,
        flushIntervalMs: 1000,
        maxQueue: 1,
        timeoutMs: 100,
        cooldownMs: 1000,
      },
      { fetchImpl }
    );

    const p1 = svc.enqueue(["a"], { immediate: false });
    await expect(svc.enqueue(["b"], { immediate: false })).resolves.toBeNull();

    // Manual flush should clear the pending timer and resolve the first request.
    await expect(svc.flush()).resolves.toBe(true);
    await expect(p1).resolves.toHaveLength(1);
  });

  it("flush: concurrent calls share the in-flight promise", async () => {
    /** @type {(value:any)=>void} */
    let resolveFetch;
    const fetchImpl = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const svc = new EmbeddingService(
      { endpoint: "https://example.test/v1/embeddings", model: null, flushIntervalMs: 9999, timeoutMs: 100, cooldownMs: 1000 },
      { fetchImpl }
    );

    const p = svc.enqueue(["a"], { immediate: false });
    const f1 = svc.flush();
    const f2 = svc.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveFetch({ ok: true, json: async () => ({ embedding: [1] }) });

    await expect(Promise.all([f1, f2])).resolves.toEqual([true, true]);
    await expect(p).resolves.toHaveLength(1);
  });

  it("flush: resolves queued requests with null when service is in cooldown", async () => {
    const fetchImpl = vi.fn();
    const svc = new EmbeddingService(
      { endpoint: "https://example.test/v1/embeddings", model: null, flushIntervalMs: 9999, timeoutMs: 100, cooldownMs: 1000 },
      { fetchImpl }
    );

    const p = svc.enqueue(["a"], { immediate: false });
    // Force cooldown after enqueue (enqueue() itself refuses to queue when cooldown is already active).
    svc._available = false;
    svc._nextRetryAt = Date.now() + 10_000;

    await expect(svc.flush()).resolves.toBe(true);
    await expect(p).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("flush: degrades immediately on provider failure and resolves leftovers", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    const svc = new EmbeddingService(
      {
        endpoint: "https://example.test/v1/embeddings",
        model: null,
        flushIntervalMs: 9999,
        batchSize: 2,
        timeoutMs: 100,
        cooldownMs: 1000,
      },
      { fetchImpl }
    );

    const p1 = svc.enqueue(["a", "bb", "ccc"], { immediate: false });
    const p2 = svc.enqueue(["x"], { immediate: false });

    await expect(svc.flush()).resolves.toBe(true);
    await expect(p1).resolves.toBeNull();
    await expect(p2).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("flush: catch handler resolves pending requests when _callEmbeddings throws", async () => {
    const svc = new EmbeddingService(
      // Use a small batch size so the request stays in the queue (partial batch),
      // ensuring the catch handler can drain it.
      { endpoint: "https://example.test/v1/embeddings", model: null, flushIntervalMs: 9999, batchSize: 1, timeoutMs: 100, cooldownMs: 1000 },
      { fetchImpl: vi.fn() }
    );

    const p = svc.enqueue(["a", "b"], { immediate: false });
    svc._callEmbeddings = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(svc.flush()).resolves.toBe(true);
    await expect(p).resolves.toBeNull();
  });

  it("callEmbeddings: covers data/raw arrays + embeddings/vector shapes and expectedCount=1 truncation", async () => {
    const fetchImpl = vi
      .fn()
      // hasIndex=false path: data rows are objects without `index`.
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ embedding: [2] }, { embedding: [1] }] }) })
      // data rows are arrays
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [[3], [4]] }) })
      // embeddings property
      .mockResolvedValueOnce({ ok: true, json: async () => ({ embeddings: [[5]] }) })
      // vector property
      .mockResolvedValueOnce({ ok: true, json: async () => ({ vector: [6] }) })
      // want=1 but provider returns multiple vectors -> truncate to first
      .mockResolvedValueOnce({ ok: true, json: async () => ({ embeddings: [[9], [8]] }) });

    const svc = new EmbeddingService(
      { endpoint: "https://example.test/v1/embeddings", model: null, flushIntervalMs: 0, timeoutMs: 100, cooldownMs: 1000 },
      { fetchImpl }
    );

    await expect(svc._callEmbeddings(["a", "b"])).resolves.toEqual([new Float32Array([2]), new Float32Array([1])]);
    await expect(svc._callEmbeddings(["c", "d"])).resolves.toEqual([new Float32Array([3]), new Float32Array([4])]);
    await expect(svc._callEmbeddings(["e"])).resolves.toEqual([new Float32Array([5])]);
    await expect(svc._callEmbeddings(["f"])).resolves.toEqual([new Float32Array([6])]);
    await expect(svc._callEmbeddings(["g"])).resolves.toEqual([new Float32Array([9])]);
  });

  it("callEmbeddings: marks failure on json parse errors and fetch throws", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => {
        throw new Error("bad json");
      } })
      .mockImplementationOnce(() => {
        throw new Error("network down");
      });

    const svc = new EmbeddingService(
      { endpoint: "https://example.test/v1/embeddings", model: null, flushIntervalMs: 0, timeoutMs: 100, cooldownMs: 1 },
      { fetchImpl }
    );

    await expect(svc._callEmbeddings(["a"])).resolves.toBeNull();
    expect(svc.getStatus().failures).toBe(1);

    // Allow immediate retry via tiny cooldown.
    vi.spyOn(Date, "now").mockReturnValue(svc.getStatus().nextRetryAt + 1);
    await expect(svc._callEmbeddings(["b"])).resolves.toBeNull();
    expect(svc.getStatus().failures).toBe(2);
  });

  it("callEmbeddings: aborts via upstream signal and swallows removeEventListener cleanup errors", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      // Simulate fetch that only completes on abort.
      await new Promise((_, reject) => {
        init.signal?.addEventListener?.(
          "abort",
          () => reject(new Error(String(init.signal?.reason || "aborted"))),
          { once: true }
        );
      });
      return { ok: true, json: async () => ({ embedding: [1] }) };
    });

    const svc = new EmbeddingService(
      { endpoint: "https://example.test/v1/embeddings", model: null, flushIntervalMs: 0, timeoutMs: 100, cooldownMs: 1000 },
      { fetchImpl }
    );

    /** @type {Function|null} */
    let onAbort = null;
    const upstreamSignal = {
      aborted: false,
      reason: "stop",
      addEventListener: (_evt, fn) => {
        onAbort = fn;
      },
      removeEventListener: () => {
        throw new Error("remove failed");
      },
    };

    const p = svc._callEmbeddings(["a"], { signal: upstreamSignal, timeoutMs: 100 });
    onAbort?.();
    await expect(p).resolves.toBeNull();
    expect(svc.getStatus().failures).toBe(1);
  });

  it("callEmbeddings: times out via internal withAbort timer", async () => {
    vi.useFakeTimers();

    const fetchImpl = vi.fn(async (_url, init) => {
      await new Promise((_, reject) => {
        init.signal?.addEventListener?.("abort", () => reject(new Error("aborted")), { once: true });
      });
      return { ok: true, json: async () => ({ embedding: [1] }) };
    });

    const svc = new EmbeddingService(
      { endpoint: "https://example.test/v1/embeddings", model: null, flushIntervalMs: 0, timeoutMs: 1000, cooldownMs: 1000 },
      { fetchImpl }
    );

    const p = svc._callEmbeddings(["a"], { timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toBeNull();
    expect(svc.getStatus().failures).toBe(1);
  });

  it("callEmbeddings: falls back to using the provided signal when AbortController is unavailable", async () => {
    vi.stubGlobal("AbortController", undefined);

    const upstream = {
      aborted: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    let seenSignal = null;
    const fetchImpl = vi.fn(async (_url, init) => {
      seenSignal = init.signal;
      return { ok: true, json: async () => ({ embedding: [1] }) };
    });

    const svc = new EmbeddingService(
      { endpoint: "https://example.test/v1/embeddings", model: null, flushIntervalMs: 0, timeoutMs: 100, cooldownMs: 1000 },
      { fetchImpl }
    );

    await expect(svc._callEmbeddings(["a"], { signal: upstream })).resolves.toHaveLength(1);
    expect(seenSignal).toBe(upstream);
  });
});

// ============================================================================
// normalizeEmbeddingConfig Tests
// ============================================================================

describe("normalizeEmbeddingConfig", () => {
  it("should return null for invalid input", () => {
    expect(normalizeEmbeddingConfig(null)).toBe(null);
    expect(normalizeEmbeddingConfig(undefined)).toBe(null);
    expect(normalizeEmbeddingConfig("string")).toBe(null);
    expect(normalizeEmbeddingConfig(123)).toBe(null);
  });

  it("should return null without endpoint", () => {
    expect(normalizeEmbeddingConfig({})).toBe(null);
    expect(normalizeEmbeddingConfig({ model: "test" })).toBe(null);
  });

  it("should return null when disabled", () => {
    expect(
      normalizeEmbeddingConfig({ endpoint: "http://test", enabled: false })
    ).toBe(null);
  });

  it("should normalize valid config with defaults", () => {
    const cfg = normalizeEmbeddingConfig({ endpoint: "http://test" });
    expect(cfg.endpoint).toBe("http://test");
    expect(cfg.model).toBe(null);
    expect(cfg.apiKey).toBe(null);
    expect(cfg.headers).toStrictEqual({});
    expect(cfg.timeoutMs).toBe(5000);
    expect(cfg.batchSize).toBe(32);
    expect(cfg.flushIntervalMs).toBe(30);
    expect(cfg.maxQueue).toBe(2000);
    expect(cfg.cooldownMs).toBe(300000);
  });

  it("should accept url or baseUrl as endpoint", () => {
    const cfg1 = normalizeEmbeddingConfig({ url: "http://a" });
    const cfg2 = normalizeEmbeddingConfig({ baseUrl: "http://b" });
    expect(cfg1.endpoint).toBe("http://a");
    expect(cfg2.endpoint).toBe("http://b");
  });

  it("should normalize model and apiKey", () => {
    const cfg = normalizeEmbeddingConfig({
      endpoint: "http://test",
      model: "text-embedding-3",
      key: "sk-123",
    });
    expect(cfg.model).toBe("text-embedding-3");
    expect(cfg.apiKey).toBe("sk-123");
  });

  it("should accept apiKey field", () => {
    const cfg = normalizeEmbeddingConfig({
      endpoint: "http://test",
      apiKey: "sk-456",
    });
    expect(cfg.apiKey).toBe("sk-456");
  });

  it("should parse custom headers", () => {
    const cfg = normalizeEmbeddingConfig({
      endpoint: "http://test",
      headers: { "X-Custom": "value", invalid: null },
    });
    expect(cfg.headers["X-Custom"]).toBe("value");
    expect(cfg.headers["invalid"]).toBe("");
  });

  it("should ignore non-object headers", () => {
    const cfg = normalizeEmbeddingConfig({
      endpoint: "http://test",
      headers: "not-an-object",
    });
    expect(cfg.headers).toStrictEqual({});
  });
});

// ============================================================================
// EmbeddingService Tests
// ============================================================================

describe("EmbeddingService", () => {
  describe("constructor and enabled state", () => {
    it("should be disabled without valid config", () => {
      const svc = new EmbeddingService(null);
      expect(svc.enabled).toBe(false);
    });

    it("should be disabled without fetch", () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        { fetchImpl: null }
      );
      expect(svc.enabled).toBe(false);
    });

    it("should be enabled with valid config and fetch", () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        { fetchImpl: () => Promise.resolve({ ok: true, json: () => ({}) }) }
      );
      expect(svc.enabled).toBe(true);
    });
  });

  describe("getStatus", () => {
    it("should return status object", () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test", model: "text-3" },
        { fetchImpl: () => {} }
      );
      const status = svc.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.available).toBe(null);
      expect(status.failures).toBe(0);
      expect(status.endpoint).toBe("http://test");
      expect(status.model).toBe("text-3");
    });

    it("should return null endpoint/model when disabled", () => {
      const svc = new EmbeddingService(null);
      const status = svc.getStatus();
      expect(status.enabled).toBe(false);
      expect(status.endpoint).toBe(null);
      expect(status.model).toBe(null);
    });
  });

  describe("embed with mock API", () => {
    let fetchCalls;

    beforeEach(() => {
      fetchCalls = [];
    });

    function createMockFetch(response) {
      return async (url, options) => {
        fetchCalls.push({ url, options });
        return response;
      };
    }

    it("should return null when disabled", async () => {
      const svc = new EmbeddingService(null);
      const result = await svc.embed("hello");
      expect(result).toBe(null);
    });

    it("should return empty array for empty input", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ data: [{ embedding: [1, 2, 3], index: 0 }] }),
          }),
        }
      );
      const result = await svc.embed([]);
      expect(result).toStrictEqual([]);
      expect(fetchCalls.length).toBe(0);
    });

    it("should filter out empty/whitespace strings", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ data: [{ embedding: [1], index: 0 }] }),
          }),
        }
      );
      const result = await svc.embed(["", "  ", "valid"]);
      expect(result.length).toBe(1);
      const body = JSON.parse(fetchCalls[0].options.body);
      expect(body.input).toStrictEqual(["valid"]);
    });

    it("should call API and return embeddings (OpenAI format)", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test", model: "text-3", apiKey: "sk-test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({
              data: [
                { embedding: [0.1, 0.2, 0.3], index: 0 },
                { embedding: [0.4, 0.5, 0.6], index: 1 },
              ],
            }),
          }),
        }
      );

      const result = await svc.embed(["hello", "world"]);
      expect(result.length).toBe(2);
      expect(result[0]).toBeInstanceOf(Float32Array);
      expect(result[1]).toBeInstanceOf(Float32Array);
      expect(result[0].length).toBe(3);
      expect(Math.abs(result[0][0] - 0.1)).toBeLessThan(0.001);
      expect(Math.abs(result[1][0] - 0.4)).toBeLessThan(0.001);

      expect(fetchCalls.length).toBe(1);
      const body = JSON.parse(fetchCalls[0].options.body);
      expect(body.model).toBe("text-3");
      expect(body.input).toStrictEqual(["hello", "world"]);
      expect(fetchCalls[0].options.headers.Authorization).toContain("sk-test");
    });

    it("should handle unordered index in response", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({
              data: [
                { embedding: [0.4, 0.5, 0.6], index: 1 },
                { embedding: [0.1, 0.2, 0.3], index: 0 },
              ],
            }),
          }),
        }
      );

      const result = await svc.embed(["a", "b"]);
      expect(Math.abs(result[0][0] - 0.1)).toBeLessThan(0.001);
      expect(Math.abs(result[1][0] - 0.4)).toBeLessThan(0.001);
    });

    it("should handle embeddings array format", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }),
          }),
        }
      );

      const result = await svc.embed(["a", "b"]);
      expect(result.length).toBe(2);
    });

    it("should handle single embedding format", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ embedding: [0.1, 0.2, 0.3] }),
          }),
        }
      );

      const result = await svc.embed("single");
      expect(result.length).toBe(1);
    });

    it("should handle vector format", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ vector: [0.1, 0.2, 0.3] }),
          }),
        }
      );

      const result = await svc.embed("single");
      expect(result.length).toBe(1);
    });

    it("should handle nested array format in data", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ data: [[0.1, 0.2], [0.3, 0.4]] }),
          }),
        }
      );

      const result = await svc.embed(["a", "b"]);
      expect(result.length).toBe(2);
    });

    it("should mark failure on non-ok response", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test", cooldownMs: 1000 },
        { fetchImpl: createMockFetch({ ok: false, status: 500 }) }
      );

      const result = await svc.embed("test");
      expect(result).toBe(null);
      expect(svc.getStatus().available).toBe(false);
      expect(svc.getStatus().failures).toBe(1);
    });

    it("should mark failure on json parse error", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test", cooldownMs: 1000 },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => {
              throw new Error("parse error");
            },
          }),
        }
      );

      const result = await svc.embed("test");
      expect(result).toBe(null);
      expect(svc.getStatus().failures).toBe(1);
    });

    it("should mark failure on invalid response format", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test", cooldownMs: 1000 },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ unexpected: "format" }),
          }),
        }
      );

      const result = await svc.embed("test");
      expect(result).toBe(null);
      expect(svc.getStatus().failures).toBe(1);
    });

    it("should mark failure on fetch exception", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test", cooldownMs: 1000 },
        {
          fetchImpl: async () => {
            throw new Error("network error");
          },
        }
      );

      const result = await svc.embed("test");
      expect(result).toBe(null);
      expect(svc.getStatus().failures).toBe(1);
    });

    it("should respect cooldown after failure", async () => {
      let callCount = 0;
      const svc = new EmbeddingService(
        { endpoint: "http://test", cooldownMs: 60000 },
        {
          fetchImpl: async () => {
            callCount++;
            throw new Error("fail");
          },
        }
      );

      await svc.embed("test1");
      expect(callCount).toBe(1);

      await svc.embed("test2");
      expect(callCount).toBe(1);
    });

    it("should not skip existing authorization header", async () => {
      const svc = new EmbeddingService(
        {
          endpoint: "http://test",
          apiKey: "sk-test",
          headers: { Authorization: "Custom auth" },
        },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ embedding: [1] }),
          }),
        }
      );

      await svc.embed("test");
      expect(fetchCalls[0].options.headers.Authorization).toBe("Custom auth");
    });
  });

  describe("enqueue and flush", () => {
    it("should batch multiple enqueue calls", async () => {
      let batchSizes = [];
      const svc = new EmbeddingService(
        { endpoint: "http://test", batchSize: 10, flushIntervalMs: 5 },
        {
          fetchImpl: async (url, opts) => {
            const body = JSON.parse(opts.body);
            batchSizes.push(body.input.length);
            return {
              ok: true,
              json: () => ({
                data: body.input.map((_, i) => ({ embedding: [i], index: i })),
              }),
            };
          },
        }
      );

      const p1 = svc.enqueue(["a", "b", "c"]);
      const p2 = svc.enqueue(["d", "e"]);

      // Manually flush to ensure promises resolve before test ends
      await svc.flush();

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.length).toBe(3);
      expect(r2.length).toBe(2);
    });

    it("should respect maxQueue limit", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test", maxQueue: 5, flushIntervalMs: 1000 },
        {
          fetchImpl: async () => ({
            ok: true,
            json: () => ({ data: [{ embedding: [1], index: 0 }] }),
          }),
        }
      );

      // Enqueue items but don't await them (they'll exceed maxQueue)
      const pendingPromises = [];
      for (let i = 0; i < 10; i++) {
        pendingPromises.push(svc.enqueue(`text-${i}`));
      }

      const result = await svc.enqueue("overflow");
      expect(result).toBe(null);

      // Cleanup: flush and await all pending to avoid leaked promises
      await svc.flush();
      await Promise.all(pendingPromises);
    });

    it("should handle immediate flush", async () => {
      let flushCount = 0;
      const svc = new EmbeddingService(
        { endpoint: "http://test", flushIntervalMs: 10000 },
        {
          fetchImpl: async (url, opts) => {
            flushCount++;
            const body = JSON.parse(opts.body);
            return {
              ok: true,
              json: () => ({
                data: body.input.map((_, i) => ({ embedding: [i], index: i })),
              }),
            };
          },
        }
      );

      const result = await svc.enqueue("test", { immediate: true });
      expect(result.length).toBe(1);
      expect(flushCount).toBe(1);
    });

    it("should return null from enqueue when disabled", async () => {
      const svc = new EmbeddingService(null);
      const result = await svc.enqueue("test");
      expect(result).toBe(null);
    });

    it("should return empty array for empty enqueue", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        { fetchImpl: async () => ({ ok: true, json: () => ({}) }) }
      );
      const result = await svc.enqueue([]);
      expect(result).toStrictEqual([]);
    });
  });

  describe("flush edge cases", () => {
    it("should return false when disabled", async () => {
      const svc = new EmbeddingService(null);
      const result = await svc.flush();
      expect(result).toBe(false);
    });

    it("should return true when queue is empty", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        { fetchImpl: async () => ({ ok: true, json: () => ({}) }) }
      );
      const result = await svc.flush();
      expect(result).toBe(true);
    });
  });

  describe("createEmbeddingService factory", () => {
    it("should create service instance", () => {
      const svc = createEmbeddingService(
        { endpoint: "http://test" },
        { fetchImpl: () => {} }
      );
      expect(svc).toBeInstanceOf(EmbeddingService);
    });
  });
});

// ============================================================================
// VectorIndex Tests
// ============================================================================

describe("VectorIndex", () => {
  /** @type {VectorIndex} */
  let index;

  beforeEach(() => {
    index = new VectorIndex({ maxItems: 100 });
  });

  describe("basic operations", () => {
    it("should upsert and retrieve vectors", () => {
      const v1 = [1, 0, 0];
      const v2 = [0, 1, 0];

      expect(index.upsert("a", v1, { label: "first" })).toBe(true);
      expect(index.upsert("b", v2, { label: "second" })).toBe(true);

      expect(index.size).toBe(2);
      expect(index.dimension).toBe(3);
      expect(index.has("a")).toBe(true);
      expect(index.has("b")).toBe(true);
      expect(index.has("c")).toBe(false);
    });

    it("should update existing vector", () => {
      index.upsert("a", [1, 0, 0]);
      index.upsert("a", [0, 1, 0]);

      expect(index.size).toBe(1);
      const results = index.search([0, 1, 0], { topK: 1 });
      expect(results[0].id).toBe("a");
      expect(results[0].score).toBeGreaterThan(0.99);
    });

    it("should delete vectors", () => {
      index.upsert("a", [1, 0, 0]);
      index.upsert("b", [0, 1, 0]);

      expect(index.delete("a")).toBe(true);
      expect(index.size).toBe(1);
      expect(index.has("a")).toBe(false);
      expect(index.has("b")).toBe(true);

      expect(index.delete("nonexistent")).toBe(false);
    });

    it("should clear all vectors", () => {
      index.upsert("a", [1, 0]);
      index.upsert("b", [0, 1]);

      index.clear();

      expect(index.size).toBe(0);
      expect(index.dimension).toBe(null);
    });

    it("should throw on dimension mismatch", () => {
      index.upsert("a", [1, 0, 0]);

      expect(() => index.upsert("b", [1, 0, 0, 0])).toThrow(
        /dimension mismatch/
      );
    });

    it("should respect maxItems limit with LRU eviction", () => {
      const smallIndex = new VectorIndex({ maxItems: 3 });
      smallIndex.upsert("a", [1, 0]);
      smallIndex.upsert("b", [0, 1]);
      smallIndex.upsert("c", [1, 1]);
      smallIndex.upsert("d", [0.5, 0.5]);

      expect(smallIndex.size).toBe(3);
      expect(smallIndex.has("a")).toBe(false);
      expect(smallIndex.has("b")).toBe(true);
      expect(smallIndex.has("c")).toBe(true);
      expect(smallIndex.has("d")).toBe(true);
    });

    it("should refresh LRU order on update", () => {
      const smallIndex = new VectorIndex({ maxItems: 3 });
      smallIndex.upsert("a", [1, 0]);
      smallIndex.upsert("b", [0, 1]);
      smallIndex.upsert("a", [1, 0]);
      smallIndex.upsert("c", [1, 1]);
      smallIndex.upsert("d", [0.5, 0.5]);

      expect(smallIndex.size).toBe(3);
      expect(smallIndex.has("a")).toBe(true);
      expect(smallIndex.has("b")).toBe(false);
    });
  });

  describe("vector normalization", () => {
    it("should accept Float32Array", () => {
      const vec = new Float32Array([1, 0, 0]);
      expect(index.upsert("a", vec)).toBe(true);
    });

    it("should accept regular array", () => {
      expect(index.upsert("a", [1, 0, 0])).toBe(true);
    });

    it("should accept ArrayBuffer", () => {
      const arr = new Float32Array([1, 0, 0]);
      expect(index.upsert("a", arr.buffer)).toBe(true);
    });

    it("should accept Uint8Array view", () => {
      const f32 = new Float32Array([1, 0, 0]);
      const u8 = new Uint8Array(f32.buffer);
      expect(index.upsert("a", u8)).toBe(true);
    });

    it("should reject null/undefined vectors", () => {
      expect(index.upsert("a", null)).toBe(false);
      expect(index.upsert("a", undefined)).toBe(false);
    });

    it("should reject empty vectors", () => {
      expect(index.upsert("a", [])).toBe(false);
    });

    it("should reject zero vectors", () => {
      expect(index.upsert("a", [0, 0, 0])).toBe(false);
    });

    it("should reject invalid id", () => {
      expect(index.upsert("", [1, 0])).toBe(false);
      expect(index.upsert(null, [1, 0])).toBe(false);
    });

    it("should handle NaN by converting to 0", () => {
      expect(index.upsert("a", [NaN, 1, 0])).toBe(true);
    });

    it("should reject vector with all NaN", () => {
      expect(index.upsert("a", [NaN, NaN, NaN])).toBe(false);
    });
  });

  describe("search", () => {
    beforeEach(() => {
      index.upsert("north", [0, 1, 0], { direction: "north" });
      index.upsert("south", [0, -1, 0], { direction: "south" });
      index.upsert("east", [1, 0, 0], { direction: "east" });
      index.upsert("west", [-1, 0, 0], { direction: "west" });
      index.upsert("northeast", [0.707, 0.707, 0], {
        direction: "northeast",
      });
    });

    it("should return empty for empty index", () => {
      const emptyIndex = new VectorIndex();
      const results = emptyIndex.search([1, 0, 0]);
      expect(results.length).toBe(0);
    });

    it("should find exact match with highest score", () => {
      const results = index.search([0, 1, 0], { topK: 1 });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("north");
      expect(results[0].score).toBeGreaterThan(0.99);
    });

    it("should respect topK parameter", () => {
      const results = index.search([0.5, 0.5, 0], { topK: 3 });
      expect(results.length).toBe(3);
    });

    it("should default topK to 5", () => {
      const results = index.search([0.5, 0.5, 0]);
      expect(results.length).toBe(5);
    });

    it("should sort by descending score", () => {
      const results = index.search([0, 1, 0], { topK: 5 });
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it("should apply minScore filter", () => {
      const results = index.search([0, 1, 0], { topK: 10, minScore: 0.5 });
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0.5);
      }
    });

    it("should apply custom filter", () => {
      const results = index.search([0, 1, 0], {
        topK: 10,
        filter: (meta) => meta.direction.includes("east"),
      });
      for (const r of results) {
        expect(r.meta.direction).toContain("east");
      }
    });

    it("should pass id to filter function", () => {
      const ids = [];
      index.search([1, 0, 0], {
        topK: 5,
        filter: (meta, id) => {
          ids.push(id);
          return true;
        },
      });
      expect(ids).toContain("north");
      expect(ids).toContain("east");
    });

    it("should return empty for invalid query vector", () => {
      expect(index.search(null).length).toBe(0);
      expect(index.search([]).length).toBe(0);
      expect(index.search([0, 0, 0]).length).toBe(0);
    });

    it("should return empty for dimension mismatch query", () => {
      const results = index.search([1, 0], { topK: 5 });
      expect(results.length).toBe(0);
    });

    it("should include meta in results", () => {
      const results = index.search([1, 0, 0], { topK: 1 });
      expect(results[0].meta.direction).toBe("east");
    });
  });

  describe("partition filtering", () => {
    it("should filter by hot/warm/cold partitions", () => {
      const now = Date.now();
      index.upsert("hot1", [1, 0, 0], { ts: now - 1000 });
      index.upsert("warm1", [0.9, 0.1, 0], {
        ts: now - 2 * 60 * 60 * 1000,
      });
      index.upsert("cold1", [0.8, 0.2, 0], {
        ts: now - 48 * 60 * 60 * 1000,
      });

      const hotResults = index.search([1, 0, 0], {
        topK: 10,
        partitions: "hot",
      });
      expect(hotResults.length).toBe(1);
      expect(hotResults[0].id).toBe("hot1");

      const warmResults = index.search([1, 0, 0], {
        topK: 10,
        partitions: ["warm"],
      });
      expect(warmResults.length).toBe(1);
      expect(warmResults[0].id).toBe("warm1");

      const multiResults = index.search([1, 0, 0], {
        topK: 10,
        partitions: ["hot", "warm"],
      });
      expect(multiResults.length).toBe(2);
    });

    it("should classify missing ts as cold", () => {
      const now = Date.now();
      index.upsert("no-ts", [1, 0, 0], {});
      index.upsert("hot", [0.9, 0.1, 0], { ts: now - 1000 });

      const coldResults = index.search([1, 0, 0], {
        topK: 10,
        partitions: "cold",
      });
      expect(coldResults.length).toBe(1);
      expect(coldResults[0].id).toBe("no-ts");
    });

    it("should handle null partitions (no filter)", () => {
      const now = Date.now();
      index.upsert("hot", [1, 0, 0], { ts: now - 1000 });
      index.upsert("cold", [0.9, 0.1, 0], {});

      const results = index.search([1, 0, 0], { topK: 10, partitions: null });
      expect(results.length).toBe(2);
    });
  });

  describe("getPartitionStats", () => {
    it("should return partition counts", () => {
      const now = Date.now();
      index.upsert("hot1", [1, 0, 0], { ts: now - 1000 });
      index.upsert("hot2", [0, 1, 0], { ts: now - 2000 });
      index.upsert("warm1", [0, 0, 1], {
        ts: now - 2 * 60 * 60 * 1000,
      });
      index.upsert("cold1", [1, 1, 0], {
        ts: now - 48 * 60 * 60 * 1000,
      });

      const stats = index.getPartitionStats();
      expect(stats.hot).toBe(2);
      expect(stats.warm).toBe(1);
      expect(stats.cold).toBe(1);
      expect(stats.total).toBe(4);
    });

    it("should return zeros for empty index", () => {
      const stats = index.getPartitionStats();
      expect(stats.hot).toBe(0);
      expect(stats.warm).toBe(0);
      expect(stats.cold).toBe(0);
      expect(stats.total).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should handle has with invalid id", () => {
      expect(index.has("")).toBe(false);
      expect(index.has(null)).toBe(false);
    });

    it("should handle delete with invalid id", () => {
      expect(index.delete("")).toBe(false);
      expect(index.delete(null)).toBe(false);
    });

    it("should handle search with topK <= 0", () => {
      index.upsert("a", [1, 0]);
      expect(index.search([1, 0], { topK: 0 }).length).toBe(1);
      expect(index.search([1, 0], { topK: -1 }).length).toBe(1);
    });

    it("should handle default options", () => {
      const idx = new VectorIndex();
      expect(idx.dimension).toBe(null);
      expect(idx.size).toBe(0);
    });

    it("should handle non-object options", () => {
      const idx = new VectorIndex("invalid");
      expect(idx.size).toBe(0);
    });
  });
});

// ============================================================================
// Multi-provider Support Tests
// ============================================================================

describe("Multi-provider embedding support", () => {
  it("should work with OpenAI response format", async () => {
    const svc = new EmbeddingService(
      { endpoint: "https://api.openai.com/v1/embeddings" },
      {
        fetchImpl: async () => ({
          ok: true,
          json: () => ({
            object: "list",
            data: [{ object: "embedding", embedding: [0.1, 0.2], index: 0 }],
            model: "text-embedding-3-small",
            usage: { prompt_tokens: 5, total_tokens: 5 },
          }),
        }),
      }
    );

    const result = await svc.embed("test");
    expect(result.length).toBe(1);
    expect(result[0]).toBeInstanceOf(Float32Array);
  });

  it("should work with Ollama response format", async () => {
    const svc = new EmbeddingService(
      { endpoint: "http://localhost:11434/api/embeddings" },
      {
        fetchImpl: async () => ({
          ok: true,
          json: () => ({
            embedding: [0.1, 0.2, 0.3, 0.4],
          }),
        }),
      }
    );

    const result = await svc.embed("test");
    expect(result.length).toBe(1);
    expect(result[0].length).toBe(4);
  });

  it("should work with batch array format", async () => {
    const svc = new EmbeddingService(
      { endpoint: "http://custom-api/embed" },
      {
        fetchImpl: async () => ({
          ok: true,
          json: () => ({
            data: [[0.1, 0.2], [0.3, 0.4]],
          }),
        }),
      }
    );

    const result = await svc.embed(["a", "b"]);
    expect(result.length).toBe(2);
  });

  it("should include custom headers", async () => {
    let capturedHeaders;
    const svc = new EmbeddingService(
      {
        endpoint: "http://test",
        headers: { "X-Api-Version": "2024-01" },
        apiKey: "test-key",
      },
      {
        fetchImpl: async (url, opts) => {
          capturedHeaders = opts.headers;
          return {
            ok: true,
            json: () => ({ embedding: [1, 2, 3] }),
          };
        },
      }
    );

    await svc.embed("test");
    expect(capturedHeaders["X-Api-Version"]).toBe("2024-01");
    expect(capturedHeaders["Authorization"]).toContain("test-key");
  });

  it("should omit model when not provided", async () => {
    let capturedBody;
    const svc = new EmbeddingService(
      { endpoint: "http://test" },
      {
        fetchImpl: async (url, opts) => {
          capturedBody = JSON.parse(opts.body);
          return {
            ok: true,
            json: () => ({ embedding: [1] }),
          };
        },
      }
    );

    await svc.embed("test");
    expect(capturedBody.model).toBe(undefined);
  });
});

// ============================================================================
// Integration Tests with MemoryStore/SourceManager
// ============================================================================

describe("EmbeddingService integration", () => {
  it("should integrate with VectorIndex for semantic search", async () => {
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      const inputs = Array.isArray(body.input) ? body.input : [];
      const data = inputs.map((text, index) => {
        const s = String(text).toLowerCase();
        const revenue = s.includes("revenue") ? 1 : 0;
        const market = s.includes("market") ? 1 : 0;
        return { index, embedding: [revenue, market, 0] };
      });
      return { ok: true, json: () => ({ data }) };
    };

    const svc = new EmbeddingService(
      { endpoint: "http://test", flushIntervalMs: 0 },
      { fetchImpl }
    );

    const vectorIndex = new VectorIndex({ maxItems: 100 });

    const texts = ["Q3 revenue analysis", "Market share data", "Other content"];
    const embeddings = await svc.embed(texts);

    texts.forEach((text, i) => {
      vectorIndex.upsert(`doc-${i}`, embeddings[i], { text });
    });

    const queryEmbedding = await svc.embed("revenue");
    const results = vectorIndex.search(queryEmbedding[0], { topK: 2 });

    expect(results[0].id).toBe("doc-0");
    expect(results[0].meta.text).toContain("revenue");
  });
});
