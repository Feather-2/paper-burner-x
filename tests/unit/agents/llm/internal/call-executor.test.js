import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCaptureLogger, createFakeTime, createMockProvider } from "../vitest-utils.js";

const assertChatResponseMock = vi.hoisted(() => vi.fn());
const extractPromptTextMock = vi.hoisted(() => vi.fn());
const tokenTrackerRecordMock = vi.hoisted(() => vi.fn());
const getGlobalTokenTrackerMock = vi.hoisted(() => vi.fn(() => ({ record: tokenTrackerRecordMock })));
const estimateComplexityMock = vi.hoisted(() => vi.fn());
const toNonEmptyStringMock = vi.hoisted(() => vi.fn());
const isPermanentAuthErrorMock = vi.hoisted(() => vi.fn());
const toErrorInfoMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../js/agents/llm/provider.js", () => ({
  assertChatResponse: assertChatResponseMock,
}));

vi.mock("../../../../../js/agents/llm/internal/provider-selection.js", () => ({
  extractPromptText: extractPromptTextMock,
}));

vi.mock("../../../../../js/agents/plugins/telemetry/index.js", () => ({
  getGlobalTokenTracker: getGlobalTokenTrackerMock,
}));

vi.mock("../../../../../js/agents/runtime/routing/performance-router.js", () => ({
  estimateComplexity: estimateComplexityMock,
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  toNonEmptyString: toNonEmptyStringMock,
}));

vi.mock("../../../../../js/agents/llm/internal/fallback.js", () => ({
  isPermanentAuthError: isPermanentAuthErrorMock,
  toErrorInfo: toErrorInfoMock,
}));

import {
  callWithPerformanceRouting,
  callWithStandardRouting,
  executeCall,
} from "../../../../../js/agents/llm/internal/call-executor.js";

function makeDeepNested(depth = 12) {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = { level: i };
    cursor = cursor.next;
  }
  return root;
}

function findEvents(emitMock, eventName) {
  return emitMock.mock.calls.filter((call) => call[0] === eventName).map((call) => call[1]);
}

function createRouter(options = {}) {
  const time = options.time ?? createFakeTime(0);
  const logger = options.logger ?? createCaptureLogger().logger;
  const models =
    options.models ?? [
      {
        id: "m1",
        provider: "mock",
        tags: ["text"],
      },
    ];
  const modelMap = new Map(models.map((model) => [model.id, model]));
  const providers = options.providers ?? {};
  const availableIds =
    options.availableIds instanceof Set ? options.availableIds : new Set(options.availableIds ?? modelMap.keys());
  const performanceRouter =
    options.performanceRouter ??
    (() => {
      const selectEndpoint = vi.fn(({ includeIds }) => ({ endpointId: includeIds[0] }));
      const recordResult = vi.fn();
      return { selectEndpoint, recordResult };
    })();

  const supportsTags =
    options.supportsTags ??
    ((entry, requiredTags) => {
      if (!requiredTags || requiredTags.size === 0) return true;
      const tags = Array.isArray(entry.tags) ? entry.tags : [];
      for (const tag of requiredTags) {
        if (!tags.includes(tag)) return false;
      }
      return true;
    });

  const router = {
    _models: modelMap,
    _logger: logger,
    _time: time,
    _performanceRouter: performanceRouter,
    _retryStrategy: options.retryStrategy ?? null,
    _cooldownMs: options.cooldownMs ?? 1000,
    _health: options.health ?? new Map(),
    _supportsTags: vi.fn((entry, requiredTags) => supportsTags(entry, requiredTags)),
    isAvailable: vi.fn((modelId) => {
      if (typeof options.isAvailable === "function") return options.isAvailable(modelId);
      return availableIds.has(modelId);
    }),
    _getCircuitBreaker: vi.fn((modelId) => {
      if (options.circuitBreakers instanceof Map) return options.circuitBreakers.get(modelId) ?? null;
      if (typeof options.getCircuitBreaker === "function") return options.getCircuitBreaker(modelId);
      return null;
    }),
    _getProvider: vi.fn((providerId) => (providers ? providers[providerId] : null)),
    _getRateLimiter: vi.fn(() => options.rateLimiter ?? null),
    markHealthy: vi.fn(),
    markUnhealthy: vi.fn(
      () =>
        options.markUnhealthyReturn ?? {
          cooldownMs: 2000,
          backoffLevel: 1,
          unhealthyUntilMs: time.now() + 2000,
        }
    ),
    disableModel: vi.fn(
      () =>
        options.disableModelReturn ?? {
          disabled: true,
          disabledReason: "auth",
          cooldownMs: 3000,
        }
    ),
    emit: vi.fn(),
    _findNextCandidate: vi.fn((startIndex, orderedCandidates, requiredTags) => {
      if (typeof options.findNextCandidate === "function") {
        return options.findNextCandidate(startIndex, orderedCandidates, requiredTags);
      }
      for (let idx = startIndex; idx < orderedCandidates.length; idx += 1) {
        const candidate = orderedCandidates[idx];
        const entry = modelMap.get(candidate);
        if (!entry) continue;
        if (supportsTags(entry, requiredTags)) return candidate;
      }
      return null;
    }),
    _getShortestCooldown: vi.fn(
      (candidates) => options.shortestCooldown ?? { modelId: candidates[0], remainingMs: 10 }
    ),
    call: vi.fn(async (args) => options.callResult ?? { content: "retry-ok", model: "retry-model", provider: "mock", ...args }),
    _registerPerformanceCandidates: vi.fn(),
    _logCandidateDebug: vi.fn(),
    _finalizeRoundRobin: vi.fn(),
    _prepareCallContext: vi.fn((ctx) => {
      if (typeof options.prepareContext === "function") return options.prepareContext(ctx);
      return ctx;
    }),
  };

  return { router, time, performanceRouter };
}

beforeEach(() => {
  vi.resetAllMocks();

  assertChatResponseMock.mockImplementation(() => {});
  extractPromptTextMock.mockImplementation((messages) => {
    if (Array.isArray(messages)) {
      return messages.map((msg) => String(msg?.content ?? "")).join(" ");
    }
    if (messages == null) return "";
    return String(messages);
  });
  tokenTrackerRecordMock.mockReset();
  getGlobalTokenTrackerMock.mockImplementation(() => ({ record: tokenTrackerRecordMock }));
  estimateComplexityMock.mockReturnValue("low");
  toNonEmptyStringMock.mockImplementation((value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  });
  isPermanentAuthErrorMock.mockReturnValue(false);
  toErrorInfoMock.mockImplementation((err) => {
    if (err && typeof err === "object" && "name" in err && "message" in err) {
      return { name: String(err.name), message: String(err.message) };
    }
    return { name: "Error", message: String(err ?? "") };
  });
});

describe("executeCall", () => {
  it("uses performance routing and finalizes selected model id", async () => {
    const time = createFakeTime(100);
    const { provider } = createMockProvider({
      time,
      behaviors: { m1: [{ content: "ok" }] },
    });

    const { router, performanceRouter } = createRouter({
      time,
      models: [{ id: "m1", provider: "mock", tags: ["text"] }],
      providers: { mock: provider },
      prepareContext: ({ usage, _waitRetryCount }) => ({
        usage: usage ?? "default",
        requiredTags: new Set(),
        waitRetryCount: _waitRetryCount ?? 0,
        baseCandidates: ["m1"],
        orderedCandidates: ["m1"],
        strategy: "priority",
        startIndex: 0,
        usePerformanceRouting: true,
      }),
    });

    extractPromptTextMock.mockReturnValue("prompt text");
    estimateComplexityMock.mockReturnValue("medium");
    toNonEmptyStringMock.mockImplementation((value) => (typeof value === "string" ? `${value}-normalized` : null));

    const result = await executeCall({
      router,
      usage: "task",
      messages: [{ role: "user", content: "hi" }],
      images: [],
    });

    expect(result).toMatchObject({ content: "ok", model: "m1", provider: "mock" });
    expect(extractPromptTextMock).toHaveBeenCalledWith([{ role: "user", content: "hi" }]);
    expect(estimateComplexityMock).toHaveBeenCalledWith({ prompt: "prompt text" });
    expect(router._registerPerformanceCandidates).toHaveBeenCalledWith({
      usage: "task",
      baseCandidates: ["m1"],
      images: [],
    });
    expect(router._logCandidateDebug).toHaveBeenCalled();
    expect(performanceRouter.selectEndpoint).toHaveBeenCalled();
    expect(router._finalizeRoundRobin).toHaveBeenCalledWith({
      usage: "task",
      strategy: "priority",
      baseCandidates: ["m1"],
      startIndex: 0,
      selectedModelId: "m1-normalized",
    });
  });

  it("finalizes even when standard routing fails", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: { bad: [{ throw: new Error("boom") }] },
    });

    const { router } = createRouter({
      time,
      models: [{ id: "bad", provider: "mock", tags: ["text"] }],
      providers: { mock: provider },
      prepareContext: ({ usage, _waitRetryCount }) => ({
        usage: usage ?? "",
        requiredTags: new Set(),
        waitRetryCount: _waitRetryCount ?? 0,
        baseCandidates: ["bad"],
        orderedCandidates: ["bad"],
        strategy: "priority",
        startIndex: 0,
        usePerformanceRouting: false,
      }),
    });

    await expect(
      executeCall({
        router,
        usage: "",
        messages: null,
        images: null,
      })
    ).rejects.toThrow("All models failed for usage: ");

    expect(router._finalizeRoundRobin).toHaveBeenCalledWith({
      usage: "",
      strategy: "priority",
      baseCandidates: ["bad"],
      startIndex: 0,
      selectedModelId: null,
    });
  });

  it("throws when called without input or with null", async () => {
    await expect(executeCall()).rejects.toThrow();
    await expect(executeCall(null)).rejects.toThrow();
  });
});

describe("callWithPerformanceRouting", () => {
  it("returns response with rate limiter and retry strategy", async () => {
    const time = createFakeTime(10);
    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [
          {
            content: "ok",
            usage: { prompt_tokens: 5, completion_tokens: 7 },
          },
        ],
      },
    });

    const limiter = {
      schedule: vi.fn(async (fn) => fn()),
      blockFor: vi.fn(),
    };
    const retryStrategy = { execute: vi.fn(async (fn) => fn()) };

    const { router, performanceRouter } = createRouter({
      time,
      models: [{ id: "m1", provider: "mock", tags: ["text"] }],
      providers: { mock: provider },
      rateLimiter: limiter,
      retryStrategy,
    });

    const result = await callWithPerformanceRouting({
      router,
      usage: "u",
      messages: [],
      images: [],
      requiredTags: new Set(),
      orderedCandidates: ["m1"],
      taskComplexity: "low",
      waitRetryCount: 0,
    });

    expect(result).toMatchObject({ content: "ok", model: "m1", provider: "mock" });
    expect(limiter.schedule).toHaveBeenCalledTimes(1);
    expect(retryStrategy.execute).toHaveBeenCalledTimes(1);
    expect(assertChatResponseMock).toHaveBeenCalledTimes(1);
    expect(tokenTrackerRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "m1",
        provider: "mock",
        usage: "u",
        promptTokens: 5,
        completionTokens: 7,
        success: true,
      })
    );
    expect(performanceRouter.recordResult).toHaveBeenCalledWith("m1", expect.objectContaining({ success: true }));
    expect(router.markHealthy).toHaveBeenCalledWith("m1");
  });

  it("redacts errors, disables on permanent auth error, and failovers", async () => {
    const time = createFakeTime(0);
    const failure = new Error("boom");
    failure.retryAfterMs = 1200;

    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [{ throw: failure }],
        m2: [{ content: "ok-2" }],
      },
    });

    const limiter = {
      schedule: vi.fn(async (fn) => fn()),
      blockFor: vi.fn(),
    };

    const { router, performanceRouter } = createRouter({
      time,
      models: [
        { id: "m1", provider: "mock", tags: ["text"] },
        { id: "m2", provider: "mock", tags: ["text"] },
      ],
      providers: { mock: provider },
      rateLimiter: limiter,
    });

    const longSecret = `authorization: bearer sk-1234567890123456 ${"x".repeat(620)}`;
    toErrorInfoMock.mockReturnValue({ name: "AuthError", message: longSecret });
    isPermanentAuthErrorMock.mockReturnValue(true);

    const result = await callWithPerformanceRouting({
      router,
      usage: "auth",
      messages: [],
      images: [],
      requiredTags: new Set(),
      orderedCandidates: ["m1", "m2"],
      taskComplexity: "high",
      waitRetryCount: 0,
    });

    expect(result).toMatchObject({ content: "ok-2", model: "m2", provider: "mock" });
    expect(router.disableModel).toHaveBeenCalledWith("m1", failure, { reason: "auth" });
    expect(router.markUnhealthy).not.toHaveBeenCalled();
    expect(limiter.blockFor).toHaveBeenCalledWith(1200);
    expect(performanceRouter.recordResult).toHaveBeenCalledWith(
      "m1",
      expect.objectContaining({ success: false, error: expect.any(String) })
    );

    const unhealthyEvents = findEvents(router.emit, "model:unhealthy");
    expect(unhealthyEvents).toHaveLength(1);
    expect(unhealthyEvents[0].error.message).toContain("[REDACTED]");
    expect(unhealthyEvents[0].error.message).not.toContain("sk-1234567890123456");
    expect(unhealthyEvents[0].error.message.length).toBeLessThanOrEqual(500);
    expect(unhealthyEvents[0].error.message.endsWith("...")).toBe(true);

    const failoverEvents = findEvents(router.emit, "model:failover");
    expect(failoverEvents[0]).toMatchObject({ fromModelId: "m1", toModelId: "m2" });
  });

  it("waits and retries after cooldown when waitRetryCount is negative", async () => {
    const time = createFakeTime(0);
    const { router } = createRouter({
      time,
      models: [{ id: "m1", provider: "mock", tags: ["text"] }],
      providers: {},
      isAvailable: () => false,
      shortestCooldown: { modelId: "m1", remainingMs: 8 },
      callResult: { content: "retry-ok", model: "m1", provider: "mock" },
    });
    const sleepSpy = vi.spyOn(time, "sleep");

    const result = await callWithPerformanceRouting({
      router,
      usage: "cooldown",
      messages: [],
      images: [],
      requiredTags: new Set(),
      orderedCandidates: ["m1"],
      taskComplexity: "low",
      waitRetryCount: -1,
    });

    expect(result.content).toBe("retry-ok");
    expect(sleepSpy).toHaveBeenCalledTimes(1);
    expect(router.call).toHaveBeenCalledWith(
      expect.objectContaining({ usage: "cooldown", _waitRetryCount: 0 })
    );
  });

  it("waits and retries with string waitRetryCount and whitespace usage", async () => {
    const time = createFakeTime(0);
    const { router } = createRouter({
      time,
      models: [{ id: "m1", provider: "mock", tags: ["text"] }],
      providers: {},
      isAvailable: () => false,
      shortestCooldown: { modelId: "m1", remainingMs: 9 },
      callResult: { content: "retry-ok", model: "m1", provider: "mock" },
    });

    const result = await callWithPerformanceRouting({
      router,
      usage: "   ",
      messages: [],
      images: [],
      requiredTags: new Set(),
      orderedCandidates: ["m1"],
      taskComplexity: "low",
      waitRetryCount: "0",
    });

    expect(result.content).toBe("retry-ok");
    expect(router.call).toHaveBeenCalledWith(
      expect.objectContaining({ usage: "   ", _waitRetryCount: "01" })
    );
  });

  it("throws for unknown model id", async () => {
    const { router } = createRouter({
      models: [],
      providers: {},
    });

    await expect(
      callWithPerformanceRouting({
        router,
        usage: "u",
        messages: [],
        images: [],
        requiredTags: new Set(),
        orderedCandidates: ["missing"],
        taskComplexity: "low",
        waitRetryCount: 0,
      })
    ).rejects.toThrow("Unknown model id: missing");
  });

  it("supports concurrent calls with empty-object messages", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [{ content: "a" }, { content: "b" }],
      },
    });

    const { router } = createRouter({
      time,
      models: [{ id: "m1", provider: "mock", tags: ["text"] }],
      providers: { mock: provider },
    });

    const callInput = {
      router,
      usage: "u",
      messages: {},
      images: [],
      requiredTags: new Set(),
      orderedCandidates: ["m1"],
      taskComplexity: "low",
      waitRetryCount: 0,
    };

    const [first, second] = await Promise.all([
      callWithPerformanceRouting(callInput),
      callWithPerformanceRouting(callInput),
    ]);

    const contents = [first.content, second.content].sort();
    expect(contents).toEqual(["a", "b"]);
    expect(provider.chat).toHaveBeenCalledTimes(2);
  });

  it("throws when orderedCandidates is not iterable", async () => {
    const { router } = createRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"] }],
      providers: {},
    });

    await expect(
      callWithPerformanceRouting({
        router,
        usage: "u",
        messages: [],
        images: [],
        requiredTags: new Set(),
        orderedCandidates: {},
        taskComplexity: "low",
        waitRetryCount: 0,
      })
    ).rejects.toThrow(TypeError);
  });
});

describe("callWithStandardRouting", () => {
  it("returns response with large payloads and nested messages", async () => {
    const time = createFakeTime(0);
    const deep = makeDeepNested(25);
    const huge = "x".repeat(120000);
    const messages = [{ role: "user", content: huge, meta: deep }];
    const images = [{ bytes: huge.slice(0, 1024), meta: deep }];

    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [{ content: "ok", usage: { prompt_tokens: 11, completion_tokens: 13 } }],
      },
    });

    const { router, performanceRouter } = createRouter({
      time,
      models: [{ id: "m1", provider: "mock", tags: ["text"] }],
      providers: { mock: provider },
    });

    const result = await callWithStandardRouting({
      router,
      usage: "worker",
      messages,
      images,
      requiredTags: new Set(),
      orderedCandidates: ["m1"],
      waitRetryCount: 0,
    });

    expect(result).toMatchObject({ content: "ok", model: "m1", provider: "mock" });
    expect(provider.chat).toHaveBeenCalledWith({ model: "m1", messages, images });
    expect(tokenTrackerRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "m1",
        provider: "mock",
        usage: "worker",
        promptTokens: 11,
        completionTokens: 13,
        success: true,
      })
    );
    expect(performanceRouter.recordResult).toHaveBeenCalledWith("m1", expect.objectContaining({ success: true }));
  });

  it("handles failure with failover and markUnhealthy", async () => {
    const time = createFakeTime(0);
    const failure = new Error("burst");
    failure.retryAfterMs = 2500;

    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [{ throw: failure }],
        m2: [{ content: "ok-2" }],
      },
    });

    const limiter = {
      schedule: vi.fn(async (fn) => fn()),
      blockFor: vi.fn(),
    };

    const { router } = createRouter({
      time,
      models: [
        { id: "m1", provider: "mock", tags: ["text"] },
        { id: "m2", provider: "mock", tags: ["text"] },
      ],
      providers: { mock: provider },
      rateLimiter: limiter,
    });

    const result = await callWithStandardRouting({
      router,
      usage: "worker",
      messages: [],
      images: [],
      requiredTags: new Set(),
      orderedCandidates: ["m1", "m2"],
      waitRetryCount: 0,
    });

    expect(result).toMatchObject({ content: "ok-2", model: "m2", provider: "mock" });
    expect(router.markUnhealthy).toHaveBeenCalledWith("m1", failure);
    expect(router.disableModel).not.toHaveBeenCalled();
    expect(limiter.blockFor).toHaveBeenCalledWith(2500);

    const unhealthyEvents = findEvents(router.emit, "model:unhealthy");
    expect(unhealthyEvents).toHaveLength(1);
    expect(unhealthyEvents[0].modelId).toBe("m1");

    const failoverEvents = findEvents(router.emit, "model:failover");
    expect(failoverEvents[0]).toMatchObject({ fromModelId: "m1", toModelId: "m2" });
  });

  it("waits and retries after cooldown when waitRetryCount is zero", async () => {
    const time = createFakeTime(0);
    const { router } = createRouter({
      time,
      models: [{ id: "m1", provider: "mock", tags: ["text"] }],
      providers: {},
      isAvailable: () => false,
      shortestCooldown: { modelId: "m1", remainingMs: 12 },
      callResult: { content: "retry-ok", model: "m1", provider: "mock" },
    });
    const sleepSpy = vi.spyOn(time, "sleep");

    const result = await callWithStandardRouting({
      router,
      usage: "cooldown",
      messages: [],
      images: [],
      requiredTags: new Set(),
      orderedCandidates: ["m1"],
      waitRetryCount: 0,
    });

    expect(result.content).toBe("retry-ok");
    expect(sleepSpy).toHaveBeenCalledTimes(1);
    expect(router.call).toHaveBeenCalledWith(
      expect.objectContaining({ usage: "cooldown", _waitRetryCount: 1 })
    );
  });

  it("throws when orderedCandidates is empty and usage is empty string", async () => {
    const { router } = createRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"] }],
      providers: {},
    });

    await expect(
      callWithStandardRouting({
        router,
        usage: "",
        messages: [],
        images: [],
        requiredTags: new Set(),
        orderedCandidates: [],
        waitRetryCount: 0,
      })
    ).rejects.toThrow("All models failed for usage: ");
  });

  it("does not wait when waitRetryCount is MAX_SAFE_INTEGER", async () => {
    const time = createFakeTime(0);
    const { router } = createRouter({
      time,
      models: [{ id: "m1", provider: "mock", tags: ["text"] }],
      providers: {},
      isAvailable: () => false,
      shortestCooldown: { modelId: "m1", remainingMs: 15 },
    });

    await expect(
      callWithStandardRouting({
        router,
        usage: "cooldown",
        messages: [],
        images: [],
        requiredTags: new Set(),
        orderedCandidates: ["m1"],
        waitRetryCount: Number.MAX_SAFE_INTEGER,
      })
    ).rejects.toThrow("All models failed for usage: cooldown");
    expect(router.call).not.toHaveBeenCalled();
  });

  it("supports rapid consecutive calls", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [{ content: "first" }, { content: "second" }],
      },
    });

    const { router } = createRouter({
      time,
      models: [{ id: "m1", provider: "mock", tags: ["text"] }],
      providers: { mock: provider },
    });

    const first = await callWithStandardRouting({
      router,
      usage: "worker",
      messages: [],
      images: [],
      requiredTags: new Set(),
      orderedCandidates: ["m1"],
      waitRetryCount: 0,
    });

    const second = await callWithStandardRouting({
      router,
      usage: "worker",
      messages: [],
      images: [],
      requiredTags: new Set(),
      orderedCandidates: ["m1"],
      waitRetryCount: 0,
    });

    expect(first.content).toBe("first");
    expect(second.content).toBe("second");
    expect(provider.chat).toHaveBeenCalledTimes(2);
  });
});
