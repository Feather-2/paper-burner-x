const test = require("node:test");
const assert = require("node:assert/strict");

function makeBlock(token, len = 200) {
  const head = `${token} `;
  if (head.length >= len) return head.slice(0, len);
  return head + "x".repeat(len - head.length);
}

test("deduplicateChunks: filters by chunkId and text prefix", async () => {
  const { deduplicateChunks } = await import("../../../js/agents/stages/deepsearch/retrieve.js");

  const existing = [
    { chunkId: "c1", text: "hello world" },
    { chunkId: "c2", text: "same prefix " + "a".repeat(400) },
  ];
  const newChunks = [
    { chunkId: "c1", text: "different text" }, // duplicate by id
    { chunkId: "c3", text: existing[1].text }, // duplicate by text prefix
    { chunkId: "c4", text: "unique text" },
  ];

  const out = deduplicateChunks(newChunks, existing);
  assert.deepEqual(
    out.map((c) => c.chunkId),
    ["c4"]
  );
});

test("DeepSearch retrieve: dedupes against state.L2 + emits deepsearch.retrieve.deduped", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchRetrieveStage } = await import("../../../js/agents/stages/deepsearch/retrieve.js");

  const text = makeBlock("TOKEN_A") + makeBlock("FILLER_B") + makeBlock("FILLER_C");

  const state = new DeepSearchState({
    runId: "run_dedup_evt",
    taskGoal: "Find TOKEN_A",
    userConfig: { retrieval: { chunkSize: 200, overlap: 0, topK: 1, windowSize: 0, useBm25: false, useGrep: true, maxChunks: 100 } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: text }] },
    L1: { gaps: [{ gapId: "gap_1", status: "open", question: "Find TOKEN_A", queryHints: ["TOKEN_A"] }] },
  });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const first = await runDeepSearchRetrieveStage({ runId: state.runId }, { state }, { emit });
  assert.ok(first.retrievedChunks.length >= 1);
  assert.equal(state.L2.retrievedChunks.length, first.retrievedChunks.length);

  const dedupEvents1 = events.filter((e) => e.name === "deepsearch.retrieve.deduped");
  assert.equal(dedupEvents1.length, 1);
  assert.equal(dedupEvents1[0].record.payload.before, first.retrievedChunks.length);
  assert.equal(dedupEvents1[0].record.payload.after, first.retrievedChunks.length);
  assert.equal(dedupEvents1[0].record.payload.dropped, 0);

  const second = await runDeepSearchRetrieveStage({ runId: state.runId }, { state }, { emit });
  assert.ok(second.retrievedChunks.length >= 1);
  assert.equal(state.L2.retrievedChunks.length, first.retrievedChunks.length);

  const dedupEvents2 = events.filter((e) => e.name === "deepsearch.retrieve.deduped");
  assert.equal(dedupEvents2.length, 2);
  assert.equal(dedupEvents2[1].record.payload.before, second.retrievedChunks.length);
  assert.equal(dedupEvents2[1].record.payload.after, 0);
  assert.equal(dedupEvents2[1].record.payload.dropped, dedupEvents2[1].record.payload.before);
});

test("DeepSearch retrieve: LRU trims oldest when exceeding maxChunks", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchRetrieveStage } = await import("../../../js/agents/stages/deepsearch/retrieve.js");

  const text = [1, 2, 3, 4, 5].map((n) => makeBlock(`TOKEN_${n}`)).join("");

  const state = new DeepSearchState({
    runId: "run_lru",
    taskGoal: "Retrieve multiple tokens",
    userConfig: { retrieval: { chunkSize: 200, overlap: 0, topK: 1, windowSize: 0, useBm25: false, useGrep: true, maxChunks: 3 } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: text }] },
    L1: { gaps: [] },
  });

  const emit = () => {};
  for (let i = 1; i <= 5; i++) {
    state.L1.gaps.push({ gapId: `gap_${i}`, status: "open", question: `Find TOKEN_${i}`, queryHints: [`TOKEN_${i}`] });
    for (const g of state.L1.gaps) g.status = g.gapId === `gap_${i}` ? "open" : "filled";
    await runDeepSearchRetrieveStage({ runId: state.runId }, { state }, { emit });
    assert.ok(state.L2.retrievedChunks.length <= 3);
  }

  const chunkIds = state.L2.retrievedChunks.map((c) => c.chunkId);
  assert.deepEqual(chunkIds, ["s1::chunk_3", "s1::chunk_4", "s1::chunk_5"]);
});

test("applyChunkLru: prefers evicting consumed chunks first", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/retrieve.js");

  const chunks = [
    { chunkId: "a" },
    { chunkId: "b", consumed: true },
    { chunkId: "c", consumed: true },
    { chunkId: "d" },
  ];

  const out = __test.applyChunkLru(chunks, { maxChunks: 2 });
  assert.deepEqual(
    out.map((c) => c.chunkId),
    ["a", "d"]
  );
});

test("DeepSearch condense: marks consumed + keeps only evidenceLedger referenced chunks", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchCondenseStage } = await import("../../../js/agents/stages/deepsearch/condense.js");

  const state = new DeepSearchState({
    runId: "run_condense_cleanup",
    taskGoal: "Cleanup",
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: "alpha beta gamma delta" }] },
    L1: {
      claims: [{ claimId: "c1", text: "Alpha", evidenceIds: ["e1"] }],
      evidenceLedger: [{ evidenceId: "e1", chunkId: "s1::chunk_2", sourceId: "s1", locator: { charStart: 10, charEnd: 20 }, quote: "beta", gapIds: ["g1"] }],
    },
    L2: {
      retrievedChunks: [
        { retrievedId: "rch_1", chunkId: "s1::chunk_1", sourceId: "s1", locator: { charStart: 0, charEnd: 10 }, text: "alpha", consumed: false },
        { retrievedId: "rch_2", chunkId: "s1::chunk_2", sourceId: "s1", locator: { charStart: 10, charEnd: 20 }, text: "beta", consumed: false },
        { retrievedId: "rch_3", chunkId: "s1::chunk_3", sourceId: "s1", locator: { charStart: 20, charEnd: 30 }, text: "gamma", consumed: true, consumedAt: "2020-01-01T00:00:00.000Z" },
      ],
      logs: ["x"],
      scratchpad: { y: 1 },
    },
  });

  const out = await runDeepSearchCondenseStage({ runId: state.runId }, { state }, {});
  assert.ok(out.condensedMemory && typeof out.condensedMemory.summary === "string");

  assert.equal(state.L2.retrievedChunks.length, 1);
  assert.equal(state.L2.retrievedChunks[0].chunkId, "s1::chunk_2");
  assert.equal(state.L2.retrievedChunks[0].consumed, true);
  assert.ok(typeof state.L2.retrievedChunks[0].consumedAt === "string" && state.L2.retrievedChunks[0].consumedAt.length > 0);
});
