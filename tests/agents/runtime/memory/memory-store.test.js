import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function createStore(options = {}) {
  const { MemoryStore } = await import("../../../../js/agents/runtime/memory/memory-store.js");
  return new MemoryStore({
    runId: "ms_test",
    tokenCounter: null,
    ...options,
  });
}

describe("runtime/memory/memory-store.js", () => {
  it("re-exports MemoryStore as named + default export", async () => {
    const mod = await import("../../../../js/agents/runtime/memory/memory-store.js");
    expect(mod.MemoryStore).toBeTypeOf("function");
    expect(mod.default).toBe(mod.MemoryStore);
  });

  it("supports todo CRUD (store/retrieve/update/delete) and flexible filters", async () => {
    const store = await createStore();

    const t1 = store.addTodo({ content: "Read doc A", status: "pending" });
    expect(t1.id).toBeTruthy();
    expect(t1.todoId).toBeTruthy();

    // retrieve (all)
    expect(store.getTodos()).toHaveLength(1);
    // retrieve (status)
    expect(store.getTodos("pending")).toHaveLength(1);

    // update
    const updated = store.updateTodo(t1.id, { status: "done", content: "Read doc A (done)" });
    expect(updated).not.toBeNull();
    expect(updated.status).toBe("completed"); // normalized from "done"
    expect(updated.updatedAt).toBeTypeOf("string");

    // retrieve (predicate)
    expect(store.getTodos((t) => t.status === "completed")).toHaveLength(1);
    // retrieve (options object)
    expect(store.getTodos({ status: "done", filter: (t) => t.content.includes("done") })).toHaveLength(1);

    // delete
    const removed = store.removeTodo(t1.id);
    expect(removed?.id).toBe(t1.id);
    expect(store.getTodos()).toHaveLength(0);

    // invalid ids are handled safely
    expect(store.updateTodo("", { status: "done" })).toBeNull();
    expect(store.removeTodo("")).toBeNull();
  });

  it("dedupes todos by todoId/id when re-adding and updates in place", async () => {
    const store = await createStore();

    const first = store.addTodo({ todoId: "todo_1", content: "Draft outline" });
    expect(store.getTodos()).toHaveLength(1);

    const second = store.addTodo({ todoId: "todo_1", content: "Draft outline (v2)", status: "in_progress" });
    expect(store.getTodos()).toHaveLength(1);
    expect(second).toBe(first); // same object instance (updated in place)
    expect(store.getTodos()[0].content).toContain("v2");
    expect(store.getTodos()[0].status).toBe("in_progress");
    expect(store.getTodos()[0].updatedAt).toBeTypeOf("string");
  });

  it("provides frozen COW getters for L0/L1/L2/L3 snapshots", async () => {
    const store = await createStore();
    store.addTodo({ content: "A" });
    store.addMessage({ role: "user", content: "hi" });

    expect(Object.isFrozen(store.L0)).toBe(true);
    expect(Object.isFrozen(store.L1)).toBe(true);
    expect(Object.isFrozen(store.L2)).toBe(true);
    expect(Object.isFrozen(store.L3)).toBe(true);

    expect(() => store.L0.todos.push({ content: "mutate" })).toThrow();
    expect(() => store.L1.messages.push({ role: "user", content: "mutate" })).toThrow();
    expect(() => store.L2.claims.push({ content: "mutate" })).toThrow();
    expect(() => store.L3.checkpoints.push({ id: "x" })).toThrow();
  });

  it("stores and retrieves working memory: messages, signals, decisions (with pruning/expiration)", async () => {
    const store = await createStore({
      config: { maxSignals: 2, maxDecisions: 2 },
    });

    // messages
    store.addMessage("hello"); // string -> {role:"user"}
    store.addMessages([{ role: "assistant", content: "hi" }, "second user msg"]);
    const msgs = store.getMessages();
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);

    // signals (store + prune + update)
    const s1 = store.addSignal({ type: "info", message: "one" });
    const s2 = store.addSignal({ type: "warn", message: "two" });
    const s3 = store.addSignal({ type: "error", message: "three" }); // prunes oldest

    expect(store.L1.signals).toHaveLength(2);
    expect(store.L1.signals.map((s) => s.id)).toEqual([s2.id, s3.id]);
    expect(store.getSignals("pending")).toHaveLength(2);

    store.acknowledgeSignal(s2.id);
    expect(store.getSignals("pending")).toHaveLength(1);
    expect(store.getSignals((s) => s.acknowledged)).toHaveLength(1);

    // decisions (store + prune)
    const d1 = store.recordDecision({ type: "search", reason: "need info" });
    const d2 = store.recordDecision({ action: "read-doc", reason: "source of truth" });
    const d3 = store.recordDecision({ action: "summarize", reason: "reduce context" }); // prunes oldest

    expect(store.L1.decisions).toHaveLength(2);
    expect(store.L1.decisions.map((d) => d.id)).toEqual([d2.id, d3.id]);
    expect(d1.action).toBe("search"); // falls back to decision.type
    expect(store.getDecisions(1)).toEqual([d3]);
  });

  it("emits memory.updated events for scratchpad/flags and supports delete via clearScratchpad", async () => {
    const eventBus = { emit: vi.fn() };
    const store = await createStore({ eventBus });

    store.setScratchpad("k1", "v1");
    store.setScratchpad({ k2: 2, k3: true });
    expect(store.getScratchpad()).toEqual({ k1: "v1", k2: 2, k3: true });
    expect(store.getScratchpad("k2")).toBe(2);

    store.clearScratchpad();
    expect(store.getScratchpad()).toEqual({});

    store.awaitUserFeedback = 1;
    store.taskImpossible = "yes";
    expect(store.getFlags()).toEqual({ awaitUserFeedback: true, taskImpossible: true });
    // cover flag getters too
    expect(store.awaitUserFeedback).toBe(true);
    expect(store.taskImpossible).toBe(true);

    // unknown flags are ignored (no event emitted)
    eventBus.emit.mockClear();
    store.setFlag("unknown_flag", true);
    expect(eventBus.emit).not.toHaveBeenCalled();

    // setFlag emits memory.updated
    store.setFlag("awaitUserFeedback", false);
    expect(eventBus.emit).toHaveBeenCalledWith(
      "memory.updated",
      expect.objectContaining({
        actor: "memory",
        payload: expect.objectContaining({
          field: "flags",
          delta: expect.objectContaining({ awaitUserFeedback: false }),
        }),
      })
    );
  });

  it("syncs discovery/subagent tables (upserts + defaulting) and can build a prompt context", async () => {
    const store = await createStore();

    store.setTaskGoal("Analyze documents");
    store.addTodo({ content: "Task 1", status: "pending" });
    store.addTodo({ content: "Task 2", status: "done" });

    // defaults
    const d0 = store.syncDiscovery("d0", {});
    expect(d0.status).toBe("open");
    expect(d0.keywords).toEqual([]);
    expect(d0.by).toBeNull();

    store.syncDiscovery("d1", { status: "open", keywords: ["q3"], by: "a" });
    store.syncDiscovery("d1", { status: "satisfied", by: "b" });
    expect(store.getDiscovery("d1")?.status).toBe("satisfied");
    expect(store.getDiscovery("d1")?.keywords).toEqual(["q3"]); // preserved
    expect(store.getDiscovery("d1")?.by).toBe("b");

    const s0 = store.syncSubagent("s0", {});
    expect(s0.status).toBe("pending");
    expect(s0.progress).toBe(0);
    expect(s0.result).toBeNull();

    store.syncSubagent("s1", { status: "running", progress: 50 });
    store.syncSubagent("s1", { progress: "nope" }); // invalid progress preserves prior
    expect(store.getSubagent("s1")?.progress).toBe(50);

    store.addSignal({ type: "info", message: "needs review" });
    store.recordDecision({ action: "search", reason: "fill gaps" });

    const ctx = store.buildPromptContext();
    expect(ctx).toContain("## 目标");
    expect(ctx).toContain("Analyze documents");
    expect(ctx).toContain("## 待办");
    expect(ctx).toContain("## 待验证");
    expect(ctx).toContain("## 待处理信号");
    expect(ctx).toContain("## 最近决策");
  });

  it("supports L2 stage summaries + claims (store/retrieve/update)", async () => {
    const store = await createStore();

    store.setStageSummary("scan", "Found 3 docs");
    store.setStageSummary("analyze", "Q3 revenue is 120B");
    expect(store.getStageSummary("scan")).toContain("Found 3");
    expect(Object.keys(store.getAllStageSummaries()).sort()).toEqual(["analyze", "scan"]);

    store.setStageSummary("   ", "ignored");
    expect(store.getStageSummary("")).toBe("");

    const c1 = store.addClaim({ content: "Q3 revenue is 120B", source: "Report A" });
    const c2 = store.addClaim("Market share increased");
    expect(c1.id).toBeTruthy();
    expect(c1.verified).toBe(false);
    expect(c2.source).toBeNull();
    expect(store.getClaims()).toHaveLength(2);
    expect(store.getClaims((c) => c.source === "Report A")).toHaveLength(1);

    const incoming = [{ id: "x", content: "replacement" }];
    store.replaceClaims(incoming);
    incoming[0].content = "mutated";
    expect(store.getClaims()[0].content).toBe("replacement"); // deep cloned
  });

  it("archives snapshots, lists & fetches them, and evicts oldest entries when over capacity (expiration)", async () => {
    const eventBus = { emit: vi.fn() };
    const store = await createStore({
      eventBus,
      config: { maxL3Bytes: 1 }, // force eviction behavior deterministically
    });

    const id1 = await store.archive("stage1", { summary: "First", data: 1 }, ["alpha"]);
    expect(id1).toBeTruthy();
    expect(store.L3.snapshots.has(id1)).toBe(true);
    expect(store.L3.index.keywords.get("alpha")?.has(id1)).toBe(true);

    const id2 = await store.archive("stage2", { summary: "Second", data: 2 }, ["beta"]);
    expect(store.L3.snapshots.has(id2)).toBe(true);

    // Oldest snapshot evicted to make room.
    expect(store.L3.snapshots.has(id1)).toBe(false);
    expect(store.L3.index.keywords.get("alpha")?.has(id1)).toBe(false);

    const snap2 = await store.getSnapshot(id2);
    expect(snap2?.summary).toBe("Second");

    const list = store.listArchives();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id2);

    // Emits memory.archived at least once.
    expect(eventBus.emit).toHaveBeenCalledWith(
      "memory.archived",
      expect.objectContaining({
        actor: "memory",
        payload: expect.objectContaining({ id: expect.any(String) }),
      })
    );
  });

  it("delegates recall/semanticRecall/hybridRecall to a provided retrieval engine", async () => {
    const retrievalEngine = {
      recall: vi.fn(() => [{ id: "x" }]),
      semanticRecall: vi.fn(async () => [{ id: "s" }]),
      hybridRecall: vi.fn(async () => [{ id: "h" }]),
    };

    const store = await createStore({ retrievalEngine });
    expect(store.recall("q", 5)).toEqual([{ id: "x" }]);
    expect(retrievalEngine.recall).toHaveBeenCalledWith("q", 5);

    await expect(store.semanticRecall("q", { limit: 1 })).resolves.toEqual([{ id: "s" }]);
    await expect(store.hybridRecall("q", { limit: 1 })).resolves.toEqual([{ id: "h" }]);
  });

  it("creates an internal RetrievalEngine when none is provided and can keyword-recall archives", async () => {
    const store = await createStore();
    const id = await store.archive("s", { summary: "Alpha summary" }, ["alpha"]);

    const hits = store.recall("alpha", 3);
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(id);
    expect(hits[0].summary).toContain("Alpha");
  });

  it("supports checkpoints (full + incremental), restore, and checkpoint eviction under tight capacity", async () => {
    const store = await createStore({
      config: { maxL3Bytes: 1 }, // forces _ensureL3Capacity to evict older checkpoints
    });

    store.setTaskGoal("base");
    store.addMessage({ role: "user", content: "hello" });

    const ckpt1 = await store.checkpoint({ incremental: true, fullSnapshotEvery: 999 });
    const meta1 = store.L3.checkpoints.find((c) => c.id === ckpt1);
    expect(meta1?.encoding).toBe("full");

    store.setTaskGoal("changed");
    const ckpt2 = await store.checkpoint({ incremental: true, fullSnapshotEvery: 999 });
    const meta2 = store.L3.checkpoints.find((c) => c.id === ckpt2);
    expect(meta2?.encoding).toBe("incremental");
    expect(meta2?.baseId).toBe(ckpt1);
    expect(meta2?.L0).toBeTruthy();
    expect(meta2?.L1).toBeUndefined();

    // Restore uses base + incremental chain.
    const ok = await store.restore(ckpt2);
    expect(ok).toBe(true);
    expect(store.getTaskGoal()).toBe("changed");
    expect(store.getMessages()).toHaveLength(1); // from base checkpoint

    expect(await store.restore("missing")).toBe(false);

    // Eviction: after enough checkpoints, oldest is dropped (but at least one base remains).
    const ckpt3 = await store.checkpoint({ incremental: true, fullSnapshotEvery: 999 });
    expect(store.L3.checkpoints.map((c) => c.id)).toEqual([ckpt2, ckpt3]);
  });

  it("supports toSnapshot/fromSnapshot (including L3) and preserves Maps/Sets correctly", async () => {
    const store1 = await createStore();
    store1.setSystemPrompt("sys");
    store1.setTaskGoal("goal");
    store1.addTodo({ content: "t1" });
    store1.addMessage({ role: "user", content: "hi" });
    store1.setStageSummary("scan", "ok");
    store1.addClaim({ content: "claim1", verified: true });
    store1.syncDiscovery("d1", { status: "open", keywords: ["alpha"] });
    store1.syncSubagent("s1", { status: "running", progress: 10 });
    const snapId = await store1.archive("stage", { summary: "S1" }, ["alpha"]);
    // Ensure L3 contains checkpoints too (covers _recalculateL3Bytes over checkpoints on restore).
    await store1.checkpoint({ incremental: false });

    const snapshot = store1.toSnapshot({ includeL3: true, incremental: false });
    expect(snapshot.L3).toBeTruthy();

    const store2 = await createStore();
    expect(store2.fromSnapshot(snapshot)).toBe(true);

    expect(store2.L0.systemPrompt).toBe("sys");
    expect(store2.getTaskGoal()).toBe("goal");
    expect(store2.getTodos()).toHaveLength(1);
    expect(store2.getMessages()).toHaveLength(1);
    expect(store2.getStageSummary("scan")).toBe("ok");
    expect(store2.getClaims((c) => c.verified)).toHaveLength(1);
    expect(store2.getDiscovery("d1")?.keywords).toEqual(["alpha"]);
    expect(store2.getSubagent("s1")?.progress).toBe(10);
    expect(store2.L3.snapshots.has(snapId)).toBe(true);
    expect(store2.L3.index.keywords.get("alpha")?.has(snapId)).toBe(true);

    expect(store2.fromSnapshot(null)).toBe(false);

    // incremental snapshots clear dirty flags and can omit unchanged layers
    const inc1 = store2.toSnapshot({ includeL3: false, incremental: true });
    const inc2 = store2.toSnapshot({ includeL3: false, incremental: true });
    expect(inc1._dirtyLayers).toBeTruthy();
    expect(inc2.L0).toBeUndefined();
    expect(inc2.L1).toBeUndefined();
    expect(inc2.L2).toBeUndefined();
  });

  it("can sync from SharedContext/DiscoveryManager delegates and avoids duplicates", async () => {
    const store = await createStore();

    const existing = store.addSignal({ type: "info", message: "local" });
    store.recordDecision({ action: "local_decision", reason: "warm existingDecisionIds" });
    const sharedContext = {
      getSignals: vi.fn(() => [{ ...existing }, { id: "sig_new", type: "warn", message: "remote" }]),
      getAllSummaries: vi.fn(() => ({ stageA: "sumA" })),
      getDecisions: vi.fn(() => [{ id: "dec_1", action: "x", reason: "", ts: 1 }]),
    };

    const discoveryManager = {
      getAllDiscoveries: vi.fn(() => [{ id: "d1", status: "open", keywords: ["k"], by: "dm", ts: 2 }]),
    };

    store.bind({ sharedContext, discoveryManager });
    store.syncAll();

    expect(sharedContext.getSignals).toHaveBeenCalled();
    expect(store.getSignals()).toHaveLength(2); // no duplicate for existing id
    expect(store.getAllStageSummaries()).toEqual({ stageA: "sumA" });
    expect(store.getDecisions()).toHaveLength(2);
    expect(store.getDiscovery("d1")?.by).toBe("dm");

    // tool-compat getters
    expect(store.sharedContext).toBe(sharedContext);
    expect(store.discoveryManager).toBe(discoveryManager);
  });

  it("compresses working memory into L2 historySummary (including overBudget fallback) and truncates long sections", async () => {
    const eventBus = { emit: vi.fn() };
    const store = await createStore({ eventBus });

    // no messages
    expect(store.compress()).toBe(false);

    // under budget + small history -> no-op
    store.addMessage({ role: "user", content: "only" });
    expect(store.compress()).toBe(false);

    // force compress but nothing to compress -> no-op
    expect(store.compress({ force: true })).toBe(false);

    // No assistant turns => overBudget fallback keeps last 2 messages.
    store.addMessages([
      { role: "user", content: "x".repeat(150) }, // forces truncate() inside _summarizeMessages
      { role: "user", content: "second" },
      { role: "user", content: "third" },
    ]);
    expect(store.compress({ force: true })).toBe(true);
    expect(store.L2.historySummary).toContain("[user]");

    // Compress again to append with a newline (hadHistorySummary=true branch).
    store.addMessages([
      { role: "user", content: "fourth" },
      { role: "user", content: "fifth" },
      { role: "user", content: "sixth" },
    ]);
    expect(store.compress({ force: true })).toBe(true);
    expect(store.L2.historySummary).toContain("\n");

    store.setStageSummary("stageA", "y".repeat(150)); // forces truncate() inside buildPromptContext
    const ctx = store.buildPromptContext();
    expect(ctx).toContain("## 历史摘要");
    expect(ctx).toContain("## 阶段发现");
    expect(ctx).toContain("...");

    expect(eventBus.emit).toHaveBeenCalledWith(
      "memory.compressed",
      expect.objectContaining({
        actor: "memory",
        payload: expect.objectContaining({
          compressedCount: expect.any(Number),
          keptCount: expect.any(Number),
        }),
      })
    );
  });

  it("triggers _checkCompress and calls compress when tokenUsage exceeds threshold", async () => {
    const store = await createStore({
      // make `_checkCompress` condition trivially true
      config: { contextWindow: 1, compressThreshold: 0 },
    });

    const spy = vi.spyOn(store, "compress").mockReturnValue(false);
    store.addMessage({ role: "user", content: "x" });
    expect(spy).toHaveBeenCalled();
  });

  it("lazily creates L3Storage from vfs and delegates archive/getSnapshot", async () => {
    const { MemoryVfs } = await import("../../../../js/agents/vfs/vfs.memory.js");
    const vfs = new MemoryVfs();
    const eventBus = { emit: vi.fn() };

    const store = await createStore({ runId: "ms_vfs", vfs, eventBus });

    // cover in-flight + cached L3Storage paths
    const p1 = store._getL3Storage();
    const p2 = store._getL3Storage();
    const [s1, s2] = await Promise.all([p1, p2]);
    expect(s1).toBe(s2);
    expect(await store._getL3Storage()).toBe(s1);

    const id = await store.archive("vfs_stage", { summary: "vfs_summary" }, ["kw"]);
    const snap = await store.getSnapshot(id);
    expect(snap?.stageKey).toBe("vfs_stage");
    expect(snap?.summary).toContain("vfs");

    expect(eventBus.emit).toHaveBeenCalledWith(
      "memory.archived",
      expect.objectContaining({
        actor: "memory",
        payload: expect.objectContaining({ id, stageKey: "vfs_stage" }),
      })
    );
  });

  it("covers archive + checkpoint/restore via l3Storage (full/incremental, base chain, and cycle fallback)", async () => {
    const checkpointIndex = [];
    const checkpoints = new Map();

    const l3Storage = {
      archive: vi.fn(async (stageKey, data) => {
        void stageKey;
        void data;
        return "snap_missing_entry";
      }),
      // Return null to exercise the fallback emit branch in MemoryStore.archive()
      getSnapshot: vi.fn(async () => null),

      listCheckpoints: vi.fn(async () => checkpointIndex.slice()),
      checkpoint: vi.fn(async (snapshot) => {
        checkpoints.set(snapshot.id, snapshot);
        checkpointIndex.push({ id: snapshot.id });
        return snapshot.id;
      }),
      getCheckpoint: vi.fn(async (id) => checkpoints.get(id) || null),
    };

    const eventBus = { emit: vi.fn() };
    const store = await createStore({ l3Storage, eventBus });

    // archive (l3Storage path + missing entry fallback emit)
    const archivedId = await store.archive("stageX", { summary: "x" }, ["kw"]);
    expect(archivedId).toBe("snap_missing_entry");
    expect(eventBus.emit).toHaveBeenCalledWith(
      "memory.archived",
      expect.objectContaining({
        actor: "memory",
        payload: expect.objectContaining({ id: "snap_missing_entry", stageKey: "stageX" }),
      })
    );
    await expect(store.getSnapshot("snap_missing_entry")).resolves.toBeNull();

    // checkpoint (l3Storage path: full then incremental)
    store.setSystemPrompt("sys");
    store.setTaskGoal("base");
    store.addMessage({ role: "user", content: "hi" });
    store.addClaim({ content: "c1" });

    const ckpt1 = await store.checkpoint({ incremental: true, fullSnapshotEvery: 1 });
    expect(checkpoints.get(ckpt1)?.encoding).toBe("full");

    // make L0/L1/L2 dirty so incremental includes them
    store.setTaskGoal("changed");
    store.addMessage({ role: "assistant", content: "ok" });
    store.addClaim({ content: "c2" });

    const ckpt2 = await store.checkpoint({ incremental: true, fullSnapshotEvery: 999 });
    const meta2 = checkpoints.get(ckpt2);
    expect(meta2?.encoding).toBe("incremental");
    expect(meta2?.baseId).toBe(ckpt1);
    expect(meta2?.L0).toBeTruthy();
    expect(meta2?.L1).toBeTruthy();
    expect(meta2?.L2).toBeTruthy();

    // create a deeper incremental chain to exercise baseId traversal
    store.setTaskGoal("v3");
    const ckpt3 = await store.checkpoint({ incremental: true, fullSnapshotEvery: 999 });
    const meta3 = checkpoints.get(ckpt3);
    expect(meta3?.encoding).toBe("incremental");
    expect(meta3?.baseId).toBe(ckpt2);

    // restore guards and missing checkpoint
    await expect(store.restore("")).resolves.toBe(false);
    await expect(store.restore("missing")).resolves.toBe(false);

    // restore full + incremental chain
    store.setTaskGoal("mutated");
    expect(await store.restore(ckpt1)).toBe(true);
    expect(store.getTaskGoal()).toBe("base");

    expect(await store.restore(ckpt2)).toBe(true);
    expect(store.getTaskGoal()).toBe("changed");

    expect(await store.restore(ckpt3)).toBe(true);
    expect(store.getTaskGoal()).toBe("v3");

    // restore incremental with a baseId cycle -> triggers _restoreFromBaseStorage seen-set short circuit
    const bad = {
      id: "ckpt_cycle",
      encoding: "incremental",
      baseId: "ckpt_cycle",
      L0: store.cloneL0(),
      L1: store.cloneL1(),
      L2: store.cloneL2(),
    };
    bad.L0.taskGoal = "fallback";
    checkpoints.set("ckpt_cycle", bad);
    expect(await store.restore("ckpt_cycle")).toBe(true);
    expect(store.getTaskGoal()).toBe("fallback");
  });

  it("covers todo edge cases, in-memory checkpoint fallback restore, and misc utilities", async () => {
    const store = await createStore();

    // cover eviction no-op paths (empty timeline/checkpoints)
    store._evictOldestSnapshot();
    store._evictOldestCheckpoint();
    store._L3.index.timeline.push({});
    store._evictOldestSnapshot(); // missing id -> no-op

    // replaceTodos + filter mismatch branches
    store.addTodo({ content: "done todo", status: "done" });
    expect(store.getTodos({ status: "pending" })).toHaveLength(0);
    expect(store.getTodos({ filter: () => false })).toHaveLength(0);
    expect(store.removeTodo("missing_id")).toBeNull();

    store.replaceTodos(null);
    expect(store.getTodos()).toHaveLength(0);
    store.replaceTodos([{ text: "t", status: "done" }]);
    expect(store.getTodos()[0].status).toBe("completed");

    expect(store.addMessages([])).toEqual([]);

    // setSystemPrompt early-return when unchanged
    store.setSystemPrompt("sys");
    store.setSystemPrompt("sys");

    // keyword indexing ignores empty keywords
    const circular = { summary: "circular" };
    circular.self = circular;
    await store.archive("stage", circular, ["", null, "Alpha"]);

    await expect(store.getSnapshot("")).resolves.toBeNull();

    // deep incremental chain covers baseId traversal, then base-missing fallback covers embedded layer restore
    store.setTaskGoal("base");
    store.addMessage({ role: "user", content: null }); // estimateTokens(null) path
    const circularContent = {};
    circularContent.self = circularContent;
    store.addMessage({ role: "user", content: circularContent }); // estimateTokens(JSON circular) catch path
    const base = await store.checkpoint({ incremental: true, fullSnapshotEvery: 999 });

    store.setTaskGoal("changed");
    store.addMessage({ role: "assistant", content: 123 }); // estimateTokens(non-string) JSON path
    store.addClaim({ content: "c" });
    const inc = await store.checkpoint({ incremental: true, fullSnapshotEvery: 999 });

    store.setTaskGoal("v3");
    const inc2 = await store.checkpoint({ incremental: true, fullSnapshotEvery: 999 });
    expect(await store.restore(inc2)).toBe(true);
    expect(store.getTaskGoal()).toBe("v3");

    // Drop the full checkpoint so restore falls back to embedded layers.
    store._L3.checkpoints = store._L3.checkpoints.filter((c) => c.id !== base);
    expect(await store.restore(inc)).toBe(true);
    expect(store.getTaskGoal()).toBe("changed");

    // Misc: getLatestCheckpoint/getStats and clone helpers
    expect(store.getLatestCheckpoint()?.id).toBe(store._L3.checkpoints[store._L3.checkpoints.length - 1]?.id);
    const stats = store.getStats();
    expect(stats.runId).toBe(store.runId);
    expect(stats.todoCount).toBeGreaterThanOrEqual(0);

    const l0 = store.cloneL0();
    const l1 = store.cloneL1();
    const l2 = store.cloneL2();
    const l3 = store.cloneL3();
    expect(l0).not.toBe(store._L0);
    expect(l1).not.toBe(store._L1);
    expect(l2).not.toBe(store._L2);
    expect(l3).not.toBe(store._L3);

    // cover misc private utilities/guards
    store._clearDirty("L0");
    expect(store._tokenize("")).toEqual([]);
  });

  it("handles malformed snapshots in fromSnapshot (covers type-guard branches)", async () => {
    const store = await createStore();

    const ok = store.fromSnapshot({
      runId: "snap_run",
      config: { maxSignals: 1 },
      // Pretend this is a full snapshot; keep `_dirtyLayers` null to exercise the non-incremental path.
      _dirtyLayers: null,
      L0: { systemPrompt: "   ", taskGoal: null, todos: null },
      L1: {
        messages: null,
        signals: "bad",
        decisions: 5,
        syncTable: null,
        scratchpad: 42,
        flags: null,
      },
      L2: { historySummary: 123, stageSummaries: null, claims: null },
      L3: { snapshots: null, index: null, checkpoints: null },
      stats: { tokenUsage: 0 },
    });

    expect(ok).toBe(true);
    expect(store.runId).toBe("snap_run");
    expect(store.L0.systemPrompt).toBe("");
    expect(store.getTaskGoal()).toBe("");
    expect(store.getTodos()).toEqual([]);
    expect(store.getMessages()).toEqual([]);
    expect(store.getClaims()).toEqual([]);
    expect(store.L3.snapshots.size).toBe(0);
  });

  it("buildPromptContext covers empty output + optional formatting branches", async () => {
    const empty = await createStore();
    expect(empty.buildPromptContext()).toBe("");

    const store = await createStore();
    store.setTaskGoal("goal");

    // Inject todos with different shapes to exercise fallback text resolution.
    store._L0.todos.push({ status: "done", content: "done content" });
    store._L0.todos.push({ status: "in_progress", title: "from title" });
    store._L0.todos.push({ status: "pending" }); // no fields -> "(无描述)"

    // Pending discovery: keywords branch and formatting.
    store.syncDiscovery("d_kw", { status: "open", keywords: ["k1", "k2"] });

    // Pending signal: message empty -> payload JSON used.
    store.addSignal({ type: "info", message: "", payload: { x: 1 } });

    // Decision: reason empty -> omit `: reason` suffix.
    store.recordDecision({ action: "act" });

    const ctx = store.buildPromptContext();
    expect(ctx).toContain("## 目标");
    expect(ctx).toContain("## 待办");
    expect(ctx).toContain("✓");
    expect(ctx).toContain("→");
    expect(ctx).toContain("(无描述)");
    expect(ctx).toContain("[k1,k2]");
    expect(ctx).toContain("{\"x\":1}");
    expect(ctx).toContain("- act");
    expect(ctx).not.toContain("act:");
  });

  it("covers constructor/default branches without hitting the global token counter", async () => {
    const { MemoryStore } = await import("../../../../js/agents/runtime/memory/memory-store.js");

    const counter = { count: vi.fn(() => 1) };
    const store = new MemoryStore({
      runId: "", // forces genId fallback branch
      tokenCounter: counter, // avoids getGlobalTokenCounter()
      embeddingService: "nope",
      vectorIndex: 123,
      config: { maxSignals: 1 },
    });

    expect(store.runId).toMatch(/^run_/);
    expect(store._tokenCounter).toBe(counter);
    expect(store._embeddingService).toBeNull();
    expect(store._vectorIndex).toBeNull();

    // A handful of default/guard paths.
    store.setSystemPrompt(null);
    store.setTaskGoal(null);
    expect(store.getTaskGoal()).toBe("");

    store.addSignal({}); // type/message fall back
    store.recordDecision({}); // action/reason fall back

    store.syncDiscovery("d_bad", null); // payload falls back to {}
    expect(store.getDiscovery("missing")).toBeNull();
    store.syncSubagent("s_bad", 123);
    expect(store.getSubagent("missing")).toBeNull();

    store.setStageSummary("scan", null);
    store.replaceClaims(null);

    // updateTodo missing id but truthy key -> exercises `todo || null` return branch
    expect(store.updateTodo("missing_todo", { status: "done" })).toBeNull();
    expect(await store.getSnapshot("missing_snap")).toBeNull(); // truthy id, not found

    // archive without `data.summary` exercises JSON-stringify summary fallback
    await store.archive("stage_no_summary", { a: 1 }, ["kw"]);
  });

  it("covers estimateBytes primitive branches and the _getL3Storage inFlight fast path", async () => {
    const { MemoryVfs } = await import("../../../../js/agents/vfs/vfs.memory.js");
    const store = await createStore({ runId: "ms_bytes", vfs: new MemoryVfs() });

    // Force the in-flight branch by providing a pending promise and leaving `_l3Storage` unset.
    store._l3Storage = null;
    store._l3StoragePromise = Promise.resolve(null);
    await store._getL3Storage();

    // Exercise estimateBytes early returns by feeding non-object entries.
    store._L3.snapshots.set("n", null);
    store._L3.snapshots.set("s", "text");
    store._L3.snapshots.set("num", 123);
    store._L3.snapshots.set("b", true);
    store._recalculateL3Bytes();
  });

  it("exposes internal tokenization helper for simple keyword splitting", async () => {
    const store = await createStore();
    expect(store._tokenize("Hello, world Q3")).toEqual(["hello", "world", "q3"]);
    expect(store._tokenize("a b c")).toEqual([]); // tokens <2 chars are filtered
  });

  it("extends DisposableBase and cleans up resources on dispose", async () => {
    const eventBus = { emit: vi.fn(), on: vi.fn(() => vi.fn()) };
    const { MemoryVfs } = await import("../../../../js/agents/vfs/vfs.memory.js");
    const vfs = new MemoryVfs();

    const store = await createStore({ eventBus, vfs });

    // Trigger lazy creation of RetrievalEngine and L3Storage
    await store._getL3Storage();
    store._getRetrievalEngine();

    expect(store._l3Storage).not.toBeNull();
    expect(store._retrievalEngine).not.toBeNull();

    // Should have `disposed` property from DisposableBase
    expect(store.disposed).toBe(false);

    await store.dispose();

    expect(store.disposed).toBe(true);
    expect(store._l3Storage).toBeNull();
    expect(store._l3StoragePromise).toBeNull();
    expect(store._retrievalEngine).toBeNull();
    expect(store._sharedContext).toBeNull();
    expect(store._discoveryManager).toBeNull();
    expect(store.eventBus).toBeNull();

    // Calling dispose again should be a no-op
    await store.dispose();
    expect(store.disposed).toBe(true);
  });

  it("dispose cleans up RetrievalEngine subscriptions", async () => {
    const unsubscribe = vi.fn();
    const eventBus = {
      emit: vi.fn(),
      on: vi.fn(() => unsubscribe),
    };

    const store = await createStore({ eventBus });

    // Force RetrievalEngine creation (it subscribes to eventBus in constructor)
    const engine = store._getRetrievalEngine();
    expect(engine._unsubscribeArchived).not.toBeNull();

    await store.dispose();

    // RetrievalEngine.dispose() should have been called, which calls unsubscribe
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("dispose handles missing dispose methods gracefully", async () => {
    const store = await createStore();

    // Inject mocks without dispose methods
    store._retrievalEngine = { recall: vi.fn() }; // no dispose
    store._l3Storage = {}; // no dispose

    // Should not throw
    await expect(store.dispose()).resolves.toBeUndefined();

    expect(store._retrievalEngine).toBeNull();
    expect(store._l3Storage).toBeNull();
  });

  it("dispose handles errors in cleanup gracefully", async () => {
    const store = await createStore();

    // Inject mocks that throw on dispose
    store._retrievalEngine = {
      dispose: vi.fn(() => {
        throw new Error("retrieval error");
      }),
    };
    store._l3Storage = {
      dispose: vi.fn(async () => {
        throw new Error("l3 error");
      }),
    };

    // Should not throw even when cleanup throws
    await expect(store.dispose()).resolves.toBeUndefined();
    expect(store.disposed).toBe(true);
  });

  // ===== Observability: Event Emission and Metrics =====

  describe("observability", () => {
    it("emits memory:l1:add events when adding messages, signals, and decisions", async () => {
      const eventBus = { emit: vi.fn() };
      const store = await createStore({ eventBus });

      store.addMessage({ role: "user", content: "hello" });
      expect(eventBus.emit).toHaveBeenCalledWith(
        "memory:l1:add",
        expect.objectContaining({
          actor: "memory",
          payload: expect.objectContaining({ type: "message", role: "user" }),
        })
      );

      eventBus.emit.mockClear();
      const sig = store.addSignal({ type: "warn", message: "alert" });
      expect(eventBus.emit).toHaveBeenCalledWith(
        "memory:l1:add",
        expect.objectContaining({
          actor: "memory",
          payload: expect.objectContaining({ type: "signal", signalType: "warn", id: sig.id }),
        })
      );

      eventBus.emit.mockClear();
      const dec = store.recordDecision({ action: "search", reason: "find info" });
      expect(eventBus.emit).toHaveBeenCalledWith(
        "memory:l1:add",
        expect.objectContaining({
          actor: "memory",
          payload: expect.objectContaining({ type: "decision", action: "search", id: dec.id }),
        })
      );
    });

    it("emits memory:l2:compress event when compressing messages", async () => {
      const eventBus = { emit: vi.fn() };
      const store = await createStore({ eventBus });

      // Add enough messages to compress
      store.addMessages([
        { role: "user", content: "first" },
        { role: "assistant", content: "response" },
        { role: "user", content: "second" },
        { role: "assistant", content: "another response" },
        { role: "user", content: "third" },
      ]);

      eventBus.emit.mockClear();
      store.compress({ force: true });

      expect(eventBus.emit).toHaveBeenCalledWith(
        "memory:l2:compress",
        expect.objectContaining({
          actor: "memory",
          payload: expect.objectContaining({
            compressedCount: expect.any(Number),
            keptCount: expect.any(Number),
            summaryTokens: expect.any(Number),
          }),
        })
      );
    });

    it("emits memory:l3:archive event when archiving data", async () => {
      const eventBus = { emit: vi.fn() };
      const store = await createStore({ eventBus });

      eventBus.emit.mockClear();
      const id = await store.archive("stage1", { summary: "Test" }, ["keyword1", "keyword2"]);

      expect(eventBus.emit).toHaveBeenCalledWith(
        "memory:l3:archive",
        expect.objectContaining({
          actor: "memory",
          payload: expect.objectContaining({
            id,
            stageKey: "stage1",
            keywordCount: 2,
          }),
        })
      );
    });

    it("emits memory:recall event when recalling memories", async () => {
      const eventBus = { emit: vi.fn() };
      const store = await createStore({ eventBus });

      await store.archive("stage", { summary: "Alpha summary" }, ["alpha"]);

      eventBus.emit.mockClear();
      store.recall("alpha", 3);

      expect(eventBus.emit).toHaveBeenCalledWith(
        "memory:recall",
        expect.objectContaining({
          actor: "memory",
          payload: expect.objectContaining({
            query: "alpha",
            resultCount: expect.any(Number),
            method: "keyword",
          }),
        })
      );
    });

    it("emits memory:recall with method=semantic for semanticRecall", async () => {
      const retrievalEngine = {
        recall: vi.fn(() => []),
        semanticRecall: vi.fn(async () => [{ id: "s1" }]),
        hybridRecall: vi.fn(async () => []),
      };
      const eventBus = { emit: vi.fn() };
      const store = await createStore({ eventBus, retrievalEngine });

      await store.semanticRecall("test query", { limit: 5 });

      expect(eventBus.emit).toHaveBeenCalledWith(
        "memory:recall",
        expect.objectContaining({
          actor: "memory",
          payload: expect.objectContaining({
            method: "semantic",
            resultCount: 1,
          }),
        })
      );
    });

    it("emits memory:recall with method=hybrid for hybridRecall", async () => {
      const retrievalEngine = {
        recall: vi.fn(() => []),
        semanticRecall: vi.fn(async () => []),
        hybridRecall: vi.fn(async () => [{ id: "h1" }, { id: "h2" }]),
      };
      const eventBus = { emit: vi.fn() };
      const store = await createStore({ eventBus, retrievalEngine });

      await store.hybridRecall("test query", { limit: 5 });

      expect(eventBus.emit).toHaveBeenCalledWith(
        "memory:recall",
        expect.objectContaining({
          actor: "memory",
          payload: expect.objectContaining({
            method: "hybrid",
            resultCount: 2,
          }),
        })
      );
    });

    it("returns structured metrics from getMetrics()", async () => {
      const store = await createStore();

      // Populate all layers
      store.addMessage({ role: "user", content: "hello" });
      store.addMessage({ role: "assistant", content: "hi there" });
      store.addSignal({ type: "info", message: "test signal" });
      store.recordDecision({ action: "search", reason: "need info" });
      store.setStageSummary("scan", "Found 3 documents");
      store.addClaim({ content: "Claim 1" });
      await store.archive("stage1", { summary: "Archive 1" }, ["kw"]);
      await store.checkpoint();
      store.recall("test", 3);

      const metrics = store.getMetrics();

      // Verify L1 metrics
      expect(metrics.l1).toEqual({
        messageCount: 2,
        signalCount: 1,
        decisionCount: 1,
        tokenEstimate: expect.any(Number),
      });
      expect(metrics.l1.tokenEstimate).toBeGreaterThan(0);

      // Verify L2 metrics
      expect(metrics.l2).toEqual({
        stageSummaryCount: 1,
        claimCount: 1,
      });

      // Verify L3 metrics
      expect(metrics.l3).toEqual({
        archiveCount: 1,
        checkpointCount: 1,
      });

      // Verify operations metrics
      expect(metrics.operations).toEqual({
        recallCount: 1,
        compressCount: 0,
        archiveCount: 1,
      });
    });

    it("increments operation counters correctly across multiple operations", async () => {
      const store = await createStore();

      // Multiple archives
      await store.archive("s1", { summary: "A1" }, []);
      await store.archive("s2", { summary: "A2" }, []);
      await store.archive("s3", { summary: "A3" }, []);

      // Multiple recalls
      store.recall("test1", 1);
      store.recall("test2", 1);

      // Force compression
      store.addMessages([
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
        { role: "assistant", content: "d" },
      ]);
      store.compress({ force: true });

      const metrics = store.getMetrics();

      expect(metrics.operations.archiveCount).toBe(3);
      expect(metrics.operations.recallCount).toBe(2);
      expect(metrics.operations.compressCount).toBe(1);
    });
  });
});
