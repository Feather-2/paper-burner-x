import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import {
  CicadaCompressor,
  CompressionLayer,
} from "../../../js/agents/runtime/compression/cicada-compressor.js";

describe("CicadaCompressor", () => {
  describe("CompressionLayer constants", () => {
    it("exposes frozen layer constants", () => {
      assert.strictEqual(CompressionLayer.TOOL_OUTPUT, "tool_output");
      assert.strictEqual(CompressionLayer.SESSION_HISTORY, "session_history");
      assert.strictEqual(CompressionLayer.LLM_SUMMARY, "llm_summary");
      assert.ok(Object.isFrozen(CompressionLayer));
    });
  });

  describe("constructor", () => {
    it("uses default values when no options provided", () => {
      const compressor = new CicadaCompressor();
      assert.strictEqual(compressor.maxTokens, 2000);
      assert.deepStrictEqual(compressor.layers, [
        "tool_output",
        "session_history",
        "llm_summary",
      ]);
      assert.strictEqual(compressor.modelRouter, null);
      assert.strictEqual(compressor.archiveAdapter, null);
    });

    it("accepts custom maxTokens", () => {
      const compressor = new CicadaCompressor({ maxTokens: 5000 });
      assert.strictEqual(compressor.maxTokens, 5000);
    });

    it("normalizes layers to valid ones only", () => {
      const compressor = new CicadaCompressor({
        layers: ["invalid", "tool_output", "unknown"],
      });
      assert.deepStrictEqual(compressor.layers, ["tool_output"]);
    });

    it("handles maxArchives as Infinity", () => {
      const compressor = new CicadaCompressor({ maxArchives: Infinity });
      assert.strictEqual(compressor._maxArchives, Infinity);
    });

    it("handles archiveRetentionDays as null", () => {
      const compressor = new CicadaCompressor({ archiveRetentionDays: null });
      assert.strictEqual(compressor._archiveRetentionDays, null);
    });
  });

  describe("TOOL_OUTPUT layer", () => {
    it("compresses toolOutputs array", async () => {
      const compressor = new CicadaCompressor({ layers: ["tool_output"] });
      const longOutput = "x".repeat(10000);
      const input = {
        toolOutputs: [{ result: longOutput, status: "ok" }],
      };

      const { context, metadata } = await compressor.compress(input);

      assert.ok(context.toolOutputs);
      assert.strictEqual(context.toolOutputs.length, 1);
      // status is an important key, should be preserved
      assert.strictEqual(context.toolOutputs[0].status, "ok");
      // result is truncated
      assert.ok(context.toolOutputs[0].result.length < longOutput.length);
      assert.ok(metadata.stats.toolOutput.truncatedFields > 0);
    });

    it("compresses tool role messages in messages array", async () => {
      const compressor = new CicadaCompressor({ layers: ["tool_output"] });
      // Use content longer than default maxChars (maxTokens * 4 = 8000)
      const longContent = "a".repeat(10000);
      const input = {
        messages: [
          { role: "user", content: "hello" },
          { role: "tool", content: longContent },
        ],
      };

      const { context, metadata } = await compressor.compress(input);

      assert.strictEqual(context.messages.length, 2);
      assert.strictEqual(context.messages[0].content, "hello");
      assert.ok(context.messages[1].content.length < longContent.length);
      assert.ok(metadata.layersApplied.includes("tool_output"));
    });

    it("handles tool_outputs key variant", async () => {
      const compressor = new CicadaCompressor({ layers: ["tool_output"] });
      const input = {
        tool_outputs: [{ data: "short" }],
      };

      const { context } = await compressor.compress(input);
      assert.ok(context.tool_outputs);
      assert.strictEqual(context.tool_outputs.length, 1);
    });

    it("respects maxToolOutputChars option", async () => {
      const compressor = new CicadaCompressor({ layers: ["tool_output"] });
      const input = {
        toolOutputs: [{ output: "x".repeat(500) }],
      };

      const { context } = await compressor.compress(input, {
        maxToolOutputChars: 100,
      });

      assert.ok(context.toolOutputs[0].output.length <= 103); // 100 + "..."
    });

    it("trims arrays in VERBOSE_KEYS exceeding maxToolOutputItems", async () => {
      const compressor = new CicadaCompressor({ layers: ["tool_output"] });
      // Use 'data' which is a VERBOSE_KEY so it won't be removed
      const input = {
        toolOutputs: [{ data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }],
      };

      const { context, metadata } = await compressor.compress(input, {
        maxToolOutputItems: 3,
      });

      assert.strictEqual(context.toolOutputs[0].data.length, 3);
      assert.ok(metadata.stats.toolOutput.trimmedArrays > 0);
    });
  });

  describe("SESSION_HISTORY layer", () => {
    it("merges only merge-safe messages and preserves metadata-bearing messages", async () => {
      const compressor = new CicadaCompressor({ layers: ["session_history"] });

      const input = {
        messages: [
          { role: "assistant", content: "a" },
          { role: "assistant", content: "b" },
          { role: "assistant", content: "c", id: "m3" },
          { role: "assistant", content: "d", id: "m4" },
        ],
      };

      const { context, metadata } = await compressor.compress(input, {
        layers: ["session_history"],
        keepLastTurns: 10,
      });

      assert.ok(context);
      assert.ok(Array.isArray(context.messages));
      assert.strictEqual(context.messages.length, 3);
      assert.strictEqual(context.messages[0].content, "a\nb");
      assert.strictEqual(context.messages[1].id, "m3");
      assert.strictEqual(context.messages[2].id, "m4");
      assert.strictEqual(metadata?.stats?.sessionHistory?.mergedMessages, 1);
    });

    it("removes thinking messages by default", async () => {
      const compressor = new CicadaCompressor({ layers: ["session_history"] });
      const input = {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "<think>internal thoughts</think>", thinking: true },
          { role: "assistant", content: "response" },
        ],
      };

      const { context, metadata } = await compressor.compress(input, {
        keepLastTurns: 10,
      });

      assert.strictEqual(context.messages.length, 2);
      assert.strictEqual(metadata.stats.sessionHistory.removedThinking, 1);
    });

    it("summarizes thinking messages when summarizeThinking is true", async () => {
      const compressor = new CicadaCompressor({ layers: ["session_history"] });
      const input = {
        messages: [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: "decide to use approach A\nwill implement it\nthinking more",
            thinking: true,
          },
          { role: "assistant", content: "response" },
        ],
      };

      const { context, metadata } = await compressor.compress(input, {
        keepLastTurns: 10,
        summarizeThinking: true,
      });

      assert.strictEqual(context.messages.length, 3);
      assert.ok(context.messages[1].content.startsWith("["));
      assert.strictEqual(context.messages[1]._thinkingSummarized, true);
      assert.strictEqual(metadata.stats.sessionHistory.summarizedThinking, 1);
      assert.strictEqual(metadata.stats.sessionHistory.removedThinking, 0);
    });

    it("keeps last N turns based on keepLastTurns", async () => {
      const compressor = new CicadaCompressor({ layers: ["session_history"] });
      const input = {
        messages: [
          { role: "user", content: "msg1" },
          { role: "assistant", content: "msg2" },
          { role: "user", content: "msg3" },
          { role: "assistant", content: "msg4" },
          { role: "user", content: "msg5" },
          { role: "assistant", content: "msg6" },
        ],
      };

      const { context, metadata } = await compressor.compress(input, {
        keepLastTurns: 2,
      });

      assert.strictEqual(context.messages.length, 2);
      assert.strictEqual(metadata.stats.sessionHistory.keptMessages, 2);
      assert.strictEqual(metadata.stats.sessionHistory.summarizedMessages, 4);
      assert.ok(context.sessionSummary);
    });

    it("preserves system messages as anchors", async () => {
      const compressor = new CicadaCompressor({ layers: ["session_history"] });
      const input = {
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "msg1" },
          { role: "assistant", content: "msg2" },
          { role: "user", content: "msg3" },
          { role: "assistant", content: "msg4" },
        ],
      };

      const { context } = await compressor.compress(input, {
        keepLastTurns: 2,
      });

      // System message should always be kept
      assert.strictEqual(context.messages[0].role, "system");
      assert.strictEqual(
        context.messages[0].content,
        "You are a helpful assistant."
      );
    });

    it("adjusts start for tool call/result pairs", async () => {
      const compressor = new CicadaCompressor({ layers: ["session_history"] });
      const input = {
        messages: [
          { role: "user", content: "old message" },
          { role: "assistant", content: "call", tool_calls: [{ id: "tc1" }] },
          { role: "tool", content: "result", tool_call_id: "tc1" },
          { role: "assistant", content: "final" },
        ],
      };

      const { context } = await compressor.compress(input, {
        keepLastTurns: 2,
      });

      // Should keep tool call with its result
      const hasToolCall = context.messages.some((m) => m.tool_calls);
      const hasToolResult = context.messages.some((m) => m.role === "tool");
      if (hasToolResult) {
        assert.ok(hasToolCall, "Tool result should have matching tool call");
      }
    });

    it("removes orphaned tool messages", async () => {
      const compressor = new CicadaCompressor({ layers: ["session_history"] });
      const input = {
        messages: [
          { role: "tool", content: "orphan", tool_call_id: "missing" },
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi" },
        ],
      };

      const { context } = await compressor.compress(input, {
        keepLastTurns: 10,
      });

      // Orphaned tool message at start should be removed
      assert.ok(
        !context.messages.some(
          (m) => m.role === "tool" && m.tool_call_id === "missing"
        )
      );
    });

    it("uses titleOnly mode when enabled", async () => {
      const compressor = new CicadaCompressor({ layers: ["session_history"] });
      const input = {
        messages: [
          { role: "user", content: "a very long message " + "x".repeat(200) },
          { role: "assistant", content: "response" },
          { role: "user", content: "kept" },
          { role: "assistant", content: "also kept" },
        ],
      };

      const { context } = await compressor.compress(input, {
        keepLastTurns: 2,
        titleOnly: true,
        titleMaxChars: 50,
      });

      // Summary should exist and be truncated
      assert.ok(context.sessionSummary);
      const lines = context.sessionSummary.split("\n");
      assert.ok(lines.every((l) => l.length <= 60)); // role: + title
    });
  });

  describe("LLM_SUMMARY layer", () => {
    it("skips LLM summary when no modelRouter", async () => {
      const compressor = new CicadaCompressor({
        layers: ["llm_summary"],
        modelRouter: null,
      });
      const input = { messages: [{ role: "user", content: "test" }] };

      const { metadata } = await compressor.compress(input);

      assert.ok(!metadata.layersApplied.includes("llm_summary"));
      assert.strictEqual(metadata.llmSummary, null);
    });

    it("generates LLM summary with modelRouter.call", async () => {
      const mockRouter = {
        call: mock.fn(async () => ({
          content: JSON.stringify({
            summary: "Test summary",
            keyPoints: ["point1"],
            decisions: ["decision1"],
            errors: [],
          }),
        })),
      };

      const compressor = new CicadaCompressor({
        layers: ["llm_summary"],
        modelRouter: mockRouter,
      });

      const input = { data: "some context" };
      const { context, metadata } = await compressor.compress(input);

      assert.ok(metadata.layersApplied.includes("llm_summary"));
      assert.strictEqual(metadata.llmSummary.summary, "Test summary");
      assert.deepStrictEqual(metadata.llmSummary.keyPoints, ["point1"]);
      assert.ok(context.llmSummary);
      assert.strictEqual(mockRouter.call.mock.callCount(), 1);
    });

    it("falls back to text summary when LLM returns invalid JSON", async () => {
      const mockRouter = {
        call: mock.fn(async () => "not valid json"),
      };

      const compressor = new CicadaCompressor({
        layers: ["llm_summary"],
        modelRouter: mockRouter,
      });

      const input = { data: "some context with error mentions" };
      const { metadata } = await compressor.compress(input);

      assert.ok(metadata.llmSummary);
      assert.ok(typeof metadata.llmSummary.summary === "string");
    });

    it("handles modelRouter.chat fallback", async () => {
      const mockRouter = {
        chat: mock.fn(async () => ({
          text: JSON.stringify({
            summary: "Chat summary",
            keyPoints: [],
            decisions: [],
            errors: [],
          }),
        })),
      };

      const compressor = new CicadaCompressor({
        layers: ["llm_summary"],
        modelRouter: mockRouter,
      });

      const { metadata } = await compressor.compress({ data: "test" });

      assert.strictEqual(metadata.llmSummary.summary, "Chat summary");
      assert.strictEqual(mockRouter.chat.mock.callCount(), 1);
    });

    it("handles LLM call failure gracefully", async () => {
      const mockRouter = {
        call: mock.fn(async () => {
          throw new Error("API error");
        }),
      };

      const compressor = new CicadaCompressor({
        layers: ["llm_summary"],
        modelRouter: mockRouter,
      });

      const { metadata } = await compressor.compress({ data: "test" });

      // Should still produce a fallback summary
      assert.ok(metadata.llmSummary);
      assert.ok(typeof metadata.llmSummary.summary === "string");
    });
  });

  describe("archive and restore", () => {
    it("stores and retrieves from internal store", async () => {
      const compressor = new CicadaCompressor();
      const archiveId = await compressor.archive("test-key", { data: "value" });

      assert.strictEqual(archiveId, "test-key");

      const restored = await compressor.restore("test-key");
      assert.ok(restored);
      assert.strictEqual(restored.data, "value");
      assert.ok(restored.timestamp);
      assert.strictEqual(restored.schemaVersion, "1.0");
    });

    it("generates archiveId when stageKey is empty", async () => {
      const compressor = new CicadaCompressor();
      const archiveId = await compressor.archive("", { data: "test" });

      assert.ok(archiveId);
      assert.ok(archiveId.startsWith("archive_"));
    });

    it("uses external adapter.store when available", async () => {
      const storedData = new Map();
      const adapter = {
        store: mock.fn(async (key, data) => {
          storedData.set(key, data);
          return `stored-${key}`;
        }),
        load: mock.fn(async (key) => storedData.get(key)),
      };

      const compressor = new CicadaCompressor({ archive: adapter });
      const archiveId = await compressor.archive("ext-key", { data: "ext" });

      assert.strictEqual(archiveId, "stored-ext-key");
      assert.strictEqual(adapter.store.mock.callCount(), 1);

      const restored = await compressor.restore("ext-key");
      assert.ok(restored);
      assert.strictEqual(restored.data, "ext");
    });

    it("uses adapter.set when store is unavailable", async () => {
      const storedData = new Map();
      const adapter = {
        set: mock.fn((key, data) => storedData.set(key, data)),
        get: mock.fn((key) => storedData.get(key)),
      };

      const compressor = new CicadaCompressor({ archive: adapter });
      await compressor.archive("set-key", { data: "set-test" });

      assert.strictEqual(adapter.set.mock.callCount(), 1);

      const restored = await compressor.restore("set-key");
      assert.ok(restored);
    });

    it("returns null when restoring non-existent key", async () => {
      const compressor = new CicadaCompressor();
      const restored = await compressor.restore("non-existent");
      assert.strictEqual(restored, null);
    });

    it("prunes archives when exceeding maxArchives", async () => {
      const compressor = new CicadaCompressor({ maxArchives: 3 });

      await compressor.archive("k1", { timestamp: 1000 });
      await compressor.archive("k2", { timestamp: 2000 });
      await compressor.archive("k3", { timestamp: 3000 });
      await compressor.archive("k4", { timestamp: 4000 });

      // k1 should be pruned (oldest)
      assert.strictEqual(compressor._archiveStore.size, 3);
      assert.ok(!compressor._archiveStore.has("k1"));
      assert.ok(compressor._archiveStore.has("k4"));
    });

    it("prunes archives by retention days on subsequent archive calls", async () => {
      const compressor = new CicadaCompressor({
        archiveRetentionDays: 1,
        maxArchives: Infinity,
      });
      const now = Date.now();
      const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;

      // Archive old entry first - it gets immediately pruned due to retention policy
      await compressor.archive("old", { timestamp: twoDaysAgo });
      // Old entry is pruned immediately because it's older than retention cutoff
      assert.ok(!compressor._archiveStore.has("old"));

      // Archive new entry
      await compressor.archive("new", { timestamp: now });

      // New entry should be kept
      assert.ok(compressor._archiveStore.has("new"));
      assert.strictEqual(compressor._archiveStore.size, 1);
    });
  });

  describe("listArchives", () => {
    it("lists archives sorted by timestamp descending", async () => {
      const compressor = new CicadaCompressor();

      await compressor.archive("old", { timestamp: 1000, summary: "old one" });
      await compressor.archive("mid", { timestamp: 2000, summary: "mid one" });
      await compressor.archive("new", { timestamp: 3000, summary: "new one" });

      const list = await compressor.listArchives({ limit: 10 });

      assert.strictEqual(list.length, 3);
      assert.strictEqual(list[0].id, "new");
      assert.strictEqual(list[1].id, "mid");
      assert.strictEqual(list[2].id, "old");
    });

    it("respects limit parameter", async () => {
      const compressor = new CicadaCompressor();

      await compressor.archive("k1", { timestamp: 1000 });
      await compressor.archive("k2", { timestamp: 2000 });
      await compressor.archive("k3", { timestamp: 3000 });

      const list = await compressor.listArchives({ limit: 2 });
      assert.strictEqual(list.length, 2);
    });

    it("filters by pattern", async () => {
      const compressor = new CicadaCompressor();

      await compressor.archive("search-1", {
        timestamp: 1000,
        summary: "found it",
      });
      await compressor.archive("search-2", {
        timestamp: 2000,
        summary: "nothing here",
      });

      const list = await compressor.listArchives({ pattern: "found" });
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].id, "search-1");
    });

    it("matches pattern against id as well", async () => {
      const compressor = new CicadaCompressor();

      await compressor.archive("special-key", { timestamp: 1000, summary: "" });
      await compressor.archive("other-key", { timestamp: 2000, summary: "" });

      const list = await compressor.listArchives({ pattern: "special" });
      assert.strictEqual(list.length, 1);
    });
  });

  describe("compress with archiveKey", () => {
    it("archives context when archiveKey is provided", async () => {
      const compressor = new CicadaCompressor({ layers: [] });

      const { metadata } = await compressor.compress(
        { data: "test" },
        { archiveKey: "my-archive" }
      );

      assert.strictEqual(metadata.archiveId, "my-archive");

      const restored = await compressor.restore("my-archive");
      assert.ok(restored);
      assert.strictEqual(restored.context.data, "test");
    });

    it("uses stageKey from context if archiveKey not provided", async () => {
      const compressor = new CicadaCompressor({ layers: [] });

      const { metadata } = await compressor.compress({
        data: "test",
        stageKey: "stage-key",
      });

      assert.strictEqual(metadata.archiveId, "stage-key");
    });
  });

  describe("event emission", () => {
    it("emits layer completed events", async () => {
      const events = [];
      const eventBus = {
        emit: mock.fn((name, payload) => events.push({ name, payload })),
      };

      const compressor = new CicadaCompressor({
        layers: ["tool_output", "session_history"],
        eventBus,
      });

      await compressor.compress({
        messages: [{ role: "user", content: "hi" }],
      });

      assert.ok(
        events.some((e) => e.name === "cicada.layer.completed"),
        "Should emit layer completed"
      );
      assert.ok(
        events.some((e) => e.name === "cicada.shed.completed"),
        "Should emit shed completed"
      );
    });

    it("includes stats in layer event payload", async () => {
      const events = [];
      const eventBus = {
        emit: (name, payload) => events.push({ name, payload }),
      };

      const compressor = new CicadaCompressor({
        layers: ["session_history"],
        eventBus,
      });

      await compressor.compress({
        messages: [{ role: "user", content: "test" }],
      });

      const layerEvent = events.find(
        (e) => e.name === "cicada.layer.completed"
      );
      assert.ok(layerEvent);
      assert.strictEqual(layerEvent.payload.actor, "cicada");
      assert.ok(layerEvent.payload.payload.layer);
      assert.ok(layerEvent.payload.payload.stats);
    });
  });

  describe("buildHandoff", () => {
    it("builds handoff document from state", () => {
      const compressor = new CicadaCompressor();

      const state = {
        runId: "run-123",
        todos: [
          { content: "Done task", status: "done" },
          { content: "Pending task", status: "pending", priority: "high" },
        ],
        taskGoal: "Complete the project",
        iteration: 5,
        L1: {
          claims: [1, 2, 3],
          condensedMemory: {
            summary: "Progress summary",
            decisionTrace: ["decision1"],
          },
        },
        L2: {
          warnings: ["warning1"],
        },
      };

      const handoff = compressor.buildHandoff(state, null);

      assert.strictEqual(handoff.runId, "run-123");
      assert.ok(handoff.timestamp);
      assert.strictEqual(handoff.accomplished.summary, "Progress summary");
      assert.deepStrictEqual(handoff.accomplished.completedTodos, ["Done task"]);
      assert.strictEqual(handoff.accomplished.claimCount, 3);
      assert.strictEqual(handoff.pending.todos.length, 1);
      assert.strictEqual(handoff.pending.todos[0].content, "Pending task");
      assert.strictEqual(handoff.pending.taskGoal, "Complete the project");
      assert.deepStrictEqual(handoff.decisions, ["decision1"]);
      assert.strictEqual(handoff.resumeGuide.nextAction, "Pending task");
      assert.strictEqual(handoff.resumeGuide.iteration, 5);
      assert.deepStrictEqual(handoff.resumeGuide.warnings, ["warning1"]);
    });

    it("uses sharedContext methods when available", () => {
      const compressor = new CicadaCompressor();

      const sharedContext = {
        buildSummaryText: () => "Shared summary",
        getDecisions: () => ["d1", "d2", "d3", "d4", "d5", "d6"],
        getAllSummaries: () => ({ stage1: "s1" }),
      };

      const state = { runId: "r1", todos: [] };
      const handoff = compressor.buildHandoff(state, sharedContext);

      assert.strictEqual(handoff.accomplished.summary, "Shared summary");
      assert.strictEqual(handoff.decisions.length, 5); // Last 5
      assert.deepStrictEqual(handoff.resumeGuide.context, { stage1: "s1" });
    });

    it("handles empty state gracefully", () => {
      const compressor = new CicadaCompressor();
      const handoff = compressor.buildHandoff({}, null);

      assert.ok(handoff.timestamp);
      assert.strictEqual(handoff.accomplished.summary, "");
      assert.deepStrictEqual(handoff.accomplished.completedTodos, []);
      assert.deepStrictEqual(handoff.pending.todos, []);
      assert.strictEqual(handoff.resumeGuide.nextAction, null);
    });

    it("handles null state", () => {
      const compressor = new CicadaCompressor();
      const handoff = compressor.buildHandoff(null, null);

      assert.ok(handoff.timestamp);
      assert.deepStrictEqual(handoff.accomplished.completedTodos, []);
    });
  });

  describe("sharedContext integration", () => {
    it("calls sharedContext methods during compress", async () => {
      const mockSharedContext = {
        setSummary: mock.fn(),
        setIndex: mock.fn(),
        signal: mock.fn(),
      };

      const mockRouter = {
        call: mock.fn(async () =>
          JSON.stringify({
            summary: "Test",
            keyPoints: ["kp1"],
            decisions: [],
            errors: [],
          })
        ),
      };

      const compressor = new CicadaCompressor({
        layers: ["llm_summary"],
        modelRouter: mockRouter,
      });

      await compressor.compress(
        { data: "test" },
        { archiveKey: "shared-test", sharedContext: mockSharedContext }
      );

      assert.strictEqual(mockSharedContext.setSummary.mock.callCount(), 1);
      assert.strictEqual(mockSharedContext.setIndex.mock.callCount(), 1);
      assert.strictEqual(mockSharedContext.signal.mock.callCount(), 1);
    });
  });

  describe("edge cases", () => {
    it("handles non-object context by wrapping", async () => {
      const compressor = new CicadaCompressor({ layers: [] });
      const { context } = await compressor.compress("plain string");

      assert.strictEqual(context.value, "plain string");
    });

    it("handles empty messages array", async () => {
      const compressor = new CicadaCompressor({ layers: ["session_history"] });
      const { context, metadata } = await compressor.compress({ messages: [] });

      assert.deepStrictEqual(context.messages, []);
      assert.strictEqual(metadata.stats.sessionHistory.totalMessages, 0);
    });

    it("handles messages with missing content", async () => {
      const compressor = new CicadaCompressor({ layers: ["session_history"] });
      const input = {
        messages: [{ role: "user" }, { role: "assistant", content: null }],
      };

      const { context } = await compressor.compress(input, {
        keepLastTurns: 10,
      });

      assert.ok(Array.isArray(context.messages));
      context.messages.forEach((m) => {
        assert.strictEqual(typeof m.content, "string");
      });
    });

    it("applies multiple layers in sequence", async () => {
      const compressor = new CicadaCompressor({
        layers: ["tool_output", "session_history"],
      });

      const input = {
        messages: [
          { role: "user", content: "hi" },
          { role: "tool", content: "x".repeat(10000) },
          { role: "assistant", content: "done" },
        ],
      };

      const { metadata } = await compressor.compress(input);

      assert.ok(metadata.layersApplied.includes("tool_output"));
      assert.ok(metadata.layersApplied.includes("session_history"));
      assert.ok(metadata.stats.toolOutput);
      assert.ok(metadata.stats.sessionHistory);
    });

    it("handles restore with schema warning for unsupported version", async () => {
      const compressor = new CicadaCompressor();
      // Directly manipulate store to inject unsupported version
      compressor._archiveStore.set("bad-version", {
        schemaVersion: "99.0",
        data: "test",
      });

      const restored = await compressor.restore("bad-version");

      assert.ok(restored);
      assert.ok(restored._schemaWarning);
      assert.ok(restored._schemaWarning.includes("99.0"));
    });
  });
});
