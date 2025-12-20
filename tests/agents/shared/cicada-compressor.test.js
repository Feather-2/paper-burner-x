const test = require("node:test");
const assert = require("node:assert/strict");

test("CicadaCompressor: generateSummary uses modelRouter.call", async () => {
  const { CicadaCompressor } = await import("../../../js/agents/shared/cicada-compressor.js");

  let captured = null;
  const modelRouter = {
    call: async (payload) => {
      captured = payload;
      return {
        content: JSON.stringify({
          primaryIntent: "Summarize stage output",
          technicalConcepts: ["Node", "LLM"],
          filesAndCode: [{ file: "src/app.js", action: "modified", summary: "Updated logic" }],
          errorsAndFixes: [],
          problemSolving: "Resolved issue",
          userMessages: ["Please proceed"],
          pendingTasks: ["Add tests"],
          currentWork: "Writing summary",
          nextSteps: ["Run tests"],
        }),
      };
    },
  };

  const compressor = new CicadaCompressor({ modelRouter });
  const summary = await compressor.generateSummary({ note: "Alpha beta" }, "analyze");

  assert.equal(captured.usage, "summarizer");
  assert.ok(captured.messages[0].content.includes("analyze"));
  assert.equal(summary.primaryIntent, "Summarize stage output");
  assert.deepEqual(summary.technicalConcepts, ["Node", "LLM"]);
  assert.equal(summary.filesAndCode[0].file, "src/app.js");
});

test("CicadaCompressor: generateSummary falls back on invalid JSON", async () => {
  const { CicadaCompressor } = await import("../../../js/agents/shared/cicada-compressor.js");

  const modelRouter = {
    chat: async () => ({ content: "not-json" }),
  };

  const compressor = new CicadaCompressor({ modelRouter });
  const summary = await compressor.generateSummary({ note: "Alpha alpha beta" }, "stage-x");

  assert.equal(summary.primaryIntent, "Summarize stage-x content");
  assert.ok(summary.technicalConcepts.includes("alpha"));
});

test("CicadaCompressor: extractKeyIndex output format", async () => {
  const { CicadaCompressor } = await import("../../../js/agents/shared/cicada-compressor.js");

  const compressor = new CicadaCompressor();
  const result = compressor.extractKeyIndex({
    id: "item_42",
    uuid: "ABCDEF12",
    key: 77,
    path: "/var/log/app.log",
    file: "src/index.js",
    note: "Alpha alpha beta gamma",
  });

  assert.ok(result.ids.includes("item_42"));
  assert.ok(result.ids.includes("77"));
  assert.ok(result.ids.includes("abcdef12"));
  assert.ok(result.paths.includes("/var/log/app.log"));
  assert.ok(result.paths.includes("src/index.js"));
  assert.ok(result.keywords.includes("alpha"));
});

test("CicadaCompressor: shouldAutoCompress threshold logic", async () => {
  const { CicadaCompressor } = await import("../../../js/agents/shared/cicada-compressor.js");

  const compressor = new CicadaCompressor();
  assert.equal(compressor.shouldAutoCompress(0.7, 0.7), true);
  assert.equal(compressor.shouldAutoCompress(0.69, 0.7), false);
  assert.equal(compressor.shouldAutoCompress("nope", 0.7), false);
  assert.equal(compressor.shouldAutoCompress(0.8, 0), false);
});

test("CicadaCompressor: getCompressionStrategy and safeStringify fallback", async () => {
  const { CicadaCompressor } = await import("../../../js/agents/shared/cicada-compressor.js");

  const compressor = new CicadaCompressor();
  assert.equal(compressor.getCompressionStrategy("conversation_history").priority, "conversation_history");
  assert.equal(compressor.getCompressionStrategy("structured_output").layer, "indexed");
  assert.equal(compressor.getCompressionStrategy("unknown").priority, "question_context");

  const circular = {};
  circular.self = circular;
  const index = compressor.extractKeyIndex(circular);
  assert.deepEqual(index.ids, []);
});

test("CicadaCompressor: compress full flow with archive + sharedContext", async () => {
  const { CicadaCompressor } = await import("../../../js/agents/shared/cicada-compressor.js");
  const { SharedContext } = await import("../../../js/agents/stages/deepsearch/shared-context.js");

  const events = [];
  const eventBus = {
    emit: (name, payload) => events.push({ name, payload }),
  };

  const archiveCalls = [];
  const archive = {
    store: async (stage, payload) => {
      archiveCalls.push({ stage, payload });
      return "arch_1";
    },
  };

  const modelRouter = {
    call: async (messages, opts) => {
      if (!Array.isArray(messages)) {
        throw new Error("expected array signature");
      }
      assert.equal(opts.usage, "summarizer");
      return {
        content: JSON.stringify({
          primaryIntent: "Compressed summary",
          technicalConcepts: ["compress"],
          filesAndCode: [],
          errorsAndFixes: [],
          problemSolving: "done",
          userMessages: [],
          pendingTasks: [],
          currentWork: "compressing",
          nextSteps: [],
        }),
      };
    },
  };

  const sharedContext = new SharedContext({ limits: { storeMax: 5 } });
  sharedContext.store("retrieve_1", { raw: "payload" });
  sharedContext.store("other_1", { keep: true });

  const compressor = new CicadaCompressor({ modelRouter, eventBus, archive });
  const result = await compressor.compress(
    "retrieve",
    { content: { alpha: "beta", path: "/tmp/test.txt" }, contentType: "tool_output" },
    { sharedContext }
  );

  assert.equal(result.archiveId, "arch_1");
  assert.equal(result.strategy.priority, "tool_output");
  assert.ok(result.compressionRatio > 0);
  assert.equal(sharedContext.has("retrieve_1"), false);
  assert.equal(sharedContext.has("other_1"), true);

  const storedSummary = JSON.parse(sharedContext.getSummary("retrieve"));
  assert.equal(storedSummary.primaryIntent, "Compressed summary");
  assert.deepEqual(sharedContext.getIndex("retrieve"), result.keyIndex);

  const lastSignal = sharedContext.getLatestSignal();
  assert.equal(lastSignal.type, "CICADA_SHED");
  assert.ok(events.find((evt) => evt.name === "CICADA_SHED"));
  assert.equal(archiveCalls.length, 1);
});

test("SharedContext: summaries, indexes, signals, and pruning", async () => {
  const { SharedContext, createSharedContext } = await import("../../../js/agents/stages/deepsearch/shared-context.js");

  const ctx = new SharedContext({
    runId: "ctx_test",
    limits: {
      storeMax: 2,
      signalsMax: 1,
      decisionsMax: 1,
      seenMax: 1,
      indexKeywordsMax: 10,
      indexIdsPerKeywordMax: 1,
    },
  });

  ctx.setSummary("stage1", "summary1");
  ctx.setSummary("", "ignored");
  assert.equal(ctx.getSummary("stage1"), "summary1");
  assert.deepEqual(ctx.getAllSummaries(), { stage1: "summary1" });
  assert.ok(ctx.buildSummaryText().includes("[stage1] summary1"));

  ctx.setIndex("stage0", "value");
  assert.equal(ctx.getIndex("stage0").value, "value");
  ctx.setIndex("stage1", new Map([
    ["keywords", ["Alpha", "Beta"]],
    ["ids", ["id1"]],
    ["paths", ["src/app.js"]],
  ]));
  assert.deepEqual(ctx.getIndex("stage1").keywords, ["Alpha", "Beta"]);
  assert.ok(ctx.search("alpha").includes("stage1"));
  assert.ok(ctx.searchAll(["alpha", "beta"]).includes("stage1"));
  assert.deepEqual(ctx.searchAll(["alpha", "missing"]), []);
  assert.deepEqual(ctx.searchAll([]), []);

  ctx.store("stage1_1", { a: 1 });
  ctx.store("stage1_2", { a: 2 });
  ctx.store("stage1_3", { a: 3 });
  assert.equal(ctx.has("stage1_1"), false);

  ctx.clearStore("stage1");
  assert.equal(ctx.getDetail("stage1_2"), null);

  ctx.store("misc_1", { ok: true });
  ctx.clearStore();
  assert.equal(ctx.getDetail("misc_1"), null);

  const commitId = ctx.commit("stage2", { full: { ok: true }, summary: "sum2", keywords: ["k1", "k2"] });
  assert.ok(commitId.startsWith("stage2_"));
  assert.equal(ctx.getSummary("stage2"), "sum2");
  assert.ok(ctx.search("k1").includes(commitId));

  const sig1 = ctx.signal("stage2", { type: "NOTICE", value: 1 });
  const sig2 = ctx.signal("PING", { stage: "stage3", value: 2 });
  assert.equal(sig2.type, "PING");
  assert.equal(ctx.getSignals().length, 1);
  assert.equal(ctx.getSignals("NOTICE").length, 0);
  assert.equal(ctx.getLatestSignal().id, sig2.id);

  ctx.clearSignals();
  assert.equal(ctx.getSignals().length, 0);
  const sig3 = ctx.signal("stage4", { type: "INFO", value: 3 });
  assert.equal(ctx.getSignals((s) => s.stage === "stage4").length, 1);
  assert.equal(ctx.getLatestSignal("INFO").id, sig3.id);

  ctx.recordDecision({ action: "pick", reason: "test" });
  ctx.recordDecision("override");
  assert.equal(ctx.getDecisions().length, 1);
  assert.equal(ctx.getDecisions((d) => d.action === "override").length, 1);

  assert.equal(ctx.checkAndMark("new").seen, false);
  assert.equal(ctx.hasSeen("hello"), false);
  ctx.markSeen("hello");
  assert.equal(ctx.hasSeen("hello"), true);
  assert.equal(ctx.checkAndMark("hello").seen, true);

  const stats = ctx.getStats();
  assert.equal(stats.runId, "ctx_test");

  const json = ctx.toJSON();
  assert.equal(json.runId, "ctx_test");
  assert.ok(Array.isArray(json.indexKeys));
  assert.ok(json.indexKeys.includes("alpha"));

  const created = createSharedContext({ runId: "ctx_created" });
  assert.equal(created.runId, "ctx_created");
});
