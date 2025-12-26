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

  assert.equal(state.timeline.length, 2);
  assert.equal(state.timeline[0].name, "e2");
  assert.equal(state.timeline[1].name, "e3");
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
    ctx.signal("s", { type: "t1" });
    ctx.signal("s", { type: "t2" });
    ctx.signal("s", { type: "t3" });
    assert.deepEqual(
      ctx.getSignals().map((s) => s.id),
      ["sig_2", "sig_3"]
    );
  }

  {
    const ctx = new SharedContext({ runId: "ctx_dec", limits: { decisionsMax: 2 } });
    ctx.recordDecision({ action: "a" });
    ctx.recordDecision({ action: "b" });
    ctx.recordDecision({ action: "c" });
    assert.deepEqual(
      ctx.getDecisions().map((d) => d.id),
      ["dec_2", "dec_3"]
    );
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
  assert.ok(cp.stateSnapshot instanceof DeepSearchState);

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
