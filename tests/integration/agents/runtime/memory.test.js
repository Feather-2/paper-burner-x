import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("runtime/memory/state-diff.js", () => {
  it("cloneJson falls back safely for non-clonable values", async () => {
    const { cloneJson } = await import("../../../../js/agents/runtime/memory/state-diff.js");

    const fn = () => "x";
    expect(cloneJson(fn)).toBe(fn);

    const out = cloneJson({ a: 1, fn });
    expect(out).toEqual({ a: 1 });
  });

  it("applyStatePatch validates ops and unsafe paths", async () => {
    const { applyStatePatch } = await import("../../../../js/agents/runtime/memory/state-diff.js");

    expect(() => applyStatePatch({ a: 1 }, [{ op: "noop", path: ["a"], value: 2 }])).toThrow(
      /invalid_patch_op/
    );

    expect(() =>
      applyStatePatch({ a: 1 }, [{ op: "replace", path: ["__proto__", "x"], value: 1 }])
    ).toThrow(/unsafe_path_segment/);
  });

  it("applyStatePatch supports object/array add-remove-replace and rejects negative array indices", async () => {
    const { applyStatePatch } = await import("../../../../js/agents/runtime/memory/state-diff.js");

    const base = { a: { b: 1 }, arr: ["x", "y"] };
    const next = applyStatePatch(base, [
      { op: "replace", path: ["a", "b"], value: 2 },
      { op: "add", path: ["a", "c"], value: 3 },
      { op: "remove", path: ["a", "b"], value: undefined },
      { op: "add", path: ["arr", 1], value: "z" },
      { op: "remove", path: ["arr", 0] },
    ]);

    expect(next).toEqual({ a: { c: 3 }, arr: ["z", "y"] });

    expect(() => applyStatePatch({ arr: ["x"] }, [{ op: "remove", path: ["arr", -1] }])).toThrow(
      /patch_path_invalid_array_index/
    );
  });

  it("buildStatePatch respects maxDepth/maxOps/maxArrayOps and unsafe-key abort", async () => {
    const { buildStatePatch } = await import("../../../../js/agents/runtime/memory/state-diff.js");

    // maxDepth: replace at current path when depth >= maxDepth.
    const base = { a: { b: { c: 1 } } };
    const next = { a: { b: { c: 2 } } };
    expect(buildStatePatch(base, next, { maxDepth: 1 })).toEqual([
      { op: "replace", path: ["a"], value: next.a },
    ]);

    // maxArrayOps: too many ops -> replace entire array.
    const arrBase = { list: [1, 2, 3] };
    const arrNext = { list: [3, 2, 1] };
    expect(buildStatePatch(arrBase, arrNext, { maxArrayOps: 0 })).toEqual([
      { op: "replace", path: ["list"], value: arrNext.list },
    ]);

    // maxOps: fallback to root replace.
    expect(buildStatePatch({ a: 1 }, { a: 2, b: 3 }, { maxOps: 1 })).toEqual([
      { op: "replace", path: [], value: { a: 2, b: 3 } },
    ]);

    // Unsafe keys: fallback to root replace (avoid prototype pollution paths).
    const unsafe = { constructor: { evil: true } };
    expect(buildStatePatch({}, unsafe)).toEqual([{ op: "replace", path: [], value: unsafe }]);
  });

  it("getPatchLayers extracts layer names from patch paths", async () => {
    const { getPatchLayers } = await import("../../../../js/agents/runtime/memory/state-diff.js");

    const layers = getPatchLayers([
      { op: "replace", path: ["L0", "taskGoal"], value: "x" },
      { op: "add", path: ["L1", "messages", 0], value: { role: "user", content: "hi" } },
      { op: "remove", path: ["foo"], value: undefined },
      { op: "replace", path: ["L10", "x"], value: 1 },
    ]);
    expect(Array.from(layers).sort()).toEqual(["L0", "L1"]);
  });
});

function createEventBus() {
  /** @type {Map<string, Set<Function>>} */
  const handlers = new Map();
  return {
    on(name, fn) {
      const set = handlers.get(name) || new Set();
      set.add(fn);
      handlers.set(name, set);
      return () => set.delete(fn);
    },
    emit(name, evt) {
      for (const fn of handlers.get(name) || []) fn(evt);
    },
  };
}

describe("runtime/memory/retrieval-engine.js", () => {
  it("keywordRecall returns the most recent archives when query has no tokens", async () => {
    const { MemoryStore } = await import("../../../../js/agents/runtime/memory/memory-store.js");
    const { RetrievalEngine } = await import("../../../../js/agents/runtime/memory/retrieval-engine.js");

    const store = new MemoryStore({ runId: "re_kw_latest", tokenCounter: null });
    const id1 = await store.archive("s1", { summary: "First summary" });
    const id2 = await store.archive("s2", { summary: "Second summary" });

    const engine = new RetrievalEngine({ memoryStore: store, subscribe: false });
    const hits = engine.keywordRecall("a", { limit: 1 }); // "a" is filtered out (<2 chars)

    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(id2);
    expect(hits[0].summary).toContain("Second");
    expect(hits[0].data.summary).toContain("Second");
    expect(hits[0].id).not.toBe(id1);
  });

  it("keywordRecall scores keyword overlaps via the keyword index", async () => {
    const { MemoryStore } = await import("../../../../js/agents/runtime/memory/memory-store.js");
    const { RetrievalEngine } = await import("../../../../js/agents/runtime/memory/retrieval-engine.js");

    const store = new MemoryStore({ runId: "re_kw_score", tokenCounter: null });
    const id1 = await store.archive("stage1", { summary: "Q3 revenue analysis" }, ["q3", "revenue"]);
    const id2 = await store.archive("stage2", { summary: "Q3 highlights" }, ["q3"]);

    const engine = new RetrievalEngine({ memoryStore: store, subscribe: false });
    const hits = engine.keywordRecall("q3 revenue", { limit: 2 });

    expect(hits.map((h) => h.id)).toEqual([id1, id2]);
  });

  it("semanticRecall returns [] when embeddings are unavailable and fallback=false", async () => {
    const { MemoryStore } = await import("../../../../js/agents/runtime/memory/memory-store.js");
    const { RetrievalEngine } = await import("../../../../js/agents/runtime/memory/retrieval-engine.js");

    const store = new MemoryStore({ runId: "re_sem_no_fallback", tokenCounter: null });
    await store.archive("stage1", { summary: "Q3 revenue analysis" }, ["q3", "revenue"]);

    const engine = new RetrievalEngine({ memoryStore: store, subscribe: false });
    const hits = await engine.semanticRecall("revenue", { limit: 1, fallback: false });

    expect(hits).toEqual([]);
  });

  it("queueIndexArchive applies backpressure and drops oldest tasks when queue is full", async () => {
    const { MemoryStore } = await import("../../../../js/agents/runtime/memory/memory-store.js");
    const { RetrievalEngine } = await import("../../../../js/agents/runtime/memory/retrieval-engine.js");

    const store = new MemoryStore({ runId: "re_queue_backpressure", tokenCounter: null });

    const never = new Promise(() => {});
    const embeddingService = { enqueue: vi.fn(() => never) };
    const vectorIndex = { upsert: vi.fn(() => true) };

    const engine = new RetrievalEngine({
      memoryStore: store,
      embeddingService,
      vectorIndex,
      subscribe: false,
      indexQueueMaxSize: 2,
      indexMaxConcurrent: 1,
    });

    const ids = await Promise.all([
      store.archive("s1", { summary: "one" }),
      store.archive("s2", { summary: "two" }),
      store.archive("s3", { summary: "three" }),
      store.archive("s4", { summary: "four" }),
    ]);

    for (const id of ids) engine.queueIndexArchive(id);

    const stats = engine.getIndexQueueStats();
    expect(stats.inFlight).toBe(1); // first task started
    expect(stats.queueSize).toBe(2); // capped
    expect(stats.droppedCount).toBe(1); // 4th insert drops oldest queued
  });

  it("subscribes to memory.archived and enqueues indexing tasks", async () => {
    const { MemoryStore } = await import("../../../../js/agents/runtime/memory/memory-store.js");
    const { RetrievalEngine } = await import("../../../../js/agents/runtime/memory/retrieval-engine.js");

    const bus = createEventBus();
    const store = new MemoryStore({
      runId: "re_subscribe",
      tokenCounter: null,
      eventBus: bus,
    });

    const embeddingService = { enqueue: vi.fn(async () => [[1, 0, 0]]) };
    const vectorIndex = { upsert: vi.fn(() => true) };

    const engine = new RetrievalEngine({ memoryStore: store, embeddingService, vectorIndex, eventBus: bus });
    const id = await store.archive("stage", { summary: "hello world" });

    // Wait a tick for async index task to run.
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.getIndexQueueStats().inFlight).toBeGreaterThanOrEqual(0);
    expect(embeddingService.enqueue).toHaveBeenCalled();
    expect(vectorIndex.upsert).toHaveBeenCalledWith(
      id,
      [1, 0, 0],
      expect.objectContaining({ stageKey: "stage" })
    );

    engine.dispose();
  });
});

describe("runtime/memory/memory-store.impl.js", () => {
  it("creates incremental checkpoints and restores through the nearest full base", async () => {
    const { MemoryStore } = await import("../../../../js/agents/runtime/memory/memory-store.js");

    const store = new MemoryStore({ runId: "mem_ckpt_inc", tokenCounter: null });
    store.setTaskGoal("Goal");
    store.addTodo({ content: "Task 1" });

    const ckpt1 = await store.checkpoint({ incremental: true, fullSnapshotEvery: 99 });
    const snap1 = store.L3.checkpoints.find((c) => c.id === ckpt1);
    expect(snap1).toEqual(
      expect.objectContaining({
        id: ckpt1,
        runId: "mem_ckpt_inc",
        encoding: "full",
        L0: expect.objectContaining({
          taskGoal: "Goal",
          todos: expect.arrayContaining([expect.objectContaining({ content: "Task 1" })]),
        }),
      })
    );
    expect(snap1.encoding).toBe("full");

    store.addMessage({ role: "user", content: "hello" });
    const ckpt2 = await store.checkpoint({ incremental: true, fullSnapshotEvery: 99 });
    const snap2 = store.L3.checkpoints.find((c) => c.id === ckpt2);
    expect(snap2).toEqual(
      expect.objectContaining({
        id: ckpt2,
        runId: "mem_ckpt_inc",
        encoding: "incremental",
        baseId: ckpt1,
      })
    );
    expect(snap2.L0).toBeUndefined();
    expect(snap2.L1).toMatchObject({
      messages: [expect.objectContaining({ role: "user", content: "hello" })],
    });

    // Mutate after checkpoint and restore.
    store.setTaskGoal("Changed");
    store.addMessage({ role: "user", content: "world" });

    expect(store.L0.taskGoal).toBe("Changed");
    expect(store.L1.messages).toHaveLength(2);

    expect(await store.restore(ckpt2)).toBe(true);
    expect(store.L0.taskGoal).toBe("Goal");
    expect(store.L0.todos).toHaveLength(1);
    expect(store.L1.messages).toHaveLength(1);
    expect(store.L1.messages[0].content).toBe("hello");
  });
});

describe("runtime/memory/index.js", () => {
  it("re-exports MemoryStore/StateEngine/action-types symbols", async () => {
    const memory = await import("../../../../js/agents/runtime/memory/index.js");
    const { MemoryStore } = await import("../../../../js/agents/runtime/memory/memory-store.js");
    const { StateEngine } = await import("../../../../js/agents/runtime/memory/state-engine.js");
    const actions = await import("../../../../js/agents/runtime/memory/action-types.js");

    expect(memory.MemoryStore).toBe(MemoryStore);
    expect(memory.StateEngine).toBe(StateEngine);
    expect(memory.L0_SET_TASK_GOAL).toBe(actions.L0_SET_TASK_GOAL);
  });
});
