import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", () => {
  return {
    Deque: vi.fn(),
  };
});

vi.mock("../../../../../js/agents/runtime/core/message-manager.js", () => {
  return {
    MessageManager: vi.fn(),
  };
});

vi.mock("../../../../../js/agents/runtime/core/constants/limits.js", () => {
  return {
    getLimit: vi.fn(),
  };
});

import { MessageHandling } from "../../../../../js/agents/runtime/core/agent-loop-message-handling.js";
import { Deque } from "../../../../../js/agents/shared/index.js";
import { MessageManager } from "../../../../../js/agents/runtime/core/message-manager.js";
import { getLimit } from "../../../../../js/agents/runtime/core/constants/limits.js";

function setDefaultMockImplementations() {
  vi.mocked(Deque).mockImplementation(function DequeCtor() {
    this._items = [];
  });

  vi.mocked(MessageManager).mockImplementation(function MessageManagerCtor(opts) {
    this.opts = opts;
    // Minimal surface area for MessageHandling delegation tests.
    this.messages = [];
    this._contextConfig = opts?.contextConfig ?? null;
    this._tokenUsage = { input: 0, output: 0, total: 0 };
    this._compressionHistory = [];
    this._compressionPromise = null;
    this._compressionPending = false;
    this.addMessage = vi.fn();
    this.addMessages = vi.fn();
    this.reset = vi.fn();
    this._shouldCompress = vi.fn();
    this._scheduleCompression = vi.fn();
    this.flushCompression = vi.fn();
    this._compress = vi.fn();
    this.getStatus = vi.fn();
    this.setContextConfig = vi.fn();
  });

  vi.mocked(getLimit).mockImplementation((_, override) => override);
}

describe("MessageHandling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMockImplementations();
  });

  it("initializes message manager and user input state (happy path)", () => {
    const loop = {};
    const contextConfig = { role: "system", config: { a: 1 } };
    const tokenCounter = { count: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const emit = vi.fn();
    const stageName = "stage:main";
    const actor = "agent:alpha";
    const maxUserInputs = 7;

    const limitSentinel = 1234;
    vi.mocked(getLimit).mockReturnValueOnce(limitSentinel);

    new MessageHandling(loop, { contextConfig, tokenCounter, logger, emit, stageName, actor, maxUserInputs });

    expect(MessageManager).toHaveBeenCalledTimes(1);
    expect(MessageManager).toHaveBeenCalledWith({
      contextConfig,
      tokenCounter,
      logger,
      emit,
      stageName,
      actor,
    });

    expect(Deque).toHaveBeenCalledTimes(1);
    expect(getLimit).toHaveBeenCalledTimes(1);
    expect(getLimit).toHaveBeenCalledWith("MAX_USER_INPUTS", maxUserInputs);

    const managerInstance = vi.mocked(MessageManager).mock.instances[0];
    const dequeInstance = vi.mocked(Deque).mock.instances[0];

    expect(loop._messageManager).toBe(managerInstance);
    expect(loop._userInputs).toBe(dequeInstance);
    expect(loop._maxUserInputs).toBe(limitSentinel);

    expect(loop._userInputUnsub).toBeNull();
    expect(loop._userInputBus).toBeNull();
    expect(loop._userInputEvent).toBe("user.input");
    expect(loop._pauseListenerUnsub).toBeNull();
  });

  it("uses default options when second argument is omitted", () => {
    const loop = {};
    const limitSentinel = 99;
    vi.mocked(getLimit).mockReturnValueOnce(limitSentinel);

    new MessageHandling(loop);

    expect(MessageManager).toHaveBeenCalledTimes(1);
    expect(MessageManager).toHaveBeenCalledWith({
      contextConfig: undefined,
      tokenCounter: undefined,
      logger: undefined,
      emit: undefined,
      stageName: undefined,
      actor: undefined,
    });
    expect(getLimit).toHaveBeenCalledWith("MAX_USER_INPUTS", undefined);

    expect(loop._maxUserInputs).toBe(limitSentinel);
    expect(loop._userInputEvent).toBe("user.input");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["0", 0],
    ["-1", -1],
    ["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
    ["empty string", ""],
    ["whitespace string", "   "],
    ["numeric string", "123"],
    ["empty array", []],
    ["empty object", {}],
    ["object (non-array)", { n: 1 }],
  ])("passes maxUserInputs=%s through getLimit and stores its result", (_label, value) => {
    const loop = {};
    const sentinel = Symbol(String(_label));
    vi.mocked(getLimit).mockReturnValueOnce(sentinel);

    new MessageHandling(loop, { stageName: "s", actor: "a", maxUserInputs: value });

    expect(getLimit).toHaveBeenCalledWith("MAX_USER_INPUTS", value);
    expect(loop._maxUserInputs).toBe(sentinel);
  });

  it.each([
    ["string options", "not-an-object"],
    ["number options", 123],
    ["boolean options", true],
  ])("accepts coercible non-object options (%s) without throwing", (_label, options) => {
    const loop = {};
    vi.mocked(getLimit).mockReturnValueOnce("limit");

    expect(() => new MessageHandling(loop, options)).not.toThrow();
    expect(MessageManager).toHaveBeenCalledTimes(1);
    expect(getLimit).toHaveBeenCalledWith("MAX_USER_INPUTS", undefined);
    expect(loop._userInputEvent).toBe("user.input");
  });

  it("handles long strings and deep/nested contextConfig without mutation", () => {
    const loop = {};
    const stageName = "s".repeat(50_000);
    const actor = " \n\t".repeat(10_000);
    const contextConfig = Object.freeze({
      deep: Object.freeze({
        level1: Object.freeze({
          level2: Object.freeze({
            payload: "x".repeat(100_000),
            arr: Object.freeze(["a", "b", "c"]),
          }),
        }),
      }),
    });

    const limitSentinel = 0;
    vi.mocked(getLimit).mockReturnValueOnce(limitSentinel);

    expect(() =>
      new MessageHandling(loop, {
        contextConfig,
        stageName,
        actor,
        maxUserInputs: 0,
        emit: null,
        logger: undefined,
        tokenCounter: undefined,
      })
    ).not.toThrow();

    expect(MessageManager).toHaveBeenCalledWith(
      expect.objectContaining({
        contextConfig,
        stageName,
        actor,
        emit: null,
      })
    );
    expect(loop._maxUserInputs).toBe(limitSentinel);
  });

  it("overwrites previous state on rapid re-initialization", () => {
    const loop = {
      _messageManager: { stale: true },
      _userInputs: { stale: true },
      _maxUserInputs: 999,
      _userInputUnsub: () => {},
      _userInputBus: { bus: true },
      _userInputEvent: "custom.event",
      _pauseListenerUnsub: () => {},
    };

    vi.mocked(getLimit).mockReturnValueOnce(1);
    new MessageHandling(loop, { stageName: "s1", actor: "a1", maxUserInputs: 1 });

    const firstMgr = loop._messageManager;
    const firstDeque = loop._userInputs;

    // Corrupt the fields to ensure re-init always resets them.
    loop._userInputUnsub = () => {};
    loop._userInputBus = { bus2: true };
    loop._userInputEvent = "other.event";
    loop._pauseListenerUnsub = () => {};
    loop._maxUserInputs = 123;

    vi.mocked(getLimit).mockReturnValueOnce(2);
    new MessageHandling(loop, { stageName: "s2", actor: "a2", maxUserInputs: 2 });

    expect(loop._messageManager).not.toBe(firstMgr);
    expect(loop._userInputs).not.toBe(firstDeque);
    expect(loop._maxUserInputs).toBe(2);

    expect(loop._userInputUnsub).toBeNull();
    expect(loop._userInputBus).toBeNull();
    expect(loop._userInputEvent).toBe("user.input");
    expect(loop._pauseListenerUnsub).toBeNull();
  });

  it("can initialize multiple loops concurrently without shared state", async () => {
    const loopA = {};
    const loopB = {};

    const limitA = Symbol("A");
    const limitB = Symbol("B");
    vi.mocked(getLimit).mockImplementation((_, override) => (override === "A" ? limitA : limitB));

    await Promise.all([
      Promise.resolve().then(() => new MessageHandling(loopA, { stageName: "sA", actor: "aA", maxUserInputs: "A" })),
      Promise.resolve().then(() => new MessageHandling(loopB, { stageName: "sB", actor: "aB", maxUserInputs: "B" })),
    ]);

    expect(loopA._messageManager).toBeDefined();
    expect(loopB._messageManager).toBeDefined();
    expect(loopA._messageManager).not.toBe(loopB._messageManager);

    expect(loopA._userInputs).toBeDefined();
    expect(loopB._userInputs).toBeDefined();
    expect(loopA._userInputs).not.toBe(loopB._userInputs);

    expect(loopA._messageManager.opts.stageName).toBe("sA");
    expect(loopB._messageManager.opts.stageName).toBe("sB");

    expect(loopA._maxUserInputs).toBe(limitA);
    expect(loopB._maxUserInputs).toBe(limitB);
  });

  it("throws when loop is null or undefined (cannot assign properties)", () => {
    expect(() => new MessageHandling(null, { stageName: "s", actor: "a" })).toThrow(TypeError);
    expect(() => new MessageHandling(undefined, { stageName: "s", actor: "a" })).toThrow(TypeError);
  });

  it("throws when options is null (cannot destructure)", () => {
    expect(() => new MessageHandling({}, null)).toThrow(TypeError);
  });

  it("propagates errors from MessageManager constructor and does not proceed", () => {
    vi.mocked(MessageManager).mockImplementationOnce(() => {
      throw new Error("mm boom");
    });

    const loop = {};
    expect(() => new MessageHandling(loop, { stageName: "s", actor: "a" })).toThrow("mm boom");

    expect(Deque).not.toHaveBeenCalled();
    expect(getLimit).not.toHaveBeenCalled();
  });

  it("propagates errors from Deque constructor and does not call getLimit", () => {
    vi.mocked(Deque).mockImplementationOnce(() => {
      throw new Error("deque boom");
    });

    const loop = {};
    expect(() => new MessageHandling(loop, { stageName: "s", actor: "a" })).toThrow("deque boom");

    expect(MessageManager).toHaveBeenCalledTimes(1);
    expect(getLimit).not.toHaveBeenCalled();
  });

  it("propagates errors from getLimit (no silent swallowing)", () => {
    vi.mocked(getLimit).mockImplementationOnce(() => {
      throw new Error("limit boom");
    });

    const loop = {};
    expect(() => new MessageHandling(loop, { stageName: "s", actor: "a" })).toThrow("limit boom");

    expect(MessageManager).toHaveBeenCalledTimes(1);
    expect(Deque).toHaveBeenCalledTimes(1);
  });
});
