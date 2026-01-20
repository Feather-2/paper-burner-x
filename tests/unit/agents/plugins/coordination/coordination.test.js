import { describe, it, expect, vi } from "vitest";

import { TabCoordinator } from "../../../../../js/agents/plugins/coordination/tab-coordinator.js";
import ProcessCoordinator from "../../../../../js/agents/plugins/coordination/process-coordinator.js";

describe("coordination/tab-coordinator", () => {
  it("parses messages and rejects invalid payloads", () => {
    const coordinator = new TabCoordinator();

    const parsed = coordinator._parseMessage({ type: "heartbeat", tabId: "tab-a", ts: 123 });
    expect(parsed).toEqual({ type: "heartbeat", tabId: "tab-a", ts: 123 });

    const withSession = coordinator._parseMessage({
      type: "session-evicted",
      tabId: "tab-b",
      ts: 456,
      sessionId: "session-1",
    });
    expect(withSession).toEqual({
      type: "session-evicted",
      tabId: "tab-b",
      ts: 456,
      sessionId: "session-1",
    });

    const parsedString = coordinator._parseMessage(
      JSON.stringify({ type: "heartbeat", tabId: "tab-c", ts: 999 })
    );
    expect(parsedString).toEqual({ type: "heartbeat", tabId: "tab-c", ts: 999 });

    expect(coordinator._parseMessage({ type: "unknown", tabId: "tab-a", ts: 123 })).toBeNull();
    expect(coordinator._parseMessage({ type: "heartbeat", tabId: "", ts: 123 })).toBeNull();
    expect(coordinator._parseMessage({ type: "heartbeat", tabId: "tab-a", ts: "nope" })).toBeNull();
    expect(coordinator._parseMessage("not json")).toBeNull();
  });

  it("elects the lowest tab id as leader", () => {
    const coordinator = new TabCoordinator();
    coordinator._tabId = "b";
    coordinator._tabSeen = new Map();

    coordinator._noteTabSeen("b");
    coordinator._noteTabSeen("c");
    coordinator._noteTabSeen("a");

    expect(coordinator.activeTabCount).toBe(3);
    expect(coordinator._leaderId).toBe("a");
    expect(coordinator.isLeader).toBe(false);
  });
});

describe("coordination/process-coordinator", () => {
  it("parses IPC messages and rejects invalid payloads", () => {
    const coordinator = new ProcessCoordinator();

    const parsed = coordinator._parseMessage({
      type: "session-evicted",
      sessionId: "session-1",
      source: 10,
    });
    expect(parsed).toEqual({
      type: "session-evicted",
      sessionId: "session-1",
      source: 10,
    });

    const parsedString = coordinator._parseMessage(
      JSON.stringify({ type: "session-accessed", sessionId: "session-2", source: "22" })
    );
    expect(parsedString).toEqual({
      type: "session-accessed",
      sessionId: "session-2",
      source: 22,
    });

    expect(coordinator._parseMessage({ type: "nope", sessionId: "session-1", source: 1 })).toBeNull();
    expect(coordinator._parseMessage({ type: "session-evicted", sessionId: "", source: 1 })).toBeNull();
    expect(coordinator._parseMessage({ type: "session-evicted", sessionId: "session-1" })).toBeNull();
    expect(coordinator._parseMessage("not json")).toBeNull();
  });

  it("routes broadcasts to workers when primary", () => {
    const coordinator = new ProcessCoordinator();
    const workerA = { send: vi.fn(), isConnected: () => true };
    const workerB = { send: vi.fn(), isConnected: () => true };

    coordinator._supported = true;
    coordinator._cluster = { workers: { a: workerA, b: workerB } };
    coordinator._isPrimary = true;
    coordinator._isWorker = false;
    coordinator._processId = 7;

    coordinator._broadcast("session-evicted", "session-1");

    expect(workerA.send).toHaveBeenCalledWith({
      type: "session-evicted",
      sessionId: "session-1",
      source: 7,
    });
    expect(workerB.send).toHaveBeenCalledWith({
      type: "session-evicted",
      sessionId: "session-1",
      source: 7,
    });
  });

  it("routes broadcasts to primary when worker", () => {
    const coordinator = new ProcessCoordinator();
    const send = vi.fn();

    coordinator._supported = true;
    coordinator._cluster = { workers: {} };
    coordinator._isPrimary = false;
    coordinator._isWorker = true;
    coordinator._processId = 12;
    coordinator._process = { send };

    coordinator._broadcast("session-accessed", "session-2");

    expect(send).toHaveBeenCalledWith({
      type: "session-accessed",
      sessionId: "session-2",
      source: 12,
    });
  });

  it("rebroadcasts worker messages from the primary", () => {
    const coordinator = new ProcessCoordinator();
    const rebroadcast = vi.spyOn(coordinator, "_broadcastToWorkers").mockImplementation(() => {});

    coordinator._supported = true;
    coordinator._cluster = { workers: {} };
    coordinator._isPrimary = true;
    coordinator._isWorker = false;
    coordinator._processId = 1;

    coordinator._handleClusterMessage(null, {
      type: "session-evicted",
      sessionId: "session-3",
      source: 2,
    });

    expect(rebroadcast).toHaveBeenCalledWith({
      type: "session-evicted",
      sessionId: "session-3",
      source: 2,
    });

    rebroadcast.mockRestore();
  });
});
