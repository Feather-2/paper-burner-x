import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EmbeddingService,
  createEmbeddingService,
  normalizeEmbeddingConfig,
} from "../../../js/agents/shared/embeddings/embedding-service.js";
import { VectorIndex } from "../../../js/agents/shared/embeddings/vector-index.js";

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
