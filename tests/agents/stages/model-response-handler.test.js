
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { ModelResponseHandler } from "../../../js/agents/stages/deepsearch/runtime/model-response-handler.js";

describe("ModelResponseHandler", () => {
  const createHandler = (overrides = {}) => {
    return new ModelResponseHandler({
      logger: { warn: () => {}, error: () => {}, debug: () => {} },
      emit: () => {},
      parseDecision: (content) => {
        try {
          const match = content.match(/\{[\s\S]*\}/);
          return match ? JSON.parse(match[0]) : null;
        } catch {
          return null;
        }
      },
      maxRetries: 3,
      ...overrides,
    });
  };

  it("should return success with parsed decision", async () => {
    const handler = createHandler();
    const messages = [];

    const result = await handler.handleResponse(
      { content: '{"thought": "test", "action": "search"}', usage: { total: 100 } },
      { stageApi: {}, addMessage: (m) => messages.push(m), budget: null }
    );

    expect(result.status).toBe("success");
    expect(result.decision).toEqual({ thought: "test", action: "search" });
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("assistant");
  });

  it("should retry on empty response", async () => {
    const handler = createHandler();
    const messages = [];

    const result = await handler.handleResponse(
      { content: "" },
      { stageApi: {}, addMessage: (m) => messages.push(m), budget: null }
    );

    expect(result.status).toBe("retry");
    expect(handler.retryCount).toBe(1);
    expect(messages.length).toBe(1);
    expect(messages[0].content.includes("JSON")).toBeTruthy();
  });

  it("should retry on parse failure", async () => {
    const handler = createHandler();
    const messages = [];

    const result = await handler.handleResponse(
      { content: "not valid json" },
      { stageApi: {}, addMessage: (m) => messages.push(m), budget: null }
    );

    expect(result.status).toBe("retry");
    expect(handler.retryCount).toBe(1);
    // assistant message + retry prompt
    expect(messages.length).toBe(2);
  });

  it("should stop after max retries (empty response)", async () => {
    const handler = createHandler({ maxRetries: 2 });
    const messages = [];
    const ctx = { stageApi: {}, addMessage: (m) => messages.push(m), budget: null };

    // First retry
    await handler.handleResponse({ content: "" }, ctx);
    expect(handler.retryCount).toBe(1);

    // Second retry - should stop
    const result = await handler.handleResponse({ content: "" }, ctx);
    expect(result.status).toBe("stop");
  });

  it("should ask user and continue on user choice", async () => {
    const handler = createHandler({ maxRetries: 1 });
    const messages = [];
    const stageApi = {
      waitForUserInput: async () => "继续重试",
    };

    const result = await handler.handleResponse(
      { content: "" },
      { stageApi, addMessage: (m) => messages.push(m), budget: null }
    );

    expect(result.status).toBe("retry");
    expect(handler.retryCount).toBe(0); // reset after user choice
  });

  it("should skip on user choice", async () => {
    const handler = createHandler({ maxRetries: 1 });
    const stageApi = {
      waitForUserInput: async () => "跳过本轮",
    };

    const result = await handler.handleResponse(
      { content: "" },
      { stageApi, addMessage: () => {}, budget: null }
    );

    expect(result.status).toBe("skip");
    expect(handler.retryCount).toBe(0);
  });

  it("should record budget usage", async () => {
    const handler = createHandler();
    let recorded = null;
    const budget = {
      recordUsage: (usage) => { recorded = usage; },
    };

    await handler.handleResponse(
      { content: '{"action": "test"}', usage: { total: 500 } },
      { stageApi: {}, addMessage: () => {}, budget }
    );

    expect(recorded).toEqual({ total: 500 });
  });

  it("should emit events", async () => {
    const events = [];
    const handler = createHandler({
      emit: (name, payload) => events.push({ name, payload }),
    });

    await handler.handleResponse(
      { content: '{"action": "test"}', usage: { total: 100 } },
      { stageApi: {}, addMessage: () => {}, budget: null }
    );

    expect(events.some(e => e.name === "deepsearch.model.responded")).toBeTruthy();
  });

  it("should reset retry count", () => {
    const handler = createHandler();
    handler.retryCount = 5;
    handler.reset();
    expect(handler.retryCount).toBe(0);
  });
});
