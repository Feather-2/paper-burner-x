import { describe, it, expect, vi, beforeEach } from "vitest";

const platformState = { isNode: true };
const clusterState = {
  isPrimary: false,
  isWorker: false,
  workers: {},
  on: vi.fn(),
  off: vi.fn(),
  removeListener: vi.fn(),
};
let clusterImportError = null;

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return { ...actual, Platform: platformState };
});

const clusterProxy = new Proxy(clusterState, {
  get(target, prop) {
    if (clusterImportError) {
      throw clusterImportError;
    }
    return target[prop];
  },
});

vi.mock("node:cluster", () => clusterProxy);

async function loadModule() {
  await vi.resetModules();
  return import("../../../../../js/agents/plugins/coordination/process-coordinator.js");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();

  platformState.isNode = true;
  clusterImportError = null;

  clusterState.isPrimary = false;
  clusterState.isWorker = false;
  clusterState.workers = {};
  clusterState.on = vi.fn();
  clusterState.off = vi.fn();
  clusterState.removeListener = vi.fn();
  if ("default" in clusterState) {
    delete clusterState.default;
  }
});

describe("isClusterSupported", () => {
  it("returns false when platform is not node", async () => {
    const { isClusterSupported } = await loadModule();
    platformState.isNode = false;

    expect(isClusterSupported()).toBe(false);
  });

  it("returns false for invalid process references", async () => {
    const { isClusterSupported } = await loadModule();
    platformState.isNode = true;

    vi.stubGlobal("process", null);
    expect(isClusterSupported()).toBe(false);

    vi.stubGlobal("process", undefined);
    expect(isClusterSupported()).toBe(false);

    vi.stubGlobal("process", {});
    expect(isClusterSupported()).toBe(false);

    vi.stubGlobal("process", []);
    expect(isClusterSupported()).toBe(false);

    vi.stubGlobal("process", { pid: "123" });
    expect(isClusterSupported()).toBe(false);
  });

  it("returns true for finite pid boundary values", async () => {
    const { isClusterSupported } = await loadModule();
    platformState.isNode = true;

    vi.stubGlobal("process", { pid: 0 });
    expect(isClusterSupported()).toBe(true);

    vi.stubGlobal("process", { pid: -1 });
    expect(isClusterSupported()).toBe(true);

    vi.stubGlobal("process", { pid: Number.MAX_SAFE_INTEGER });
    expect(isClusterSupported()).toBe(true);
  });
});

describe("ProcessCoordinator", () => {
  it("initializes once under concurrent calls", async () => {
    const { ProcessCoordinator } = await loadModule();
    clusterState.isPrimary = true;
    clusterState.isWorker = false;
    vi.stubGlobal("process", { pid: 1 });

    const coordinator = new ProcessCoordinator();
    await Promise.all([coordinator.init(), coordinator.init()]);

    expect(clusterState.on).toHaveBeenCalledTimes(1);
    expect(coordinator.isEnabled()).toBe(true);
  });

  it("logs and disables support when cluster module import fails", async () => {
    const { ProcessCoordinator } = await loadModule();
    const warn = vi.fn();

    clusterImportError = new Error("boom");
    vi.stubGlobal("process", { pid: 2 });

    const coordinator = new ProcessCoordinator({ logger: { warn } });
    await coordinator.init();

    expect(coordinator._supported).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[ProcessCoordinator] Failed to load cluster module:",
      expect.any(Error)
    );
  });

  it("disables support when cluster module is invalid", async () => {
    const { ProcessCoordinator } = await loadModule();
    vi.stubGlobal("process", { pid: 3 });

    clusterState.isPrimary = undefined;
    clusterState.isWorker = undefined;
    clusterState.default = {};

    const coordinator = new ProcessCoordinator();
    await coordinator.init();

    expect(coordinator._supported).toBe(false);
    expect(coordinator._cluster).toBeNull();
  });

  it("registers primary listener and cleans up on dispose", async () => {
    const { ProcessCoordinator } = await loadModule();
    vi.stubGlobal("process", { pid: 4 });

    clusterState.isPrimary = true;
    clusterState.isWorker = false;

    const coordinator = new ProcessCoordinator();
    await coordinator.init();

    expect(clusterState.on).toHaveBeenCalledWith("message", expect.any(Function));

    await coordinator.dispose();
    expect(clusterState.off).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("registers worker listener and cleans up on dispose", async () => {
    const { ProcessCoordinator } = await loadModule();
    const proc = { pid: 5, on: vi.fn(), off: vi.fn() };
    vi.stubGlobal("process", proc);

    clusterState.isPrimary = false;
    clusterState.isWorker = true;

    const coordinator = new ProcessCoordinator();
    await coordinator.init();

    expect(proc.on).toHaveBeenCalledWith("message", expect.any(Function));

    await coordinator.dispose();
    expect(proc.off).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("broadcastWithSession ignores empty inputs and accepts long strings", async () => {
    const { ProcessCoordinator } = await loadModule();
    const coordinator = new ProcessCoordinator();
    const spy = vi.spyOn(coordinator, "_broadcast");
    coordinator._enabled = true;

    coordinator.broadcastAccess(null);
    coordinator.broadcastAccess(undefined);
    coordinator.broadcastAccess("");
    coordinator.broadcastAccess("   ");
    coordinator.broadcastAccess([]);

    const longSession = "a".repeat(10000);
    coordinator.broadcastAccess(longSession);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("session-accessed", longSession);
  });

  it("broadcast routes to workers and respects source boundaries", async () => {
    const { ProcessCoordinator } = await loadModule();
    const worker = { send: vi.fn(), isConnected: () => true };
    const coordinator = new ProcessCoordinator();

    coordinator._supported = true;
    coordinator._cluster = { workers: { w: worker } };
    coordinator._isPrimary = true;
    coordinator._processId = Number.MAX_SAFE_INTEGER;
    coordinator._enabled = true;

    coordinator._broadcast("session-accessed", "session-a");
    coordinator._processId = -1;
    coordinator._broadcast("session-evicted", "session-b");
    coordinator._broadcast("unknown", "session-c");

    expect(worker.send).toHaveBeenCalledTimes(2);
    expect(worker.send).toHaveBeenNthCalledWith(1, {
      type: "session-accessed",
      sessionId: "session-a",
      source: Number.MAX_SAFE_INTEGER,
    });
    expect(worker.send).toHaveBeenNthCalledWith(2, {
      type: "session-evicted",
      sessionId: "session-b",
      source: -1,
    });
  });

  it("broadcast ignores when source is unavailable or disposed", async () => {
    const { ProcessCoordinator } = await loadModule();
    const worker = { send: vi.fn(), isConnected: () => true };
    const coordinator = new ProcessCoordinator();

    coordinator._supported = true;
    coordinator._cluster = { workers: { w: worker } };
    coordinator._isPrimary = true;
    coordinator._processId = null;
    coordinator._process = { pid: "nope" };
    coordinator._enabled = true;

    coordinator._broadcast("session-accessed", "session-a");

    coordinator.disposed = true;
    coordinator._processId = 1;
    coordinator._broadcast("session-evicted", "session-b");

    expect(worker.send).not.toHaveBeenCalled();
  });

  it("broadcastToWorkers skips disconnected workers and logs failures", async () => {
    const { ProcessCoordinator } = await loadModule();
    const warn = vi.fn();
    const coordinator = new ProcessCoordinator({ logger: { warn } });

    const goodWorker = { send: vi.fn(), isConnected: () => true };
    const disconnected = { send: vi.fn(), isConnected: () => false };
    const noSend = { isConnected: () => true };
    const throwing = {
      send: vi.fn(() => {
        throw new Error("boom");
      }),
      isConnected: () => true,
    };

    coordinator._cluster = {
      workers: { goodWorker, disconnected, noSend, throwing },
    };

    coordinator._broadcastToWorkers({
      type: "session-evicted",
      sessionId: "session-1",
      source: 1,
    });

    expect(goodWorker.send).toHaveBeenCalled();
    expect(disconnected.send).not.toHaveBeenCalled();
    expect(throwing.send).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[ProcessCoordinator] Failed to send message to worker:",
      expect.any(Error)
    );
  });

  it("sendToPrimary logs failures", async () => {
    const { ProcessCoordinator } = await loadModule();
    const warn = vi.fn();
    const coordinator = new ProcessCoordinator({ logger: { warn } });

    coordinator._process = {
      send: () => {
        throw new Error("fail");
      },
    };

    coordinator._sendToPrimary({
      type: "session-accessed",
      sessionId: "session-2",
      source: 2,
    });

    expect(warn).toHaveBeenCalledWith(
      "[ProcessCoordinator] Failed to send message to primary:",
      expect.any(Error)
    );
  });

  it("handles incoming messages and protects handler errors", async () => {
    const { ProcessCoordinator } = await loadModule();
    const warn = vi.fn();
    const onEviction = vi.fn(() => {
      throw new Error("handler");
    });
    const onAccess = vi.fn();

    const coordinator = new ProcessCoordinator({
      logger: { warn },
      onEviction,
      onAccess,
    });
    coordinator._processId = 5;

    const ignored = coordinator._handleIncomingMessage({
      type: "session-evicted",
      sessionId: "session-1",
      source: 5,
    });

    expect(ignored).toBeNull();
    expect(onEviction).not.toHaveBeenCalled();

    const evicted = coordinator._handleIncomingMessage({
      type: "session-evicted",
      sessionId: "session-2",
      source: 6,
    });

    expect(evicted).toEqual({
      type: "session-evicted",
      sessionId: "session-2",
      source: 6,
    });
    expect(onEviction).toHaveBeenCalledWith("session-2");
    expect(warn).toHaveBeenCalledWith(
      "[ProcessCoordinator] onEviction handler failed:",
      expect.any(Error)
    );

    const accessed = coordinator._handleIncomingMessage({
      type: "session-accessed",
      sessionId: "session-3",
      source: 7,
    });

    expect(accessed).toEqual({
      type: "session-accessed",
      sessionId: "session-3",
      source: 7,
    });
    expect(onAccess).toHaveBeenCalledWith("session-3");
  });

  it("parseMessage validates payloads and handles large/deep inputs", async () => {
    const { ProcessCoordinator } = await loadModule();
    const warn = vi.fn();
    const coordinator = new ProcessCoordinator({ logger: { warn } });

    expect(coordinator._parseMessage(null)).toBeNull();
    expect(coordinator._parseMessage(undefined)).toBeNull();
    expect(coordinator._parseMessage([])).toBeNull();
    expect(coordinator._parseMessage({})).toBeNull();
    expect(
      coordinator._parseMessage({ type: "session-evicted", sessionId: "", source: 1 })
    ).toBeNull();
    expect(
      coordinator._parseMessage({ type: "unknown", sessionId: "session", source: 1 })
    ).toBeNull();
    expect(
      coordinator._parseMessage({ type: "session-evicted", sessionId: "session" })
    ).toBeNull();
    expect(
      coordinator._parseMessage({ type: "session-evicted", sessionId: "session", source: [] })
    ).toBeNull();

    expect(coordinator._parseMessage("")).toBeNull();
    expect(coordinator._parseMessage("   ")).toBeNull();
    expect(warn).toHaveBeenCalled();

    const parsedString = coordinator._parseMessage(
      JSON.stringify({ type: "session-accessed", sessionId: "session-1", source: "42" })
    );
    expect(parsedString).toEqual({
      type: "session-accessed",
      sessionId: "session-1",
      source: 42,
    });

    const deep = { level: {} };
    let cursor = deep.level;
    for (let i = 0; i < 50; i++) {
      cursor.next = {};
      cursor = cursor.next;
    }

    const deepMessage = coordinator._parseMessage({
      type: "session-evicted",
      sessionId: "deep",
      source: 0,
      extra: deep,
    });
    expect(deepMessage).toEqual({ type: "session-evicted", sessionId: "deep", source: 0 });

    const longSession = "x".repeat(100000);
    const largePayload = JSON.stringify({
      type: "session-accessed",
      sessionId: longSession,
      source: String(Number.MAX_SAFE_INTEGER),
      extra: deep,
    });
    const largeParsed = coordinator._parseMessage(largePayload);

    expect(largeParsed).toEqual({
      type: "session-accessed",
      sessionId: longSession,
      source: Number.MAX_SAFE_INTEGER,
    });
  });

  it("broadcastAccess handles rapid consecutive calls", async () => {
    const { ProcessCoordinator } = await loadModule();
    const worker = { send: vi.fn(), isConnected: () => true };
    const coordinator = new ProcessCoordinator();

    coordinator._supported = true;
    coordinator._cluster = { workers: { w: worker } };
    coordinator._isPrimary = true;
    coordinator._processId = 1;
    coordinator._enabled = true;

    for (let i = 0; i < 5; i++) {
      coordinator.broadcastAccess(`session-${i}`);
    }

    expect(worker.send).toHaveBeenCalledTimes(5);
  });

  it("degrades to no-op when coordinator is disabled", async () => {
    const { ProcessCoordinator } = await loadModule();
    const worker = { send: vi.fn(), isConnected: () => true };
    const coordinator = new ProcessCoordinator();

    coordinator._supported = true;
    coordinator._cluster = { workers: { w: worker } };
    coordinator._isPrimary = true;
    coordinator._processId = 1;
    coordinator._enabled = false;

    coordinator.broadcastAccess("session-disabled");
    coordinator.broadcastEviction("session-disabled");

    expect(coordinator.isEnabled()).toBe(false);
    expect(worker.send).not.toHaveBeenCalled();
  });
});

describe("default export", () => {
  it("matches the named ProcessCoordinator export", async () => {
    const mod = await loadModule();

    expect(mod.default).toBe(mod.ProcessCoordinator);
  });
});
