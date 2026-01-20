/**
 * @file tests/unit/agents/llm/index.test.js
 * @description js/agents/llm/index.js re-export tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const makeFn = (name) => vi.fn((...args) => ({ name, args }));
  const makeClass = (name, setupInstance, shouldThrow) => {
    const instances = [];
    class MockClass {
      constructor(...args) {
        const shouldThrowNow = shouldThrow ? shouldThrow(args) : args[0] === "__throw__";
        if (shouldThrowNow) {
          throw new Error(`${name} ctor error`);
        }
        this.args = args;
        if (setupInstance) {
          setupInstance(this, args);
        }
        instances.push(this);
      }
    }
    Object.defineProperty(MockClass, "name", { value: name });
    return { MockClass, instances };
  };
  const makeConst = (label) => Object.freeze({ __tag: label });

  const MODEL_TAGS = Object.freeze(["text", "vision", "fast"]);

  const normalizeModelTags = makeFn("normalizeModelTags");
  const assertModelEntry = makeFn("assertModelEntry");
  const assertUsageConfig = makeFn("assertUsageConfig");
  const assertChatMessages = makeFn("assertChatMessages");
  const assertChatResponse = makeFn("assertChatResponse");
  const assertProvider = makeFn("assertProvider");

  const ModelUsage = makeConst("ModelUsage");
  const RouterStrategy = makeConst("RouterStrategy");
  const isValidModelUsage = makeFn("isValidModelUsage");
  const normalizeRouterStrategy = makeFn("normalizeRouterStrategy");

  const ModelRouter = makeClass(
    "ModelRouter",
    (instance) => {
      instance.call = vi.fn(async (payload) => ({ name: "ModelRouter.call", payload }));
    },
    (args) => args[0] === "__throw__" || args[0]?.models === "__throw__"
  );

  const TokenBucketRateLimiter = makeClass("TokenBucketRateLimiter", (instance) => {
    instance.schedule = vi.fn(async (fn) => fn());
  });

  const parseContextOverflowError = makeFn("parseContextOverflowError");
  const computeOverflowRetryMaxTokens = makeFn("computeOverflowRetryMaxTokens");
  const executeWithOverflowRecovery = makeFn("executeWithOverflowRecovery");

  const ModelEventEmitter = makeClass("ModelEventEmitter", (instance) => {
    instance.listeners = new Map();
    instance.on = vi.fn((event, handler) => {
      instance.listeners.set(event, handler);
    });
    instance.emit = vi.fn((event, payload) => {
      const handler = instance.listeners.get(event);
      if (handler) {
        handler(payload);
      }
    });
  });

  const createImageProvider = makeFn("createImageProvider");
  const createWhisperProvider = makeFn("createWhisperProvider");

  const MockProvider = makeClass("MockProvider", (instance) => {
    instance.chat = vi.fn(async (input) => ({ name: "MockProvider.chat", input }));
  });

  const getPptModelConfig = makeFn("getPptModelConfig");
  const getPptModelTags = makeFn("getPptModelTags");
  const getPptRolePriority = makeFn("getPptRolePriority");
  const getPptAudioConfig = makeFn("getPptAudioConfig");
  const buildPptUsageConfigForModelRouter = makeFn("buildPptUsageConfigForModelRouter");
  const createPptConfiguredChat = makeFn("createPptConfiguredChat");
  const createPptAwareAiApiService = makeFn("createPptAwareAiApiService");
  const getPptConfigSummary = makeFn("getPptConfigSummary");

  return {
    MODEL_TAGS,
    normalizeModelTags,
    assertModelEntry,
    assertUsageConfig,
    assertChatMessages,
    assertChatResponse,
    assertProvider,
    ModelUsage,
    RouterStrategy,
    isValidModelUsage,
    normalizeRouterStrategy,
    ModelRouter: ModelRouter.MockClass,
    ModelRouterInstances: ModelRouter.instances,
    TokenBucketRateLimiter: TokenBucketRateLimiter.MockClass,
    TokenBucketRateLimiterInstances: TokenBucketRateLimiter.instances,
    parseContextOverflowError,
    computeOverflowRetryMaxTokens,
    executeWithOverflowRecovery,
    ModelEventEmitter: ModelEventEmitter.MockClass,
    ModelEventEmitterInstances: ModelEventEmitter.instances,
    createImageProvider,
    createWhisperProvider,
    MockProvider: MockProvider.MockClass,
    MockProviderInstances: MockProvider.instances,
    getPptModelConfig,
    getPptModelTags,
    getPptRolePriority,
    getPptAudioConfig,
    buildPptUsageConfigForModelRouter,
    createPptConfiguredChat,
    createPptAwareAiApiService,
    getPptConfigSummary,
  };
});

vi.mock("../../../../js/agents/llm/provider.js", () => ({
  MODEL_TAGS: mocked.MODEL_TAGS,
  normalizeModelTags: mocked.normalizeModelTags,
  assertModelEntry: mocked.assertModelEntry,
  assertUsageConfig: mocked.assertUsageConfig,
  assertChatMessages: mocked.assertChatMessages,
  assertChatResponse: mocked.assertChatResponse,
  assertProvider: mocked.assertProvider,
}));

vi.mock("../../../../js/agents/llm/constants.js", () => ({
  ModelUsage: mocked.ModelUsage,
  RouterStrategy: mocked.RouterStrategy,
  isValidModelUsage: mocked.isValidModelUsage,
  normalizeRouterStrategy: mocked.normalizeRouterStrategy,
}));

vi.mock("../../../../js/agents/llm/model-router.js", () => ({
  ModelRouter: mocked.ModelRouter,
}));

vi.mock("../../../../js/agents/llm/rate-limit.js", () => ({
  TokenBucketRateLimiter: mocked.TokenBucketRateLimiter,
}));

vi.mock("../../../../js/agents/llm/overflow-recovery.js", () => ({
  parseContextOverflowError: mocked.parseContextOverflowError,
  computeOverflowRetryMaxTokens: mocked.computeOverflowRetryMaxTokens,
  executeWithOverflowRecovery: mocked.executeWithOverflowRecovery,
}));

vi.mock("../../../../js/agents/llm/model-events.js", () => ({
  ModelEventEmitter: mocked.ModelEventEmitter,
}));

vi.mock("../../../../js/agents/llm/image-provider.js", () => ({
  createImageProvider: mocked.createImageProvider,
}));

vi.mock("../../../../js/agents/llm/whisper-provider.js", () => ({
  createWhisperProvider: mocked.createWhisperProvider,
}));

vi.mock("../../../../js/agents/llm/mock-provider.js", () => ({
  MockProvider: mocked.MockProvider,
}));

vi.mock("../../../../js/agents/llm/ppt-model-bridge.js", () => ({
  getPptModelConfig: mocked.getPptModelConfig,
  getPptModelTags: mocked.getPptModelTags,
  getPptRolePriority: mocked.getPptRolePriority,
  getPptAudioConfig: mocked.getPptAudioConfig,
  buildPptUsageConfigForModelRouter: mocked.buildPptUsageConfigForModelRouter,
  createPptConfiguredChat: mocked.createPptConfiguredChat,
  createPptAwareAiApiService: mocked.createPptAwareAiApiService,
  getPptConfigSummary: mocked.getPptConfigSummary,
}));

import {
  createProvider,
  MODEL_TAGS,
  normalizeModelTags,
  assertModelEntry,
  assertUsageConfig,
  assertChatMessages,
  assertChatResponse,
  assertProvider,
  ModelUsage,
  RouterStrategy,
  isValidModelUsage,
  normalizeRouterStrategy,
  ModelRouter,
  TokenBucketRateLimiter,
  parseContextOverflowError,
  computeOverflowRetryMaxTokens,
  executeWithOverflowRecovery,
  ModelEventEmitter,
  createImageProvider,
  createWhisperProvider,
  MockProvider,
  getPptModelConfig,
  getPptModelTags,
  getPptRolePriority,
  getPptAudioConfig,
  buildPptUsageConfigForModelRouter,
  createPptConfiguredChat,
  createPptAwareAiApiService,
  getPptConfigSummary,
} from "../../../../js/agents/llm/index.js";

const buildDeepObject = (depth) => {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i += 1) {
    current.next = { level: i };
    current = current.next;
  }
  return root;
};

const HUGE_STRING = "x".repeat(1024 * 1024);
const HUGE_ARRAY = Array.from({ length: 10000 }, (_, index) => index);
const DEEP_OBJECT = buildDeepObject(40);

const boundaryValues = [
  null,
  undefined,
  "",
  "   ",
  [],
  {},
  0,
  -1,
  Number.MAX_SAFE_INTEGER,
  "123",
  { 0: "a", length: 1 },
  HUGE_STRING,
  HUGE_ARRAY,
  DEEP_OBJECT,
];

const instanceCollections = [
  mocked.ModelRouterInstances,
  mocked.TokenBucketRateLimiterInstances,
  mocked.ModelEventEmitterInstances,
  mocked.MockProviderInstances,
];

beforeEach(() => {
  vi.clearAllMocks();
  for (const instances of instanceCollections) {
    instances.length = 0;
  }
});

const runFunctionExportTests = ({ name, fn, mock }) => {
  describe(name, () => {
    it("re-exports the function and returns its result for normal input", () => {
      const input = { tag: "normal" };
      expect(fn).toBe(mock);
      const result = fn(input, "extra");
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock).toHaveBeenCalledWith(input, "extra");
      expect(result).toEqual({ name, args: [input, "extra"] });
    });

    it("forwards boundary inputs and supports concurrent/rapid calls", async () => {
      const inputs = boundaryValues.map((value, index) => [value, { index }]);
      const results = await Promise.all(inputs.map((args) => Promise.resolve(fn(...args))));

      expect(mock).toHaveBeenCalledTimes(inputs.length);
      inputs.forEach((args, idx) => {
        expect(mock).toHaveBeenNthCalledWith(idx + 1, ...args);
        expect(results[idx]).toEqual({ name, args });
      });

      fn("rapid-1");
      fn("rapid-2");
      expect(mock).toHaveBeenCalledTimes(inputs.length + 2);
      expect(mock).toHaveBeenLastCalledWith("rapid-2");
    });

    it("propagates errors from dependencies", () => {
      const error = new Error(`${name} exploded`);
      mock.mockImplementationOnce(() => {
        throw error;
      });
      expect(() => fn("__throw__")).toThrow(error);
    });
  });
};

const runClassExportTests = ({ name, ClassCtor, mock, instances }) => {
  describe(name, () => {
    it("re-exports the class and constructs normally", () => {
      const options = { tag: "normal" };
      expect(ClassCtor).toBe(mock);
      const instance = new ClassCtor(options);
      expect(instance).toBeInstanceOf(ClassCtor);
      expect(instances).toHaveLength(1);
      expect(instances[0]).toBe(instance);
      expect(instances[0].args).toEqual([options]);
    });

    it("accepts boundary inputs and supports rapid instantiation", async () => {
      const inputs = boundaryValues.map((value, index) => [value, { index }]);
      const created = await Promise.all(inputs.map((args) => Promise.resolve(new ClassCtor(...args))));

      expect(instances).toHaveLength(inputs.length);
      created.forEach((instance, idx) => {
        expect(instance.args).toEqual(inputs[idx]);
      });

      const extra = new ClassCtor("rapid-1");
      const extraTwo = new ClassCtor("rapid-2");
      expect(instances).toHaveLength(inputs.length + 2);
      expect(instances[instances.length - 2]).toBe(extra);
      expect(instances[instances.length - 1]).toBe(extraTwo);
    });

    it("propagates constructor errors", () => {
      expect(() => new ClassCtor("__throw__")).toThrow(`${name} ctor error`);
    });
  });
};

const runConstantExportTests = ({ name, value, mock }) => {
  describe(name, () => {
    it("re-exports the constant reference", () => {
      expect(value).toBe(mock);
    });
  });
};

runConstantExportTests({ name: "MODEL_TAGS", value: MODEL_TAGS, mock: mocked.MODEL_TAGS });
runConstantExportTests({ name: "ModelUsage", value: ModelUsage, mock: mocked.ModelUsage });
runConstantExportTests({ name: "RouterStrategy", value: RouterStrategy, mock: mocked.RouterStrategy });

[
  { name: "normalizeModelTags", fn: normalizeModelTags, mock: mocked.normalizeModelTags },
  { name: "assertModelEntry", fn: assertModelEntry, mock: mocked.assertModelEntry },
  { name: "assertUsageConfig", fn: assertUsageConfig, mock: mocked.assertUsageConfig },
  { name: "assertChatMessages", fn: assertChatMessages, mock: mocked.assertChatMessages },
  { name: "assertChatResponse", fn: assertChatResponse, mock: mocked.assertChatResponse },
  { name: "assertProvider", fn: assertProvider, mock: mocked.assertProvider },
  { name: "isValidModelUsage", fn: isValidModelUsage, mock: mocked.isValidModelUsage },
  { name: "normalizeRouterStrategy", fn: normalizeRouterStrategy, mock: mocked.normalizeRouterStrategy },
  { name: "parseContextOverflowError", fn: parseContextOverflowError, mock: mocked.parseContextOverflowError },
  { name: "computeOverflowRetryMaxTokens", fn: computeOverflowRetryMaxTokens, mock: mocked.computeOverflowRetryMaxTokens },
  { name: "executeWithOverflowRecovery", fn: executeWithOverflowRecovery, mock: mocked.executeWithOverflowRecovery },
  { name: "createImageProvider", fn: createImageProvider, mock: mocked.createImageProvider },
  { name: "createWhisperProvider", fn: createWhisperProvider, mock: mocked.createWhisperProvider },
  { name: "getPptModelConfig", fn: getPptModelConfig, mock: mocked.getPptModelConfig },
  { name: "getPptModelTags", fn: getPptModelTags, mock: mocked.getPptModelTags },
  { name: "getPptRolePriority", fn: getPptRolePriority, mock: mocked.getPptRolePriority },
  { name: "getPptAudioConfig", fn: getPptAudioConfig, mock: mocked.getPptAudioConfig },
  {
    name: "buildPptUsageConfigForModelRouter",
    fn: buildPptUsageConfigForModelRouter,
    mock: mocked.buildPptUsageConfigForModelRouter,
  },
  { name: "createPptConfiguredChat", fn: createPptConfiguredChat, mock: mocked.createPptConfiguredChat },
  { name: "createPptAwareAiApiService", fn: createPptAwareAiApiService, mock: mocked.createPptAwareAiApiService },
  { name: "getPptConfigSummary", fn: getPptConfigSummary, mock: mocked.getPptConfigSummary },
].forEach(runFunctionExportTests);

[
  {
    name: "ModelRouter",
    ClassCtor: ModelRouter,
    mock: mocked.ModelRouter,
    instances: mocked.ModelRouterInstances,
  },
  {
    name: "TokenBucketRateLimiter",
    ClassCtor: TokenBucketRateLimiter,
    mock: mocked.TokenBucketRateLimiter,
    instances: mocked.TokenBucketRateLimiterInstances,
  },
  {
    name: "ModelEventEmitter",
    ClassCtor: ModelEventEmitter,
    mock: mocked.ModelEventEmitter,
    instances: mocked.ModelEventEmitterInstances,
  },
  {
    name: "MockProvider",
    ClassCtor: MockProvider,
    mock: mocked.MockProvider,
    instances: mocked.MockProviderInstances,
  },
].forEach(runClassExportTests);

describe("createProvider", () => {
  it("creates a router-backed chat function", async () => {
    const models = [{ id: "m1" }];
    const providers = { mock: { id: "mock" } };
    const provider = await createProvider({ models, providers });

    expect(mocked.ModelRouterInstances).toHaveLength(1);
    const routerInstance = mocked.ModelRouterInstances[0];
    expect(routerInstance.args[0]).toEqual({ models, providers });

    const messages = [{ role: "user", content: "hi" }];
    const options = { usage: "worker", temperature: 0.1 };
    const result = await provider.chat(messages, options);

    expect(routerInstance.call).toHaveBeenCalledTimes(1);
    expect(routerInstance.call).toHaveBeenCalledWith({ messages, usage: "worker", temperature: 0.1 });
    expect(result).toEqual({
      name: "ModelRouter.call",
      payload: { messages, usage: "worker", temperature: 0.1 },
    });
  });

  it("handles boundary configs/messages/options with concurrent calls", async () => {
    const provider = await createProvider({});
    const routerInstance = mocked.ModelRouterInstances[0];
    expect(routerInstance.args[0]).toEqual({ models: [], providers: undefined });

    const calls = boundaryValues.map((value, index) => {
      const options = {
        index,
        usage: boundaryValues[(index + 1) % boundaryValues.length],
        extra: boundaryValues[boundaryValues.length - 1 - index],
      };
      return provider.chat(value, options);
    });

    const results = await Promise.all(calls);

    expect(routerInstance.call).toHaveBeenCalledTimes(boundaryValues.length);
    boundaryValues.forEach((value, index) => {
      const options = {
        index,
        usage: boundaryValues[(index + 1) % boundaryValues.length],
        extra: boundaryValues[boundaryValues.length - 1 - index],
      };
      expect(routerInstance.call).toHaveBeenNthCalledWith(index + 1, { messages: value, ...options });
      expect(results[index]).toEqual({
        name: "ModelRouter.call",
        payload: { messages: value, ...options },
      });
    });

    await provider.chat("rapid-1", { usage: "fast" });
    await provider.chat("rapid-2", { usage: "fast" });
    expect(routerInstance.call).toHaveBeenCalledTimes(boundaryValues.length + 2);
    expect(routerInstance.call).toHaveBeenLastCalledWith({ messages: "rapid-2", usage: "fast" });
  });

  it("propagates constructor and call errors", async () => {
    await expect(createProvider({ models: "__throw__" })).rejects.toThrow("ModelRouter ctor error");

    const provider = await createProvider({});
    const routerInstance = mocked.ModelRouterInstances[0];
    const error = new Error("call failed");
    routerInstance.call.mockRejectedValueOnce(error);

    await expect(provider.chat(["hi"])).rejects.toThrow(error);
  });
});
