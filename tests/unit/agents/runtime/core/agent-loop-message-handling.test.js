import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  messageManagerCtor: vi.fn(),
  messageManagerInstances: [],
  getLimit: vi.fn(),
  dequeInstances: [],
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  Deque: class DequeMock {
    constructor() {
      this._items = [];
      mockState.dequeInstances.push(this);
    }
    push(item) {
      this._items.push(item);
    }
    shift() {
      return this._items.shift();
    }
    toArray() {
      return [...this._items];
    }
    clear() {
      this._items.length = 0;
    }
    get size() {
      return this._items.length;
    }
  },
}));

vi.mock("../../../../../js/agents/runtime/core/constants/limits.js", () => ({
  getLimit: mockState.getLimit,
}));

vi.mock("../../../../../js/agents/runtime/core/message-manager.js", () => {
  class MessageManagerMock {
    constructor(options) {
      mockState.messageManagerCtor(options);
      this._contextConfig = options?.contextConfig ?? null;
      this.messages = [];
      this._tokenUsage = { input: 0, output: 0, total: 0 };
      this._compressionHistory = [];
      this._compressionPromise = null;
      this._compressionPending = false;
      this.addMessage = vi.fn((message) => {
        this.messages.push(message);
        return message;
      });
      this.addMessages = vi.fn((messages) => {
        this.messages.push(...messages);
        return messages;
      });
      this.reset = vi.fn(async (opts) => opts);
      this._shouldCompress = vi.fn(() => false);
      this._scheduleCompression = vi.fn((opts) => opts);
      this.flushCompression = vi.fn(async (opts) => opts);
      this._compress = vi.fn(async () => undefined);
      this.getStatus = vi.fn(() => ({ ok: true }));
      this.setContextConfig = vi.fn((config) => {
        this._contextConfig = config;
        return config;
      });
      mockState.messageManagerInstances.push(this);
    }
  }
  return { MessageManager: MessageManagerMock };
});

import {
  initMessageHandling,
  attachMessageHandling,
} from "../../../../../js/agents/runtime/core/agent-loop-message-handling.js";

const createLoop = (options = {}) => {
  class BaseLoop {}
  attachMessageHandling(BaseLoop);
  const loop = new BaseLoop();
  initMessageHandling(loop, {
    stageName: options.stageName ?? "stage",
    actor: options.actor ?? "actor",
  });
  loop.stageName = options.stageName ?? "stage";
  loop.actor = options.actor ?? "actor";
  loop.emit = options.emit;
  loop.eventBus = options.eventBus;
  loop.pause = options.pause ?? vi.fn();
  return loop;
};

beforeEach(() => {
  mockState.messageManagerCtor.mockReset();
  mockState.getLimit.mockReset();
  mockState.messageManagerInstances.length = 0;
  mockState.dequeInstances.length = 0;
  mockState.getLimit.mockReturnValue(3);
});

describe("initMessageHandling", () => {
  it("initializes message manager and user input state", () => {
    const loop = {};
    const options = {
      contextConfig: { mode: "compact" },
      tokenCounter: { count: vi.fn() },
      logger: { info: vi.fn() },
      emit: vi.fn(),
      stageName: "stage",
      actor: "actor",
      maxUserInputs: 5,
    };

    mockState.getLimit.mockReturnValue(7);
    initMessageHandling(loop, options);

    expect(mockState.messageManagerCtor).toHaveBeenCalledWith({
      contextConfig: options.contextConfig,
      tokenCounter: options.tokenCounter,
      logger: options.logger,
      emit: options.emit,
      stageName: "stage",
      actor: "actor",
    });
    expect(mockState.getLimit).toHaveBeenCalledWith("MAX_USER_INPUTS", 5);
    expect(mockState.messageManagerInstances).toContain(loop._messageManager);
    expect(mockState.dequeInstances).toContain(loop._userInputs);
    expect(loop._maxUserInputs).toBe(7);
    expect(loop._userInputUnsub).toBe(null);
    expect(loop._userInputBus).toBe(null);
    expect(loop._userInputEvent).toBe("user.input");
    expect(loop._pauseListenerUnsub).toBe(null);
  });

  it("passes boundary maxUserInputs values to getLimit", () => {
    const values = [0, -1, Number.MAX_SAFE_INTEGER, "5", undefined];
    for (const value of values) {
      const loop = {};
      initMessageHandling(loop, { stageName: "", actor: "", maxUserInputs: value });
      expect(mockState.getLimit).toHaveBeenLastCalledWith("MAX_USER_INPUTS", value);
    }
  });

  it("handles undefined options without throwing", () => {
    const loop = {};
    expect(() => initMessageHandling(loop)).not.toThrow();
    expect(mockState.getLimit).toHaveBeenCalledWith("MAX_USER_INPUTS", undefined);
  });

  it("throws when loop or options are invalid", () => {
    expect(() => initMessageHandling(null, {})).toThrow();
    expect(() => initMessageHandling({}, null)).toThrow();
  });
});

describe("attachMessageHandling", () => {
  it("adds message handling methods to base prototype", () => {
    class BaseLoop {}
    attachMessageHandling(BaseLoop);
    const instance = new BaseLoop();

    expect(typeof instance.addMessage).toBe("function");
    expect(typeof instance.addMessages).toBe("function");
    expect(typeof instance.resetMessages).toBe("function");
    expect(Object.getOwnPropertyDescriptor(BaseLoop.prototype, "messages").get).toBeTypeOf("function");
  });

  it("delegates message getters and setters to message manager", () => {
    const loop = createLoop();
    const manager = loop._messageManager;

    manager.messages = [{ id: 1 }];
    manager._contextConfig = { window: 10 };
    manager._tokenUsage = { input: 1, output: 2, total: 3 };
    manager._compressionHistory = ["snapshot"];
    manager._compressionPromise = Promise.resolve();
    manager._compressionPending = true;

    expect(loop.messages).toBe(manager.messages);
    expect(loop._contextConfig).toBe(manager._contextConfig);
    loop._contextConfig = { window: 20 };
    expect(manager._contextConfig).toEqual({ window: 20 });
    expect(loop._tokenUsage).toBe(manager._tokenUsage);
    expect(loop._compressionHistory).toBe(manager._compressionHistory);
    expect(loop._compressionPromise).toBe(manager._compressionPromise);
    expect(loop._compressionPending).toBe(true);
  });

  it("delegates message manager methods", async () => {
    const loop = createLoop();
    const manager = loop._messageManager;

    const message = { role: "user", content: "hello" };
    expect(loop.addMessage(message)).toBe(message);
    expect(manager.addMessage).toHaveBeenCalledWith(message);

    const messages = [{ role: "user", content: "a" }, { role: "assistant", content: "b" }];
    expect(loop.addMessages(messages)).toBe(messages);
    expect(manager.addMessages).toHaveBeenCalledWith(messages);

    const resetResult = await loop.resetMessages({ clearCompressionHistory: true });
    expect(manager.reset).toHaveBeenCalledWith({ clearCompressionHistory: true });
    expect(resetResult).toEqual({ clearCompressionHistory: true });

    manager._shouldCompress.mockReturnValue(true);
    expect(loop._shouldCompress()).toBe(true);

    const scheduleResult = loop._scheduleCompression({ force: true });
    expect(manager._scheduleCompression).toHaveBeenCalledWith({ force: true });
    expect(scheduleResult).toEqual({ force: true });

    const flushResult = await loop.flushCompression({ maxRounds: 2 });
    expect(manager.flushCompression).toHaveBeenCalledWith({ maxRounds: 2 });
    expect(flushResult).toEqual({ maxRounds: 2 });

    await loop._compressMessages();
    expect(manager._compress).toHaveBeenCalledTimes(1);

    expect(loop.getContextStatus()).toEqual({ ok: true });

    const config = { contextWindow: 100 };
    expect(loop.setContextConfig(config)).toBe(config);
    expect(manager.setContextConfig).toHaveBeenCalledWith(config);
  });

  it("ignores user input listener when event bus is missing", () => {
    const loop = createLoop();
    loop._attachUserInputListener(null);
    loop._attachUserInputListener({});
    expect(loop._userInputBus).toBe(null);
    expect(loop._userInputUnsub).toBe(null);
  });

  it("subscribes to user input events and records payloads", () => {
    const loop = createLoop();
    const eventBus = {
      subscribe: vi.fn(() => vi.fn()),
    };
    const recordSpy = vi.spyOn(loop, "recordUserInput").mockReturnValue({ payload: "ok", ts: 1 });

    const controller = new AbortController();
    loop._attachUserInputListener(eventBus, { eventName: "", signal: controller.signal });

    const [eventName, handler, options] = eventBus.subscribe.mock.calls[0];
    expect(eventName).toBe("user.input");
    expect(options).toEqual({ signal: controller.signal });

    handler({ payload: { text: "hello" } });
    handler("raw");

    expect(recordSpy).toHaveBeenCalledWith({ text: "hello" });
    expect(recordSpy).toHaveBeenCalledWith("raw");
  });

  it("does not resubscribe when bus and event are unchanged", () => {
    const loop = createLoop();
    const unsub = vi.fn();
    const eventBus = {
      subscribe: vi.fn(() => unsub),
    };

    loop._attachUserInputListener(eventBus, { eventName: "user.input" });
    loop._attachUserInputListener(eventBus, { eventName: "user.input" });

    expect(eventBus.subscribe).toHaveBeenCalledTimes(1);
    expect(unsub).not.toHaveBeenCalled();
  });

  it("unsubscribes and resubscribes when event changes", () => {
    const loop = createLoop();
    const unsub = vi.fn();
    const eventBus = {
      subscribe: vi.fn(() => unsub),
    };

    loop._attachUserInputListener(eventBus, { eventName: "user.input" });
    loop._attachUserInputListener(eventBus, { eventName: "user.input.next" });

    expect(unsub).toHaveBeenCalledTimes(1);
    expect(eventBus.subscribe).toHaveBeenCalledTimes(2);
  });

  it("attaches pause listener once and resolves reasons", () => {
    const loop = createLoop();
    const eventBus = {
      subscribe: vi.fn(() => vi.fn()),
    };

    loop._attachPauseListener(eventBus);
    loop._attachPauseListener(eventBus);

    expect(eventBus.subscribe).toHaveBeenCalledTimes(1);

    const handler = eventBus.subscribe.mock.calls[0][1];
    handler({ payload: { reason: "break" } });
    handler({ payload: { message: "stop" } });
    handler({ payload: 0 });
    handler({ payload: Number.MAX_SAFE_INTEGER });

    expect(loop.pause).toHaveBeenCalledWith("break");
    expect(loop.pause).toHaveBeenCalledWith("stop");
    expect(loop.pause).toHaveBeenCalledWith("user_requested");
  });

  it("detaches event bus listeners safely even if unsubscribe throws", () => {
    const loop = createLoop();
    loop._userInputUnsub = vi.fn(() => {
      throw new Error("fail");
    });
    loop._userInputBus = { subscribe: vi.fn() };
    loop._pauseListenerUnsub = vi.fn(() => {
      throw new Error("fail");
    });

    expect(() => loop._detachEventBusListeners()).not.toThrow();
    expect(loop._userInputUnsub).toBe(null);
    expect(loop._userInputBus).toBe(null);
    expect(loop._pauseListenerUnsub).toBe(null);
  });

  it("records inputs with timestamps and enforces max size", () => {
    const loop = createLoop({ emit: vi.fn() });
    loop._maxUserInputs = 2;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123);

    const first = loop.recordUserInput("one");
    const second = loop.recordUserInput("two");
    const third = loop.recordUserInput("three");

    expect(first.ts).toBe(123);
    expect(second.ts).toBe(123);
    expect(third.ts).toBe(123);
    expect(loop._userInputs.size).toBe(2);
    expect(loop._userInputs.toArray()[0].payload).toBe("two");
    expect(loop.emit).toHaveBeenCalledWith("stage.user.input", {
      actor: "actor",
      status: "info",
      payload: third,
    });

    nowSpy.mockRestore();
  });

  it("falls back to eventBus.emit when emit is not a function", () => {
    const eventBus = { emit: vi.fn() };
    const loop = createLoop({ eventBus, emit: null });

    loop.recordUserInput({ text: "hello" });

    expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });

  it("does not trim when maxUserInputs is non-positive or non-numeric", () => {
    const loop = createLoop();

    loop._maxUserInputs = 0;
    loop.recordUserInput("a");
    loop.recordUserInput("b");
    expect(loop._userInputs.size).toBe(2);

    loop._maxUserInputs = -1;
    loop.recordUserInput("c");
    expect(loop._userInputs.size).toBe(3);

    loop._maxUserInputs = "2";
    loop.recordUserInput("d");
    expect(loop._userInputs.size).toBe(4);
  });

  it("handles rapid successive inputs while honoring the limit", async () => {
    const loop = createLoop();
    loop._maxUserInputs = 3;

    const payloads = ["a", "b", "c", "d"];
    await Promise.all(payloads.map((payload) => Promise.resolve(loop.recordUserInput(payload))));

    expect(loop._userInputs.size).toBe(3);
    expect(loop._userInputs.toArray().map((entry) => entry.payload)).toEqual(["b", "c", "d"]);
  });

  it("consumes user inputs and clears by default", () => {
    const loop = createLoop();
    loop.recordUserInput("first");
    loop.recordUserInput("second");

    const items = loop.consumeUserInputs();
    expect(items).toHaveLength(2);
    expect(loop._userInputs.size).toBe(0);
  });

  it("consumes user inputs without clearing when requested", () => {
    const loop = createLoop();
    loop.recordUserInput("third");

    const items = loop.consumeUserInputs({ clear: false });
    expect(items).toHaveLength(1);
    expect(loop._userInputs.size).toBe(1);
  });

  it("returns empty list when consuming with no inputs", () => {
    const loop = createLoop();
    expect(loop.consumeUserInputs()).toEqual([]);
  });

  it("drains user inputs as text and respects clear option", () => {
    const loop = createLoop();
    loop.recordUserInput("  hello  ");
    loop.recordUserInput({ text: "world" });

    const result = loop.drainUserInputsAsText();
    expect(result.items).toHaveLength(2);
    expect(result.text).toBe("hello\nworld");
    expect(loop._userInputs.size).toBe(0);

    loop.recordUserInput("again");
    const resultNoClear = loop.drainUserInputsAsText({ clear: false });
    expect(resultNoClear.text).toBe("again");
    expect(loop._userInputs.size).toBe(1);
  });

  it("applies user inputs to config with default key", () => {
    const loop = createLoop();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(456);

    loop.recordUserInput({ message: "note" });
    const result = loop.applyUserInputsToConfig({ userNotes: "prior" });

    expect(result.userNotes).toEqual(["prior", "note"]);
    expect(result._lastUserNote).toBe("note");
    expect(result._lastUserNoteAt).toBe(456);
    expect(result._rawUserInputs).toHaveLength(1);

    nowSpy.mockRestore();
  });

  it("returns original config when there is no new user input", () => {
    const loop = createLoop();
    const config = { a: 1 };
    const result = loop.applyUserInputsToConfig(config);
    expect(result).toBe(config);
  });

  it("applies inputs to custom key and handles non-array existing values", () => {
    const loop = createLoop();
    const largeText = "x".repeat(100000);
    loop.recordUserInput(largeText);

    const result = loop.applyUserInputsToConfig({ notes: { invalid: true } }, { key: "notes" });

    expect(result.notes).toEqual([largeText]);
    expect(result._rawUserInputs).toHaveLength(1);
  });

  it("creates a new config when userConfig is not an object", () => {
    const loop = createLoop();
    loop.recordUserInput({ text: "note" });

    const result = loop.applyUserInputsToConfig("invalid");

    expect(result.userNotes).toEqual(["note"]);
  });

  it("applies deep nested inputs and clears the queue", () => {
    const loop = createLoop();
    loop.recordUserInput({ a: { b: { c: { d: 1 } } } });

    const result = loop.applyUserInputsToConfig(null);
    expect(result.userNotes[0]).toContain("\"d\":1");
    expect(loop._userInputs.size).toBe(0);
  });

  it("reports pending user inputs correctly", () => {
    const loop = createLoop();
    expect(loop.hasPendingUserInputs()).toBe(false);

    loop.recordUserInput("one");
    expect(loop.hasPendingUserInputs()).toBe(true);

    loop._userInputs = null;
    expect(loop.hasPendingUserInputs()).toBe(null);
  });

  it("formats user inputs with trimming, selection, and JSON fallback", () => {
    const loop = createLoop();
    const circular = {};
    circular.self = circular;

    const items = [
      { payload: "  hello " },
      { payload: "" },
      { payload: { text: " world " } },
      { payload: { message: " ok " } },
      { payload: 0 },
      { payload: -1 },
      { payload: Number.MAX_SAFE_INTEGER },
      { payload: { nested: { deep: { value: 1 } } } },
      { payload: circular },
      { payload: "   " },
      null,
      undefined,
    ];

    const result = loop.formatUserInputs(items);
    const lines = result.split("\n");

    expect(lines).toContain("hello");
    expect(lines).toContain("world");
    expect(lines).toContain("ok");
    expect(lines).toContain("0");
    expect(lines).toContain("-1");
    expect(lines).toContain(String(Number.MAX_SAFE_INTEGER));
    expect(lines.some((line) => line.includes("\"nested\""))).toBe(true);
    expect(lines).toContain("[object Object]");
    expect(lines).not.toContain("");
  });

  it("returns empty string for non-array or empty inputs", () => {
    const loop = createLoop();
    expect(loop.formatUserInputs({})).toBe("");
    expect(loop.formatUserInputs([])).toBe("");
  });
});
