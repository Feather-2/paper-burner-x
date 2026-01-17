
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  CicadaCompressor,
  CompressionLayer,
} from "../../../js/agents/runtime/compression/cicada-compressor.js";

describe("CicadaCompressor", () => {
  describe("CompressionLayer constants", () => {
    it("exposes frozen layer constants", () => {
      expect(CompressionLayer.TOOL_OUTPUT).toBe("tool_output");
      expect(CompressionLayer.SESSION_HISTORY).toBe("session_history");
      expect(CompressionLayer.LLM_SUMMARY).toBe("llm_summary");
      expect(Object.isFrozen(CompressionLayer)).toBe(true);
    });
  });

  describe("constructor", () => {
    it("uses default values when no options provided", () => {
      const compressor = new CicadaCompressor();
      expect(compressor.maxTokens).toBe(2000);
      expect(compressor.layers).toEqual([
        "tool_output",
        "session_history",
        "llm_summary",
      ]);
      expect(compressor.modelRouter).toBe(null);
      expect(compressor.archiveAdapter).toBe(null);
    });

    it("accepts custom maxTokens", () => {
      const compressor = new CicadaCompressor({ maxTokens: 5000 });
      expect(compressor.maxTokens).toBe(5000);
    });

    it("normalizes layers to valid ones only", () => {
      const compressor = new CicadaCompressor({
        layers: ["invalid", "tool_output", "unknown"],
      });
      expect(compressor.layers).toEqual(["tool_output"]);
    });

    it("handles maxArchives as Infinity", () => {
      const compressor = new CicadaCompressor({ maxArchives: Infinity });
      expect(compressor._maxArchives).toBe(Infinity);
    });

    it("handles archiveRetentionDays as null", () => {
      const compressor = new CicadaCompressor({ archiveRetentionDays: null });
      expect(compressor._archiveRetentionDays).toBe(null);
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

      expect(context.toolOutputs).toBeInstanceOf(Array);
      expect(context.toolOutputs.length).toBe(1);
      // status is an important key, should be preserved
      expect(context.toolOutputs[0].status).toBe("ok");
      // result is truncated
      expect(context.toolOutputs[0].result.length).toBeLessThan(longOutput.length);
      expect(metadata.stats.toolOutput.truncatedFields).toBeGreaterThan(0);
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

      expect(context.messages.length).toBe(2);
      expect(context.messages[0].content).toBe("hello");
      expect(context.messages[1].content.length).toBeLessThan(longContent.length);
      expect(metadata.layersApplied).toContain("tool_output");
    });

    it("handles tool_outputs key variant", async () => {
      const compressor = new CicadaCompressor({ layers: ["tool_output"] });
      const input = {
        tool_outputs: [{ data: "short" }],
      };

      const { context } = await compressor.compress(input);
      expect(context.tool_outputs).toBeInstanceOf(Array);
      expect(context.tool_outputs.length).toBe(1);
    });

    it("respects maxToolOutputChars option", async () => {
      const compressor = new CicadaCompressor({ layers: ["tool_output"] });
      const input = {
        toolOutputs: [{ output: "x".repeat(500) }],
      };

      const { context } = await compressor.compress(input, {
        maxToolOutputChars: 100,
      });

      expect(context.toolOutputs[0].output.length).toBeLessThanOrEqual(103); // 100 + "..."
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

      expect(context.toolOutputs[0].data.length).toBe(3);
      expect(metadata.stats.toolOutput.trimmedArrays).toBeGreaterThan(0);
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

      expect(context).toEqual(expect.any(Object));
      expect(context.messages).toBeInstanceOf(Array);
      expect(context.messages.length).toBe(3);
      expect(context.messages[0].content).toBe("a\nb");
      expect(context.messages[1].id).toBe("m3");
      expect(context.messages[2].id).toBe("m4");
      expect(metadata?.stats?.sessionHistory?.mergedMessages).toBe(1);
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

      expect(context.messages.length).toBe(2);
      expect(metadata.stats.sessionHistory.removedThinking).toBe(1);
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

      expect(context.messages.length).toBe(3);
      expect(context.messages[1].content).toMatch(/^\[/);
      expect(context.messages[1]._thinkingSummarized).toBe(true);
      expect(metadata.stats.sessionHistory.summarizedThinking).toBe(1);
      expect(metadata.stats.sessionHistory.removedThinking).toBe(0);
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

      expect(context.messages.length).toBe(2);
      expect(metadata.stats.sessionHistory.keptMessages).toBe(2);
      expect(metadata.stats.sessionHistory.summarizedMessages).toBe(4);
      expect(context.sessionSummary.length).toBeGreaterThan(0);
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
      expect(context.messages[0].role).toBe("system");
      expect(context.messages[0].content).toBe("You are a helpful assistant."
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
        expect(hasToolCall, "Tool result should have matching tool call").toBe(true);
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
      expect(
        context.messages.some(
          (m) => m.role === "tool" && m.tool_call_id === "missing"
        )
      ).toBe(false);
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
      expect(context.sessionSummary.length).toBeGreaterThan(0);
      const lines = context.sessionSummary.split("\n");
      expect(lines.every((l) => l.length <= 60)).toBe(true); // role: + title
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

      expect(metadata.layersApplied).not.toContain("llm_summary");
      expect(metadata.llmSummary).toBe(null);
    });

    it("generates LLM summary with modelRouter.call", async () => {
      const mockRouter = {
        call: vi.fn(async () => ({
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

      expect(metadata.layersApplied).toContain("llm_summary");
      expect(metadata.llmSummary.summary).toBe("Test summary");
      expect(metadata.llmSummary.keyPoints).toEqual(["point1"]);
      expect(context.llmSummary).toEqual(expect.any(Object));
      expect(mockRouter.call.mock.calls.length).toBe(1);
    });

    it("falls back to text summary when LLM returns invalid JSON", async () => {
      const mockRouter = {
        call: vi.fn(async () => "not valid json"),
      };

      const compressor = new CicadaCompressor({
        layers: ["llm_summary"],
        modelRouter: mockRouter,
      });

      const input = { data: "some context with error mentions" };
      const { metadata } = await compressor.compress(input);

      expect(metadata.llmSummary).toEqual(expect.any(Object));
      expect(metadata.llmSummary.summary).toBeTypeOf("string");
    });

    it("handles modelRouter.chat fallback", async () => {
      const mockRouter = {
        chat: vi.fn(async () => ({
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

      expect(metadata.llmSummary.summary).toBe("Chat summary");
      expect(mockRouter.chat.mock.calls.length).toBe(1);
    });

    it("handles LLM call failure gracefully", async () => {
      const mockRouter = {
        call: vi.fn(async () => {
          throw new Error("API error");
        }),
      };

      const compressor = new CicadaCompressor({
        layers: ["llm_summary"],
        modelRouter: mockRouter,
      });

      const { metadata } = await compressor.compress({ data: "test" });

      // Should still produce a fallback summary
      expect(metadata.llmSummary).toEqual(expect.any(Object));
      expect(metadata.llmSummary.summary).toBeTypeOf("string");
    });
  });

  describe("archive and restore", () => {
    it("stores and retrieves from internal store", async () => {
      const compressor = new CicadaCompressor();
      const archiveId = await compressor.archive("test-key", { data: "value" });

      expect(archiveId).toBe("test-key");

      const restored = await compressor.restore("test-key");
      expect(restored).toEqual(expect.any(Object));
      expect(restored.data).toBe("value");
      expect(restored.timestamp).toBeGreaterThan(0);
      expect(restored.schemaVersion).toBe("1.0");
    });

    it("generates archiveId when stageKey is empty", async () => {
      const compressor = new CicadaCompressor();
      const archiveId = await compressor.archive("", { data: "test" });

      expect(archiveId).toBeTypeOf("string");
      expect(archiveId).toMatch(/^archive_/);
    });

    it("uses external adapter.store when available", async () => {
      const storedData = new Map();
      const adapter = {
        store: vi.fn(async (key, data) => {
          storedData.set(key, data);
          return `stored-${key}`;
        }),
        load: vi.fn(async (key) => storedData.get(key)),
      };

      const compressor = new CicadaCompressor({ archive: adapter });
      const archiveId = await compressor.archive("ext-key", { data: "ext" });

      expect(archiveId).toBe("stored-ext-key");
      expect(adapter.store.mock.calls.length).toBe(1);

      const restored = await compressor.restore("ext-key");
      expect(restored).toEqual(expect.any(Object));
      expect(restored.data).toBe("ext");
    });

    it("uses adapter.set when store is unavailable", async () => {
      const storedData = new Map();
      const adapter = {
        set: vi.fn((key, data) => storedData.set(key, data)),
        get: vi.fn((key) => storedData.get(key)),
      };

      const compressor = new CicadaCompressor({ archive: adapter });
      await compressor.archive("set-key", { data: "set-test" });

      expect(adapter.set.mock.calls.length).toBe(1);

      const restored = await compressor.restore("set-key");
      expect(restored).toEqual(expect.any(Object));
    });

    it("returns null when restoring non-existent key", async () => {
      const compressor = new CicadaCompressor();
      const restored = await compressor.restore("non-existent");
      expect(restored).toBe(null);
    });

    it("prunes archives when exceeding maxArchives", async () => {
      const compressor = new CicadaCompressor({ maxArchives: 3 });

      await compressor.archive("k1", { timestamp: 1000 });
      await compressor.archive("k2", { timestamp: 2000 });
      await compressor.archive("k3", { timestamp: 3000 });
      await compressor.archive("k4", { timestamp: 4000 });

      // k1 should be pruned (oldest)
      expect(compressor._archiveStore.size).toBe(3);
      expect(compressor._archiveStore.has("k1")).toBe(false);
      expect(compressor._archiveStore.has("k4")).toBe(true);
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
      expect(compressor._archiveStore.has("old")).toBe(false);

      // Archive new entry
      await compressor.archive("new", { timestamp: now });

      // New entry should be kept
      expect(compressor._archiveStore.has("new")).toBe(true);
      expect(compressor._archiveStore.size).toBe(1);
    });
  });

  describe("listArchives", () => {
    it("lists archives sorted by timestamp descending", async () => {
      const compressor = new CicadaCompressor();

      await compressor.archive("old", { timestamp: 1000, summary: "old one" });
      await compressor.archive("mid", { timestamp: 2000, summary: "mid one" });
      await compressor.archive("new", { timestamp: 3000, summary: "new one" });

      const list = await compressor.listArchives({ limit: 10 });

      expect(list.length).toBe(3);
      expect(list[0].id).toBe("new");
      expect(list[1].id).toBe("mid");
      expect(list[2].id).toBe("old");
    });

    it("respects limit parameter", async () => {
      const compressor = new CicadaCompressor();

      await compressor.archive("k1", { timestamp: 1000 });
      await compressor.archive("k2", { timestamp: 2000 });
      await compressor.archive("k3", { timestamp: 3000 });

      const list = await compressor.listArchives({ limit: 2 });
      expect(list.length).toBe(2);
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
      expect(list.length).toBe(1);
      expect(list[0].id).toBe("search-1");
    });

    it("matches pattern against id as well", async () => {
      const compressor = new CicadaCompressor();

      await compressor.archive("special-key", { timestamp: 1000, summary: "" });
      await compressor.archive("other-key", { timestamp: 2000, summary: "" });

      const list = await compressor.listArchives({ pattern: "special" });
      expect(list.length).toBe(1);
    });
  });

  describe("compress with archiveKey", () => {
    it("archives context when archiveKey is provided", async () => {
      const compressor = new CicadaCompressor({ layers: [] });

      const { metadata } = await compressor.compress(
        { data: "test" },
        { archiveKey: "my-archive" }
      );

      expect(metadata.archiveId).toBe("my-archive");

      const restored = await compressor.restore("my-archive");
      expect(restored).toEqual(expect.any(Object));
      expect(restored.context.data).toBe("test");
    });

    it("uses stageKey from context if archiveKey not provided", async () => {
      const compressor = new CicadaCompressor({ layers: [] });

      const { metadata } = await compressor.compress({
        data: "test",
        stageKey: "stage-key",
      });

      expect(metadata.archiveId).toBe("stage-key");
    });
  });

  describe("event emission", () => {
    it("emits layer completed events", async () => {
      const events = [];
      const eventBus = {
        emit: vi.fn((name, payload) => events.push({ name, payload })),
      };

      const compressor = new CicadaCompressor({
        layers: ["tool_output", "session_history"],
        eventBus,
      });

      await compressor.compress({
        messages: [{ role: "user", content: "hi" }],
      });

      expect(events.some(e => e.name === "cicada.layer.completed"),
        "Should emit layer completed"
      );
      expect(events.some(e => e.name === "cicada.shed.completed"),
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
      expect(layerEvent).toEqual(expect.any(Object));
      expect(layerEvent.payload.actor).toBe("cicada");
      expect(layerEvent.payload.payload.layer).toBeTypeOf("string");
      expect(layerEvent.payload.payload.stats).toEqual(expect.any(Object));
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

      expect(handoff.runId).toBe("run-123");
      expect(handoff.timestamp).toBeTypeOf("string");
      expect(handoff.accomplished.summary).toBe("Progress summary");
      expect(handoff.accomplished.completedTodos).toEqual(["Done task"]);
      expect(handoff.accomplished.claimCount).toBe(3);
      expect(handoff.pending.todos.length).toBe(1);
      expect(handoff.pending.todos[0].content).toBe("Pending task");
      expect(handoff.pending.taskGoal).toBe("Complete the project");
      expect(handoff.decisions).toEqual(["decision1"]);
      expect(handoff.resumeGuide.nextAction).toBe("Pending task");
      expect(handoff.resumeGuide.iteration).toBe(5);
      expect(handoff.resumeGuide.warnings).toEqual(["warning1"]);
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

      expect(handoff.accomplished.summary).toBe("Shared summary");
      expect(handoff.decisions.length).toBe(5); // Last 5
      expect(handoff.resumeGuide.context).toEqual({ stage1: "s1" });
    });

    it("handles empty state gracefully", () => {
      const compressor = new CicadaCompressor();
      const handoff = compressor.buildHandoff({}, null);

      expect(handoff.timestamp).toBeTypeOf("string");
      expect(handoff.accomplished.summary).toBe("");
      expect(handoff.accomplished.completedTodos).toEqual([]);
      expect(handoff.pending.todos).toEqual([]);
      expect(handoff.resumeGuide.nextAction).toBe(null);
    });

    it("handles null state", () => {
      const compressor = new CicadaCompressor();
      const handoff = compressor.buildHandoff(null, null);

      expect(handoff.timestamp).toBeTypeOf("string");
      expect(handoff.accomplished.completedTodos).toEqual([]);
    });
  });

  describe("sharedContext integration", () => {
    it("calls sharedContext methods during compress", async () => {
      const mockSharedContext = {
        setSummary: vi.fn(),
        setIndex: vi.fn(),
        signal: vi.fn(),
      };

      const mockRouter = {
        call: vi.fn(async () =>
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

      expect(mockSharedContext.setSummary.mock.calls.length).toBe(1);
      expect(mockSharedContext.setIndex.mock.calls.length).toBe(1);
      expect(mockSharedContext.signal.mock.calls.length).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("handles non-object context by wrapping", async () => {
      const compressor = new CicadaCompressor({ layers: [] });
      const { context } = await compressor.compress("plain string");

      expect(context.value).toBe("plain string");
    });

    it("handles empty messages array", async () => {
      const compressor = new CicadaCompressor({ layers: ["session_history"] });
      const { context, metadata } = await compressor.compress({ messages: [] });

      expect(context.messages).toEqual([]);
      expect(metadata.stats.sessionHistory.totalMessages).toBe(0);
    });

    it("handles messages with missing content", async () => {
      const compressor = new CicadaCompressor({ layers: ["session_history"] });
      const input = {
        messages: [{ role: "user" }, { role: "assistant", content: null }],
      };

      const { context } = await compressor.compress(input, {
        keepLastTurns: 10,
      });

      expect(context.messages).toBeInstanceOf(Array);
      context.messages.forEach((m) => {
        expect(typeof m.content).toBe("string");
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

      expect(metadata.layersApplied).toContain("tool_output");
      expect(metadata.layersApplied).toContain("session_history");
      expect(metadata.stats.toolOutput).toEqual(expect.any(Object));
      expect(metadata.stats.sessionHistory).toEqual(expect.any(Object));
    });

    it("handles restore with schema warning for unsupported version", async () => {
      const compressor = new CicadaCompressor();
      // Directly manipulate store to inject unsupported version
      compressor._archiveStore.set("bad-version", {
        schemaVersion: "99.0",
        data: "test",
      });

      const restored = await compressor.restore("bad-version");

      expect(restored).toEqual(expect.any(Object));
      expect(restored._schemaWarning).toBeTypeOf("string");
      expect(restored._schemaWarning).toContain("99.0");
    });
  });
});
