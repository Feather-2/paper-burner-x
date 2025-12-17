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

test("DeepSearchState.clone: structuredClone throws on function/symbol values", async () => {
  if (typeof structuredClone !== "function") return;
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  {
    const state = new DeepSearchState({ runId: "run_clone_throw_fn", taskGoal: "t" });
    state.todos = [{ todoId: "t1", bad: () => {} }];
    assert.throws(() => state.clone(), /clone|DataCloneError|could not be cloned/i);
  }

  {
    const state = new DeepSearchState({ runId: "run_clone_throw_sym", taskGoal: "t" });
    state.todos = [{ todoId: "t1", bad: Symbol("x") }];
    assert.throws(() => state.clone(), /clone|DataCloneError|could not be cloned/i);
  }
});

test("DeepSearchState.saveCheckpoint: stamps checkpoint schema version", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({ runId: "run_ckpt_schema", taskGoal: "t" });
  const cp = state.saveCheckpoint({ checkpointId: "cp1" });

  assert.equal(cp.schemaVersion, "1.0");
  assert.equal(cp.stateSnapshot.checkpointSchemaVersion, "1.0");
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
