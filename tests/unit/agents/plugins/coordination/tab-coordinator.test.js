import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
  };
});

import { TabCoordinator } from "../../../../../js/agents/plugins/coordination/tab-coordinator.js";
import * as shared from "../../../../../js/agents/shared/index.js";

const originalBroadcastChannel = globalThis.BroadcastChannel;

const createMockBroadcastChannel = () => {
  const channels = new Map();
  const ctorSpy = vi.fn();

  class MockBroadcastChannel {
    constructor(name) {
      ctorSpy(name);
      this.name = name;
      this.sent = [];
      this._listeners = new Map();

      const set = channels.get(name) ?? new Set();
      set.add(this);
      channels.set(name, set);
    }

    addEventListener(type, handler) {
      const set = this._listeners.get(type) ?? new Set();
      set.add(handler);
      this._listeners.set(type, set);
    }

    removeEventListener(type, handler) {
      const set = this._listeners.get(type);
      if (set) set.delete(handler);
    }

    postMessage(message) {
      this.sent.push(message);
      const set = channels.get(this.name);
      if (!set) return;
      for (const instance of set) {
        instance._emit("message", { data: message });
      }
    }

    close() {
      const set = channels.get(this.name);
      if (set) {
        set.delete(this);
        if (!set.size) channels.delete(this.name);
      }
      this._listeners.clear();
    }

    _emit(type, event) {
      const set = this._listeners.get(type);
      if (!set) return;
      for (const handler of Array.from(set)) {
        handler(event);
      }
    }
  }

  return { MockBroadcastChannel, channels, ctorSpy };
};

const withFakeTimers = async (fn) => {
  vi.useFakeTimers();
  try {
    await fn();
  } finally {
    vi.useRealTimers();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  globalThis.BroadcastChannel = originalBroadcastChannel;
});

describe("TabCoordinator", () => {
  it("uses defaults for invalid options and empty values", () => {
    globalThis.BroadcastChannel = undefined;

    const coordinatorNull = new TabCoordinator(null);
    const coordinatorUndefined = new TabCoordinator(undefined);
    const coordinatorArray = new TabCoordinator([]);
    const coordinatorEmpty = new TabCoordinator({});
    const coordinatorInvalid = new TabCoordinator({
      channelName: "   ",
      heartbeatMs: 0,
      onEviction: "nope",
      onAccess: 123,
    });

    expect(coordinatorNull._channelName).toBe("agent-sessions");
    expect(coordinatorUndefined._channelName).toBe("agent-sessions");
    expect(coordinatorArray._channelName).toBe("agent-sessions");
    expect(coordinatorEmpty._channelName).toBe("agent-sessions");
    expect(coordinatorInvalid._channelName).toBe("agent-sessions");
    expect(coordinatorInvalid._heartbeatMs).toBe(5000);
    expect(coordinatorInvalid._staleMs).toBe(15000);
    expect(coordinatorInvalid._onEviction).toBeNull();
    expect(coordinatorInvalid._onAccess).toBeNull();
    expect(coordinatorNull._supported).toBe(false);

    expect(shared.isPlainObject).toHaveBeenCalled();
    expect(shared.toNonEmptyString).toHaveBeenCalled();
  });

  it("accepts numeric-like heartbeat values and trims channel names", () => {
    globalThis.BroadcastChannel = undefined;

    const coordinator = new TabCoordinator({
      channelName: "  custom-channel  ",
      heartbeatMs: "2500",
    });
    const maxCoordinator = new TabCoordinator({ heartbeatMs: Number.MAX_SAFE_INTEGER });
    const negativeCoordinator = new TabCoordinator({ heartbeatMs: -1 });

    expect(coordinator._channelName).toBe("custom-channel");
    expect(coordinator._heartbeatMs).toBe(2500);
    expect(coordinator._staleMs).toBe(7500);

    expect(maxCoordinator._heartbeatMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(maxCoordinator._staleMs).toBe(Number.MAX_SAFE_INTEGER * 3);

    expect(negativeCoordinator._heartbeatMs).toBe(5000);
  });

  it("no-ops on init when BroadcastChannel is unsupported", async () => {
    globalThis.BroadcastChannel = undefined;

    const coordinator = new TabCoordinator();
    await coordinator.init();

    expect(coordinator._initialized).toBe(true);
    expect(coordinator._channel).toBeNull();
    expect(coordinator._heartbeatTimer).toBeNull();
  });

  it("handles BroadcastChannel constructor failures and logs warnings", async () => {
    const warn = vi.fn();

    class ThrowingChannel {
      constructor() {
        throw new Error("boom");
      }
    }

    globalThis.BroadcastChannel = ThrowingChannel;

    const coordinator = new TabCoordinator({ logger: { warn } });
    await coordinator.init();

    expect(coordinator._supported).toBe(false);
    expect(coordinator._channel).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("initializes broadcast channel, sends heartbeats, and schedules refresh", async () => {
    await withFakeTimers(async () => {
      const { MockBroadcastChannel } = createMockBroadcastChannel();
      globalThis.BroadcastChannel = MockBroadcastChannel;

      const coordinator = new TabCoordinator({ heartbeatMs: 1000 });
      await coordinator.init();

      const channel = coordinator._channel;
      expect(channel).not.toBeNull();
      expect(channel.sent.length).toBe(2);
      expect(channel.sent[0].type).toBe("leader-election");
      expect(channel.sent[1].type).toBe("heartbeat");
      expect(coordinator._tabSeen.has(coordinator._tabId)).toBe(true);

      vi.advanceTimersByTime(1000);
      const heartbeatCount = channel.sent.filter((entry) => entry.type === "heartbeat").length;
      expect(heartbeatCount).toBe(2);

      coordinator.dispose();
    });
  });

  it("broadcasts session events for valid session ids and ignores invalid inputs", () => {
    const coordinator = new TabCoordinator();
    const postMessage = vi.fn();

    coordinator._supported = true;
    coordinator._channel = { postMessage };

    const invalidSessionIds = [null, undefined, "", "   ", []];
    for (const sessionId of invalidSessionIds) {
      coordinator.broadcastEviction(sessionId);
      coordinator.broadcastAccess(sessionId);
    }

    expect(postMessage).not.toHaveBeenCalled();

    const longSessionId = "s".repeat(10000);

    coordinator.broadcastAccess(0);
    coordinator.broadcastEviction(longSessionId);
    coordinator.broadcastAccess("session-2");

    expect(postMessage).toHaveBeenCalledTimes(3);

    const [first, second, third] = postMessage.mock.calls.map((call) => call[0]);
    expect(first.type).toBe("session-accessed");
    expect(first.sessionId).toBe("0");
    expect(second.type).toBe("session-evicted");
    expect(second.sessionId).toBe(longSessionId);
    expect(third.sessionId).toBe("session-2");
    expect(third.ts).toEqual(expect.any(Number));
  });

  it("guards broadcasts and logs postMessage errors", () => {
    const warn = vi.fn();
    const coordinator = new TabCoordinator({ logger: { warn } });
    const safePostMessage = vi.fn();

    coordinator._supported = false;
    coordinator._channel = { postMessage: safePostMessage };
    coordinator._broadcast("heartbeat");
    expect(safePostMessage).not.toHaveBeenCalled();

    coordinator._supported = true;
    coordinator._disposed = true;
    coordinator._broadcast("heartbeat");
    expect(safePostMessage).not.toHaveBeenCalled();

    coordinator._disposed = false;
    coordinator._broadcast("unknown");
    expect(safePostMessage).not.toHaveBeenCalled();

    coordinator._channel = {
      postMessage: vi.fn(() => {
        throw new Error("fail");
      }),
    };
    coordinator._broadcast("heartbeat");
    expect(warn).toHaveBeenCalled();
  });

  it("parses messages, handles deep payloads, and rejects invalid inputs", () => {
    const warn = vi.fn();
    const coordinator = new TabCoordinator({ logger: { warn } });

    const valid = coordinator._parseMessage({
      type: "heartbeat",
      tabId: "tab-a",
      ts: Number.MAX_SAFE_INTEGER,
    });
    expect(valid).toEqual({ type: "heartbeat", tabId: "tab-a", ts: Number.MAX_SAFE_INTEGER });

    const withStringTs = coordinator._parseMessage({
      type: "leader-election",
      tabId: "tab-b",
      ts: "123",
    });
    expect(withStringTs).toEqual({ type: "leader-election", tabId: "tab-b", ts: 123 });

    const withWhitespaceSession = coordinator._parseMessage({
      type: "session-accessed",
      tabId: "tab-c",
      ts: 1,
      sessionId: "   ",
    });
    expect(withWhitespaceSession).toEqual({ type: "session-accessed", tabId: "tab-c", ts: 1 });

    const longSessionId = "x".repeat(10000);
    const deepPayload = coordinator._parseMessage({
      type: "session-evicted",
      tabId: "tab-deep",
      ts: 5,
      sessionId: longSessionId,
      extra: { a: { b: { c: { d: { e: [1, 2, 3] } } } } },
    });
    expect(deepPayload).toEqual({
      type: "session-evicted",
      tabId: "tab-deep",
      ts: 5,
      sessionId: longSessionId,
    });

    const jsonString = JSON.stringify({ type: "heartbeat", tabId: "tab-json", ts: 9 });
    expect(coordinator._parseMessage(jsonString)).toEqual({
      type: "heartbeat",
      tabId: "tab-json",
      ts: 9,
    });

    expect(coordinator._parseMessage(null)).toBeNull();
    expect(coordinator._parseMessage(undefined)).toBeNull();
    expect(coordinator._parseMessage("")).toBeNull();
    expect(coordinator._parseMessage([])).toBeNull();
    expect(coordinator._parseMessage({})).toBeNull();
    expect(coordinator._parseMessage({ type: "unknown", tabId: "tab-a", ts: 1 })).toBeNull();
    expect(coordinator._parseMessage({ type: "heartbeat", tabId: "", ts: 1 })).toBeNull();
    expect(coordinator._parseMessage({ type: "heartbeat", tabId: "tab-a", ts: "nope" })).toBeNull();

    coordinator._parseMessage("not json");
    expect(warn).toHaveBeenCalled();
  });

  it("handles incoming messages, ignores self, and triggers callbacks", () => {
    const onEviction = vi.fn();
    const onAccess = vi.fn();
    const coordinator = new TabCoordinator({ onEviction, onAccess });

    coordinator._tabId = "self";
    coordinator._tabSeen = new Map();

    const refreshSpy = vi.spyOn(coordinator, "_refreshPresence");

    coordinator._handleMessage({
      data: { type: "heartbeat", tabId: "self", ts: 1 },
    });
    expect(coordinator._tabSeen.size).toBe(0);

    coordinator._handleMessage({
      data: { type: "session-evicted", tabId: "tab-a", ts: 2, sessionId: "s1" },
    });
    coordinator._handleMessage({
      data: { type: "session-accessed", tabId: "tab-b", ts: 3, sessionId: "s2" },
    });
    coordinator._handleMessage({
      data: { type: "session-evicted", tabId: "tab-c", ts: 4 },
    });

    expect(onEviction).toHaveBeenCalledWith("s1");
    expect(onAccess).toHaveBeenCalledWith("s2");

    coordinator._handleMessage({
      data: { type: "leader-election", tabId: "tab-d", ts: 5 },
    });
    expect(refreshSpy).toHaveBeenCalled();

    coordinator._handleMessage({
      data: { type: "heartbeat", tabId: "tab-e", ts: 6 },
    });
    coordinator._handleMessage({
      data: { type: "heartbeat", tabId: "tab-f", ts: 7 },
    });

    expect(coordinator.activeTabCount).toBeGreaterThan(1);
  });

  it("refreshes presence, prunes stale tabs, and elects leader", () => {
    const coordinator = new TabCoordinator();
    coordinator._tabId = "b";
    coordinator._staleMs = 10;
    coordinator._tabSeen = new Map([
      ["b", 100],
      ["a", 115],
      ["c", 0],
    ]);

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(120);
    try {
      coordinator._refreshPresence();
    } finally {
      nowSpy.mockRestore();
    }

    expect(coordinator._tabSeen.has("c")).toBe(false);
    expect(coordinator.activeTabCount).toBe(2);
    expect(coordinator._leaderId).toBe("a");
    expect(coordinator.isLeader).toBe(false);

    coordinator._tabSeen.clear();

    const nowSpy2 = vi.spyOn(Date, "now").mockReturnValue(130);
    try {
      coordinator._refreshPresence();
    } finally {
      nowSpy2.mockRestore();
    }

    expect(coordinator._tabSeen.has("b")).toBe(true);
    expect(coordinator.activeTabCount).toBe(1);
    expect(coordinator.isLeader).toBe(true);
  });

  it("safeCall isolates handler errors and logs warnings", () => {
    const warn = vi.fn();
    const coordinator = new TabCoordinator({ logger: { warn } });
    const handler = vi.fn(() => {
      throw new Error("fail");
    });

    coordinator._safeCall(handler, "session-x", "onEviction");

    expect(handler).toHaveBeenCalledWith("session-x");
    expect(warn).toHaveBeenCalled();
  });

  it("disposes timers and channels, resetting state safely", async () => {
    await withFakeTimers(async () => {
      const warn = vi.fn();
      const coordinator = new TabCoordinator({ logger: { warn } });
      const removeEventListener = vi.fn();
      const close = vi.fn(() => {
        throw new Error("close");
      });

      coordinator._channel = { removeEventListener, close };
      coordinator._heartbeatTimer = setInterval(() => {}, 1000);
      coordinator._tabSeen.set("tab-x", 1);
      coordinator._isLeader = false;
      coordinator._activeTabCount = 2;

      coordinator.dispose();

      expect(removeEventListener).toHaveBeenCalledWith("message", coordinator._handleMessage);
      expect(close).toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
      expect(coordinator._heartbeatTimer).toBeNull();
      expect(coordinator._channel).toBeNull();
      expect(coordinator._tabSeen.size).toBe(0);
      expect(coordinator._activeTabCount).toBe(1);
      expect(coordinator.isLeader).toBe(true);

      warn.mockClear();
      coordinator.dispose();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it("initializes only once under concurrent init calls", async () => {
    await withFakeTimers(async () => {
      const { MockBroadcastChannel, ctorSpy } = createMockBroadcastChannel();
      globalThis.BroadcastChannel = MockBroadcastChannel;

      const coordinator = new TabCoordinator({ heartbeatMs: 50 });
      await Promise.all([coordinator.init(), coordinator.init()]);

      expect(ctorSpy).toHaveBeenCalledTimes(1);
      expect(coordinator._channel).not.toBeNull();

      coordinator.dispose();
    });
  });
});
