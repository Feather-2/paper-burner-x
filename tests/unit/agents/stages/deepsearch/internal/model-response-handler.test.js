import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedShared = vi.hoisted(() => ({
  robustParseJson: vi.fn(),
}));

const mockedEvents = vi.hoisted(() => ({
  DeepSearchEvents: {
    MODEL_RESPONDED: "deepsearch.model.responded",
    AGENT_ERROR: "deepsearch.agent.error",
  },
}));

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  robustParseJson: mockedShared.robustParseJson,
}));

vi.mock("../../../../../../js/agents/runtime/events/events.js", () => ({
  DeepSearchEvents: mockedEvents.DeepSearchEvents,
}));

import ModelResponseHandlerDefault, {
  ModelResponseHandler,
} from "../../../../../../js/agents/stages/deepsearch/internal/model-response-handler.js";

const createHandler = (overrides = {}) => {
  const logger = overrides.logger ?? { warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const emit = overrides.emit ?? vi.fn();
  const parseDecision =
    overrides.parseDecision ??
    vi.fn((content) => {
      try {
        return JSON.parse(content);
      } catch {
        return null;
      }
    });
  const maxRetries = overrides.maxRetries ?? 3;

  const handler = new ModelResponseHandler({ logger, emit, parseDecision, maxRetries });
  return { handler, logger, emit, parseDecision };
};

const createDeepDecision = (depth) => {
  let current = { depth };
  for (let i = depth - 1; i >= 0; i -= 1) {
    current = { depth: i, next: current };
  }
  return current;
};

describe("ModelResponseHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles success, emits events, logs response, and records usage", async () => {
    const { handler, emit, parseDecision, logger } = createHandler();
    const addMessage = vi.fn();
    const budget = { recordUsage: vi.fn() };
    handler.retryCount = 2;

    const response = {
      content: '{"thought":"t","action":"a"}',
      usage: { total: 42 },
    };

    const result = await handler.handleResponse(response, {
      stageApi: {},
      addMessage,
      budget,
    });

    expect(parseDecision).toHaveBeenCalledWith(response.content);
    expect(result).toEqual({
      status: "success",
      decision: { thought: "t", action: "a" },
      content: response.content,
    });
    expect(addMessage).toHaveBeenCalledWith({ role: "assistant", content: response.content });
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(mockedEvents.DeepSearchEvents.MODEL_RESPONDED, {
      content: response.content,
      usage: response.usage,
    });
    expect(budget.recordUsage).toHaveBeenCalledWith(response.usage);
    expect(handler.retryCount).toBe(0);
  });

  it.each([
    ["null response", null],
    ["undefined response", undefined],
    ["empty string content", { content: "" }],
    ["whitespace content", { content: " \n\t" }],
    ["empty array response", []],
    ["empty object response", {}],
  ])("retries on %s", async (_label, response) => {
    const { handler, logger, parseDecision } = createHandler();
    const addMessage = vi.fn();

    const result = await handler.handleResponse(response, {
      stageApi: {},
      addMessage,
      budget: null,
    });

    expect(result.status).toBe("retry");
    expect(handler.retryCount).toBe(1);
    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
      })
    );
    expect(parseDecision).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("retries on parse failure and prompts for JSON", async () => {
    const { handler, logger } = createHandler({
      parseDecision: vi.fn(() => null),
    });
    const addMessage = vi.fn();

    const result = await handler.handleResponse(
      { content: "not json" },
      { stageApi: {}, addMessage, budget: null }
    );

    expect(result.status).toBe("retry");
    expect(handler.retryCount).toBe(1);
    expect(addMessage).toHaveBeenCalledTimes(2);
    expect(addMessage.mock.calls[0][0]).toEqual({ role: "assistant", content: "not json" });
    expect(addMessage.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        role: "user",
      })
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["继续重试", "retry", 0],
    ["跳过本轮", "skip", 0],
    ["停止执行", "stop", 1],
    [null, "stop", 1],
  ])("honors user choice %s after max empty retries", async (choice, status, expectedRetry) => {
    const { handler, emit, logger } = createHandler({ maxRetries: 1 });
    const addMessage = vi.fn();
    const stageApi = {
      waitForUserInput: vi.fn(async () => choice),
    };

    const result = await handler.handleResponse(
      { content: "" },
      { stageApi, addMessage, budget: null }
    );

    expect(result.status).toBe(status);
    expect(handler.retryCount).toBe(expectedRetry);
    expect(addMessage).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(mockedEvents.DeepSearchEvents.AGENT_ERROR, {
      error: "Too many empty responses",
      recoverable: true,
    });
  });

  it("stops on parse failures when stageApi is an array (object-as-array boundary)", async () => {
    const { handler, emit, logger } = createHandler({
      maxRetries: 1,
      parseDecision: vi.fn(() => null),
    });
    const addMessage = vi.fn();
    const stageApi = [];

    const result = await handler.handleResponse(
      { content: "not json" },
      { stageApi, addMessage, budget: null }
    );

    expect(result.status).toBe("stop");
    expect(handler.retryCount).toBe(1);
    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(mockedEvents.DeepSearchEvents.AGENT_ERROR, {
      error: "Too many parse failures",
      recoverable: true,
    });
  });

  it("treats string maxRetries as numeric boundary", async () => {
    const { handler, emit } = createHandler({ maxRetries: "2" });
    const addMessage = vi.fn();
    const stageApi = {
      waitForUserInput: vi.fn(async () => "停止执行"),
    };

    const first = await handler.handleResponse(
      { content: "" },
      { stageApi, addMessage, budget: null }
    );
    const second = await handler.handleResponse(
      { content: "" },
      { stageApi, addMessage, budget: null }
    );

    expect(first.status).toBe("retry");
    expect(second.status).toBe("stop");
    expect(emit).toHaveBeenCalledWith(mockedEvents.DeepSearchEvents.AGENT_ERROR, {
      error: "Too many empty responses",
      recoverable: true,
    });
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
  ])("handles %s maxRetries boundary with immediate prompt", async (_label, maxRetries) => {
    const { handler, emit } = createHandler({ maxRetries });
    const addMessage = vi.fn();
    const stageApi = {
      waitForUserInput: vi.fn(async () => "继续重试"),
    };

    const result = await handler.handleResponse(
      { content: "" },
      { stageApi, addMessage, budget: null }
    );

    expect(result.status).toBe("retry");
    expect(handler.retryCount).toBe(0);
    expect(stageApi.waitForUserInput).toHaveBeenCalledWith(
      expect.objectContaining({
        question: expect.stringContaining(String(maxRetries)),
      })
    );
    expect(emit).toHaveBeenCalledWith(mockedEvents.DeepSearchEvents.AGENT_ERROR, {
      error: "Too many empty responses",
      recoverable: true,
    });
  });

  it("does not reach MAX_SAFE_INTEGER retry limit on first empty response", async () => {
    const { handler, emit } = createHandler({ maxRetries: Number.MAX_SAFE_INTEGER });
    const addMessage = vi.fn();

    const result = await handler.handleResponse(
      { content: "" },
      { stageApi: {}, addMessage, budget: null }
    );

    expect(result.status).toBe("retry");
    expect(handler.retryCount).toBe(1);
    expect(emit).not.toHaveBeenCalled();
  });

  it("handles concurrent responses without leaking state", async () => {
    const { handler, emit } = createHandler({
      parseDecision: vi.fn(() => ({ ok: true })),
    });
    const addMessage = vi.fn();

    const [first, second] = await Promise.all([
      handler.handleResponse(
        { content: '{"action":"a"}' },
        { stageApi: {}, addMessage, budget: null }
      ),
      handler.handleResponse(
        { content: '{"action":"b"}' },
        { stageApi: {}, addMessage, budget: null }
      ),
    ]);

    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    expect(addMessage).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(handler.retryCount).toBe(0);
  });

  it("handles rapid successive calls and resets retry count on success", async () => {
    const parseDecision = vi.fn();
    parseDecision.mockReturnValueOnce(null).mockReturnValueOnce({ action: "ok" });

    const { handler } = createHandler({ parseDecision });
    const addMessage = vi.fn();

    const first = await handler.handleResponse(
      { content: "not json" },
      { stageApi: {}, addMessage, budget: null }
    );
    const second = await handler.handleResponse(
      { content: '{"action":"ok"}' },
      { stageApi: {}, addMessage, budget: null }
    );

    expect(first.status).toBe("retry");
    expect(second.status).toBe("success");
    expect(handler.retryCount).toBe(0);
    expect(addMessage).toHaveBeenCalledTimes(3);
  });

  it("truncates long content in logs (long string boundary)", async () => {
    const { handler, logger } = createHandler({
      parseDecision: vi.fn(() => ({ action: "ok" })),
    });
    const addMessage = vi.fn();
    const content = "a".repeat(250);

    const result = await handler.handleResponse(
      { content },
      { stageApi: {}, addMessage, budget: null }
    );

    const preview = `${"a".repeat(200)}...`;
    expect(result.status).toBe("success");
    expect(logger.debug).toHaveBeenCalledWith(`Model response: ${preview}`);
  });

  it("accepts huge content and deep decisions (resource boundary)", async () => {
    const deepDecision = createDeepDecision(25);
    const { handler, logger } = createHandler({
      parseDecision: vi.fn(() => deepDecision),
    });
    const addMessage = vi.fn();
    const content = "x".repeat(200000);

    const result = await handler.handleResponse(
      { content },
      { stageApi: {}, addMessage, budget: null }
    );

    expect(result.status).toBe("success");
    expect(result.decision).toBe(deepDecision);
    expect(result.decision.next.next.depth).toBe(2);
    expect(logger.debug).toHaveBeenCalledWith(`Model response: ${"x".repeat(200)}...`);
  });

  it("throws when addMessage expects arrays (object-as-array boundary)", async () => {
    const { handler } = createHandler();
    const addMessage = vi.fn((msg) => {
      if (!Array.isArray(msg)) {
        throw new TypeError("expected array");
      }
    });

    await expect(
      handler.handleResponse(
        { content: '{"action":"ok"}' },
        { stageApi: {}, addMessage, budget: null }
      )
    ).rejects.toThrow(TypeError);
  });

  it("resets retry count", () => {
    const { handler } = createHandler();
    handler.retryCount = 5;
    handler.reset();
    expect(handler.retryCount).toBe(0);
  });
});

describe("default", () => {
  it("exports ModelResponseHandler", () => {
    expect(ModelResponseHandlerDefault).toBe(ModelResponseHandler);
  });
});
