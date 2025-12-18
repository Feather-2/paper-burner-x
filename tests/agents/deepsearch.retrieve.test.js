const test = require("node:test");
const assert = require("node:assert/strict");

function makeChunks() {
  return [
    { chunkId: "c1", text: "chunk 1", score: 1 },
    { chunkId: "c2", text: "chunk 2", score: 10 },
    { chunkId: "c3", text: "chunk 3", score: 5 },
    { chunkId: "c4", text: "chunk 4", score: 2 },
  ];
}

function stageApiWithModelRouterCall(call) {
  return {
    modelRouter: {
      call: function (messages, opts) {
        return call(messages, opts);
      },
    },
  };
}

test("rerankWithLLM: normal completion uses LLM order and fills with BM25", async () => {
  const { __test } = await import("../../js/agents/stages/deepsearch/retrieve.js");

  let sawSignal = false;
  const stageApi = stageApiWithModelRouterCall(async (_messages, opts = {}) => {
    assert.ok(opts?.signal, "expected opts.signal");
    assert.equal(opts.signal.aborted, false);
    sawSignal = true;
    return {
      content: JSON.stringify({
        ranked: [
          { id: "c3", score: 9, reason: "best" },
          { id: "c1", score: 2, reason: "too low" },
          { id: "c2", score: 8, reason: "good" },
        ],
      }),
    };
  });

  const events = [];
  const emit = (...args) => events.push(args);

  const { ranked, stats } = await __test.rerankWithLLM(makeChunks(), "q", { stageApi, emit, topK: 3, timeoutMs: 200 });

  assert.equal(sawSignal, true);
  assert.deepEqual(
    ranked.map((c) => c.chunkId),
    ["c3", "c2", "c4"]
  );
  assert.equal(ranked[0].rerankScore, 9);
  assert.equal(ranked[1].rerankScore, 8);
  assert.equal("rerankScore" in ranked[2], false);
  assert.equal(stats.skipped, false);
  assert.equal(stats.llmRankedCount, 3);
  assert.equal(stats.filteredCount, 1);
  assert.ok(events.some(([name]) => name === "deepsearch.rerank.completed"));
});

test("rerankWithLLM: parse failure falls back to BM25 ordering", async () => {
  const { __test } = await import("../../js/agents/stages/deepsearch/retrieve.js");

  const stageApi = stageApiWithModelRouterCall(async () => ({ content: "not json" }));
  const { ranked, stats } = await __test.rerankWithLLM(makeChunks(), "q", { stageApi, topK: 3, timeoutMs: 200 });

  assert.deepEqual(
    ranked.map((c) => c.chunkId),
    ["c2", "c3", "c4"]
  );
  assert.equal(stats.skipped, true);
  assert.equal(stats.reason, "parse_failed");
});

test("rerankWithLLM: timeout aborts via signal and falls back", async () => {
  const { __test } = await import("../../js/agents/stages/deepsearch/retrieve.js");

  let abortSeen = false;
  const stageApi = stageApiWithModelRouterCall((_messages, opts = {}) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ content: '{"ranked":[]}' }), 1000);
      opts.signal.addEventListener(
        "abort",
        () => {
          abortSeen = true;
          clearTimeout(timer);
          reject(opts.signal.reason);
        },
        { once: true }
      );
    });
  });

  const started = Date.now();
  const { ranked, stats } = await __test.rerankWithLLM(makeChunks(), "q", { stageApi, topK: 3, timeoutMs: 20 });
  const elapsedMs = Date.now() - started;

  assert.equal(abortSeen, true);
  assert.ok(elapsedMs < 500, `expected to finish quickly, got ${elapsedMs}ms`);
  assert.deepEqual(
    ranked.map((c) => c.chunkId),
    ["c2", "c3", "c4"]
  );
  assert.equal(stats.skipped, true);
  assert.equal(stats.reason, "Rerank LLM timeout");
});

test("rerankWithLLM: external cancellation aborts via forwarded signal and falls back", async () => {
  const { __test } = await import("../../js/agents/stages/deepsearch/retrieve.js");

  const outer = new AbortController();
  const stageApi = stageApiWithModelRouterCall((_messages, opts = {}) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ content: '{"ranked":[]}' }), 1000);
      opts.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(opts.signal.reason);
        },
        { once: true }
      );
    });
  });

  setTimeout(() => outer.abort(new Error("User cancelled")), 20);
  const { ranked, stats } = await __test.rerankWithLLM(makeChunks(), "q", {
    stageApi,
    topK: 3,
    timeoutMs: 5000,
    signal: outer.signal,
  });

  assert.deepEqual(
    ranked.map((c) => c.chunkId),
    ["c2", "c3", "c4"]
  );
  assert.equal(stats.skipped, true);
  assert.equal(stats.reason, "User cancelled");
});
