import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

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

    assert.equal(result.status, "success");
    assert.deepEqual(result.decision, { thought: "test", action: "search" });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, "assistant");
  });

  it("should retry on empty response", async () => {
    const handler = createHandler();
    const messages = [];

    const result = await handler.handleResponse(
      { content: "" },
      { stageApi: {}, addMessage: (m) => messages.push(m), budget: null }
    );

    assert.equal(result.status, "retry");
    assert.equal(handler.retryCount, 1);
    assert.equal(messages.length, 1);
    assert.ok(messages[0].content.includes("JSON"));
  });

  it("should retry on parse failure", async () => {
    const handler = createHandler();
    const messages = [];

    const result = await handler.handleResponse(
      { content: "not valid json" },
      { stageApi: {}, addMessage: (m) => messages.push(m), budget: null }
    );

    assert.equal(result.status, "retry");
    assert.equal(handler.retryCount, 1);
    // assistant message + retry prompt
    assert.equal(messages.length, 2);
  });

  it("should stop after max retries (empty response)", async () => {
    const handler = createHandler({ maxRetries: 2 });
    const messages = [];
    const ctx = { stageApi: {}, addMessage: (m) => messages.push(m), budget: null };

    // First retry
    await handler.handleResponse({ content: "" }, ctx);
    assert.equal(handler.retryCount, 1);

    // Second retry - should stop
    const result = await handler.handleResponse({ content: "" }, ctx);
    assert.equal(result.status, "stop");
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

    assert.equal(result.status, "retry");
    assert.equal(handler.retryCount, 0); // reset after user choice
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

    assert.equal(result.status, "skip");
    assert.equal(handler.retryCount, 0);
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

    assert.deepEqual(recorded, { total: 500 });
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

    assert.ok(events.some((e) => e.name === "deepsearch.model.responded"));
  });

  it("should reset retry count", () => {
    const handler = createHandler();
    handler.retryCount = 5;
    handler.reset();
    assert.equal(handler.retryCount, 0);
  });
});
