import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("stripThinkingTags: removes <think> blocks from R1 model output", async () => {
  const { stripThinkingTags } = await import("../../../js/agents/stages/deepsearch/state.js");

  // Basic case
  const input1 = '<think>This is reasoning...</think>{"result": "success"}';
  expect(stripThinkingTags(input1)).toBe('{"result": "success"}');

  // Multiple think blocks
  const input2 = '<think>First thought</think>prefix<think>Second thought</think>{"data": 1}';
  expect(stripThinkingTags(input2)).toBe('prefix{"data": 1}');

  // Multiline think content
  const input3 = `<think>
Line 1
Line 2
</think>
{"json": true}`;
  expect(stripThinkingTags(input3)).toBe('{"json": true}');

  // No think tags - should return as-is
  const input4 = '{"normal": "json"}';
  expect(stripThinkingTags(input4)).toBe('{"normal": "json"}');

  // Case insensitive
  const input5 = '<THINK>Uppercase</THINK>{"result": 1}';
  expect(stripThinkingTags(input5)).toBe('{"result": 1}');
});

it("extractJsonCandidate: extracts JSON after stripping think tags", async () => {
  const { extractJsonCandidate } = await import("../../../js/agents/stages/deepsearch/state.js");

  // R1 style output with think block followed by JSON
  const r1Output = `<think>
Let me analyze this step by step:
1. First, I need to understand the gaps
2. Then generate new questions
{"internal": "this should be ignored"}
</think>

{"gaps": [{"question": "What is X?", "priority": "high"}]}`;

  const result = extractJsonCandidate(r1Output);
  const parsed = JSON.parse(result);
  expect(Array.isArray(parsed.gaps)).toBeTruthy();
  expect(parsed.gaps[0].question).toBe("What is X?");
});

it("extractJsonCandidate: handles fenced code blocks after think tags", async () => {
  const { extractJsonCandidate } = await import("../../../js/agents/stages/deepsearch/state.js");

  const input = `<think>Some reasoning here</think>

\`\`\`json
{"title": "Test", "markdown": "# Hello"}
\`\`\``;

  const result = extractJsonCandidate(input);
  const parsed = JSON.parse(result);
  expect(parsed.title).toBe("Test");
});

it("extractJsonCandidate: supports top-level JSON arrays", async () => {
  const { extractJsonCandidate } = await import("../../../js/agents/stages/deepsearch/state.js");

  const input = 'prefix [{"a":1},{"b":2}] suffix';
  const result = extractJsonCandidate(input);
  const parsed = JSON.parse(result);
  expect(Array.isArray(parsed)).toBeTruthy();
  expect(parsed[0].a).toBe(1);
  expect(parsed[1].b).toBe(2);
});

it("extractJsonCandidate: selects the correct closing brace when extra braces exist", async () => {
  const { extractJsonCandidate } = await import("../../../js/agents/stages/deepsearch/state.js");

  const input = 'prefix {"a":1} suffix } trailing';
  const result = extractJsonCandidate(input);
  expect(result).toBe('{"a":1}');
});

it("extractJsonCandidate: handles empty or null input", async () => {
  const { extractJsonCandidate } = await import("../../../js/agents/stages/deepsearch/state.js");

  expect(extractJsonCandidate(null)).toBe(null);
  expect(extractJsonCandidate("")).toBe(null);
  expect(extractJsonCandidate("   ")).toBe(null);
  expect(extractJsonCandidate("<think>only thinking</think>")).toBe(null);
});

it("DeepSearchState.clone: uses structuredClone for non-JSON types when available", async () => {
  if (typeof structuredClone !== "function") return;
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({ runId: "run_clone_types", taskGoal: "t" });
  const when = new Date("2020-01-01T00:00:00.000Z");
  const meta = new Map([["k", "v"]]);
  const tags = new Set(["a", "b"]);
  state.todos = [{ todoId: "t1", status: "open", text: "x", when, meta, tags }];

  const cloned = state.clone();
  expect(cloned).not.toBe(state);
  expect(cloned.todos).not.toBe(state.todos);
  expect(cloned.todos[0].when instanceof Date).toBe(true);
  expect(cloned.todos[0].meta instanceof Map).toBe(true);
  expect(cloned.todos[0].tags instanceof Set).toBe(true);
  expect([...cloned.todos[0].meta.entries()]).toEqual([...meta.entries()]);
  expect([...cloned.todos[0].tags.values()]).toEqual([...tags.values()]);
});

it("DeepSearchState.clone: falls back safely for function/symbol values", async () => {
  if (typeof structuredClone !== "function") return;
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  {
    const state = new DeepSearchState({ runId: "run_clone_fallback_fn", taskGoal: "t" });
    const fn = () => {};
    state.todos = [{ todoId: "t1", bad: fn }];
    const cloned = state.clone();
    expect(typeof cloned.todos[0].bad).toBe("function");
    expect(cloned.todos[0].bad).toBe(fn);
  }

  {
    const state = new DeepSearchState({ runId: "run_clone_fallback_sym", taskGoal: "t" });
    const sym = Symbol("x");
    state.todos = [{ todoId: "t1", bad: sym }];
    const cloned = state.clone();
    expect(typeof cloned.todos[0].bad).toBe("symbol");
    expect(cloned.todos[0].bad).toBe(sym);
  }
});

it("cloneValue: avoids recursion overflow in hasCycle for deep objects", async () => {
  const { cloneValue } = await import("../../../js/agents/stages/deepsearch/runtime/checkpoint.js");

  const originalStructuredClone = globalThis.structuredClone;
  globalThis.structuredClone = (value) => value;
  try {
    const depth = 20000;
    const root = {};
    let cursor = root;
    for (let i = 0; i < depth; i++) {
      cursor.next = {};
      cursor = cursor.next;
    }

    const cloned = cloneValue(root);
    expect(cloned).toBe(root);
  } finally {
    globalThis.structuredClone = originalStructuredClone;
  }
});

it("DeepSearchState.saveCheckpoint: stamps checkpoint schema version", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({ runId: "run_ckpt_schema", taskGoal: "t" });
  const cp = state.saveCheckpoint({ checkpointId: "cp1" });

  expect(cp.schemaVersion).toBe("1.0");
  expect(cp.stateSnapshot.checkpointSchemaVersion).toBe("1.0");
});

it("DeepSearchState.saveCheckpoint: minimal strategy produces lean snapshot", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_ckpt_min",
    taskGoal: "t",
    userConfig: { checkpointStrategy: "minimal" },
  });
  state.L2.retrievedChunks = [{ chunkId: "c1", text: "x" }];
  state.L2.tokenUsage = { input: 1, output: 2, total: 3, estimatedCostUSD: 0 };

  const cp = state.saveCheckpoint({ checkpointId: "cp_min" });
  expect(cp.strategy).toBe("minimal");
  expect(cp.stateSnapshot.snapshotStrategy).toBe("minimal");
  expect("retrievedChunkIds" in cp.stateSnapshot.L2).toBe(false);

  state.L2.retrievedChunks = [{ chunkId: "c2", text: "y" }];
  state.restoreCheckpoint("cp_min");
  expect(state.L2.restoredFromMinimalCheckpoint).toBe(true);
  expect(state.L2.retrievedChunks).toEqual([]);
  expect(state.L2.tokenUsage.total).toBe(3);
});

it("DeepSearchState.addTimeline: enforces maxTimeline cap", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_timeline_cap",
    taskGoal: "t",
    userConfig: { memory: { maxTimeline: 2 } },
  });

  state.addTimeline({ name: "e1" });
  state.addTimeline({ name: "e2" });
  state.addTimeline({ name: "e3" });

  // timeline 是 Deque，使用 size 和 toArray()
  expect(state.timeline.size).toBe(2);
  const arr = state.timeline.toArray();
  expect(arr[0].name).toBe("e2");
  expect(arr[1].name).toBe("e3");
});

it("DeepSearchState.saveCheckpoint: enforces maxCheckpoints cap", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_ckpt_cap",
    taskGoal: "t",
    userConfig: { memory: { maxCheckpoints: 2 } },
  });

  state.saveCheckpoint({ checkpointId: "cp1" });
  state.saveCheckpoint({ checkpointId: "cp2" });
  state.saveCheckpoint({ checkpointId: "cp3" });

  expect(state.checkpoints.length).toBe(2);
  expect(state.checkpoints[0].checkpointId).toBe("cp2");
  expect(state.checkpoints[1].checkpointId).toBe("cp3");
});

it("SharedContext: prunes store, signals, decisions, seen, and index", async () => {
  const { SharedContext } = await import("../../../js/agents/stages/deepsearch/runtime/shared-context.js");

  {
    const ctx = new SharedContext({ runId: "ctx_store", limits: { storeMax: 2 } });
    ctx.store("a", { v: 1 });
    ctx.store("b", { v: 2 });
    ctx.store("c", { v: 3 });
    expect(ctx.has("a")).toBe(false);
    expect(ctx.has("b")).toBe(true);
    expect(ctx.has("c")).toBe(true);
    expect(ctx.getStats().storeItems).toBe(2);
  }

  {
    const ctx = new SharedContext({ runId: "ctx_sig", limits: { signalsMax: 2 } });
    const s1 = ctx.signal("s", { type: "t1" });
    const s2 = ctx.signal("s", { type: "t2" });
    const s3 = ctx.signal("s", { type: "t3" });
    expect(ctx.getSignals().map((s) => s.id)).toEqual([s2.id, s3.id]
    );
    expect(s1.id).not.toBe(s2.id);
    expect(s2.id).not.toBe(s3.id);
  }

  {
    const ctx = new SharedContext({ runId: "ctx_dec", limits: { decisionsMax: 2 } });
    const d1 = ctx.recordDecision({ action: "a" });
    const d2 = ctx.recordDecision({ action: "b" });
    const d3 = ctx.recordDecision({ action: "c" });
    expect(ctx.getDecisions().map((d) => d.id)).toEqual([d2.id, d3.id]
    );
    expect(d1.id).not.toBe(d2.id);
    expect(d2.id).not.toBe(d3.id);
  }

  {
    const ctx = new SharedContext({ runId: "ctx_seen", limits: { seenMax: 2 } });
    ctx.markSeen("alpha");
    ctx.markSeen("beta");
    ctx.markSeen("gamma");
    expect(ctx.hasSeen("alpha")).toBe(false);
    expect(ctx.hasSeen("beta")).toBe(true);
    expect(ctx.hasSeen("gamma")).toBe(true);
  }

  {
    const originalNow = Date.now;
    let now = 1_700_000_000_000;
    Date.now = () => (now += 1);

    try {
      const ctx = new SharedContext({ runId: "ctx_index", limits: { indexKeywordsMax: 2, storeMax: 100 } });
      const id1 = ctx.commit("s", { full: { n: 1 }, keywords: ["a"] });
      const id2 = ctx.commit("s", { full: { n: 2 }, keywords: ["b"] });
      const id3 = ctx.commit("s", { full: { n: 3 }, keywords: ["c"] });
      expect(ctx.search("a").length).toBe(0);
      expect(ctx.search("b")).toEqual([id2]);
      expect(ctx.search("c")).toEqual([id3]);
      expect(ctx.has(id1)).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  }

  {
    const originalNow = Date.now;
    let now = 1_700_000_100_000;
    Date.now = () => (now += 1);

    try {
      const ctx = new SharedContext({
        runId: "ctx_ids_per_kw",
        limits: { indexIdsPerKeywordMax: 2, indexKeywordsMax: 10, storeMax: 100 },
      });
      const id1 = ctx.commit("s", { full: { n: 1 }, keywords: ["k"] });
      const id2 = ctx.commit("s", { full: { n: 2 }, keywords: ["k"] });
      const id3 = ctx.commit("s", { full: { n: 3 }, keywords: ["k"] });
      expect(ctx.search("k")).toEqual([id2, id3]);
      expect(ctx.has(id1)).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  }
});

it("SharedContext: action stream rehydrates state and preserves version", async () => {
  const { SharedContext } = await import("../../../js/agents/stages/deepsearch/runtime/shared-context.js");

  const originalNow = Date.now;
  Date.now = () => 1_700_000_000_000; // constant time to stress ID collisions

  try {
    const ctx1 = new SharedContext({
      runId: "ctx_actions_src",
      limits: {
        actionsMax: 200,
        storeMax: 50,
        signalsMax: 50,
        decisionsMax: 50,
        indexKeywordsMax: 200,
        indexIdsPerKeywordMax: 20,
      },
    });

    expect(ctx1.getVersion()).toBe(0);

    ctx1.setSummary("stageA", "sumA");
    const sig = ctx1.signal("advice", { type: "advice", message: "hello" });
    const dec = ctx1.recordDecision({ action: "do", reason: "because" });
    ctx1.addToIndex("k", "id123");
    ctx1.store("id123", { v: 1 });
    const commitId = ctx1.commit("finding", { full: { x: 1 }, summary: "sumFinding", keywords: ["k2"] });
    ctx1.setIndex("design", { keywords: ["kw"], paths: ["p"], ids: ["i"] });

    expect(ctx1.getVersion()).toBeGreaterThan(0);

    const actions = ctx1.getActions({ sinceVersion: 0, limit: 500 });
    expect(actions.length >= 6).toBeTruthy();
    expect(actions.every((a) => typeof a?.kind === "string" && a.kind.length > 0)).toBe(true);
    expect(actions.every((a) => Number.isFinite(Number(a?.version)))).toBe(true);

    const ctx2 = new SharedContext({
      runId: "ctx_actions_dst",
      limits: {
        actionsMax: 200,
        storeMax: 50,
        signalsMax: 50,
        decisionsMax: 50,
        indexKeywordsMax: 200,
        indexIdsPerKeywordMax: 20,
      },
    });

    ctx2.applyActions(actions);

    expect(ctx2.getVersion()).toBe(ctx1.getVersion());
    expect(ctx2.getSummary("stageA")).toBe("sumA");
    expect(ctx2.has("id123")).toBe(true);
    expect(ctx2.has(commitId)).toBe(true);
    expect(ctx2.search("k").includes("id123")).toBe(true);
    expect(ctx2.search("k2").includes(commitId)).toBe(true);

    const appliedSignals = ctx2.getSignals();
    expect(appliedSignals.length > 0).toBe(true);
    expect(appliedSignals.some((s) => s?.id === sig.id)).toBe(true);
    expect(appliedSignals.some((s) => s?.payload?.message === "hello")).toBe(true);

    const appliedDecisions = ctx2.getDecisions();
    expect(appliedDecisions.length > 0).toBe(true);
    expect(appliedDecisions.some((d) => d?.id === dec.id)).toBe(true);
    expect(appliedDecisions.some((d) => d?.action === "do")).toBe(true);
  } finally {
    Date.now = originalNow;
  }
});

it("SharedContext: filters signals by targetTaskId (keeps broadcast signals)", async () => {
  const { SharedContext } = await import("../../../js/agents/stages/deepsearch/runtime/shared-context.js");

  const ctx = new SharedContext({ runId: "ctx_task_scope" });
  ctx.signal("advice", { type: "advice", targetTaskId: "task_a", message: "for A" });
  ctx.signal("advice", { type: "advice", targetTaskId: "task_b", message: "for B" });
  ctx.signal("notice", { type: "notice", message: "broadcast" });

  const scopedPrompt = ctx.buildBlackboardPrompt({ maxSignals: 10, targetTaskId: "task_a" });
  expect(scopedPrompt.includes("for A")).toBeTruthy();
  expect(scopedPrompt.includes("broadcast")).toBeTruthy();
  expect(scopedPrompt.includes("for B")).toBe(false);

  const allPrompt = ctx.buildBlackboardPrompt({ maxSignals: 10 });
  expect(allPrompt.includes("for A")).toBeTruthy();
  expect(allPrompt.includes("for B")).toBeTruthy();
  expect(allPrompt.includes("broadcast")).toBeTruthy();

  const scopedSignals = ctx.getSignals({ targetTaskId: "task_a" });
  const scopedMsgs = scopedSignals.map((s) => s?.payload?.message).filter(Boolean);
  expect(scopedMsgs.includes("for A")).toBeTruthy();
  expect(scopedMsgs.includes("broadcast")).toBeTruthy();
  expect(scopedMsgs.includes("for B")).toBe(false);
});

it("DeepSearchState.restoreCheckpoint: migrates legacy checkpoints without schemaVersion", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({ runId: "run_ckpt_migrate", taskGoal: "t" });
  state.iteration = 2;
  state.saveCheckpoint({ checkpointId: "cp_legacy" });

  delete state.checkpoints[0].schemaVersion;

  state.iteration = 99;
  state.restoreCheckpoint("cp_legacy");

  expect(state.iteration).toBe(2);
  expect(state.checkpoints[0].schemaVersion).toBe("1.0");
});

it("DeepSearchState.restoreCheckpoint: warns on unknown checkpoint schema versions", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({ runId: "run_ckpt_warn", taskGoal: "t" });
  state.saveCheckpoint({ checkpointId: "cp_unknown" });
  state.checkpoints[0].schemaVersion = "999.0";

  let warnCount = 0;
  const originalWarn = console.warn;
  console.warn = () => {
    warnCount += 1;
  };

  try {
    state.restoreCheckpoint("cp_unknown");
  } finally {
    console.warn = originalWarn;
  }

  expect(warnCount >= 1).toBeTruthy();
});

it("Checkpoint E2E: 保存完整状态并恢复", async () => {
  if (typeof structuredClone !== "function") return;
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const createdAt = "2020-01-01T00:00:00.000Z";
  const when = new Date("2021-01-01T00:00:00.000Z");
  const gapMeta = new Map([["k", "v"]]);
  const gapTags = new Set(["t1", "t2"]);

  const state = new DeepSearchState({
    runId: "run_ckpt_e2e_full",
    taskGoal: "Test checkpoint E2E full flow",
    createdAt,
    iteration: 2,
    maxIterations: 5,
    userConfig: { checkpointStrategy: "full" },
  });

  state.L0 = {
    sources: [{ sourceId: "s1", title: "Source 1", url: "https://example.com" }],
    sourceIndex: { s1: 0 },
  };
  state.L1.gaps = [{ gapId: "gap_1", question: "What is X?", priority: "high", status: "open", createdAt: when, meta: gapMeta, tags: gapTags }];
  state.L1.claims = [{ claimId: "claim_1", text: "X is Y", createdAt: when, meta: new Map([["c", "1"]]) }];
  state.L1.evidenceLedger = [{ evidenceId: "ev_1", claimId: "claim_1", quote: "Evidence", createdAt: when, refs: new Set(["r1"]) }];
  state.L2.retrievedChunks = [{ chunkId: "ch_1", text: "chunk", score: 0.5 }];
  state.L2.scratchpad = { rounds: [1, 2], ctx: new Map([["a", { b: 1 }]]) };
  state.todos = [{ todoId: "t1", status: "open", text: "Fill gap", tags: new Set(["todo"]) }];
  state.timeline = [{ name: "deepsearch.test", status: "info", payload: { ok: true }, timestamp: "2020-01-01T00:00:01.000Z" }];

  const original = structuredClone(state.toJSON({ includeCheckpoints: false }));
  const cp = state.saveCheckpoint({ checkpointId: "cp_full_e2e" });

  expect(cp.schemaVersion).toBe("1.0");
  expect(cp.strategy).toBe("full");
  // 优化后快照是普通对象而非 DeepSearchState 实例（restoreCheckpoint 时重建）
  expect(typeof cp.stateSnapshot === "object" && cp.stateSnapshot !== null).toBeTruthy();

  expect(cp.stateSnapshot).not.toBe(state);
  expect(cp.stateSnapshot.L1).not.toBe(state.L1);
  expect(cp.stateSnapshot.L1.gaps).not.toBe(state.L1.gaps);
  expect(cp.stateSnapshot.L1.gaps[0].createdAt instanceof Date).toBe(true);
  expect(cp.stateSnapshot.L1.gaps[0].meta instanceof Map).toBe(true);
  expect(cp.stateSnapshot.L1.gaps[0].tags instanceof Set).toBe(true);
  expect(cp.stateSnapshot.L1.gaps[0].meta).not.toBe(state.L1.gaps[0].meta);
  expect(cp.stateSnapshot.L1.gaps[0].tags).not.toBe(state.L1.gaps[0].tags);

  state.L1.gaps[0].question = "mutated";
  state.L1.gaps[0].meta.set("k", "mutated");
  state.L2.scratchpad.rounds.push(999);

  expect(cp.stateSnapshot.L1.gaps[0].question).toBe("What is X?");
  expect(cp.stateSnapshot.L1.gaps[0].meta.get("k")).toBe("v");
  expect(cp.stateSnapshot.L2.scratchpad.rounds).toEqual([1, 2]);

  state.iteration = 123;
  state.L0.sources = [];
  state.L1.claims = [];
  state.L2.retrievedChunks = [];

  state.restoreCheckpoint("cp_full_e2e");

  const restored = state.toJSON({ includeCheckpoints: false });
  expect({ ...restored, timeline: restored.timeline.slice(0, -1) }).toEqual(original);
  expect(restored.timeline.at(-1).name).toBe("deepsearch.checkpoint.restored");
});

it("Checkpoint E2E: legacy checkpoint 迁移", async () => {
  const { loadCheckpoint } = await import("../../../js/agents/stages/deepsearch/state.js");

  const legacy = {
    checkpointId: "cp_legacy_no_version",
    iteration: 1,
    timestamp: "2020-01-01T00:00:00.000Z",
    strategy: "lite",
    stateSnapshot: { snapshotStrategy: "lite", runId: "run_legacy", iteration: 1 },
    metrics: { gapCount: 1, claimCount: 1, evidenceCount: 1, retrievedCount: 1 },
  };

  const migrated = loadCheckpoint(legacy);
  expect(migrated).not.toBe(legacy);
  expect(migrated.schemaVersion).toBe("1.0");
  expect(migrated.checkpointId).toBe("cp_legacy_no_version");
  expect(loadCheckpoint(migrated)).toBe(migrated);
});

it("Checkpoint E2E: 中断恢复场景", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const runRounds = (state, { stopAfterIteration } = {}) => {
    while (state.iteration < state.maxIterations) {
      const next = state.iteration + 1;
      if (!state.L2.scratchpad || typeof state.L2.scratchpad !== "object") state.L2.scratchpad = {};
      if (!Array.isArray(state.L2.scratchpad.rounds)) state.L2.scratchpad.rounds = [];
      state.L2.scratchpad.rounds.push(next);
      state.L1.claims.push({ claimId: `claim_${next}`, text: `Claim ${next}` });
      state.iteration = next;
      if (typeof stopAfterIteration === "number" && state.iteration === stopAfterIteration) return;
    }
  };

  const state = new DeepSearchState({
    runId: "run_ckpt_interrupt",
    taskGoal: "Interrupt and resume",
    createdAt: "2020-01-01T00:00:00.000Z",
    iteration: 0,
    maxIterations: 5,
    userConfig: { checkpointStrategy: "full" },
  });

  let checkpoint;
  try {
    runRounds(state, { stopAfterIteration: 2 });
    checkpoint = state.saveCheckpoint({ checkpointId: "cp_interrupt" });
    throw new Error("interrupted");
  } catch (err) {
    expect(String(err?.message)).toBe("interrupted");
  }

  const resumed = new DeepSearchState({ runId: "run_new", taskGoal: "new" });
  resumed.checkpoints = [checkpoint];
  resumed.restoreCheckpoint("cp_interrupt");

  expect(resumed.runId).toBe("run_ckpt_interrupt");
  expect(resumed.iteration).toBe(2);
  expect(resumed.L2.scratchpad.rounds).toEqual([1, 2]);

  runRounds(resumed);
  expect(resumed.iteration).toBe(5);
  expect(resumed.L2.scratchpad.rounds).toEqual([1, 2, 3, 4, 5]);
});

it("SourceManager: reads docs with consistent modes and caches line indexes", async () => {
  const { SourceManager } = await import("../../../js/agents/stages/deepsearch/source-manager.js");

  const doc1 = {
    sourceId: "doc_1",
    name: "Doc One",
    sourceText: "# Title\n\n## A\nA1\nA2\n\n## B\nB1\n",
  };
  const doc2 = {
    sourceId: "doc_2",
    title: "Doc Two",
    sourceTextNormalized: "Line1\nLine2\nLine3",
  };

  const manager = new SourceManager([doc1, doc2], { maxCachedLineIndexes: 1 });

  const full = manager.read("doc_1", { maxLength: 10000 });
  expect(full.success).toBe(true);
  expect(full.readMode).toBe("full");
  expect(full.lineStart).toBe(1);
  expect(typeof full.lineEnd).toBe("number");

  const preview = manager.read("doc_1", { preview: true, maxLength: 10000 });
  expect(preview.success).toBe(true);
  expect(preview.readMode).toBe("preview");
  expect(preview.content.includes("## 文档结构")).toBeTruthy();
  expect(preview.content.includes("## 内容预览")).toBeTruthy();
  expect(typeof preview.headingCount).toBe("number");

  const section = manager.read("doc_1", { section: "## A", maxLength: 10000 });
  expect(section.success).toBe(true);
  expect(section.readMode).toBe("section");
  expect(section.content.includes("## A")).toBeTruthy();
  expect(section.content.includes("A1")).toBeTruthy();
  expect(section.lineStart >= 1).toBeTruthy();
  expect(section.lineEnd >= section.lineStart).toBeTruthy();

  const lines = manager.read("doc_2", { startLine: 2, endLine: 2, maxLength: 10000 });
  expect(lines.success).toBe(true);
  expect(lines.readMode).toBe("lines");
  expect(lines.content.trim()).toBe("Line2");
  expect(lines.lineStart).toBe(2);
  expect(lines.lineEnd).toBe(2);

  // LRU cap keeps only the most recent entry
  expect(manager._lineStartsCache.size).toBe(1);
  expect(manager._lineStartsCache.has("doc_2")).toBe(true);

  const chars = manager.read("doc_2", { start: 0, end: 1, maxLength: 10000 });
  expect(chars.success).toBe(true);
  expect(chars.readMode).toBe("chars");
  expect(chars.lineStart).toBe(1);
  expect(chars.lineEnd).toBe(1);
});

it("read-doc/search-docs tools: share SourceManager and keep outputs stable", async () => {
  const { default: SourceManager } = await import("../../../js/agents/stages/deepsearch/source-manager.js");
  const { handler: readDoc } = await import("../../../js/agents/stages/deepsearch/tools/read-doc/handler.js");
  const { handler: searchDocs } = await import("../../../js/agents/stages/deepsearch/tools/search-docs/handler.js");

  const state = {
    L0: {
      sources: [
        { sourceId: "s1", name: "S1", sourceText: "alpha\nbeta\ngamma\n" },
        { sourceId: "s2", name: "S2", sourceText: "delta\nepsilon\n" },
      ],
    },
    L1: {},
    L2: {},
    todos: [],
  };

  const events = [];
  const manager = new SourceManager(state.L0.sources, { maxCachedLineIndexes: 2 });

  const readRes = await readDoc(
    { sourceId: "s1", startLine: 2, endLine: 2, maxLength: 5000 },
    {
      state,
      emit: (name, payload) => events.push({ name, payload }),
      sourceManager: manager,
    }
  );
  expect(readRes.success).toBe(true);
  expect(readRes.readMode).toBe("lines");
  expect(readRes.content.trim()).toBe("beta");
  expect(state.L1.readDocIds).toEqual(["s1"]);
  expect(events.some(e => e.name === "deepsearch.doc.read")).toBeTruthy();

  const searchRes = await searchDocs(
    { query: "alpha", limit: 10 },
    {
      state,
      emit: () => {},
      sourceManager: manager,
    }
  );
  expect(searchRes.success).toBe(true);
  expect(Array.isArray(searchRes.results)).toBe(true);
  expect(searchRes.results.some((r) => r.sourceId === "s1")).toBe(true);

  const restricted = await searchDocs(
    { query: "alpha", sources: ["s2"], limit: 10 },
    {
      state,
      emit: () => {},
      sourceManager: manager,
    }
  );
  expect(restricted.success).toBe(true);
  expect(restricted.results.length).toBe(0);
});

it("report-postprocess: review/reorder/validate share a single implementation", async () => {
  const {
    reviewReportMarkdown,
    reorderReportSections,
    validateReport,
    getReportProgress,
    prepareReportForSubmit,
  } = await import("../../../js/agents/stages/deepsearch/report/report-postprocess.js");

  const longPara = `Paragraph:${"x".repeat(80)}`;
  const markdown = [
    "## A",
    "",
    "keep",
    "",
    "## A",
    "",
    "REMOVE_ME",
    "",
    "## B",
    "",
    longPara,
    "",
    longPara,
    "",
    "**",
    "",
    "**建议",
    "",
  ].join("\n");

  const reviewed = reviewReportMarkdown(markdown);
  expect(reviewed.fixed).toBe(true);
  expect(reviewed.markdown.includes("REMOVE_ME")).toBe(false);
  expect(reviewed.markdown.includes("**\n\n**")).toBe(false);
  expect(reviewed.issues.some((i) => i.type === "duplicate_heading")).toBe(true);
  expect(reviewed.issues.some((i) => i.type === "duplicate_paragraph")).toBe(true);
  expect(reviewed.issues.some((i) => i.type === "broken_formatting")).toBe(true);

  const reordered = reorderReportSections(
    ["## X", "", "x", "", "## 参考文献", "", "ref1", "", "## Y", "", "y", "", "## 参考文献", "", "ref2"].join("\n")
  );
  expect((reordered.match(/## 参考文献/g) || []).length).toBe(1);
  expect(reordered.indexOf("## Y") < reordered.indexOf("## 参考文献")).toBe(true);
  expect(reordered.includes("ref1")).toBe(true);
  expect(reordered.includes("ref2")).toBe(true);

  const state = { globalConfig: { report: { quick: { minWords: 10, minReferences: 1 } } } };
  const okReport = "## 摘要\n\n内容 [doc:L1]\n\n## 发现\n\nOK";
  const ok = validateReport(okReport, "quick", state);
  expect(ok.valid).toBe(true);
  expect(ok.warnings.some((w) => w.includes("信息缺口"))).toBe(true);

  const progress = getReportProgress({ markdown: okReport }, "quick", state);
  expect(progress.isReady).toBe(true);

  const processed = prepareReportForSubmit(
    "## 摘要\n\n内容 [doc:L1]\n\n## 发现\n\nOK\n\n## 参考文献\n\nrefA\n\n## 参考文献\n\nrefB\n",
    "quick",
    state
  );
  expect(processed.validation.valid).toBe(true);
  expect((processed.markdown.match(/## 参考文献/g) || []).length).toBe(1);
  expect(processed.markdown.includes("refA")).toBe(true);
  expect(processed.markdown.includes("refB")).toBe(true);
  expect(processed.review.fixed).toBe(false);
});

it("report-postprocess: returns issues on invalid reports", async () => {
  const { reviewReportMarkdown, validateReport, getReportProgress } = await import(
    "../../../js/agents/stages/deepsearch/report/report-postprocess.js"
  );

  const empty = reviewReportMarkdown("");
  expect(empty.fixed).toBe(false);
  expect(empty.issues).toEqual([]);

  const state = {
    globalConfig: {
      report: {
        quick: { minWords: 1, minReferences: 1, requiredSections: ["摘要"], recommendedSections: ["结论"] },
      },
    },
  };
  const badReport = "no sections and no refs";
  const bad = validateReport(badReport, "quick", state);
  expect(bad.valid).toBe(false);
  expect(bad.issues.some((i) => i.includes("缺少必需章节"))).toBe(true);
  expect(bad.issues.some((i) => i.includes("引用不足"))).toBe(true);
  expect(bad.warnings.some((w) => w.includes("建议添加章节"))).toBe(true);

  const progress = getReportProgress({ markdown: badReport }, "quick", state);
  expect(progress.isReady).toBe(false);
});

it("WritingPhaseHandler: system retries do not consume writing iterations", async () => {
  const { WritingPhaseHandler } = await import("../../../js/agents/stages/deepsearch/runtime/writing-phase-handler.js");

  let calls = 0;
  const responses = [
    { content: "" },
    { content: "not json" },
    { content: JSON.stringify({ thought: "t", action: "write-report", args: { action: "append", content: "x" } }) },
  ];

  const handler = new WritingPhaseHandler({
    logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
    emit: () => {},
    parseDecision: (content) => {
      try {
        return JSON.parse(content);
      } catch {
        return null;
      }
    },
    executeTool: async () => ({ success: true }),
    maxIterations: 1,
    maxParseFailures: 3,
  });

  const state = { L1: { report: { markdown: "" } }, todos: [], userConfig: { mode: "quick" }, globalConfig: { report: { quick: { minWords: 0 } } } };
  const addMessage = () => {};
  const messages = () => [];
  const signal = new AbortController().signal;

  const result = await handler.run({
    state,
    stageApi: {},
    sharedContext: null,
    callModel: async () => responses[calls++] || responses.at(-1),
    addMessage,
    messages,
    signal,
  });

  expect(calls).toBe(3);
  expect(result.iterations).toBe(1);
});

it("DeepSearchAgentLoop: caps system retries without consuming iteration budget", async () => {
  const { DeepSearchAgentLoop, AgentStatus } = await import("../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");

  let calls = 0;
  const stageApi = {
    signal: new AbortController().signal,
    modelRouter: {
      call: async () => {
        calls += 1;
        throw new Error("transient");
      },
    },
  };

  const agent = new DeepSearchAgentLoop({
    mode: "quick",
    maxIterations: 2,
    config: { report: { quick: { minWords: 0 } }, agent: { quick: { writeIterations: 1 } } },
  });

  const output = await agent.run(
    {
      runId: "run_system_retry_cap",
      taskGoal: "t",
      userConfig: { maxSystemRetriesPerIteration: 2 },
      L0: { sources: [] },
      // Avoid entering writing phase during this test.
      L1: { report: { markdown: "x".repeat(5000) } },
    },
    { stageApi }
  );

  expect(calls).toBe(4);
  expect(output.status).toBe(AgentStatus.COMPLETED);
});

it("DeepSearchAgentLoop: fail-fast on non-recoverable model errors", async () => {
  const { DeepSearchAgentLoop, AgentStatus } = await import("../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");

  let calls = 0;
  const stageApi = {
    signal: new AbortController().signal,
    modelRouter: {
      call: async () => {
        calls += 1;
        const err = new Error("Unauthorized");
        err.status = 401;
        throw err;
      },
    },
  };

  const agent = new DeepSearchAgentLoop({
    mode: "quick",
    maxIterations: 3,
    config: { report: { quick: { minWords: 0 } }, agent: { quick: { writeIterations: 1 } } },
  });

  await expect(() =>
      agent.run(
        {
          runId: "run_fail_fast_auth",
          taskGoal: "t",
          userConfig: {},
          L0: { sources: [] },
          L1: { report: { markdown: "x".repeat(5000) } },
        },
        { stageApi }
      ),
    /Unauthorized/
  );

  expect(calls).toBe(1);
  expect(agent.status).toBe(AgentStatus.FAILED);
});
