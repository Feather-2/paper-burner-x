const test = require("node:test");
const assert = require("node:assert/strict");

function makeEventBus() {
  const events = [];
  return {
    events,
    emit: (name, record) => events.push({ name, record }),
  };
}

function makeModelRouter(response) {
  return {
    call: async () => response,
  };
}

test("CicadaCompressor: tool output compression truncates verbose fields", async () => {
  const { CicadaCompressor, CompressionLayer } = await import("../../../js/agents/runtime/cicada-compressor.js");

  const compressor = new CicadaCompressor({
    maxTokens: 20,
    layers: [CompressionLayer.TOOL_OUTPUT],
  });

  const context = {
    toolOutputs: [
      {
        tool: "search",
        status: "ok",
        output: "a".repeat(300),
        debug: "b".repeat(200),
        items: [
          { id: 1, text: "x".repeat(50) },
          { id: 2, text: "y".repeat(50) },
          { id: 3, text: "z".repeat(50) },
        ],
      },
    ],
    messages: [{ role: "tool", content: "c".repeat(180) }],
  };

  const result = await compressor.compress(context, { maxToolOutputChars: 60, maxToolOutputItems: 2 });
  const output = result.context.toolOutputs[0];
  const toolMessage = result.context.messages[0];

  assert.ok(output.output.length <= 60);
  assert.ok(output.debug.length <= 60);
  assert.equal(output.items.length, 2);
  assert.ok(toolMessage.content.length <= 60);
  assert.ok(result.metadata.stats.toolOutput.originalSize > result.metadata.stats.toolOutput.compressedSize);
});

test("CicadaCompressor: session history compression merges and summarizes", async () => {
  const { CicadaCompressor, CompressionLayer } = await import("../../../js/agents/runtime/cicada-compressor.js");

  const compressor = new CicadaCompressor({
    layers: [CompressionLayer.SESSION_HISTORY],
  });

  const context = {
    messages: [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Thought: internal" },
      { role: "assistant", content: "Answer part 1" },
      { role: "assistant", content: "Answer part 2" },
      { role: "user", content: "Question 2" },
      { role: "assistant", content: "Answer 2" },
      { role: "user", content: "Question 3" },
      { role: "assistant", content: "Answer 3" },
    ],
  };

  const result = await compressor.compress(context, { keepLastTurns: 4, summaryLineChars: 40 });
  const messages = result.context.messages;

  assert.equal(messages.length, 4);
  assert.ok(messages[0].content.includes("Question 2"));
  assert.ok(result.context.sessionSummary.includes("user: Hi"));
  assert.ok(result.context.sessionSummary.includes("assistant: Answer part 1"));
  assert.equal(result.metadata.stats.sessionHistory.removedThinking, 1);
  assert.equal(result.metadata.stats.sessionHistory.mergedMessages, 1);
});

test("CicadaCompressor: LLM summary uses modelRouter output", async () => {
  const { CicadaCompressor, CompressionLayer } = await import("../../../js/agents/runtime/cicada-compressor.js");

  const modelRouter = makeModelRouter(
    JSON.stringify({
      summary: "done",
      keyPoints: ["kp1"],
      decisions: ["d1"],
      errors: ["e1"],
    })
  );

  const compressor = new CicadaCompressor({
    modelRouter,
    layers: [CompressionLayer.LLM_SUMMARY],
  });

  const result = await compressor.compress({ messages: [{ role: "user", content: "Go" }] });

  assert.equal(result.metadata.llmSummary.summary, "done");
  assert.deepEqual(result.metadata.llmSummary.keyPoints, ["kp1"]);
  assert.deepEqual(result.metadata.llmSummary.decisions, ["d1"]);
  assert.deepEqual(result.metadata.llmSummary.errors, ["e1"]);
});

test("CicadaCompressor: LLM fallback handles invalid JSON", async () => {
  const { CicadaCompressor } = await import("../../../js/agents/runtime/cicada-compressor.js");

  const modelRouter = makeModelRouter("not json");
  const compressor = new CicadaCompressor({ modelRouter });

  const summary = await compressor._compressWithLLM({ messages: [{ role: "user", content: "Decision: ship" }] });

  assert.ok(summary.summary.length > 0);
  assert.ok(summary.keyPoints.length > 0);
});

test("CicadaCompressor: archive and restore use in-memory fallback", async () => {
  const { CicadaCompressor } = await import("../../../js/agents/runtime/cicada-compressor.js");

  const compressor = new CicadaCompressor();
  const archiveId = await compressor.archive("stage_1", { ok: true });
  const restored = await compressor.restore("stage_1");

  assert.equal(archiveId, "stage_1");
  assert.deepEqual(restored, { ok: true });
});

test("CicadaCompressor: emits layer and shed events", async () => {
  const { CicadaCompressor } = await import("../../../js/agents/runtime/cicada-compressor.js");
  const { CicadaEvents } = await import("../../../js/agents/runtime/events.js");

  const bus = makeEventBus();
  const modelRouter = makeModelRouter(
    JSON.stringify({ summary: "ok", keyPoints: [], decisions: [] })
  );
  const compressor = new CicadaCompressor({ modelRouter, eventBus: bus });

  await compressor.compress({
    toolOutputs: [{ tool: "list", output: "a".repeat(80) }],
    messages: [{ role: "user", content: "Hello" }],
  });

  const layerEvents = bus.events.filter((evt) => evt.name === CicadaEvents.LAYER_COMPLETED);
  assert.equal(layerEvents.length, 3);
  assert.ok(bus.events.some((evt) => evt.name === CicadaEvents.SHED_COMPLETED));
});

test("CicadaCompressor: skips LLM layer without modelRouter", async () => {
  const { CicadaCompressor, CompressionLayer } = await import("../../../js/agents/runtime/cicada-compressor.js");

  const compressor = new CicadaCompressor({
    layers: [CompressionLayer.LLM_SUMMARY],
  });

  const result = await compressor.compress({ messages: [] });

  assert.equal(result.metadata.layersApplied.length, 0);
  assert.equal(result.metadata.llmSummary, null);
});
