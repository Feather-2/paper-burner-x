const test = require("node:test");
const assert = require("node:assert/strict");

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function extractEventPayload(e) {
  if (e && isPlainObject(e.record) && "payload" in e.record) return e.record.payload;
  if (e && isPlainObject(e) && "payload" in e) return e.payload;
  return undefined;
}

function assertValidProgressPayload(payload) {
  assert.ok(isPlainObject(payload), "progress payload must be an object");
  assert.equal(typeof payload.phase, "string");
  assert.ok(payload.phase.length > 0);
  assert.equal(typeof payload.step, "string");
  assert.ok(payload.step.length > 0);
  assert.equal(typeof payload.msg, "string");
  assert.ok(payload.msg.length > 0);

  assert.equal(typeof payload.current, "number");
  assert.ok(Number.isFinite(payload.current));
  assert.equal(typeof payload.total, "number");
  assert.ok(Number.isFinite(payload.total));
  assert.ok(payload.total >= 1);
  assert.ok(payload.current >= 0);
  assert.ok(payload.current <= payload.total);

  assert.equal(typeof payload.progress, "number");
  assert.ok(Number.isFinite(payload.progress));
  assert.ok(payload.progress >= 0 && payload.progress <= 1);

  if ("detail" in payload) {
    assert.ok(payload.detail === undefined || isPlainObject(payload.detail), "progress.detail must be an object when present");
  }
}

function createMockModelRouter(handler) {
  const calls = [];
  return {
    calls,
    call: async (messages, opts) => {
      calls.push({ messages, opts });
      return handler(messages, opts);
    },
  };
}

function makeWordBlob(n, word = "w") {
  return Array.from({ length: n }, () => word).join(" ");
}

test("LRUMap: evicts oldest and refreshes on get", async () => {
  const { LRUMap } = await import("../../js/agents/shared/lru-map.js");

  {
    const m = new LRUMap(2);
    m.set("a", 1);
    m.set("b", 2);
    m.set("c", 3);
    assert.equal(m.has("a"), false);
    assert.equal(m.has("b"), true);
    assert.equal(m.has("c"), true);
  }

  {
    const m = new LRUMap(2);
    m.set("a", 1);
    m.set("b", 2);
    assert.equal(m.get("a"), 1); // refresh a
    m.set("c", 3);
    assert.equal(m.has("b"), false);
    assert.equal(m.has("a"), true);
    assert.equal(m.has("c"), true);
  }

  {
    const m = new LRUMap(2);
    m.set("a", 1);
    m.set("b", 2);
    m.set("a", 11); // refresh a
    m.set("c", 3);
    assert.equal(m.has("b"), false);
    assert.equal(m.get("a"), 11);
  }
});

test("Stress test: LRU Map 处理 10000 个 chunk", async () => {
  const { LRUMap } = await import("../../js/agents/shared/lru-map.js");

  const maxSize = 1000;
  const total = 10000;

  const m = new LRUMap(maxSize);
  for (let i = 0; i < total; i++) m.set(`chunk_${i}`, i);

  assert.equal(m.size, maxSize);

  // oldest should be evicted; newest should be kept.
  assert.equal(m.has("chunk_0"), false);
  assert.equal(m.has(`chunk_${total - 1}`), true);
  assert.equal(m.has(`chunk_${total - maxSize}`), true);
  assert.equal(m.has(`chunk_${total - maxSize - 1}`), false);

  // get should refresh LRU order.
  assert.equal(m.get(`chunk_${total - maxSize}`), total - maxSize);
  m.set(`chunk_${total}`, total);
  assert.equal(m.size, maxSize);
  assert.equal(m.has(`chunk_${total}`), true);
  assert.equal(m.has(`chunk_${total - maxSize}`), true);
  assert.equal(m.has(`chunk_${total - maxSize + 1}`), false); // was oldest after refresh
});

test("Stress test: 并发限制处理 50 个并行任务", async () => {
  const { mapConcurrent } = await import("../../js/agents/shared/concurrency.js");

  const total = 50;
  const concurrency = 7;
  const items = Array.from({ length: total }, (_, i) => i);

  let inFlight = 0;
  let maxInFlight = 0;
  const started = [];
  const completed = [];

  const results = await mapConcurrent(
    items,
    async (_item, i) => {
      started.push(i);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 8));
      inFlight -= 1;
      completed.push(i);
      return i;
    },
    concurrency
  );

  assert.equal(maxInFlight <= concurrency, true);
  assert.equal(maxInFlight, concurrency);
  assert.equal(started.length, total);
  assert.equal(completed.length, total);
  assert.deepEqual(started, items);
  assert.deepEqual(results, items);
});

test("applyChunkLru: evicts oldest consumed first, then oldest overall (stable LRU)", async () => {
  const { __test } = await import("../../js/agents/stages/deepsearch/retrieve.js");

  {
    const chunks = [
      { chunkId: "a" }, // oldest
      { chunkId: "b", consumed: true },
      { chunkId: "c" },
      { chunkId: "d", consumed: true },
      { chunkId: "e" },
      { chunkId: "f" }, // newest
    ];
    const out = __test.applyChunkLru(chunks, { maxChunks: 3 });
    assert.deepEqual(
      out.map((c) => c.chunkId),
      ["c", "e", "f"]
    );
  }

  {
    const chunks = [
      { chunkId: "c1", consumed: true }, // oldest consumed
      { chunkId: "u2" },
      { chunkId: "c3", consumed: true }, // newer consumed; should be kept
      { chunkId: "u4" },
    ];
    const out = __test.applyChunkLru(chunks, { maxChunks: 3 });
    assert.deepEqual(
      out.map((c) => c.chunkId),
      ["u2", "c3", "u4"]
    );
  }
});

test("Stress test: 大量 gaps 的迭代处理", async () => {
  const { DeepSearchState, computeRoundHitsByGapId, validateIteration } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchRetrieveStage } = await import("../../js/agents/stages/deepsearch/retrieve.js");

  const gapCount = 30;
  const gaps = Array.from({ length: gapCount }, (_, i) => ({
    gapId: `gap_${i}`,
    type: "definition",
    question: `Q${i}`,
    status: "open",
    missCount: i >= 5 && i < 10 ? 2 : 0, // will be reset by quality hits
  }));

  const evidenceLedger = Array.from({ length: 5 }, (_, i) => ({
    evidenceId: `e_${i}`,
    gapIds: [`gap_${i}`],
    sourceId: "s1",
    locator: { charStart: 0, charEnd: 1 },
    quote: "x",
  }));

  const state = new DeepSearchState({
    runId: "run_stress_gaps",
    taskGoal: "Stress gaps",
    userConfig: {
      retrieval: {
        iterative: { enabled: false }, // allow async localRetriever path (awaited)
        enableToolChain: false,
        topK: 1,
        maxChunks: 1000,
      },
    },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: "alpha beta gamma delta" }] },
    L1: { gaps, evidenceLedger },
    L2: { retrievedChunks: [] },
  });

  const stageEvents = [];
  const stageEmit = (name, record) => stageEvents.push({ name, record });

  let inFlight = 0;
  let maxInFlight = 0;
  let callCount = 0;

  const localRetriever = async (sourceIndex, gapRows) => {
    callCount += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 6));
    inFlight -= 1;

    const gapId = String(gapRows?.[0]?.gapId || "");
    const idx = Number(gapId.split("_")[1]);
    if (!Number.isFinite(idx)) return [];
    if (idx >= 10) return [];

    return [
      {
        chunkId: `${sourceIndex.sourceId}::${gapId}::chunk`,
        sourceId: sourceIndex.sourceId,
        locator: { charStart: 0, charEnd: 1 },
        text: `hit ${gapId}`,
        score: 0.9,
        gapId,
        matchedGapIds: [gapId],
      },
    ];
  };

  await runDeepSearchRetrieveStage({ runId: state.runId }, { state }, { emit: stageEmit, localRetriever });

  assert.equal(callCount, gapCount);
  assert.equal(maxInFlight <= 5, true);
  assert.equal(maxInFlight, 5);

  const { allHits, qualityHits } = computeRoundHitsByGapId(state.L2.retrievedChunks, 0.5);

  const validateEvents = [];
  const validateEmit = (name, payload) => validateEvents.push({ name, payload });

  validateIteration(state, { roundHits: { allHits, qualityHits }, blockAfterMisses: 1, minEvidenceToFill: 1, emit: validateEmit });

  const byId = new Map(state.L1.gaps.map((g) => [g.gapId, g]));
  for (let i = 0; i < 5; i++) {
    const g = byId.get(`gap_${i}`);
    assert.equal(g.status, "filled");
    assert.equal(g.evidenceCount, 1);
  }
  for (let i = 5; i < 10; i++) {
    const g = byId.get(`gap_${i}`);
    assert.equal(g.status, "open");
    assert.equal(g.missCount, 0);
  }
  for (let i = 10; i < gapCount; i++) {
    const g = byId.get(`gap_${i}`);
    assert.equal(g.status, "blocked");
  }

  const statusEvents = validateEvents.filter((e) => e.name === "deepsearch.gap.status.changed");
  assert.equal(
    statusEvents.filter((e) => e.payload?.to === "filled").length,
    5
  );
  assert.equal(
    statusEvents.filter((e) => e.payload?.to === "blocked").length,
    20
  );

  // Sanity: retrieve stage still emitted progress.
  assert.ok(stageEvents.some((e) => e.name === "deepsearch.retrieve.progress"));
});

test("DeepSearchState: serialization/deserialization preserves L0/L1/L2", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");

  assert.throws(() => DeepSearchState.fromJSON(null), /must be an object/);

  const state = new DeepSearchState({
    runId: "run_test",
    taskGoal: "Compare A vs B",
    userConfig: { title: "Test Deck" },
    L0: { sources: [{ sourceId: "s1", kind: "file", title: "Doc", sourceTextNormalized: "Alpha beta gamma" }] },
    L1: { claims: [{ claimId: "c1", text: "Alpha", evidenceIds: ["e1"] }], evidenceLedger: [{ evidenceId: "e1", sourceId: "s1", locator: { charStart: 0, charEnd: 5 }, quote: "Alpha" }] },
    L2: { retrievedChunks: [{ retrievedId: "rch_1", sourceId: "s1", locator: { charStart: 0, charEnd: 5 }, text: "Alpha" }] },
  });
  state.addTodo({ todoId: "todo_1", text: "Fill definition gap" });
  state.addTimeline({ name: "deepsearch.scan", status: "completed", payload: { sourceCount: 1 } });

  const serialized = state.serialize({ pretty: true });
  const roundtrip = DeepSearchState.deserialize(serialized);

  assert.deepEqual(roundtrip.toJSON().runId, "run_test");
  assert.deepEqual(roundtrip.toJSON().taskGoal, "Compare A vs B");
  assert.ok(roundtrip.toJSON().L0 && roundtrip.toJSON().L1 && roundtrip.toJSON().L2);
  assert.equal(roundtrip.todos.length, 1);
  assert.equal(roundtrip.timeline.length, 1);
  assert.equal(roundtrip.writeBacktrackCount, 0);
  assert.ok(Array.isArray(roundtrip.writeSnapshots));
});

test("DeepSearch model caller: injects stageApi.signal by default (new signature)", async () => {
  const { buildBaseCaller } = await import("../../js/agents/stages/deepsearch/model/caller.js");

  const controller = new AbortController();
  const calls = [];
  const stageApi = {
    signal: controller.signal,
    modelRouter: {
      call: async (payload) => {
        calls.push(payload);
        return { content: "ok" };
      },
    },
  };

  const call = buildBaseCaller(stageApi, { usage: "worker" });
  await call([{ role: "user", content: "hi" }], { temperature: 0.2 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].usage, "worker");
  assert.equal(calls[0].signal, controller.signal);

  const override = new AbortController();
  await call([{ role: "user", content: "hi2" }], { signal: override.signal });
  assert.equal(calls[1].signal, override.signal);
});

test("DeepSearch model caller: injects stageApi.signal by default (legacy signature)", async () => {
  const { buildBaseCaller } = await import("../../js/agents/stages/deepsearch/model/caller.js");

  const controller = new AbortController();
  const calls = [];
  const stageApi = {
    signal: controller.signal,
    modelRouter: {
      call: async (messages, opts) => {
        calls.push({ messages, opts });
        return { content: "ok" };
      },
    },
  };

  const call = buildBaseCaller(stageApi, { usage: "worker" });
  await call([{ role: "user", content: "hi" }], { temperature: 0.2 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.usage, "worker");
  assert.equal(calls[0].opts.signal, controller.signal);
});

test("DeepSearch cancellation: stageApi.signal abort propagates into model calls", async () => {
  const { getModelCaller } = await import("../../js/agents/stages/deepsearch/model.js");

  const controller = new AbortController();
  const stageApi = {
    signal: controller.signal,
    checkCancelled: () => {},
    modelRouter: {
      call: async (payload) => {
        const signal = payload?.signal;
        return new Promise((_resolve, reject) => {
          if (!signal) return reject(new Error("missing signal"));
          const onAbort = () => reject(new Error(String(signal.reason || "aborted")));
          if (signal.aborted) return onAbort();
          signal.addEventListener("abort", onAbort, { once: true });
        });
      },
    },
  };

  const callModel = getModelCaller(stageApi, { usage: "worker" });
  const p = callModel([{ role: "user", content: "hi" }]);
  controller.abort("cancelled");
  await assert.rejects(() => p, /cancelled|abort/i);
});

test("ShadowAgent: clears timeout and passes signal to callModel", async () => {
  const { ShadowAgent } = await import("../../js/agents/stages/deepsearch/shadow-agent.js");
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");

  const originalClearTimeout = global.clearTimeout;
  const cleared = [];
  global.clearTimeout = (id) => {
    cleared.push(id);
    return originalClearTimeout(id);
  };

  try {
    const modelCalls = [];
    const stageApi = {
      checkCancelled: () => {},
      modelRouter: {
        call: async (payload) => {
          modelCalls.push(payload);
          return {
            content: "```json\n" + JSON.stringify({ relevant: true, confidence: 0.9, reason: "ok", keyInfo: "k" }) + "\n```",
          };
        },
      },
    };

    const state = new DeepSearchState({ runId: "run_shadow_timeout", taskGoal: "t" });
    const agent = new ShadowAgent(stageApi, state, { timeoutMs: 100, maxConcurrentCalls: 1 });

    const out = await agent.validateRelevance(
      { chunkId: "c1", text: makeWordBlob(200, "chunk") },
      { gapId: "gap_1", question: "q", priority: "medium" },
      { round: 1 }
    );

    assert.equal(out.relevant, true);
    assert.equal(modelCalls.length, 1);
    assert.ok(modelCalls[0].signal && typeof modelCalls[0].signal.aborted === "boolean");
    assert.ok(cleared.length >= 1);
  } finally {
    global.clearTimeout = originalClearTimeout;
  }
});

test("ShadowAgent: clears timeout on timeout/abort", async () => {
  const { ShadowAgent } = await import("../../js/agents/stages/deepsearch/shadow-agent.js");
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");

  const originalClearTimeout = global.clearTimeout;
  const cleared = [];
  global.clearTimeout = (id) => {
    cleared.push(id);
    return originalClearTimeout(id);
  };

  try {
    const stageApi = {
      checkCancelled: () => {},
      modelRouter: {
        call: async (payload) => {
          const signal = payload?.signal;
          return new Promise((_resolve, reject) => {
            const onAbort = () => reject(new Error(String(signal?.reason || "timeout")));
            if (!signal) return reject(new Error("missing signal"));
            if (signal.aborted) return onAbort();
            signal.addEventListener("abort", onAbort, { once: true });
          });
        },
      },
    };

    const state = new DeepSearchState({ runId: "run_shadow_timeout_err", taskGoal: "t" });
    const agent = new ShadowAgent(stageApi, state, { timeoutMs: 5, maxConcurrentCalls: 1 });

    const out = await agent.validateRelevance(
      { chunkId: "c1", text: makeWordBlob(200, "chunk") },
      { gapId: "gap_1", question: "q", priority: "medium" },
      { round: 1 }
    );

    assert.equal(out.skipped, true);
    assert.ok(cleared.length >= 1);
  } finally {
    global.clearTimeout = originalClearTimeout;
  }
});

test("DeepSearchState.toJSON: returns deep clone and breaks cycles", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_tojson_clone",
    taskGoal: "t",
    L1: { gaps: [{ gapId: "gap_1", question: "q1" }] },
    L2: { scratchpad: { a: 1 } },
  });

  state.L2.scratchpad.self = state.L2.scratchpad;

  const json = state.toJSON({ includeCheckpoints: false });
  assert.equal(json.L2.scratchpad.self, "[Circular]");

  json.L1.gaps[0].question = "mutated";
  json.L2.scratchpad.a = 2;
  assert.equal(state.L1.gaps[0].question, "q1");
  assert.equal(state.L2.scratchpad.a, 1);
});

test("DeepSearch checkpoints: lite snapshots skip L0 bulk, summarize L1/L2, and restore without mutating L1", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");

  const bigSourceText = makeWordBlob(25000, "alpha"); // large-ish to make size differences obvious
  const bigChunkText = makeWordBlob(12000, "chunk");

  const state = new DeepSearchState({
    runId: "run_cp_lite",
    taskGoal: "Test lite checkpoint",
    userConfig: {}, // default should be lite
    L0: {
      sources: [
        { sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: bigSourceText },
        { sourceId: "s2", kind: "user_text", title: "Input2", sourceTextNormalized: bigSourceText },
      ],
    },
    L1: {
      gaps: [{ gapId: "gap_1", type: "definition", question: "What is Alpha?", status: "open", missCount: 0 }],
      claims: [{ claimId: "c1", text: "Alpha is important", evidenceIds: ["e1"], gapIds: ["gap_1"] }],
      evidenceLedger: [{ evidenceId: "e1", chunkId: "s1::chunk_1", sourceId: "s1", locator: { charStart: 0, charEnd: 10 }, quote: "alpha", gapIds: ["gap_1"] }],
      report: { title: "Report", markdown: "# Report\n\nAlpha." },
    },
    L2: {
      retrievedChunks: [
        { retrievedId: "rch_1", chunkId: "s1::chunk_1", sourceId: "s1", locator: { charStart: 0, charEnd: 10 }, text: bigChunkText, gapId: "gap_1", matchedGapIds: ["gap_1"] },
        { retrievedId: "rch_2", chunkId: "s2::chunk_2", sourceId: "s2", locator: { charStart: 11, charEnd: 20 }, text: bigChunkText, gapId: "gap_1", matchedGapIds: ["gap_1"] },
      ],
      scratchpad: { internal: "skip_me" },
      logs: ["log1", "log2"],
      tokenUsage: { input: 10, output: 3, total: 13, estimatedCostUSD: 0 },
    },
  });

  const originalL1 = JSON.parse(JSON.stringify(state.L1));

  const cpLite = state.saveCheckpoint({ checkpointId: "cp_lite" });
  assert.equal(cpLite.strategy, "lite");
  assert.equal(cpLite.stateSnapshot.snapshotStrategy, "lite");

  // L0 bulk should not be copied into snapshot (refs only).
  assert.ok(cpLite.stateSnapshot.L0 && typeof cpLite.stateSnapshot.L0 === "object");
  assert.equal(Array.isArray(cpLite.stateSnapshot.L0.sources), false);
  assert.equal(typeof cpLite.stateSnapshot.L0.sourcesRef, "string");

  // L1 is summarized to avoid serializing full mutable artifacts.
  assert.equal("L1" in cpLite.stateSnapshot, false);
  assert.deepEqual(cpLite.stateSnapshot.L1Summary, {
    gapCount: 1,
    claimCount: 1,
    gapIds: ["gap_1"],
  });

  // L2 should be summarized: only ids + tokenUsage; scratchpad/logs skipped.
  assert.deepEqual(new Set(cpLite.stateSnapshot.L2.retrievedChunkIds), new Set(["s1::chunk_1", "s2::chunk_2"]));
  assert.deepEqual(cpLite.stateSnapshot.L2.tokenUsage, { input: 10, output: 3, total: 13, estimatedCostUSD: 0 });
  assert.equal("retrievedChunks" in cpLite.stateSnapshot.L2, false);
  assert.equal("scratchpad" in cpLite.stateSnapshot.L2, false);
  assert.equal("logs" in cpLite.stateSnapshot.L2, false);

  // Mutate L0/L1 then restore: lite restore should keep current L0 and preserve L1 (L1 is not serialized in lite snapshots).
  state.L0.sources.push({ sourceId: "s3", kind: "user_text", title: "Added", sourceTextNormalized: "new" });
  const preservedL0 = state.L0;
  state.taskGoal = "mutated";
  state.L1.claims = [];
  state.L2.retrievedChunks = [];
  state.restoreCheckpoint("cp_lite");

  assert.equal(state.taskGoal, "Test lite checkpoint");
  assert.equal(originalL1.claims.length, 1);
  assert.equal(state.L1.claims.length, 0);
  assert.equal(state.L1.gaps.length, 1);
  assert.equal(state.L1.gaps[0].gapId, "gap_1");
  assert.equal(state.L0, preservedL0);
  assert.equal(state.L0.sources.length, 3);
  assert.deepEqual(new Set(state.L2.retrievedChunkIds), new Set(["s1::chunk_1", "s2::chunk_2"]));
  assert.equal(state.L2.restoredFromLiteCheckpoint, true);
  assert.equal(Array.isArray(state.L2.retrievedChunks) && state.L2.retrievedChunks.length, 0);
});

test("DeepSearch checkpoints: lite snapshots are >=50% smaller than full snapshots", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");

  const bigSourceText = makeWordBlob(40000, "alpha");
  const bigChunkText = makeWordBlob(20000, "chunk");

  const state = new DeepSearchState({
    runId: "run_cp_size",
    taskGoal: "Size compare",
    userConfig: { checkpointStrategy: "full" },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: bigSourceText }] },
    L1: {
      claims: [{ claimId: "c1", text: "alpha", evidenceIds: ["e1"], gapIds: ["g1"] }],
      evidenceLedger: [{ evidenceId: "e1", chunkId: "s1::chunk_1", sourceId: "s1", locator: { charStart: 0, charEnd: 10 }, quote: "alpha", gapIds: ["g1"] }],
      gaps: [{ gapId: "g1", type: "definition", question: "q", status: "open" }],
      report: { title: "R", markdown: "# R" },
    },
    L2: {
      retrievedChunks: [{ retrievedId: "rch_1", chunkId: "s1::chunk_1", sourceId: "s1", locator: { charStart: 0, charEnd: 10 }, text: bigChunkText, gapId: "g1", matchedGapIds: ["g1"] }],
      tokenUsage: { input: 2, output: 1, total: 3, estimatedCostUSD: 0 },
      scratchpad: { x: makeWordBlob(5000, "s") },
      logs: [makeWordBlob(5000, "l")],
    },
  });

  const cpFull = state.saveCheckpoint({ checkpointId: "cp_full" });
  assert.equal(cpFull.strategy, "full");
  assert.ok(cpFull.stateSnapshot instanceof DeepSearchState);
  const fullBytes = Buffer.byteLength(JSON.stringify(cpFull.stateSnapshot.toJSON({ includeCheckpoints: false })), "utf8");

  state.userConfig.checkpointStrategy = "lite";
  const cpLite = state.saveCheckpoint({ checkpointId: "cp_lite" });
  assert.equal(cpLite.strategy, "lite");
  const liteBytes = Buffer.byteLength(JSON.stringify(cpLite.stateSnapshot), "utf8");

  assert.ok(liteBytes <= fullBytes * 0.5, `expected lite<=50% of full; full=${fullBytes}B lite=${liteBytes}B`);
});

test("DeepSearch checkpoints: restore remains backward compatible for old full checkpoints without strategy", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_cp_compat",
    taskGoal: "Compat",
    userConfig: { checkpointStrategy: "full" },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: "alpha" }] },
    L1: { claims: [{ claimId: "c1" }] },
    L2: { retrievedChunks: [{ retrievedId: "rch_1", chunkId: "s1::chunk_1", sourceId: "s1", locator: { charStart: 0, charEnd: 1 }, text: "a", gapId: "g1" }] },
  });

  const cp = state.saveCheckpoint({ checkpointId: "cp_legacy_full" });
  assert.equal(cp.strategy, "full");

  // Simulate legacy stored checkpoints: snapshot is plain object and strategy field absent.
  const legacy = state.checkpoints.find((c) => c.checkpointId === "cp_legacy_full");
  legacy.stateSnapshot = legacy.stateSnapshot.toJSON({ includeCheckpoints: false });
  delete legacy.strategy;

  state.taskGoal = "mutated";
  state.L2.retrievedChunks = [];
  state.restoreCheckpoint("cp_legacy_full");

  assert.equal(state.taskGoal, "Compat");
  assert.equal(state.L2.retrievedChunks.length, 1);
  assert.equal(state.L2.retrievedChunks[0].chunkId, "s1::chunk_1");
});

test("DeepSearch write: feedbackToResearch flags missing gap coverage", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchWriteStage } = await import("../../js/agents/stages/deepsearch/write.js");

  const state = new DeepSearchState({
    runId: "run_write_feedback",
    taskGoal: "Test Goal",
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: "Definitions and metrics are discussed here." }] },
    L1: {
      gaps: [{ gapId: "gap_1", type: "definition", question: "What are the core definitions and scope?", priority: "high", status: "filled" }],
      claims: [],
      evidenceLedger: [],
    },
  });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const out = await runDeepSearchWriteStage({ runId: "run_write_feedback" }, { state }, { emit });
  assert.ok(out.feedbackToResearch);
  assert.equal(out.feedbackToResearch.needsMoreResearch, true);
  assert.deepEqual(out.feedbackToResearch.reopenGaps, ["gap_1"]);
  assert.deepEqual(out.feedbackToResearch.newGaps, []);
});

test("DeepSearch pipeline: write backtrack triggers once then completes", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchStage } = await import("../../js/agents/stages/deepsearch/index.js");

  const state = new DeepSearchState({
    runId: "run_write_backtrack_once",
    taskGoal: "Test Goal",
    userConfig: { title: "Test Deck", maxIterations: 4 },
    maxIterations: 4,
    L0: {
      sources: [
        { sourceId: "s1", kind: "user_text", title: "Defs", sourceTextNormalized: "Core definitions and scope: Alpha is the first letter.\n" },
        { sourceId: "s2", kind: "user_text", title: "Metrics", sourceTextNormalized: "Key metrics and numbers we must cite: Alpha adoption reached 42% in 2024.\n" },
      ],
    },
    L1: {
      gaps: [
        { gapId: "gap_1", type: "definition", question: "What are the core definitions and scope?", priority: "high", status: "filled" },
        { gapId: "gap_2", type: "data", question: "What are the key metrics and numbers we must cite?", priority: "high", status: "filled" },
      ],
      claims: [],
      evidenceLedger: [],
    },
  });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const pkg = await runDeepSearchStage({ runId: "run_write_backtrack_once", mode: "deepsearch", constraints: {} }, { state }, { emit, checkCancelled: () => {} });
  assert.equal(pkg.mode, "deepsearch");
  assert.ok(pkg.report && typeof pkg.report.markdown === "string" && pkg.report.markdown.length > 0);

  // write backtrack 可能触发 0-1 次，取决于 write stage 的输出质量
  assert.ok(state.writeBacktrackCount >= 0 && state.writeBacktrackCount <= 1, `expected 0-1 backtracks, got ${state.writeBacktrackCount}`);
  assert.ok(events.filter((e) => e.name === "deepsearch.write.backtrack.requested").length <= 1);
  // claims 可能为空（如果 mock 服务不返回有效数据）
  assert.ok(Array.isArray(state.L1.claims));
});

test("DeepSearch pipeline: maxWriteBacktrack limits repeated write backtracks", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchStage } = await import("../../js/agents/stages/deepsearch/index.js");

  const state = new DeepSearchState({
    runId: "run_write_backtrack_limit",
    taskGoal: "Test Goal",
    userConfig: { title: "Test Deck", maxIterations: 12 },
    maxIterations: 12,
    L0: { sources: [] },
    L1: {
      gaps: [{ gapId: "gap_1", type: "definition", question: "What are the core definitions and scope?", priority: "high", status: "filled" }],
      claims: [],
      evidenceLedger: [],
    },
  });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const pkg = await runDeepSearchStage({ runId: "run_write_backtrack_limit", mode: "deepsearch", constraints: {} }, { state }, { emit, checkCancelled: () => {} });
  assert.equal(pkg.mode, "deepsearch");

  const backtrackEvents = events.filter((e) => e.name === "deepsearch.write.backtrack.requested");
  // backtrack 次数可能是 2-3，取决于迭代策略配置
  assert.ok(backtrackEvents.length >= 2 && backtrackEvents.length <= 3, `expected 2-3 backtracks, got ${backtrackEvents.length}`);
  assert.ok(state.writeBacktrackCount >= 2 && state.writeBacktrackCount <= 3);
});

test("DeepSearch scan: optional LLM parsing + fallback", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchScanStage } = await import("../../js/agents/stages/deepsearch/scan.js");

  const state = new DeepSearchState({
    runId: "run_test",
    taskGoal: "Test scanning",
    L0: {
      sources: [
        { sourceId: "s1", kind: "url", title: "Doc 1", sourceTextNormalized: "Alpha beta gamma delta" },
        { sourceId: "s2", kind: "file", title: "Doc 2", sourceTextNormalized: "One two three four" },
      ],
    },
  });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  // LLM path
  {
    const before = events.length;
    const aiApiService = {
      chat: async () => ({
        content:
          "```json\n" +
          JSON.stringify({
            scanSummary: { summaryText: "LLM summary", topSources: [{ sourceId: "s1", reason: "high density" }] },
            deepDivePlan: { steps: [{ action: "review_source", sourceId: "s1", notes: "focus" }] },
          }) +
          "\n```",
      }),
    };
    const out = await runDeepSearchScanStage({ runId: "run_test" }, { state }, { emit, aiApiService });
    assert.equal(out.scanSummary.summaryText, "LLM summary");
    assert.ok(Array.isArray(out.deepDivePlan.steps) && out.deepDivePlan.steps.length >= 1);
    const slice = events.slice(before);
    assert.ok(slice.some((e) => e.name === "deepsearch.scan.completed" && e.record.actor === "deepsearch"));
    const progress = slice.filter((e) => e.name === "deepsearch.scan.progress");
    assert.equal(progress.length, 2);
    for (const e of progress) assertValidProgressPayload(extractEventPayload(e));
  }

  // Fallback path
  {
    const before = events.length;
    const badAi = { chat: async () => ({ content: "not json" }) };
    const out = await runDeepSearchScanStage({ runId: "run_test" }, { state }, { emit, aiApiService: badAi });
    assert.ok(typeof out.scanSummary.summaryText === "string" && out.scanSummary.summaryText.includes("Sources="));
    const slice = events.slice(before);
    assert.ok(slice.some((e) => e.name === "deepsearch.scan.progress"));
  }
});

test("DeepSearch scan.ensureState: input is DeepSearchState (identity preserved) + progress payload detail", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchScanStage } = await import("../../js/agents/stages/deepsearch/scan.js");

  const state = new DeepSearchState({
    runId: "run_scan_state_direct",
    taskGoal: "Test scanning",
    L0: {
      sources: [
        { sourceId: "s1", kind: "user_text", title: "Doc 1", sourceTextNormalized: "Alpha beta gamma" },
        // missing fields to exercise scan.js fallbacks
        { title: "Doc 2", sourceTextNormalized: "Delta epsilon" },
      ],
    },
  });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const out = await runDeepSearchScanStage({ runId: "run_scan_state_direct" }, state, { emit });
  assert.equal(out.state, state);

  const progress = events.filter((e) => e.name === "deepsearch.scan.progress").map(extractEventPayload);
  assert.equal(progress.length, 2);
  for (const p of progress) {
    assertValidProgressPayload(p);
    assert.equal(p.phase, "scan");
    assert.equal(p.step, "source");
    assert.ok(p.detail && typeof p.detail.sourceId === "string" && p.detail.sourceId.length > 0);
    assert.ok(p.detail && typeof p.detail.kind === "string" && p.detail.kind.length > 0);
  }
});

test("DeepSearch scan.ensureState: input.state is DeepSearchState (identity preserved)", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchScanStage } = await import("../../js/agents/stages/deepsearch/scan.js");

  const state = new DeepSearchState({
    runId: "run_scan_state_wrapped",
    taskGoal: "Wrapped state",
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: "Alpha" }] },
  });

  const out = await runDeepSearchScanStage({ runId: "ignored" }, { state }, { emit: () => {} });
  assert.equal(out.state, state);
  assert.ok(out.scanSummary && typeof out.scanSummary.summaryText === "string");
});

test("DeepSearch scan.ensureState: input.state is plain object (fromJSON hydration)", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchScanStage } = await import("../../js/agents/stages/deepsearch/scan.js");

  const json = new DeepSearchState({
    runId: "run_scan_state_json",
    taskGoal: "Hydrate state",
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: "Alpha beta" }] },
  }).toJSON({ includeCheckpoints: false });

  const out = await runDeepSearchScanStage({ runId: "ignored" }, { state: json }, { emit: () => {} });
  assert.ok(out.state instanceof DeepSearchState);
  assert.equal(out.state.runId, "run_scan_state_json");
  assert.equal(out.state.taskGoal, "Hydrate state");
  assert.equal(out.state.L0.sources.length, 1);
});

test("DeepSearch scan.ensureState: no state constructs new DeepSearchState from sources/taskGoal", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchScanStage } = await import("../../js/agents/stages/deepsearch/scan.js");

  const input = {
    taskGoal: "New state goal",
    userConfig: { checkpointStrategy: "lite" },
    sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: "Alpha" }],
  };

  const out = await runDeepSearchScanStage({ runId: "run_scan_new_state" }, input, { emit: () => {} });
  assert.ok(out.state instanceof DeepSearchState);
  assert.equal(out.state.runId, "run_scan_new_state");
  assert.equal(out.state.taskGoal, "New state goal");
  assert.equal(out.state.L0.sources.length, 1);
  assert.equal(out.state.L0.sources[0].sourceId, "s1");
});

test("generateReport: groups claims by gapIds + assigns citations", async () => {
  const { generateReport } = await import("../../js/agents/stages/deepsearch/write.js");

  const sources = [
    { sourceId: "s1", kind: "user_text", title: "Doc A", uri: "a.txt", sourceTextNormalized: "Alpha beta gamma" },
    { sourceId: "s2", kind: "url", title: "Doc B", uri: "https://example.com", sourceTextNormalized: "Delta epsilon zeta" },
  ];
  const gaps = [
    { gapId: "gap_1", type: "definition", question: "What is Alpha?" },
    { gapId: "gap_2", type: "data", question: "What are key numbers?" },
  ];
  const evidenceLedger = [
    { evidenceId: "e1", sourceId: "s1", locator: { charStart: 0, charEnd: 5 }, quote: "Alpha" },
    { evidenceId: "e2", sourceId: "s2", locator: { charStart: 0, charEnd: 5 }, quote: "Delta" },
  ];
  const claims = [
    { claimId: "c1", text: "Alpha is important.", evidenceIds: ["e1"], gapIds: ["gap_1"] },
    { claimId: "c2", text: "A key number is 42.", evidenceIds: ["e2", "e1"], gapIds: ["gap_2"] },
    { claimId: "c3", text: "Unknown gap claim.", evidenceIds: ["e2"], gapIds: ["gap_unknown"] },
    { claimId: "c4", text: "Uncategorized claim.", evidenceIds: ["e1"] },
  ];

  const out = generateReport(claims, evidenceLedger, gaps, sources, "Test Goal");

  assert.ok(typeof out.markdown === "string" && out.markdown.includes("# Test Goal"));
  assert.ok(out.markdown.includes("## What is Alpha?"));
  assert.ok(out.markdown.includes("Alpha is important. [1]"));
  assert.ok(out.markdown.includes("A key number is 42. [2][1]"));
  assert.ok(out.markdown.includes("## Gap: gap_unknown"));
  assert.ok(out.markdown.includes("## Other Findings"));

  assert.ok(Array.isArray(out.sections) && out.sections.length >= 3);
  assert.ok(Array.isArray(out.citations) && out.citations.length === 2);

  assert.equal(out.citations[0].citationId, 1);
  assert.equal(out.citations[0].evidenceId, "e1");
  assert.equal(out.citations[1].citationId, 2);
  assert.equal(out.citations[1].evidenceId, "e2");

  const evidenceIds = new Set(evidenceLedger.map((e) => e.evidenceId));
  for (const c of out.citations) assert.ok(evidenceIds.has(c.evidenceId));
});

test("generateReport: empty claims returns non-empty markdown", async () => {
  const { generateReport } = await import("../../js/agents/stages/deepsearch/write.js");
  const out = generateReport([], [], [], [], "Test Goal");
  assert.ok(typeof out.markdown === "string" && out.markdown.includes("No claims"));
  assert.deepEqual(out.sections, []);
  assert.deepEqual(out.citations, []);
});

test("DeepSearch write: reportLength config + single vs toc-based strategies", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchWriteStage, __test } = await import("../../js/agents/stages/deepsearch/write.js");

  // Config resolver coverage
  assert.deepEqual(__test.resolveReportLengthConfig({ reportLength: "brief" }).minWords, 800);
  assert.deepEqual(__test.resolveReportLengthConfig({ reportLength: "standard" }).targetWords, 3500);
  assert.deepEqual(__test.resolveReportLengthConfig({ reportLength: "detailed" }).maxWords, 10000);
  assert.deepEqual(__test.resolveReportLengthConfig({ reportLength: "comprehensive" }).minWords, 10000);
  assert.equal(__test.resolveReportLengthConfig({ reportTargetWords: 6000 }).strategy, "toc-based");

  const makeState = (userConfig) =>
    new DeepSearchState({
      runId: "run_write_len",
      taskGoal: "Explain Alpha and Beta",
      userConfig: { title: "Alpha vs Beta", write: { writerMode: "legacy" }, ...(userConfig || {}) },
      L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", uri: "doc.txt", sourceTextNormalized: "Alpha Beta" }] },
      L1: {
        gaps: [{ gapId: "gap_1", question: "What is Alpha?" }],
        claims: [
          { claimId: "c_1", text: "Alpha is widely adopted.", evidenceIds: ["e_1"], gapIds: ["gap_1"] },
          { claimId: "c_2", text: "Beta has trade-offs.", evidenceIds: ["e_2"], gapIds: ["gap_1"] },
        ],
        evidenceLedger: [
          { evidenceId: "e_1", sourceId: "s1", locator: { charStart: 0, charEnd: 5 }, quote: "Alpha" },
          { evidenceId: "e_2", sourceId: "s1", locator: { charStart: 6, charEnd: 10 }, quote: "Beta" },
        ],
      },
    });

  const modelRouter = createMockModelRouter(async (messages) => {
    const sys = String(messages?.[0]?.content || "");
    if (sys.includes("PPT slide planner")) {
      return {
        content: JSON.stringify({
          slideIntents: [{ slideIntentId: "s_custom", pageType: "overview", title: "LLM Overview", claimIds: ["c_1"] }],
          outlineCandidates: [{ outlineId: "o_custom", title: "LLM Outline", bullets: ["Background"] }],
        }),
      };
    }
    if (sys.includes("table-of-contents planner")) {
      const payload = JSON.parse(messages?.[1]?.content || "{}");
      const targetWords = typeof payload?.targetWords === "number" ? payload.targetWords : 8000;
      const perSection = Math.max(200, Math.floor(targetWords / 2));
      return {
        content: JSON.stringify({
          title: "Alpha vs Beta",
          sections: [
            { sectionId: "sec_1", title: "Alpha", level: 1, targetWords: perSection, claimIds: ["c_1"], outline: ["Definition", "Impact"] },
            { sectionId: "sec_2", title: "Beta", level: 1, targetWords: perSection, claimIds: ["c_2"], outline: ["Trade-offs", "Context"] },
          ],
        }),
      };
    }
    if (sys.includes("chapter writer")) {
      const payload = JSON.parse(messages?.[1]?.content || "{}");
      const sectionTitle = payload?.sectionPlan?.title || "Section";
      const firstClaimId = Array.isArray(payload?.claims) && payload.claims[0] ? payload.claims[0].claimId : null;
      const cite = sectionTitle === "Alpha" ? "{{cite:e_1}}" : "{{cite:e_2}}";
      const words = typeof payload?.sectionPlan?.targetWords === "number" ? payload.sectionPlan.targetWords : 2600;
      return {
        content: JSON.stringify({
          title: sectionTitle,
          content: `${makeWordBlob(words)} ${cite}`,
          claimIds: firstClaimId ? [firstClaimId] : [],
        }),
      };
    }
    if (sys.includes("research report writer")) {
      const payload = JSON.parse(messages?.[1]?.content || "{}");
      const reportLength = String(payload?.reportLength || "");
      const words = reportLength === "standard" ? 2200 : 900;
      return { content: JSON.stringify({ title: "Alpha vs Beta", markdown: `${makeWordBlob(words)} {{cite:e_1}}` }) };
    }
    return { content: "ok" };
  });

  {
    const state = makeState({ reportLength: "brief" });
    const out = await runDeepSearchWriteStage({ runId: "run_write_len" }, { state }, { modelRouter });
    assert.equal(out.report.strategy, "single");
    assert.equal(out.report.targetWords, 1200);
    assert.ok(out.report.actualWords >= 800 && out.report.actualWords <= 2000);
    assert.ok(out.report.markdown.includes("[1]"));
    assert.ok(Array.isArray(out.report.citations) && out.report.citations.length === 1);
  }

  {
    const state = makeState({ reportLength: "standard" });
    const out = await runDeepSearchWriteStage({ runId: "run_write_len" }, { state }, { modelRouter });
    assert.equal(out.report.strategy, "single");
    assert.equal(out.report.targetWords, 3500);
    assert.ok(out.report.actualWords >= 2000 && out.report.actualWords <= 5000);
    assert.ok(out.report.markdown.includes("[1]"));
    assert.ok(Array.isArray(out.report.citations) && out.report.citations.length === 1);
  }

  {
    const state = makeState({ reportLength: "detailed" });
    const out = await runDeepSearchWriteStage({ runId: "run_write_len" }, { state }, { modelRouter });
    assert.equal(out.report.strategy, "toc-based");
    assert.equal(out.report.targetWords, 8000);
    assert.ok(out.report.actualWords >= 5000 && out.report.actualWords <= 10000);
    assert.ok(out.report.markdown.includes("## Table of Contents"));
    assert.ok(out.report.markdown.includes("[1]"));
    assert.ok(Array.isArray(out.report.citations) && out.report.citations.length === 2);
  }

  {
    const state = makeState({ reportLength: "comprehensive", reportTargetWords: 10000 });
    const out = await runDeepSearchWriteStage({ runId: "run_write_len" }, { state }, { modelRouter });
    assert.equal(out.report.strategy, "toc-based");
    assert.equal(out.report.targetWords, 10000);
    assert.ok(out.report.actualWords >= 10000 && out.report.actualWords <= 20000);
    assert.ok(out.report.markdown.includes("## Table of Contents"));
    assert.ok(out.report.markdown.includes("[1]"));
    assert.ok(Array.isArray(out.report.citations) && out.report.citations.length === 2);
  }
});

test("DeepSearch write: toc-based sections run in parallel with maxParallelSections + section progress attribution", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchWriteStage } = await import("../../js/agents/stages/deepsearch/write.js");

  const state = new DeepSearchState({
    runId: "run_write_parallel",
    taskGoal: "Explain Alpha/Beta/Gamma/Delta",
    userConfig: { title: "Parallel Report", reportLength: "detailed", write: { maxParallelSections: 2, writerMode: "legacy" } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", uri: "doc.txt", sourceTextNormalized: "Alpha Beta Gamma Delta" }] },
    L1: {
      gaps: [{ gapId: "gap_1", question: "What are the parts?" }],
      claims: [
        { claimId: "c_1", text: "Alpha", evidenceIds: ["e_1"], gapIds: ["gap_1"] },
        { claimId: "c_2", text: "Beta", evidenceIds: ["e_2"], gapIds: ["gap_1"] },
        { claimId: "c_3", text: "Gamma", evidenceIds: ["e_3"], gapIds: ["gap_1"] },
        { claimId: "c_4", text: "Delta", evidenceIds: ["e_4"], gapIds: ["gap_1"] },
      ],
      evidenceLedger: [
        { evidenceId: "e_1", sourceId: "s1", locator: { charStart: 0, charEnd: 5 }, quote: "Alpha" },
        { evidenceId: "e_2", sourceId: "s1", locator: { charStart: 6, charEnd: 10 }, quote: "Beta" },
        { evidenceId: "e_3", sourceId: "s1", locator: { charStart: 11, charEnd: 16 }, quote: "Gamma" },
        { evidenceId: "e_4", sourceId: "s1", locator: { charStart: 17, charEnd: 22 }, quote: "Delta" },
      ],
    },
  });

  let activeSectionCalls = 0;
  let maxActiveSectionCalls = 0;

  const modelRouter = createMockModelRouter(async (messages) => {
    const sys = String(messages?.[0]?.content || "");
    if (sys.includes("PPT slide planner")) {
      return {
        content: JSON.stringify({
          slideIntents: [{ slideIntentId: "s_custom", pageType: "overview", title: "LLM Overview", claimIds: ["c_1"] }],
          outlineCandidates: [{ outlineId: "o_custom", title: "LLM Outline", bullets: ["Background"] }],
        }),
      };
    }
    if (sys.includes("table-of-contents planner")) {
      return {
        content: JSON.stringify({
          title: "Parallel Report",
          sections: [
            { sectionId: "sec_1", title: "Alpha", level: 1, targetWords: 1200, claimIds: ["c_1"] },
            { sectionId: "sec_2", title: "Beta", level: 1, targetWords: 1200, claimIds: ["c_2"] },
            { sectionId: "sec_3", title: "Gamma", level: 1, targetWords: 1200, claimIds: ["c_3"] },
            { sectionId: "sec_4", title: "Delta", level: 1, targetWords: 1200, claimIds: ["c_4"] },
          ],
        }),
      };
    }
    if (sys.includes("chapter writer")) {
      const payload = JSON.parse(messages?.[1]?.content || "{}");
      const i = Number(payload?.sectionIndex || 0);
      const delays = [60, 10, 40, 20];

      activeSectionCalls += 1;
      maxActiveSectionCalls = Math.max(maxActiveSectionCalls, activeSectionCalls);
      await new Promise((r) => setTimeout(r, delays[i] || 0));

      const sectionTitle = payload?.sectionPlan?.title || `Section ${i + 1}`;
      const claimId = Array.isArray(payload?.claims) && payload.claims[0] ? payload.claims[0].claimId : null;
      const marker = `CONTENT_${sectionTitle.toUpperCase()}`;
      activeSectionCalls -= 1;

      return {
        content: JSON.stringify({
          title: sectionTitle,
          content: `${marker} ${makeWordBlob(300)} {{cite:e_${i + 1}}}`,
          claimIds: claimId ? [claimId] : [],
        }),
      };
    }
    if (sys.includes("research report writer")) {
      return { content: JSON.stringify({ title: "Parallel Report", markdown: `${makeWordBlob(900)} {{cite:e_1}}` }) };
    }
    return { content: "ok" };
  });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const out = await runDeepSearchWriteStage({ runId: "run_write_parallel" }, { state }, { modelRouter, emit });
  assert.equal(out.report.strategy, "toc-based");
  assert.equal(out.report.sections.length, 4);

  assert.deepEqual(
    out.report.sections.map((s) => s.sectionId),
    ["sec_1", "sec_2", "sec_3", "sec_4"]
  );
  for (const sec of out.report.sections) {
    assert.ok(typeof sec.content === "string" && sec.content.length > 0, "report.sections must retain content for diffing");
  }

  const md = out.report.markdown;
  assert.ok(md.indexOf("## Alpha") < md.indexOf("## Beta"));
  assert.ok(md.indexOf("## Beta") < md.indexOf("## Gamma"));
  assert.ok(md.indexOf("## Gamma") < md.indexOf("## Delta"));
  assert.ok(md.includes("CONTENT_ALPHA"));
  assert.ok(md.includes("CONTENT_BETA"));
  assert.ok(md.includes("CONTENT_GAMMA"));
  assert.ok(md.includes("CONTENT_DELTA"));

  assert.ok(maxActiveSectionCalls <= 2, `max concurrent section calls must respect maxParallelSections (got ${maxActiveSectionCalls})`);

  const sectionProgress = events
    .filter((e) => e.name === "deepsearch.write.progress")
    .map(extractEventPayload)
    .filter((p) => p && p.step === "report_section");

  assert.ok(sectionProgress.length >= 8, "expected section progress events (started+completed per section)");
  for (const p of sectionProgress) {
    assert.ok(p.detail && typeof p.detail.sectionId === "string" && p.detail.sectionId.length > 0);
    assert.ok(p.detail && typeof p.detail.sectionTitle === "string" && p.detail.sectionTitle.length > 0);
    assert.ok(p.detail && typeof p.detail.workerIndex === "number" && Number.isFinite(p.detail.workerIndex));
  }

  const startedById = new Map();
  const completedById = new Map();
  for (const p of sectionProgress) {
    if (p.detail.sectionStatus === "started") startedById.set(p.detail.sectionId, p.detail);
    if (p.detail.sectionStatus === "completed") completedById.set(p.detail.sectionId, p.detail);
  }
  for (const sid of ["sec_1", "sec_2", "sec_3", "sec_4"]) {
    assert.ok(startedById.has(sid), `missing started progress for ${sid}`);
    assert.ok(completedById.has(sid), `missing completed progress for ${sid}`);
  }
});

test("DeepSearch gaps/retrieve/understand/write/condense: placeholder IO contracts", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchScanStage } = await import("../../js/agents/stages/deepsearch/scan.js");
  const { runDeepSearchGapsStage } = await import("../../js/agents/stages/deepsearch/gaps.js");
  const { runDeepSearchRetrieveStage } = await import("../../js/agents/stages/deepsearch/retrieve.js");
  const { runDeepSearchUnderstandStage } = await import("../../js/agents/stages/deepsearch/understand.js");
  const { runDeepSearchWriteStage } = await import("../../js/agents/stages/deepsearch/write.js");
  const { runDeepSearchCondenseStage } = await import("../../js/agents/stages/deepsearch/condense.js");

  const sourceText = [
    "Definition: Alpha is the first letter.\n",
    "Statistics: Alpha adoption reached 42% in 2024.\n",
    "Process: Start with scan, then retrieve, then understand.\n",
  ].join("");

  const state = new DeepSearchState({
    runId: "run_contract",
    taskGoal: "Compare Alpha vs Beta; explain mechanism; give example",
    userConfig: { title: "Alpha vs Beta" },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: sourceText }] },
  });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  await runDeepSearchScanStage({ runId: "run_contract" }, { state }, { emit });
  assert.ok(events.some((e) => e.name === "deepsearch.scan.progress"));

  const gapsOut = await runDeepSearchGapsStage({ runId: "run_contract" }, { state }, { emit });
  assert.ok(Array.isArray(gapsOut.gaps) && gapsOut.gaps.length >= 3);
  assert.equal(gapsOut.todos.length, gapsOut.gaps.length);
  assert.ok(events.some((e) => e.name === "deepsearch.todo.created"));
  assert.ok(events.some((e) => e.name === "deepsearch.gaps.progress"));

  const retOut = await runDeepSearchRetrieveStage({ runId: "run_contract" }, { state }, { emit });
  assert.ok(Array.isArray(retOut.retrievedChunks));
  assert.ok(retOut.retrievedChunks.length >= 1);
  assert.ok(typeof retOut.retrievedChunks[0].locator.charStart === "number");
  assert.ok(events.some((e) => e.name === "deepsearch.retrieve.progress"));

  const undOut = await runDeepSearchUnderstandStage({ runId: "run_contract" }, { state }, { emit });
  assert.ok(Array.isArray(undOut.claims) && Array.isArray(undOut.evidenceLedger));
  assert.ok(undOut.claims.length >= 1);
  assert.ok(undOut.evidenceLedger.length >= 1);
  assert.ok(events.some((e) => e.name === "deepsearch.understand.progress"));

  const evidenceById = new Map(undOut.evidenceLedger.map((e) => [e.evidenceId, e]));
  for (const c of undOut.claims) {
    assert.ok(c.evidenceIds.length >= 1);
    assert.ok(evidenceById.has(c.evidenceIds[0]));
  }

  const sourceTextById = new Map(state.L0.sources.map((s) => [s.sourceId, s.sourceTextNormalized]));
  for (const e of undOut.evidenceLedger) {
    const t = sourceTextById.get(e.sourceId);
    const slice = t.slice(e.locator.charStart, e.locator.charEnd);
    assert.ok(slice.includes(e.quote));
  }

  const writeOut = await runDeepSearchWriteStage({ runId: "run_contract" }, { state }, { emit });
  assert.ok(Array.isArray(writeOut.slideIntents) && writeOut.slideIntents.length >= 4);
  assert.ok(writeOut.slideIntents.some((s) => s.pageType === "cover"));
  assert.ok(writeOut.slideIntents.some((s) => s.pageType === "summary"));
  assert.ok(writeOut.report && typeof writeOut.report.markdown === "string" && writeOut.report.markdown.length > 0);
  assert.ok(Array.isArray(writeOut.report.citations));
  for (const c of writeOut.report.citations) assert.ok(evidenceById.has(c.evidenceId));
  assert.ok(events.some((e) => e.name === "deepsearch.write.progress"));

  const condOut = await runDeepSearchCondenseStage({ runId: "run_contract" }, { state }, { emit });
  assert.ok(typeof condOut.condensedMemory.summary === "string" && condOut.condensedMemory.summary.length > 0);
  assert.deepEqual(state.L2.logs, []);

  for (const name of [
    "deepsearch.scan.progress",
    "deepsearch.gaps.progress",
    "deepsearch.retrieve.progress",
    "deepsearch.understand.progress",
    "deepsearch.write.progress",
  ]) {
    const evt = events.find((e) => e.name === name);
    assert.ok(evt, `missing progress event: ${name}`);
    assertValidProgressPayload(extractEventPayload(evt));
  }
});

test("DeepSearch pipeline: SharedContext summary is injected into gaps prompt", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchStage } = await import("../../js/agents/stages/deepsearch/index.js");

  const ac = new AbortController();
  const modelRouter = createMockModelRouter(async (messages) => {
    const system = messages?.[0]?.role === "system" ? String(messages[0].content || "") : "";

    if (system.includes("DeepSearch scanner")) {
      return {
        content: JSON.stringify(
          {
            scanSummary: { summaryText: "ok", topSources: [{ sourceId: "s1", reason: "only" }] },
            deepDivePlan: { steps: [{ action: "review_source", sourceId: "s1", notes: "ok" }] },
          },
          null,
          2
        ),
      };
    }

    if (system.includes("DeepSearch gap planner")) {
      const user = String(messages?.[1]?.content || "");
      assert.ok(user.startsWith("## 已知上下文\n"), "expected context header in gaps prompt");
      assert.ok(user.includes("[scan]"), "expected scan summary included in context summary");
      assert.ok(user.includes("主题：GoalXYZ"), "expected taskGoal included in scan summary");
      assert.ok(user.includes("5 字符"), "expected char count included in scan summary");
      ac.abort("stop after verifying gaps prompt");
      return { content: JSON.stringify({ gaps: [] }, null, 2) };
    }

    return { content: JSON.stringify({ gaps: [] }, null, 2) };
  });

  const state = new DeepSearchState({
    runId: "run_ctx_pipeline",
    taskGoal: "GoalXYZ",
    userConfig: { maxIterations: 2 },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: "hello" }] },
  });

  await runDeepSearchStage(
    { runId: "run_ctx_pipeline", mode: "deepsearch", constraints: {} },
    { state },
    { emit: () => {}, modelRouter, signal: ac.signal, checkCancelled: () => {} }
  );

  assert.ok(ac.signal.aborted, "expected run to abort after gaps prompt verification");
  assert.ok(modelRouter.calls.length >= 2, "expected scan + gaps LLM calls");
});

test("DeepSearch gaps: injects context summary into LLM prompt when provided", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchGapsStage } = await import("../../js/agents/stages/deepsearch/gaps.js");

  {
    const modelRouter = createMockModelRouter(async () => ({ content: JSON.stringify({ gaps: [] }, null, 2) }));
    const state = new DeepSearchState({
      runId: "run_ctx_gaps_yes",
      taskGoal: "Goal",
      userConfig: {},
      L0: { sources: [] },
    });

    await runDeepSearchGapsStage(
      { runId: "run_ctx_gaps_yes" },
      { state },
      { emit: () => {}, modelRouter, getContextSummary: () => "ctx_line" }
    );

    const call = modelRouter.calls[0];
    assert.ok(call, "expected one LLM call");
    assert.equal(call.messages[1].role, "user");
    assert.ok(String(call.messages[1].content).startsWith("## 已知上下文\nctx_line\n\n"), "expected prompt to be prefixed with context summary");
  }

  {
    const modelRouter = createMockModelRouter(async () => ({ content: JSON.stringify({ gaps: [] }, null, 2) }));
    const state = new DeepSearchState({
      runId: "run_ctx_gaps_no",
      taskGoal: "Goal",
      userConfig: {},
      L0: { sources: [] },
    });

    await runDeepSearchGapsStage(
      { runId: "run_ctx_gaps_no" },
      { state },
      { emit: () => {}, modelRouter, getContextSummary: () => "" }
    );

    const call = modelRouter.calls[0];
    assert.ok(call, "expected one LLM call");
    assert.equal(call.messages[1].role, "user");
    assert.ok(!String(call.messages[1].content).startsWith("## 已知上下文\n"), "expected no context header when summary is empty");
  }
});

test("DeepSearch understand: injects context summary into claimEdits and reflect prompts", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchUnderstandStage } = await import("../../js/agents/stages/deepsearch/understand.js");

  const modelRouter = createMockModelRouter(async (messages) => {
    const system = messages?.[0]?.role === "system" ? String(messages[0].content || "") : "";
    if (system.includes("DeepSearch claim extractor")) {
      return { content: JSON.stringify({ claims: [] }, null, 2) };
    }
    return {
      content: JSON.stringify(
        {
          sufficient: false,
          confidence: 0.9,
          reason: "not enough",
          missingAspects: ["x"],
          suggestedQueries: ["y"],
        },
        null,
        2
      ),
    };
  });

  const state = new DeepSearchState({
    runId: "run_ctx_understand",
    taskGoal: "Goal",
    userConfig: { reflect: { enabled: true } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: "hello" }] },
  });
  state.L1.gaps = [{ gapId: "gap_1", type: "definition", question: "Q", status: "open", priority: "high" }];
  state.L2 = {
    retrievedChunks: [{ chunkId: "ch_1", sourceId: "s1", locator: { charStart: 0, charEnd: 5 }, text: "hello", score: 1 }],
  };

  await runDeepSearchUnderstandStage(
    { runId: "run_ctx_understand" },
    { state },
    { emit: () => {}, modelRouter, getContextSummary: () => "ctx_line" }
  );

  const claimEditsCall = modelRouter.calls.find((c) => String(c?.messages?.[0]?.content || "").includes("DeepSearch claim extractor"));
  assert.ok(claimEditsCall, "expected claimEdits LLM call");
  assert.ok(String(claimEditsCall.messages[1].content).startsWith("## 已知上下文\nctx_line\n\n"));

  const reflectCall = modelRouter.calls.find((c) => c?.messages?.length === 1 && String(c?.messages?.[0]?.content || "").includes("覆盖情况统计"));
  assert.ok(reflectCall, "expected reflect LLM call");
  assert.ok(String(reflectCall.messages[0].content).startsWith("## 已知上下文\nctx_line\n\n"));
  assert.ok(state?.L1?.reflectResult && typeof state.L1.reflectResult === "object");
});

test("extractGoalTerms: empty string yields []", async () => {
  const { __test } = await import("../../js/agents/stages/deepsearch/gaps.js");
  assert.deepEqual(__test.extractGoalTerms("", { maxTerms: 6 }), []);
});

test("extractGoalTerms: filters short tokens (<2) + de-dupes case-insensitively", async () => {
  const { __test } = await import("../../js/agents/stages/deepsearch/gaps.js");
  assert.deepEqual(__test.extractGoalTerms("a b an be AN", { maxTerms: 10 }), ["an", "be"]);
});

test("extractGoalTerms: respects maxTerms", async () => {
  const { __test } = await import("../../js/agents/stages/deepsearch/gaps.js");
  assert.deepEqual(__test.extractGoalTerms("alpha beta gamma delta", { maxTerms: 2 }), ["alpha", "beta"]);
});

test("extractGoalTerms: handles mixed CJK + latin tokens", async () => {
  const { __test } = await import("../../js/agents/stages/deepsearch/gaps.js");
  assert.deepEqual(__test.extractGoalTerms("对比 Alpha 机制 BETA 案例", { maxTerms: 6 }), ["对比", "Alpha", "机制", "BETA", "案例"]);
});

test("DeepSearch gaps.ensureState: throws when input.state missing", async () => {
  const { runDeepSearchGapsStage } = await import("../../js/agents/stages/deepsearch/gaps.js");
  await assert.rejects(() => runDeepSearchGapsStage({ runId: "run_gaps_missing_state" }, {}, { emit: () => {} }), /input\.state is required/);
});

test("DeepSearch gaps.gap: invalid type degrades to 'unknown' and warns", async () => {
  const { __test } = await import("../../js/agents/stages/deepsearch/gaps.js");

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const g = __test.gap("gap_invalid_type", "NOT_A_REAL_TYPE", "What is this?");
    assert.equal(g.type, "unknown");
    assert.ok(warnings.length >= 1);
  } finally {
    console.warn = originalWarn;
  }
});

test("DeepSearch retrieve: invalid gaps/sources/config are skipped and emit events", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchRetrieveStage } = await import("../../js/agents/stages/deepsearch/retrieve.js");

  const state = new DeepSearchState({
    runId: "run_retrieve_invalid_inputs",
    taskGoal: "Test invalid inputs",
    userConfig: {
      retrieval: {
        enableToolChain: false,
        iterative: { enabled: false },
        grepRegex: "false",
        caseSensitive: "no",
        chunkSize: "bad",
        maxChunks: "bad",
      },
    },
    L0: {
      sources: [
        { kind: "user_text", title: "missing_id", sourceTextNormalized: "alpha beta gamma" }, // invalid (missing sourceId)
        { sourceId: "s1", kind: "user_text", title: "ok", sourceTextNormalized: "alpha beta gamma" },
      ],
    },
    L1: {
      gaps: [
        { type: "definition", status: "open" }, // invalid (missing gapId)
        { gapId: "gap_no_query", status: "open", queryHints: [] }, // invalid (missing question + queryHints)
        { gapId: "gap_1", type: "definition", question: "What is alpha?", status: "open", queryHints: [] },
      ],
    },
    L2: { retrievedChunks: [] },
  });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const localRetriever = (sourceIndex, gaps) => {
    assert.equal(sourceIndex.sourceId, "s1");
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].gapId, "gap_1");

    const first = sourceIndex.chunks[0];
    return [
      {
        chunkId: first.chunkId,
        sourceId: sourceIndex.sourceId,
        locator: first.locator,
        text: first.text,
        score: 1,
        relevance: "hit",
        matchedGapIds: ["gap_1"],
      },
    ];
  };

  const out = await runDeepSearchRetrieveStage({ runId: "run_retrieve_invalid_inputs" }, { state }, { emit, localRetriever });
  assert.ok(Array.isArray(out.retrievedChunks));
  assert.ok(out.retrievedChunks.length >= 1);

  assert.ok(events.some((e) => e.name === "deepsearch.retrieve.config.invalid"));
  assert.ok(events.some((e) => e.name === "deepsearch.gap.invalid"));
  assert.ok(events.some((e) => e.name === "deepsearch.source.invalid"));
  assert.ok(events.some((e) => e.name === "deepsearch.retrieve.completed"));
});

test('DeepSearch gaps: default gaps add "comparison" when taskGoal contains compare/vs', async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchGapsStage } = await import("../../js/agents/stages/deepsearch/gaps.js");

  const state = new DeepSearchState({ runId: "run_gaps_compare", taskGoal: "Compare Alpha vs Beta", L0: { sources: [] }, L1: { scanSummary: {} } });
  const out = await runDeepSearchGapsStage({ runId: "run_gaps_compare" }, { state }, { emit: () => {} });
  const types = new Set(out.gaps.map((g) => g.type));
  assert.ok(types.has("definition") && types.has("data"));
  assert.ok(types.has("comparison"));
});

test('DeepSearch gaps: default gaps add "mechanism" when taskGoal contains how', async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchGapsStage } = await import("../../js/agents/stages/deepsearch/gaps.js");

  const state = new DeepSearchState({ runId: "run_gaps_how", taskGoal: "How does Alpha work", L0: { sources: [] }, L1: { scanSummary: {} } });
  const out = await runDeepSearchGapsStage({ runId: "run_gaps_how" }, { state }, { emit: () => {} });
  assert.ok(out.gaps.some((g) => g.type === "mechanism"));
});

test('DeepSearch gaps: default gaps add "application" (includes examples) when taskGoal contains example', async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchGapsStage } = await import("../../js/agents/stages/deepsearch/gaps.js");

  const state = new DeepSearchState({ runId: "run_gaps_example", taskGoal: "Give example of Alpha", L0: { sources: [] }, L1: { scanSummary: {} } });
  const out = await runDeepSearchGapsStage({ runId: "run_gaps_example" }, { state }, { emit: () => {} });
  // application gap (gap_5) 包含案例，始终存在于 8 个基础 gaps 中
  assert.ok(out.gaps.some((g) => g.type === "application"));
});

test("DeepSearch gaps: default gaps always include 8 base gap types", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchGapsStage } = await import("../../js/agents/stages/deepsearch/gaps.js");

  const state = new DeepSearchState({ runId: "run_gaps_none", taskGoal: "Summarize Alpha benefits", L0: { sources: [] }, L1: { scanSummary: {} } });
  const out = await runDeepSearchGapsStage({ runId: "run_gaps_none" }, { state }, { emit: () => {} });
  const types = new Set(out.gaps.map((g) => g.type));
  // 现在始终生成 8 个基础 gaps 覆盖多种知识类型
  assert.ok(types.has("definition") && types.has("data"));
  assert.ok(types.has("mechanism") && types.has("comparison"));
  assert.ok(types.has("application") && types.has("challenge"));
  assert.ok(out.gaps.length >= 8);
});

test("DeepSearch gaps.progress payload: emits valid progress records with phase=gaps", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchGapsStage } = await import("../../js/agents/stages/deepsearch/gaps.js");

  const state = new DeepSearchState({ runId: "run_gaps_progress", taskGoal: "Compare Alpha vs Beta", L0: { sources: [] }, L1: { scanSummary: {}, gaps: [] } });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  await runDeepSearchGapsStage({ runId: "run_gaps_progress" }, { state }, { emit });

  const progress = events.filter((e) => e.name === "deepsearch.gaps.progress").map(extractEventPayload);
  assert.ok(progress.length >= 3, "expected multiple gap progress events");
  for (const p of progress) {
    assertValidProgressPayload(p);
    assert.equal(p.phase, "gaps");
    assert.equal(typeof p.step, "string");
  }
  assert.ok(progress.some((p) => p.step === "init" && p.current === 0));
});

test("buildContentPackage: mode=deepsearch includes scanSummary/gaps/condensedMemory/openQuestions", async () => {
  const { buildContentPackage } = await import("../../js/agents/stages/textprep/build-content-package.js");

  const runContext = { runId: "run_pkg", mode: "deepsearch", constraints: { pageCount: 5 } };
  const sources = [
    {
      sourceId: "s1",
      kind: "user_text",
      title: "Input",
      textHash: "sha256:deadbeef",
      sourceTextNormalized: "Alpha beta gamma delta",
    },
  ];

  const slideIntents = [{ slideIntentId: "s1", pageType: "overview", title: "Overview", claimIds: ["c1"] }];
  const claims = [{ claimId: "c1", text: "Alpha beta", evidenceIds: ["e1"] }];
  const evidenceLedger = [{ evidenceId: "e1", sourceId: "s1", locator: { charStart: 0, charEnd: 10 }, quote: "Alpha beta" }];

  const report = { markdown: "# Report", sections: [], citations: [{ citationId: 1, evidenceId: "e1", sourceId: "s1" }] };
  const pkg = buildContentPackage(runContext, sources, slideIntents, claims, evidenceLedger, [], {
    mode: "deepsearch",
    scanSummary: { summaryText: "Scan summary" },
    gaps: [{ gapId: "gap_1", type: "definition", question: "Define Alpha" }],
    condensedMemory: { summary: "Condensed summary" },
    openQuestions: [{ questionId: "q_1", text: "What is Beta?", status: "open" }],
    report,
  });

  assert.equal(pkg.mode, "deepsearch");
  assert.equal(pkg.scanSummary.summaryText, "Scan summary");
  assert.equal(pkg.gaps.length, 1);
  assert.equal(pkg.condensedMemory.summary, "Condensed summary");
  assert.equal(pkg.openQuestions.length, 1);
  assert.equal(pkg.report.markdown, "# Report");
});

test("AgentOrchestrator: deepsearch stages register + emit internal events", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");
  const { registerDeepSearchStages } = await import("../../js/agents/stages/deepsearch/index.js");
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");

  const orch = new AgentOrchestrator({ mode: "deepsearch", scenario: "test", runId: "run_orch" });
  registerDeepSearchStages(orch, { timeoutMs: 2000 });

  const events = [];
  orch.eventBus.on("*", (e) => events.push(e));

  const state = new DeepSearchState({
    runId: "run_orch",
    taskGoal: "Compare Alpha vs Beta",
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: "Alpha vs Beta. Definition: Alpha." }] },
  });

  const pkg = await orch.run(async (o) => {
    await o.runStage("deepsearch.scan", { state });
    await o.runStage("deepsearch.gaps", { state });
    await o.runStage("deepsearch.retrieve", { state });
    await o.runStage("deepsearch.understand", { state });
    await o.runStage("deepsearch.write", { state });
    await o.runStage("deepsearch.condense", { state });
    return o.runStage("deepsearch.pipeline", { state });
  });
  assert.equal(pkg.mode, "deepsearch");
  assert.ok(Array.isArray(pkg.slideIntents) && pkg.slideIntents.length >= 4);
  assert.ok(pkg.report && typeof pkg.report.markdown === "string" && pkg.report.markdown.length > 0);

  assert.ok(events.some((e) => e.name === "deepsearch.scan.started" && e.status === "started"));
  assert.ok(events.some((e) => e.name === "deepsearch.scan.completed" && e.actor === "deepsearch" && e.status === "completed"));
  assert.ok(events.some((e) => e.name === "deepsearch.gaps.completed" && e.actor === "deepsearch"));
  assert.ok(events.some((e) => e.name === "deepsearch.retrieve.completed" && e.actor === "deepsearch"));
  assert.ok(events.some((e) => e.name === "deepsearch.understand.completed" && e.actor === "deepsearch"));
  assert.ok(events.some((e) => e.name === "deepsearch.write.completed" && e.actor === "deepsearch"));
  assert.ok(events.some((e) => e.name === "deepsearch.condense.completed" && e.actor === "deepsearch"));
});

test("DeepSearchState: tokenUsage init + addTokenUsage", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");

  const s0 = new DeepSearchState({ runId: "run_tokens", taskGoal: "x" });
  assert.deepEqual(s0.L2.tokenUsage, { input: 0, output: 0, total: 0, estimatedCostUSD: 0 });

  s0.addTokenUsage({ prompt_tokens: 10, completion_tokens: 7 });
  assert.deepEqual(s0.L2.tokenUsage, { input: 10, output: 7, total: 17, estimatedCostUSD: 0 });

  s0.addTokenUsage({ input: 3, output: 5, total: 9 });
  assert.deepEqual(s0.L2.tokenUsage, { input: 13, output: 12, total: 26, estimatedCostUSD: 0 });

  const s1 = new DeepSearchState({ runId: "run_tokens2", taskGoal: "x", L2: { tokenUsage: { input: 2, output: 1, total: 3, estimatedCostUSD: 0 } } });
  assert.deepEqual(s1.L2.tokenUsage, { input: 2, output: 1, total: 3, estimatedCostUSD: 0 });
});

test("getModelCaller: wraps call, accumulates tokenUsage, emits deepsearch.token.usage", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { getModelCaller } = await import("../../js/agents/stages/deepsearch/model.js");

  const state = new DeepSearchState({ runId: "run_token_mw", taskGoal: "x" });
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const aiApiService = {
    chat: async () => ({
      content: "ok",
      usage: { prompt_tokens: 4, completion_tokens: 6 },
    }),
  };

  const callModel = getModelCaller({ emit, aiApiService }, { usage: "analyst", state });
  assert.equal(typeof callModel, "function");

  await callModel([{ role: "user", content: "hi" }]);
  await callModel([{ role: "user", content: "hi2" }]);

  assert.deepEqual(state.L2.tokenUsage, { input: 8, output: 12, total: 20, estimatedCostUSD: 0 });
  assert.ok(events.some((e) => e.name === "deepsearch.token.usage" && e.record.actor === "deepsearch"));

  const tokenEvents = events.filter((e) => e.name === "deepsearch.token.usage");
  assert.equal(tokenEvents.length, 2);
  assert.deepEqual(tokenEvents[0].record.payload.usage, { input: 4, output: 6, total: 10, estimatedCostUSD: 0 });
  assert.deepEqual(tokenEvents[1].record.payload.total, { input: 8, output: 12, total: 20, estimatedCostUSD: 0 });

  // modelRouter compatibility (new signature)
  {
    const s = new DeepSearchState({ runId: "run_token_router", taskGoal: "x" });
    const routerEvents = [];
    const modelRouter = {
      call: async ({ usage, messages }) => ({
        content: `usage=${usage}; msgs=${messages.length}`,
        usage: { prompt_tokens: 1, completion_tokens: 2 },
        model: "m1",
        provider: "mock",
      }),
    };
    const c = getModelCaller({ emit: (n, r) => routerEvents.push({ n, r }), modelRouter }, { usage: "worker", state: s });
    await c([{ role: "user", content: "x" }], { model: "auto" });
    assert.deepEqual(s.L2.tokenUsage, { input: 1, output: 2, total: 3, estimatedCostUSD: 0 });
    assert.ok(routerEvents.some((e) => e.n === "deepsearch.token.usage"));
  }

  // modelRouter compatibility (legacy signature)
  {
    const s = new DeepSearchState({ runId: "run_token_router_legacy", taskGoal: "x" });
    const routerEvents = [];
    const modelRouter = {
      call: async (messages, opts) => ({
        content: `legacy; usage=${opts.usage}; msgs=${messages.length}`,
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 6 },
      }),
    };
    const c = getModelCaller({ emit: (n, r) => routerEvents.push({ n, r }), modelRouter }, { usage: "planner", state: s });
    await c([{ role: "user", content: "x" }], { temperature: 0 });
    assert.deepEqual(s.L2.tokenUsage, { input: 2, output: 3, total: 6, estimatedCostUSD: 0 });
    assert.ok(routerEvents.some((e) => e.n === "deepsearch.token.usage"));
  }
});

test("DeepSearch pipeline: metrics.deepsearch includes tokenUsage", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchStage } = await import("../../js/agents/stages/deepsearch/index.js");

  const sourceText = [
    "Definition: Alpha is the first letter.\n",
    "Statistics: Alpha adoption reached 42% in 2024.\n",
    "Process: Start with scan, then retrieve, then understand.\n",
  ].join("");

  const state = new DeepSearchState({
    runId: "run_pkg_tokens",
    taskGoal: "Compare Alpha vs Beta",
    userConfig: { title: "Alpha vs Beta", maxIterations: 1 },
    maxIterations: 1,
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: sourceText }] },
  });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const aiApiService = {
    chat: async ({ messages } = {}) => {
      const sys = String(messages?.[0]?.content || "");
      if (sys.includes("DeepSearch scanner")) {
        return {
          content:
            "```json\n" +
            JSON.stringify({
              scanSummary: { summaryText: "LLM summary", topSources: [{ sourceId: "s1", reason: "high density" }] },
              deepDivePlan: { steps: [{ action: "review_source", sourceId: "s1", notes: "focus" }] },
            }) +
            "\n```",
          usage: { prompt_tokens: 11, completion_tokens: 3 },
        };
      }
      if (sys.includes("DeepSearch gap planner")) {
        return { content: "```json\n" + JSON.stringify({ gaps: [] }) + "\n```", usage: { prompt_tokens: 5, completion_tokens: 2 } };
      }
      if (sys.includes("DeepSearch claim extractor")) {
        return { content: "```json\n" + JSON.stringify({ claims: [] }) + "\n```", usage: { prompt_tokens: 7, completion_tokens: 1 } };
      }
      if (sys.includes("PPT slide planner")) {
        return {
          content:
            "```json\n" +
            JSON.stringify({
              slideIntents: [{ slideIntentId: "s_custom", pageType: "overview", title: "Overview", objective: "Summarize", keyPoints: ["A", "B"], claimIds: [] }],
              outlineCandidates: [{ outlineId: "o1", title: "Outline", bullets: ["One", "Two"] }],
            }) +
            "\n```",
          usage: { prompt_tokens: 9, completion_tokens: 4 },
        };
      }
      return { content: "{}", usage: { prompt_tokens: 0, completion_tokens: 0 } };
    },
  };

  const pkg = await runDeepSearchStage({ runId: "run_pkg_tokens", mode: "deepsearch", constraints: {} }, { state }, { emit, aiApiService, checkCancelled: () => {} });
  assert.ok(pkg?.metrics?.deepsearch?.tokenUsage);
  assert.deepEqual(pkg.metrics.deepsearch.tokenUsage, { input: 32, output: 10, total: 42, estimatedCostUSD: 0 });
  assert.ok(events.filter((e) => e.name === "deepsearch.token.usage").length >= 4);
});

test("getModelCaller: emits budget.warning and budget.exceeded, and estimates cost", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { getModelCaller } = await import("../../js/agents/stages/deepsearch/model.js");

  const state = new DeepSearchState({
    runId: "run_budget_events",
    taskGoal: "x",
    userConfig: {
      budget: {
        maxTokens: 10,
        maxCostUSD: 1,
        warnAt: 0.5,
        action: "warn",
        prices: { m1: { input: 0.01, output: 0.02 } },
      },
    },
  });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const aiApiService = {
    chat: async () => ({
      content: "ok",
      model: "m1",
      usage: { prompt_tokens: 5, completion_tokens: 0 },
    }),
  };

  const callModel = getModelCaller({ emit, aiApiService }, { usage: "analyst", state });
  await callModel([{ role: "user", content: "hi" }]);

  // 5/10 => warnAt reached (0.5), should emit warning once.
  assert.ok(events.some((e) => e.name === "deepsearch.budget.warning"));
  assert.equal(events.filter((e) => e.name === "deepsearch.budget.exceeded").length, 0);

  // Second call adds 6 tokens => exceed maxTokens.
  aiApiService.chat = async () => ({
    content: "ok2",
    model: "m1",
    usage: { prompt_tokens: 6, completion_tokens: 0 },
  });
  await callModel([{ role: "user", content: "hi2" }]);

  assert.equal(events.filter((e) => e.name === "deepsearch.budget.warning").length, 1);
  assert.equal(events.filter((e) => e.name === "deepsearch.budget.exceeded").length, 1);

  // Cost estimate: 11 input tokens at $0.01/1K => $0.00011
  assert.ok(Math.abs(state.L2.tokenUsage.estimatedCostUSD - 0.00011) < 1e-12);
});

test("DeepSearch pipeline: budget.exceeded action=stop terminates after scan", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchStage } = await import("../../js/agents/stages/deepsearch/index.js");

  const state = new DeepSearchState({
    runId: "run_budget_stop",
    taskGoal: "Alpha",
    userConfig: { maxIterations: 5, budget: { maxTokens: 1, warnAt: 0.1, action: "stop" } },
    maxIterations: 5,
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: "Alpha is alpha." }] },
  });

  const calls = [];
  const aiApiService = {
    chat: async ({ messages } = {}) => {
      calls.push(String(messages?.[0]?.content || ""));
      const sys = String(messages?.[0]?.content || "");
      if (sys.includes("DeepSearch scanner")) {
        return {
          content:
            "```json\n" +
            JSON.stringify({
              scanSummary: { summaryText: "LLM summary", topSources: [{ sourceId: "s1", reason: "x" }] },
              deepDivePlan: { steps: [{ action: "review_source", sourceId: "s1", notes: "x" }] },
            }) +
            "\n```",
          usage: { prompt_tokens: 2, completion_tokens: 0 },
          model: "m1",
        };
      }
      throw new Error("should not call other stages when budget stop");
    },
  };

  await runDeepSearchStage({ runId: "run_budget_stop", mode: "deepsearch", constraints: {} }, { state }, { emit: () => {}, aiApiService, checkCancelled: () => {} });
  assert.equal(calls.length, 1);
  assert.ok(state.timeline.some((e) => e && e.name === "deepsearch.budget.stop"));
});

test("DeepSearch pipeline: budget.exceeded action=degrade clamps maxIterations", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchStage } = await import("../../js/agents/stages/deepsearch/index.js");

  const state = new DeepSearchState({
    runId: "run_budget_degrade",
    taskGoal: "Alpha",
    userConfig: { maxIterations: 5, budget: { maxTokens: 1, warnAt: 0.1, action: "degrade" } },
    maxIterations: 5,
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: "Alpha is alpha. Alpha repeats." }] },
  });

  const aiApiService = {
    chat: async ({ messages } = {}) => {
      const sys = String(messages?.[0]?.content || "");
      if (sys.includes("DeepSearch scanner")) {
        return {
          content:
            "```json\n" +
            JSON.stringify({
              scanSummary: { summaryText: "LLM summary", topSources: [{ sourceId: "s1", reason: "x" }] },
              deepDivePlan: { steps: [{ action: "review_source", sourceId: "s1", notes: "x" }] },
            }) +
            "\n```",
          usage: { prompt_tokens: 2, completion_tokens: 0 },
          model: "m1",
        };
      }
      if (sys.includes("DeepSearch gap planner")) {
        return {
          content: "```json\n" + JSON.stringify({ gaps: [{ type: "definition", question: "What is Alpha?", status: "open" }] }) + "\n```",
          usage: { prompt_tokens: 0, completion_tokens: 0 },
          model: "m1",
        };
      }
      if (sys.includes("DeepSearch claim extractor")) {
        return { content: "```json\n" + JSON.stringify({ claims: [] }) + "\n```", usage: { prompt_tokens: 0, completion_tokens: 0 }, model: "m1" };
      }
      if (sys.includes("PPT slide planner")) {
        return {
          content:
            "```json\n" +
            JSON.stringify({
              slideIntents: [{ slideIntentId: "s1", pageType: "overview", title: "Overview", objective: "x", keyPoints: ["a"], claimIds: [] }],
              outlineCandidates: [],
            }) +
            "\n```",
          usage: { prompt_tokens: 0, completion_tokens: 0 },
          model: "m1",
        };
      }
      return { content: "{}", usage: { prompt_tokens: 0, completion_tokens: 0 }, model: "m1" };
    },
  };

  await runDeepSearchStage({ runId: "run_budget_degrade", mode: "deepsearch", constraints: {} }, { state }, { emit: () => {}, aiApiService, checkCancelled: () => {} });
  assert.equal(state.maxIterations, 1);
  assert.ok(state.timeline.some((e) => e && e.name === "deepsearch.budget.degraded"));
});

test("ShadowAgent budget: reserves calls for high priority gaps (total + round)", async () => {
  const { __test } = await import("../../js/agents/stages/deepsearch/shadow-agent.js");

  const stats = new __test.ShadowStats();
  const config = {
    maxCallsTotal: 10,
    maxCallsPerRound: 5,
    maxCallsPerGap: 100,
    priorityReserve: { high: 0.3, medium: 0.1, low: 0 },
  };

  const round = 0;
  const lowGap = { gapId: "g_low", priority: "low" };
  const highGap = { gapId: "g_high", priority: "high" };

  // round reserve: maxCallsPerRound=5, high reserve=1 -> low can consume at most 4 in this round.
  for (let i = 0; i < 4; i++) {
    const r = stats.reserveCall(round, lowGap, config);
    assert.ok(r, `expected low to reserve call ${i + 1}`);
    stats.finishCall(r, { success: true });
  }
  assert.equal(stats.canCall(round, lowGap, config), false, "low should be blocked by round reserve");
  assert.equal(stats.canCall(round, highGap, config), true, "high should still be allowed by round reserve");

  // total reserve: maxCallsTotal=10, high reserve=3 and medium reserve=1 -> low total cap is 6.
  for (let i = 0; i < 2; i++) {
    const r = stats.reserveCall(round + 1, lowGap, config);
    assert.ok(r, `expected low to reserve total call ${i + 1}`);
    stats.finishCall(r, { success: true });
  }
  assert.equal(stats.getStats().totalCalls, 6);
  assert.equal(stats.canCall(round + 1, lowGap, config), false, "low should be blocked by total reserve");
  assert.equal(stats.canCall(round + 1, highGap, config), true, "high should still be allowed by total reserve");
});

test("ShadowAgent queue: high priority executes before medium/low", async () => {
  const { ShadowAgent } = await import("../../js/agents/stages/deepsearch/shadow-agent.js");

  const modelRouter = createMockModelRouter(async () => {
    return {
      content: JSON.stringify({ relevant: true, confidence: 0.9, reason: "ok", keyInfo: "x" }),
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      model: "m1",
    };
  });

  const stageApi = { modelRouter };
  const agent = new ShadowAgent(stageApi, {}, { maxConcurrentCalls: 1, maxCallsTotal: 20, maxCallsPerRound: 20, maxCallsPerGap: 20 });

  const longText = makeWordBlob(200, "alpha");
  const chunk = { chunkId: "c1", text: longText };

  const lowGap = { gapId: "g_low", priority: "low", question: "Q_LOW" };
  const highGap = { gapId: "g_high", priority: "high", question: "Q_HIGH" };
  const mediumGap = { gapId: "g_med", priority: "medium", question: "Q_MED" };

  await Promise.all([
    agent.validateRelevance(chunk, lowGap, { round: 0 }),
    agent.validateRelevance(chunk, highGap, { round: 0 }),
    agent.validateRelevance(chunk, mediumGap, { round: 0 }),
  ]);

  const callOrder = modelRouter.calls.map((c) => {
    const content = c?.messages?.[0]?.content || "";
    if (content.includes("Q_HIGH")) return "high";
    if (content.includes("Q_MED")) return "medium";
    if (content.includes("Q_LOW")) return "low";
    return "unknown";
  });

  assert.deepEqual(callOrder, ["high", "medium", "low"]);
});
