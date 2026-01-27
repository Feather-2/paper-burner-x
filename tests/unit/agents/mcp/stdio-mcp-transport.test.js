import { describe, it, expect, vi, beforeEach } from "vitest";

let processInstances = [];
let processConnectError = null;
let processConnectGate = null;

class MockProcessTransport {
  constructor(options) {
    this.options = options;
    this._listeners = new Map();
    processInstances.push(this);

    this.connect = vi.fn(() => {
      if (processConnectError) return Promise.reject(processConnectError);
      if (processConnectGate) return processConnectGate;
      return Promise.resolve();
    });

    this.disconnect = vi.fn(() => Promise.resolve());
    this.send = vi.fn();
  }

  on(event, handler) {
    const handlers = this._listeners.get(event) || [];
    handlers.push(handler);
    this._listeners.set(event, handlers);
    return this;
  }

  emit(event, ...args) {
    const handlers = this._listeners.get(event) || [];
    for (const handler of handlers) handler(...args);
  }
}

vi.mock("../../../../js/agents/runtime/transports/process-transport.js", () => {
  return { ProcessTransport: MockProcessTransport };
});

vi.mock("../../../../js/agents/mcp/mcp-transport.js", () => {
  const MCP_PROTOCOL_VERSION = "test-protocol";

  const McpMethods = {
    INITIALIZE: "initialize",
    INITIALIZED: "notifications/initialized",
  };

  class McpTransport {
    constructor(options = {}) {
      this.timeout = options.timeout;
      this._connected = false;
      this._listeners = new Map();

      this.request = vi.fn();
      this.notify = vi.fn();
      this._handleMessage = vi.fn();
      this._rejectAllPending = vi.fn();
    }

    on(event, handler) {
      const handlers = this._listeners.get(event) || [];
      handlers.push(handler);
      this._listeners.set(event, handlers);
      return this;
    }

    emit(event, ...args) {
      const handlers = this._listeners.get(event) || [];
      for (const handler of handlers) handler(...args);
      return handlers.length > 0;
    }
  }

  return { McpTransport, MCP_PROTOCOL_VERSION, McpMethods };
});

let StdioMcpTransport;
let MCP_PROTOCOL_VERSION;
let McpMethods;

function makeDeepObject(depth) {
  let current = { value: "end" };
  for (let i = 0; i < depth; i++) {
    current = { layer: i, next: current };
  }
  return current;
}

beforeEach(async () => {
  vi.clearAllMocks();
  processInstances = [];
  processConnectError = null;
  processConnectGate = null;

  ({ StdioMcpTransport } = await import("../../../../js/agents/mcp/stdio-mcp-transport.js"));
  ({ MCP_PROTOCOL_VERSION, McpMethods } = await import("../../../../js/agents/mcp/mcp-transport.js"));
});

describe("StdioMcpTransport", () => {
  it("constructs with defaults and normalizes nullish options", () => {
    const transport = new StdioMcpTransport({
      command: "",
      args: null,
      env: null,
      cwd: "",
      timeout: 0,
      signal: undefined,
      autoInit: undefined,
      clientName: "",
      clientVersion: "",
    });

    expect(transport.command).toBe("");
    expect(transport.args).toEqual([]);
    expect(transport.env).toEqual({});
    expect(transport.cwd).toBe(process.cwd());
    expect(transport.timeout).toBe(0);
    expect(transport.signal).toBe(null);
    expect(transport.autoInit).toBe(true);
    expect(transport.clientName).toBe("js-agents");
    expect(transport.clientVersion).toBe("1.0.0");
    expect(transport._process).toBe(null);
    expect(transport._processTransportModule).toBe(null);
    expect(transport.serverInfo).toBe(null);
    expect(transport.capabilities).toBe(null);
  });

  it("preserves truthy edge values and type-boundary inputs", () => {
    const abortController = new AbortController();
    const weirdArgs = { not: "an array" };
    const weirdEnv = [];
    const whitespaceCwd = "   ";
    const whitespaceName = "   client   ";
    const longVersion = "v" + "1".repeat(10_000);

    const transport = new StdioMcpTransport({
      command: "x".repeat(50_000),
      args: weirdArgs,
      env: weirdEnv,
      cwd: whitespaceCwd,
      timeout: Number.MAX_SAFE_INTEGER,
      signal: abortController.signal,
      autoInit: 0,
      clientName: whitespaceName,
      clientVersion: longVersion,
    });

    expect(transport.args).toBe(weirdArgs);
    expect(transport.env).toBe(weirdEnv);
    expect(transport.cwd).toBe(whitespaceCwd);
    expect(transport.timeout).toBe(Number.MAX_SAFE_INTEGER);
    expect(transport.signal).toBe(abortController.signal);
    expect(transport.autoInit).toBe(true);
    expect(transport.clientName).toBe(whitespaceName);
    expect(transport.clientVersion).toBe(longVersion);
  });

  it("accepts negative and non-number timeout values (type/boundary)", async () => {
    const transport = new StdioMcpTransport({
      command: "cmd",
      timeout: "5000",
      args: [],
      env: {},
    });

    vi.spyOn(transport, "_initialize").mockResolvedValue(undefined);
    await transport.connect();

    expect(processInstances).toHaveLength(1);
    expect(processInstances[0].options.timeout).toBe("5000");

    const transportNeg = new StdioMcpTransport({ command: "cmd", timeout: -1 });
    expect(transportNeg.timeout).toBe(-1);
  });

  it("caches the ProcessTransport module within an instance", async () => {
    const transport = new StdioMcpTransport({ command: "cmd" });

    expect(transport._processTransportModule).toBe(null);

    const PT1 = await transport._getProcessTransport();
    const moduleRef = transport._processTransportModule;

    const PT2 = await transport._getProcessTransport();

    expect(PT1).toBe(MockProcessTransport);
    expect(PT2).toBe(PT1);
    expect(transport._processTransportModule).toBe(moduleRef);
  });

  it("connect creates a ProcessTransport, wires events, connects, auto-inits, and emits connect", async () => {
    const abortController = new AbortController();
    const transport = new StdioMcpTransport({
      command: "cmd",
      args: ["-a", "b"],
      env: { FOO: "bar" },
      cwd: "/tmp",
      timeout: 123,
      signal: abortController.signal,
    });

    const onConnect = vi.fn();
    transport.on("connect", onConnect);

    const initSpy = vi.spyOn(transport, "_initialize").mockResolvedValue(undefined);

    await transport.connect();

    expect(processInstances).toHaveLength(1);
    expect(processInstances[0].options).toEqual({
      command: "cmd",
      args: ["-a", "b"],
      env: { FOO: "bar" },
      cwd: "/tmp",
      timeout: 123,
      signal: abortController.signal,
    });

    expect(processInstances[0]._listeners.has("message")).toBe(true);
    expect(processInstances[0]._listeners.has("error")).toBe(true);
    expect(processInstances[0]._listeners.has("exit")).toBe(true);
    expect(processInstances[0]._listeners.has("stderr")).toBe(true);

    expect(processInstances[0].connect).toHaveBeenCalledTimes(1);
    expect(transport._connected).toBe(true);
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("connect skips protocol init when autoInit is false", async () => {
    const transport = new StdioMcpTransport({
      command: "cmd",
      autoInit: false,
    });

    const initSpy = vi.spyOn(transport, "_initialize");
    const onConnect = vi.fn();
    transport.on("connect", onConnect);

    await transport.connect();

    expect(initSpy).not.toHaveBeenCalled();
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(transport._connected).toBe(true);
  });

  it("connect is idempotent after already connected", async () => {
    const transport = new StdioMcpTransport({ command: "cmd" });
    vi.spyOn(transport, "_initialize").mockResolvedValue(undefined);

    await transport.connect();
    processConnectError = new Error("should not be used");

    await transport.connect();

    expect(processInstances).toHaveLength(1);
    expect(processInstances[0].connect).toHaveBeenCalledTimes(1);
  });

  it("connect propagates ProcessTransport.connect() errors and does not emit connect", async () => {
    const transport = new StdioMcpTransport({ command: "cmd" });
    vi.spyOn(transport, "_initialize").mockResolvedValue(undefined);

    const onConnect = vi.fn();
    transport.on("connect", onConnect);

    processConnectError = new Error("boom");

    await expect(transport.connect()).rejects.toThrow("boom");

    expect(onConnect).not.toHaveBeenCalled();
    expect(transport._connected).toBe(false);
    expect(processInstances).toHaveLength(1);
  });

  it("connect propagates initialization errors and does not emit connect", async () => {
    const transport = new StdioMcpTransport({ command: "cmd" });

    const onConnect = vi.fn();
    transport.on("connect", onConnect);

    vi.spyOn(transport, "_initialize").mockRejectedValue(new Error("init failed"));

    await expect(transport.connect()).rejects.toThrow("init failed");

    expect(onConnect).not.toHaveBeenCalled();
    expect(processInstances).toHaveLength(1);
  });

  it("forwards process message, error, and stderr events (deep/large payloads)", async () => {
    const transport = new StdioMcpTransport({ command: "cmd" });
    vi.spyOn(transport, "_initialize").mockResolvedValue(undefined);
    await transport.connect();

    const message = makeDeepObject(25);
    const err = new Error("child error");
    const hugeStderr = "x".repeat(200_000);

    const onError = vi.fn();
    const onStderr = vi.fn();
    transport.on("error", onError);
    transport.on("stderr", onStderr);

    processInstances[0].emit("message", message);
    processInstances[0].emit("error", err);
    processInstances[0].emit("stderr", hugeStderr);

    expect(transport._handleMessage).toHaveBeenCalledTimes(1);
    expect(transport._handleMessage).toHaveBeenCalledWith(message);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(err);
    expect(onStderr).toHaveBeenCalledTimes(1);
    expect(onStderr).toHaveBeenCalledWith(hugeStderr);
  });

  it("handles process exit by marking disconnected, rejecting pending, and emitting disconnect", async () => {
    const transport = new StdioMcpTransport({ command: "cmd" });
    vi.spyOn(transport, "_initialize").mockResolvedValue(undefined);

    const onDisconnect = vi.fn();
    transport.on("disconnect", onDisconnect);

    await transport.connect();
    expect(transport._connected).toBe(true);

    processInstances[0].emit("exit", { code: 1, signal: "SIGTERM" });

    expect(transport._connected).toBe(false);
    expect(transport._rejectAllPending).toHaveBeenCalledTimes(1);
    const [exitError] = transport._rejectAllPending.mock.calls[0];
    expect(exitError).toBeInstanceOf(Error);
    expect(exitError.message).toContain("Process exited: code=1, signal=SIGTERM");
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(onDisconnect).toHaveBeenCalledWith({ code: 1, signal: "SIGTERM" });
  });

  it("initialize sends initialize request and stores server info and capabilities", async () => {
    const transport = new StdioMcpTransport({
      command: "cmd",
      clientName: "client",
      clientVersion: "2.0.0",
    });

    const deepCapabilities = makeDeepObject(20);
    transport.request.mockResolvedValue({
      serverInfo: { name: "srv", version: "9.9.9" },
      capabilities: deepCapabilities,
    });
    transport.notify.mockResolvedValue(undefined);

    await transport._initialize();

    expect(transport.request).toHaveBeenCalledTimes(1);
    expect(transport.request).toHaveBeenCalledWith(McpMethods.INITIALIZE, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "client", version: "2.0.0" },
    });

    expect(transport.serverInfo).toEqual({ name: "srv", version: "9.9.9" });
    expect(transport.capabilities).toBe(deepCapabilities);

    expect(transport.notify).toHaveBeenCalledTimes(1);
    const [method, params] = transport.notify.mock.calls[0];
    expect(typeof method).toBe("string");
    expect(method.toLowerCase()).toContain("initialized");
    expect(params).toEqual({});
  });

  it("initialize handles nullish results by setting defaults and still notifies", async () => {
    const transport = new StdioMcpTransport({ command: "cmd" });

    transport.request.mockResolvedValue(undefined);
    transport.notify.mockResolvedValue(undefined);

    await transport._initialize();

    expect(transport.serverInfo).toBe(null);
    expect(transport.capabilities).toEqual({});
    expect(transport.notify).toHaveBeenCalledTimes(1);
  });

  it("initialize propagates request errors without mutating stored state", async () => {
    const transport = new StdioMcpTransport({ command: "cmd" });
    transport.serverInfo = { name: "existing" };
    transport.capabilities = { existing: true };

    transport.request.mockRejectedValue(new Error("request failed"));

    await expect(transport._initialize()).rejects.toThrow("request failed");

    expect(transport.serverInfo).toEqual({ name: "existing" });
    expect(transport.capabilities).toEqual({ existing: true });
    expect(transport.notify).not.toHaveBeenCalled();
  });

  it("connect tolerates concurrent calls and ends in a connected state", async () => {
    let resolveGate;
    processConnectGate = new Promise((resolve) => {
      resolveGate = resolve;
    });

    const transport = new StdioMcpTransport({ command: "cmd" });
    vi.spyOn(transport, "_initialize").mockResolvedValue(undefined);

    const p1 = transport.connect();
    const p2 = transport.connect();
    resolveGate();

    await Promise.all([p1, p2]);

    expect(transport._connected).toBe(true);
    expect(processInstances.length).toBeGreaterThanOrEqual(1);
  });
});