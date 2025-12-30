const test = require("node:test");
const assert = require("node:assert/strict");

test("stripThinkingTags: removes <think> blocks from R1 model output", async () => {
  const { stripThinkingTags } = await import("../../../js/agents/stages/deepsearch/state.js");

  // Basic case
  const input1 = '<think>This is reasoning...</think>{"result": "success"}';
  assert.equal(stripThinkingTags(input1), '{"result": "success"}');

  // Multiple think blocks
  const input2 = '<think>First thought</think>prefix<think>Second thought</think>{"data": 1}';
  assert.equal(stripThinkingTags(input2), 'prefix{"data": 1}');

  // Multiline think content
  const input3 = `<think>
Line 1
Line 2
</think>
{"json": true}`;
  assert.equal(stripThinkingTags(input3), '{"json": true}');

  // No think tags - should return as-is
  const input4 = '{"normal": "json"}';
  assert.equal(stripThinkingTags(input4), '{"normal": "json"}');

  // Case insensitive
  const input5 = '<THINK>Uppercase</THINK>{"result": 1}';
  assert.equal(stripThinkingTags(input5), '{"result": 1}');
});

test("extractJsonCandidate: extracts JSON after stripping think tags", async () => {
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
  assert.ok(Array.isArray(parsed.gaps));
  assert.equal(parsed.gaps[0].question, "What is X?");
});

test("extractJsonCandidate: handles fenced code blocks after think tags", async () => {
  const { extractJsonCandidate } = await import("../../../js/agents/stages/deepsearch/state.js");

  const input = `<think>Some reasoning here</think>

\`\`\`json
{"title": "Test", "markdown": "# Hello"}
\`\`\``;

  const result = extractJsonCandidate(input);
  const parsed = JSON.parse(result);
  assert.equal(parsed.title, "Test");
});

test("extractJsonCandidate: supports top-level JSON arrays", async () => {
  const { extractJsonCandidate } = await import("../../../js/agents/stages/deepsearch/state.js");

  const input = 'prefix [{"a":1},{"b":2}] suffix';
  const result = extractJsonCandidate(input);
  const parsed = JSON.parse(result);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].a, 1);
  assert.equal(parsed[1].b, 2);
});

test("extractJsonCandidate: selects the correct closing brace when extra braces exist", async () => {
  const { extractJsonCandidate } = await import("../../../js/agents/stages/deepsearch/state.js");

  const input = 'prefix {"a":1} suffix } trailing';
  const result = extractJsonCandidate(input);
  assert.equal(result, '{"a":1}');
});

test("extractJsonCandidate: handles empty or null input", async () => {
  const { extractJsonCandidate } = await import("../../../js/agents/stages/deepsearch/state.js");

  assert.equal(extractJsonCandidate(null), null);
  assert.equal(extractJsonCandidate(""), null);
  assert.equal(extractJsonCandidate("   "), null);
  assert.equal(extractJsonCandidate("<think>only thinking</think>"), null);
});

test("DeepSearchState.clone: uses structuredClone for non-JSON types when available", async () => {
  if (typeof structuredClone !== "function") return;
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({ runId: "run_clone_types", taskGoal: "t" });
  const when = new Date("2020-01-01T00:00:00.000Z");
  const meta = new Map([["k", "v"]]);
  const tags = new Set(["a", "b"]);
  state.todos = [{ todoId: "t1", status: "open", text: "x", when, meta, tags }];

  const cloned = state.clone();
  assert.notEqual(cloned, state);
  assert.notEqual(cloned.todos, state.todos);
  assert.equal(cloned.todos[0].when instanceof Date, true);
  assert.equal(cloned.todos[0].meta instanceof Map, true);
  assert.equal(cloned.todos[0].tags instanceof Set, true);
  assert.deepEqual([...cloned.todos[0].meta.entries()], [...meta.entries()]);
  assert.deepEqual([...cloned.todos[0].tags.values()], [...tags.values()]);
});

test("DeepSearchState.clone: falls back safely for function/symbol values", async () => {
  if (typeof structuredClone !== "function") return;
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  {
    const state = new DeepSearchState({ runId: "run_clone_fallback_fn", taskGoal: "t" });
    const fn = () => {};
    state.todos = [{ todoId: "t1", bad: fn }];
    const cloned = state.clone();
    assert.equal(typeof cloned.todos[0].bad, "function");
    assert.equal(cloned.todos[0].bad, fn);
  }

  {
    const state = new DeepSearchState({ runId: "run_clone_fallback_sym", taskGoal: "t" });
    const sym = Symbol("x");
    state.todos = [{ todoId: "t1", bad: sym }];
    const cloned = state.clone();
    assert.equal(typeof cloned.todos[0].bad, "symbol");
    assert.equal(cloned.todos[0].bad, sym);
  }
});

test("cloneValue: avoids recursion overflow in hasCycle for deep objects", async () => {
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
    assert.equal(cloned, root);
  } finally {
    globalThis.structuredClone = originalStructuredClone;
  }
});

test("DeepSearchState.saveCheckpoint: stamps checkpoint schema version", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({ runId: "run_ckpt_schema", taskGoal: "t" });
  const cp = state.saveCheckpoint({ checkpointId: "cp1" });

  assert.equal(cp.schemaVersion, "1.0");
  assert.equal(cp.stateSnapshot.checkpointSchemaVersion, "1.0");
});

test("DeepSearchState.saveCheckpoint: minimal strategy produces lean snapshot", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_ckpt_min",
    taskGoal: "t",
    userConfig: { checkpointStrategy: "minimal" },
  });
  state.L2.retrievedChunks = [{ chunkId: "c1", text: "x" }];
  state.L2.tokenUsage = { input: 1, output: 2, total: 3, estimatedCostUSD: 0 };

  const cp = state.saveCheckpoint({ checkpointId: "cp_min" });
  assert.equal(cp.strategy, "minimal");
  assert.equal(cp.stateSnapshot.snapshotStrategy, "minimal");
  assert.equal("retrievedChunkIds" in cp.stateSnapshot.L2, false);

  state.L2.retrievedChunks = [{ chunkId: "c2", text: "y" }];
  state.restoreCheckpoint("cp_min");
  assert.equal(state.L2.restoredFromMinimalCheckpoint, true);
  assert.deepEqual(state.L2.retrievedChunks, []);
  assert.equal(state.L2.tokenUsage.total, 3);
});

test("DeepSearchState.addTimeline: enforces maxTimeline cap", async () => {
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
  assert.equal(state.timeline.size, 2);
  const arr = state.timeline.toArray();
  assert.equal(arr[0].name, "e2");
  assert.equal(arr[1].name, "e3");
});

test("DeepSearchState.saveCheckpoint: enforces maxCheckpoints cap", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_ckpt_cap",
    taskGoal: "t",
    userConfig: { memory: { maxCheckpoints: 2 } },
  });

  state.saveCheckpoint({ checkpointId: "cp1" });
  state.saveCheckpoint({ checkpointId: "cp2" });
  state.saveCheckpoint({ checkpointId: "cp3" });

  assert.equal(state.checkpoints.length, 2);
  assert.equal(state.checkpoints[0].checkpointId, "cp2");
  assert.equal(state.checkpoints[1].checkpointId, "cp3");
});

test("SharedContext: prunes store, signals, decisions, seen, and index", async () => {
  const { SharedContext } = await import("../../../js/agents/stages/deepsearch/runtime/shared-context.js");

  {
    const ctx = new SharedContext({ runId: "ctx_store", limits: { storeMax: 2 } });
    ctx.store("a", { v: 1 });
    ctx.store("b", { v: 2 });
    ctx.store("c", { v: 3 });
    assert.equal(ctx.has("a"), false);
    assert.equal(ctx.has("b"), true);
    assert.equal(ctx.has("c"), true);
    assert.equal(ctx.getStats().storeItems, 2);
  }

  {
    const ctx = new SharedContext({ runId: "ctx_sig", limits: { signalsMax: 2 } });
    const s1 = ctx.signal("s", { type: "t1" });
    const s2 = ctx.signal("s", { type: "t2" });
    const s3 = ctx.signal("s", { type: "t3" });
    assert.deepEqual(
      ctx.getSignals().map((s) => s.id),
      [s2.id, s3.id]
    );
    assert.notEqual(s1.id, s2.id);
    assert.notEqual(s2.id, s3.id);
  }

  {
    const ctx = new SharedContext({ runId: "ctx_dec", limits: { decisionsMax: 2 } });
    const d1 = ctx.recordDecision({ action: "a" });
    const d2 = ctx.recordDecision({ action: "b" });
    const d3 = ctx.recordDecision({ action: "c" });
    assert.deepEqual(
      ctx.getDecisions().map((d) => d.id),
      [d2.id, d3.id]
    );
    assert.notEqual(d1.id, d2.id);
    assert.notEqual(d2.id, d3.id);
  }

  {
    const ctx = new SharedContext({ runId: "ctx_seen", limits: { seenMax: 2 } });
    ctx.markSeen("alpha");
    ctx.markSeen("beta");
    ctx.markSeen("gamma");
    assert.equal(ctx.hasSeen("alpha"), false);
    assert.equal(ctx.hasSeen("beta"), true);
    assert.equal(ctx.hasSeen("gamma"), true);
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
      assert.equal(ctx.search("a").length, 0);
      assert.deepEqual(ctx.search("b"), [id2]);
      assert.deepEqual(ctx.search("c"), [id3]);
      assert.equal(ctx.has(id1), true);
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
      assert.deepEqual(ctx.search("k"), [id2, id3]);
      assert.equal(ctx.has(id1), true);
    } finally {
      Date.now = originalNow;
    }
  }
});

test("SharedContext: action stream rehydrates state and preserves version", async () => {
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

    assert.equal(ctx1.getVersion(), 0);

    ctx1.setSummary("stageA", "sumA");
    const sig = ctx1.signal("advice", { type: "advice", message: "hello" });
    const dec = ctx1.recordDecision({ action: "do", reason: "because" });
    ctx1.addToIndex("k", "id123");
    ctx1.store("id123", { v: 1 });
    const commitId = ctx1.commit("finding", { full: { x: 1 }, summary: "sumFinding", keywords: ["k2"] });
    ctx1.setIndex("design", { keywords: ["kw"], paths: ["p"], ids: ["i"] });

    assert.ok(ctx1.getVersion() > 0);

    const actions = ctx1.getActions({ sinceVersion: 0, limit: 500 });
    assert.ok(actions.length >= 6);
    assert.equal(actions.every((a) => typeof a?.kind === "string" && a.kind.length > 0), true);
    assert.equal(actions.every((a) => Number.isFinite(Number(a?.version))), true);

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

    assert.equal(ctx2.getVersion(), ctx1.getVersion());
    assert.equal(ctx2.getSummary("stageA"), "sumA");
    assert.equal(ctx2.has("id123"), true);
    assert.equal(ctx2.has(commitId), true);
    assert.equal(ctx2.search("k").includes("id123"), true);
    assert.equal(ctx2.search("k2").includes(commitId), true);

    const appliedSignals = ctx2.getSignals();
    assert.equal(appliedSignals.length > 0, true);
    assert.equal(appliedSignals.some((s) => s?.id === sig.id), true);
    assert.equal(appliedSignals.some((s) => s?.payload?.message === "hello"), true);

    const appliedDecisions = ctx2.getDecisions();
    assert.equal(appliedDecisions.length > 0, true);
    assert.equal(appliedDecisions.some((d) => d?.id === dec.id), true);
    assert.equal(appliedDecisions.some((d) => d?.action === "do"), true);
  } finally {
    Date.now = originalNow;
  }
});

test("SharedContext: filters signals by targetTaskId (keeps broadcast signals)", async () => {
  const { SharedContext } = await import("../../../js/agents/stages/deepsearch/runtime/shared-context.js");

  const ctx = new SharedContext({ runId: "ctx_task_scope" });
  ctx.signal("advice", { type: "advice", targetTaskId: "task_a", message: "for A" });
  ctx.signal("advice", { type: "advice", targetTaskId: "task_b", message: "for B" });
  ctx.signal("notice", { type: "notice", message: "broadcast" });

  const scopedPrompt = ctx.buildBlackboardPrompt({ maxSignals: 10, targetTaskId: "task_a" });
  assert.ok(scopedPrompt.includes("for A"));
  assert.ok(scopedPrompt.includes("broadcast"));
  assert.equal(scopedPrompt.includes("for B"), false);

  const allPrompt = ctx.buildBlackboardPrompt({ maxSignals: 10 });
  assert.ok(allPrompt.includes("for A"));
  assert.ok(allPrompt.includes("for B"));
  assert.ok(allPrompt.includes("broadcast"));

  const scopedSignals = ctx.getSignals({ targetTaskId: "task_a" });
  const scopedMsgs = scopedSignals.map((s) => s?.payload?.message).filter(Boolean);
  assert.ok(scopedMsgs.includes("for A"));
  assert.ok(scopedMsgs.includes("broadcast"));
  assert.equal(scopedMsgs.includes("for B"), false);
});

test("DeepSearchState.restoreCheckpoint: migrates legacy checkpoints without schemaVersion", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({ runId: "run_ckpt_migrate", taskGoal: "t" });
  state.iteration = 2;
  state.saveCheckpoint({ checkpointId: "cp_legacy" });

  delete state.checkpoints[0].schemaVersion;

  state.iteration = 99;
  state.restoreCheckpoint("cp_legacy");

  assert.equal(state.iteration, 2);
  assert.equal(state.checkpoints[0].schemaVersion, "1.0");
});

test("DeepSearchState.restoreCheckpoint: warns on unknown checkpoint schema versions", async () => {
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

  assert.ok(warnCount >= 1);
});

test("Checkpoint E2E: 保存完整状态并恢复", async () => {
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

  assert.equal(cp.schemaVersion, "1.0");
  assert.equal(cp.strategy, "full");
  // 优化后快照是普通对象而非 DeepSearchState 实例（restoreCheckpoint 时重建）
  assert.ok(typeof cp.stateSnapshot === "object" && cp.stateSnapshot !== null);

  assert.notEqual(cp.stateSnapshot, state);
  assert.notEqual(cp.stateSnapshot.L1, state.L1);
  assert.notEqual(cp.stateSnapshot.L1.gaps, state.L1.gaps);
  assert.equal(cp.stateSnapshot.L1.gaps[0].createdAt instanceof Date, true);
  assert.equal(cp.stateSnapshot.L1.gaps[0].meta instanceof Map, true);
  assert.equal(cp.stateSnapshot.L1.gaps[0].tags instanceof Set, true);
  assert.notEqual(cp.stateSnapshot.L1.gaps[0].meta, state.L1.gaps[0].meta);
  assert.notEqual(cp.stateSnapshot.L1.gaps[0].tags, state.L1.gaps[0].tags);

  state.L1.gaps[0].question = "mutated";
  state.L1.gaps[0].meta.set("k", "mutated");
  state.L2.scratchpad.rounds.push(999);

  assert.equal(cp.stateSnapshot.L1.gaps[0].question, "What is X?");
  assert.equal(cp.stateSnapshot.L1.gaps[0].meta.get("k"), "v");
  assert.deepEqual(cp.stateSnapshot.L2.scratchpad.rounds, [1, 2]);

  state.iteration = 123;
  state.L0.sources = [];
  state.L1.claims = [];
  state.L2.retrievedChunks = [];

  state.restoreCheckpoint("cp_full_e2e");

  const restored = state.toJSON({ includeCheckpoints: false });
  assert.deepEqual({ ...restored, timeline: restored.timeline.slice(0, -1) }, original);
  assert.equal(restored.timeline.at(-1).name, "deepsearch.checkpoint.restored");
});

test("Checkpoint E2E: legacy checkpoint 迁移", async () => {
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
  assert.notEqual(migrated, legacy);
  assert.equal(migrated.schemaVersion, "1.0");
  assert.equal(migrated.checkpointId, "cp_legacy_no_version");
  assert.equal(loadCheckpoint(migrated), migrated);
});

test("Checkpoint E2E: 中断恢复场景", async () => {
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
    assert.equal(String(err?.message), "interrupted");
  }

  const resumed = new DeepSearchState({ runId: "run_new", taskGoal: "new" });
  resumed.checkpoints = [checkpoint];
  resumed.restoreCheckpoint("cp_interrupt");

  assert.equal(resumed.runId, "run_ckpt_interrupt");
  assert.equal(resumed.iteration, 2);
  assert.deepEqual(resumed.L2.scratchpad.rounds, [1, 2]);

  runRounds(resumed);
  assert.equal(resumed.iteration, 5);
  assert.deepEqual(resumed.L2.scratchpad.rounds, [1, 2, 3, 4, 5]);
});

test("SourceManager: reads docs with consistent modes and caches line indexes", async () => {
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
  assert.equal(full.success, true);
  assert.equal(full.readMode, "full");
  assert.equal(full.lineStart, 1);
  assert.equal(typeof full.lineEnd, "number");

  const preview = manager.read("doc_1", { preview: true, maxLength: 10000 });
  assert.equal(preview.success, true);
  assert.equal(preview.readMode, "preview");
  assert.ok(preview.content.includes("## 文档结构"));
  assert.ok(preview.content.includes("## 内容预览"));
  assert.equal(typeof preview.headingCount, "number");

  const section = manager.read("doc_1", { section: "## A", maxLength: 10000 });
  assert.equal(section.success, true);
  assert.equal(section.readMode, "section");
  assert.ok(section.content.includes("## A"));
  assert.ok(section.content.includes("A1"));
  assert.ok(section.lineStart >= 1);
  assert.ok(section.lineEnd >= section.lineStart);

  const lines = manager.read("doc_2", { startLine: 2, endLine: 2, maxLength: 10000 });
  assert.equal(lines.success, true);
  assert.equal(lines.readMode, "lines");
  assert.equal(lines.content.trim(), "Line2");
  assert.equal(lines.lineStart, 2);
  assert.equal(lines.lineEnd, 2);

  // LRU cap keeps only the most recent entry
  assert.equal(manager._lineStartsCache.size, 1);
  assert.equal(manager._lineStartsCache.has("doc_2"), true);

  const chars = manager.read("doc_2", { start: 0, end: 1, maxLength: 10000 });
  assert.equal(chars.success, true);
  assert.equal(chars.readMode, "chars");
  assert.equal(chars.lineStart, 1);
  assert.equal(chars.lineEnd, 1);
});

test("read-doc/search-docs tools: share SourceManager and keep outputs stable", async () => {
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
  assert.equal(readRes.success, true);
  assert.equal(readRes.readMode, "lines");
  assert.equal(readRes.content.trim(), "beta");
  assert.deepEqual(state.L1.readDocIds, ["s1"]);
  assert.ok(events.some((e) => e.name === "deepsearch.doc.read"));

  const searchRes = await searchDocs(
    { query: "alpha", limit: 10 },
    {
      state,
      emit: () => {},
      sourceManager: manager,
    }
  );
  assert.equal(searchRes.success, true);
  assert.equal(Array.isArray(searchRes.results), true);
  assert.equal(searchRes.results.some((r) => r.sourceId === "s1"), true);

  const restricted = await searchDocs(
    { query: "alpha", sources: ["s2"], limit: 10 },
    {
      state,
      emit: () => {},
      sourceManager: manager,
    }
  );
  assert.equal(restricted.success, true);
  assert.equal(restricted.results.length, 0);
});

test("report-postprocess: review/reorder/validate share a single implementation", async () => {
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
  assert.equal(reviewed.fixed, true);
  assert.equal(reviewed.markdown.includes("REMOVE_ME"), false);
  assert.equal(reviewed.markdown.includes("**\n\n**"), false);
  assert.equal(reviewed.issues.some((i) => i.type === "duplicate_heading"), true);
  assert.equal(reviewed.issues.some((i) => i.type === "duplicate_paragraph"), true);
  assert.equal(reviewed.issues.some((i) => i.type === "broken_formatting"), true);

  const reordered = reorderReportSections(
    ["## X", "", "x", "", "## 参考文献", "", "ref1", "", "## Y", "", "y", "", "## 参考文献", "", "ref2"].join("\n")
  );
  assert.equal((reordered.match(/## 参考文献/g) || []).length, 1);
  assert.equal(reordered.indexOf("## Y") < reordered.indexOf("## 参考文献"), true);
  assert.equal(reordered.includes("ref1"), true);
  assert.equal(reordered.includes("ref2"), true);

  const state = { globalConfig: { report: { quick: { minWords: 10, minReferences: 1 } } } };
  const okReport = "## 摘要\n\n内容 [doc:L1]\n\n## 发现\n\nOK";
  const ok = validateReport(okReport, "quick", state);
  assert.equal(ok.valid, true);
  assert.equal(ok.warnings.some((w) => w.includes("信息缺口")), true);

  const progress = getReportProgress({ markdown: okReport }, "quick", state);
  assert.equal(progress.isReady, true);

  const processed = prepareReportForSubmit(
    "## 摘要\n\n内容 [doc:L1]\n\n## 发现\n\nOK\n\n## 参考文献\n\nrefA\n\n## 参考文献\n\nrefB\n",
    "quick",
    state
  );
  assert.equal(processed.validation.valid, true);
  assert.equal((processed.markdown.match(/## 参考文献/g) || []).length, 1);
  assert.equal(processed.markdown.includes("refA"), true);
  assert.equal(processed.markdown.includes("refB"), true);
  assert.equal(processed.review.fixed, false);
});

test("report-postprocess: returns issues on invalid reports", async () => {
  const { reviewReportMarkdown, validateReport, getReportProgress } = await import(
    "../../../js/agents/stages/deepsearch/report/report-postprocess.js"
  );

  const empty = reviewReportMarkdown("");
  assert.equal(empty.fixed, false);
  assert.deepEqual(empty.issues, []);

  const state = {
    globalConfig: {
      report: {
        quick: { minWords: 1, minReferences: 1, requiredSections: ["摘要"], recommendedSections: ["结论"] },
      },
    },
  };
  const badReport = "no sections and no refs";
  const bad = validateReport(badReport, "quick", state);
  assert.equal(bad.valid, false);
  assert.equal(bad.issues.some((i) => i.includes("缺少必需章节")), true);
  assert.equal(bad.issues.some((i) => i.includes("引用不足")), true);
  assert.equal(bad.warnings.some((w) => w.includes("建议添加章节")), true);

  const progress = getReportProgress({ markdown: badReport }, "quick", state);
  assert.equal(progress.isReady, false);
});

test("WritingPhaseHandler: system retries do not consume writing iterations", async () => {
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

  assert.equal(calls, 3);
  assert.equal(result.iterations, 1);
});

test("DeepSearchAgentLoop: caps system retries without consuming iteration budget", async () => {
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

  assert.equal(calls, 4);
  assert.equal(output.status, AgentStatus.COMPLETED);
});

test("DeepSearchAgentLoop: fail-fast on non-recoverable model errors", async () => {
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

  await assert.rejects(
    () =>
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

  assert.equal(calls, 1);
  assert.equal(agent.status, AgentStatus.FAILED);
});

test("Skills injection: candidate index preserves explicit/keyword/tag matches", async () => {
  const { collectSkillsToInject } = await import("../../../js/agents/skills/injection.js");

  const skills = [
    {
      metadata: {
        name: "Alpha",
        description: "Handles greeting tasks",
        path: "/dev/null",
        keywords: ["hello"],
        keywordsAll: [],
      },
      body: "# alpha",
    },
    {
      metadata: {
        name: "Beta",
        description: "Handles world tasks",
        path: "/dev/null",
        keywords: ["world"],
        keywordsAll: [],
      },
      body: "# beta",
    },
    {
      metadata: {
        name: "Gamma",
        description: "Tag-driven skill",
        path: "/dev/null",
        tags: { env: "prod" },
      },
      body: "# gamma",
    },
  ];

  {
    const hits = collectSkillsToInject("hello there", skills, { maxInjections: 5, minScore: 0.4 });
    assert.equal(hits.some((h) => h.skill.metadata.name === "Alpha"), true);
  }

  {
    const hits = collectSkillsToInject("$Beta please", skills, { maxInjections: 5, minScore: 0.4 });
    assert.equal(hits.some((h) => h.skill.metadata.name === "Beta"), true);
  }

  {
    const hits = collectSkillsToInject("no keywords here", skills, {
      context: { tags: { env: "prod" } },
      maxInjections: 5,
      minScore: 0.4,
    });
    assert.equal(hits.some((h) => h.skill.metadata.name === "Gamma"), true);
  }
});
