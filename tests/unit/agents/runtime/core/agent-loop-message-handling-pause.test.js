import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  Deque: vi.fn().mockImplementation(function DequeCtor() {
    this._items = [];
  }),
}));

vi.mock("../../../../../js/agents/runtime/core/message-manager.js", () => ({
  MessageManager: vi.fn().mockImplementation(function MessageManagerCtor() {
    this.messages = [];
    this._contextConfig = null;
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
  }),
}));

vi.mock("../../../../../js/agents/runtime/core/constants/limits.js", () => ({
  getLimit: vi.fn((_name, value) => value ?? 10),
}));

import { MessageHandling } from "../../../../../js/agents/runtime/core/agent-loop-message-handling.js";

describe("MessageHandling pause listener rebinding", () => {
  let loop;
  let handling;

  beforeEach(() => {
    loop = {
      statusController: {
        pause: vi.fn(),
      },
    };
    handling = new MessageHandling(loop);
  });

  it("rebinds pause listener when eventBus instance changes", () => {
    const unsubA = vi.fn();
    const unsubB = vi.fn();
    let handlerA = null;
    let handlerB = null;
    const busA = {
      subscribe: vi.fn((_event, handler) => {
        handlerA = handler;
        return unsubA;
      }),
    };
    const busB = {
      subscribe: vi.fn((_event, handler) => {
        handlerB = handler;
        return unsubB;
      }),
    };

    handling._attachPauseListener(busA);
    expect(busA.subscribe).toHaveBeenCalledTimes(1);
    handling._attachPauseListener(busB);

    expect(unsubA).toHaveBeenCalledTimes(1);
    expect(busB.subscribe).toHaveBeenCalledTimes(1);
    handlerB?.({ payload: { reason: "new-bus" } });
    expect(loop.statusController.pause).toHaveBeenCalledWith("new-bus");
    expect(handlerA).not.toBe(handlerB);
  });
});
