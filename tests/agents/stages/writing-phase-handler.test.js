import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { WritingPhaseHandler } from "../../../js/agents/stages/deepsearch/runtime/writing-phase-handler.js";

describe("WritingPhaseHandler", () => {
  const createHandler = (overrides = {}) => {
    return new WritingPhaseHandler({
      logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
      emit: () => {},
      parseDecision: (content) => {
        try {
          const match = content.match(/\{[\s\S]*\}/);
          return match ? JSON.parse(match[0]) : null;
        } catch {
          return null;
        }
      },
      executeTool: async () => ({ success: true }),
      maxIterations: 3,
      maxParseFailures: 2,
      ...overrides,
    });
  };

  describe("shouldEnter", () => {
    it("should return true when word count is below minimum and iteration limit reached", () => {
      const handler = createHandler();
      const result = handler.shouldEnter({
        state: { L1: { report: { markdown: "短报告" } } },
        mode: "quick",
        globalConfig: {},
        iteration: 15,
        maxIterations: 15,
        toolCallCount: 10,
        maxToolCalls: 50,
      });
      assert.equal(result, true);
    });

    it("should return true when tool call limit reached", () => {
      const handler = createHandler();
      const result = handler.shouldEnter({
        state: { L1: { report: { markdown: "短报告" } } },
        mode: "quick",
        globalConfig: {},
        iteration: 5,
        maxIterations: 15,
        toolCallCount: 50,
        maxToolCalls: 50,
      });
      assert.equal(result, true);
    });

    it("should return false when word count meets minimum", () => {
      const handler = createHandler();
      const longReport = "字".repeat(5000);
      const result = handler.shouldEnter({
        state: { L1: { report: { markdown: longReport } } },
        mode: "quick",
        globalConfig: { report: { quick: { minWords: 4000 } } },
        iteration: 15,
        maxIterations: 15,
        toolCallCount: 10,
        maxToolCalls: 50,
      });
      assert.equal(result, false);
    });

    it("should return false when limits not reached", () => {
      const handler = createHandler();
      const result = handler.shouldEnter({
        state: { L1: { report: { markdown: "短" } } },
        mode: "quick",
        globalConfig: {},
        iteration: 5,
        maxIterations: 15,
        toolCallCount: 10,
        maxToolCalls: 50,
      });
      assert.equal(result, false);
    });
  });

  describe("getStats", () => {
    it("should calculate word count and todo stats", () => {
      const handler = createHandler();
      const stats = handler.getStats({
        state: {
          L1: { report: { markdown: "测试报告内容" } },
          todos: [
            { status: "completed" },
            { status: "done" },
            { status: "pending" },
          ],
        },
        mode: "wider",
        globalConfig: {},
      });

      assert.equal(stats.wordCount, 6);
      assert.equal(stats.minWords, 6000);
      assert.equal(stats.doneTodos, 2);
      assert.equal(stats.totalTodos, 3);
    });

    it("should handle empty state", () => {
      const handler = createHandler();
      const stats = handler.getStats({
        state: {},
        mode: "quick",
        globalConfig: {},
      });

      assert.equal(stats.wordCount, 0);
      assert.equal(stats.doneTodos, 0);
      assert.equal(stats.totalTodos, 0);
    });
  });

  describe("run", () => {
    it("should execute writing phase and exit on submit success", async () => {
      const messages = [];
      let callCount = 0;

      const handler = createHandler({
        executeTool: async (name, args) => {
          if (args?.action === "submit") return { success: true };
          return { success: true };
        },
      });

      await handler.run({
        state: { userConfig: { mode: "quick" }, globalConfig: {}, todos: [] },
        stageApi: {},
        sharedContext: null,
        callModel: async () => {
          callCount++;
          if (callCount === 1) {
            return { content: '{"thought": "get findings", "action": "write-report", "args": {"action": "get-findings"}}' };
          }
          return { content: '{"thought": "submit", "action": "write-report", "args": {"action": "submit"}}' };
        },
        addMessage: (m) => messages.push(m),
        messages: () => messages,
        signal: null,
      });

      assert.ok(messages.length >= 2);
    });

    it("should stop on max parse failures", async () => {
      const handler = createHandler({ maxParseFailures: 2 });
      const messages = [];

      await handler.run({
        state: { userConfig: { mode: "quick" }, globalConfig: {}, todos: [] },
        stageApi: {},
        sharedContext: null,
        callModel: async () => ({ content: "invalid json" }),
        addMessage: (m) => messages.push(m),
        messages: () => messages,
        signal: null,
      });

      // Should have stopped after 2 parse failures
      const parseFailureMessages = messages.filter(m => m.content?.includes("JSON 解析失败"));
      assert.ok(parseFailureMessages.length <= 2);
    });

    it("should respect abort signal", async () => {
      const handler = createHandler();
      const messages = [];
      const abortController = new AbortController();
      abortController.abort();

      await handler.run({
        state: { userConfig: { mode: "quick" }, globalConfig: {}, todos: [] },
        stageApi: {},
        sharedContext: null,
        callModel: async () => ({ content: '{"action": "test"}' }),
        addMessage: (m) => messages.push(m),
        messages: () => messages,
        signal: abortController.signal,
      });

      // Should exit immediately due to abort
      assert.equal(messages.filter(m => m.role === "assistant").length, 0);
    });
  });
});
