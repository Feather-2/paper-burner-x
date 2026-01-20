import { describe, it, expect, vi, beforeEach } from "vitest";

const { processTransportState, MockProcessTransport } = vi.hoisted(() => {
  class MiniEmitter {
    constructor() {
      this._listeners = new Map();
    }

    on(event, handler) {
      const handlers = this._listeners.get(event) || new Set();
      handlers.add(handler);
      this._listeners.set(event, handlers);
      return this;
    }

    emit(event, ...args) {
      const handlers = this._listeners.get(event);
      if (!handlers) return false;
      for (const handler of Array.from(handlers)) {
        handler(...args);
      }
      return true;
    }
  }

  const state = {
    instances: [],
    connectError: null,
    connectDelayMs: 0,
    isConnectedValue: true,
    reset() {
      this.instances.length = 0;
      this.connectError = null;
      this.connectDelayMs = 0;
      this.isConnectedValue = true;
    },
  };

  class MockProcessTransport extends MiniEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.connected = false;
      this.sent = [];
      state.instances.push(this);
    }

    async connect() {
      if (state.connectDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.connectDelayMs));
      }
      if (state.connectError) {
        throw state.connectError;
      }
      this.connected = true;
    }

    disconnect() {
      this.connected = false;
    }

    send(message) {
      this.sent.push(message);
    }

    isConnected() {
      return state.isConnectedValue;
    }
  }

  return { processTransportState: state, MockProcessTransport };
});

vi.mock("../../../../js/agents/runtime/transports/process-transport.js", () => ({
  ProcessTransport: MockProcessTransport,
  default: MockProcessTransport,
}), { virtual: true });

import StdioMcpTransportDefault, {
  StdioMcpTransport,
  createStdioMcpTransport,
} from "../../../../js/agents/mcp/stdio-mcp-transport.js";
import { MCP_PROTOCOL_VERSION, McpMethods } from "../../../../js/agents/mcp/mcp-transport.js";

function makeTransport(overrides = {}) {
  const transport = new StdioMcpTransport({
    command: "node",
    ...overrides,
  });
  transport._getProcessTransport = vi.fn().mockResolvedValue(MockProcessTransport);
  return transport;
}

function getLastProcessTransport() {
  return processTransportState.instances[processTransportState.instances.length - 1] || null;
}

function createDeepObject(depth) {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = { level: i };
    cursor = cursor.next;
  }
  return root;
}

beforeEach(() => {
  processTransportState.reset();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("StdioMcpTransport", () => {
  it("constructs with defaults and handles null/undefined/empty values", () => {
    const transport = new StdioMcpTransport({
      command: "",
      args: null,
      env: null,
      cwd: undefined,
      timeout: undefined,
      signal: undefined,
      clientName: undefined,
      clientVersion: undefined,
    });

    expect(transport.command).toBe("");
    expect(transport.args).toEqual([]);
    expect(transport.env).toEqual({});
    expect(transport.cwd).toBe(process.cwd());
    expect(transport.signal).toBe(null);
    expect(transport.autoInit).toBe(true);
    expect(transport.clientName).toBe("js-agents");
    expect(transport.clientVersion).toBe("1.0.0");
    expect(transport.timeout).toBe(30000);
  });

  it("accepts timeout boundary values and type edges", () => {
    const cases = [0, -1, Number.MAX_SAFE_INTEGER];
    for (const value of cases) {
      const transport = makeTransport({ timeout: value });
      expect(transport.timeout).toBe(value);
    }

    const env = {};
    const transport = makeTransport({
      args: { 0: "a" },
      env,
      cwd: "   ",
      autoInit: false,
      timeout: "1000",
      clientName: "",
      clientVersion: "",
    });

    expect(transport.args).toEqual({ 0: "a" });
    expect(transport.env).toBe(env);
    expect(transport.cwd).toBe("   ");
    expect(transport.autoInit).toBe(false);
    expect(transport.timeout).toBe("1000");
    expect(transport.clientName).toBe("js-agents");
    expect(transport.clientVersion).toBe("1.0.0");
  });

  it("connects, wires process transport, and emits connect", async () => {
    const transport = makeTransport({
      args: [],
      env: { TEST: "1" },
      cwd: "/tmp",
      timeout: 123,
      signal: null,
      autoInit: false,
    });

    const onConnect = vi.fn();
    transport.on("connect", onConnect);

    await transport.connect();

    const proc = getLastProcessTransport();
    expect(proc).toBe(transport._process);
    expect(proc.options).toEqual({
      command: "node",
      args: [],
      env: { TEST: "1" },
      cwd: "/tmp",
      timeout: 123,
      signal: null,
    });
    expect(transport.isConnected()).toBe(true);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("connect is a no-op when already connected", async () => {
    const transport = makeTransport({ autoInit: false });
    transport._connected = true;

    await transport.connect();

    expect(processTransportState.instances).toHaveLength(0);
  });

  it("auto-initializes when enabled", async () => {
    const transport = makeTransport();
    const initSpy = vi.spyOn(transport, "_initialize").mockResolvedValue();

    await transport.connect();

    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  it("relays process events and handles exit", async () => {
    const transport = makeTransport({ autoInit: false });
    const handleSpy = vi.spyOn(transport, "_handleMessage");
    const rejectSpy = vi.spyOn(transport, "_rejectAllPending");
    const onError = vi.fn();
    const onStderr = vi.fn();
    const onDisconnect = vi.fn();

    transport.on("error", onError);
    transport.on("stderr", onStderr);
    transport.on("disconnect", onDisconnect);

    await transport.connect();
    const proc = getLastProcessTransport();

    const msg = { jsonrpc: "2.0", method: "ping" };
    proc.emit("message", msg);
    expect(handleSpy).toHaveBeenCalledWith(msg);

    const err = new Error("boom");
    proc.emit("error", err);
    expect(onError).toHaveBeenCalledWith(err);

    proc.emit("stderr", "oops");
    expect(onStderr).toHaveBeenCalledWith("oops");

    proc.emit("exit", { code: 2, signal: "SIGTERM" });
    expect(transport._connected).toBe(false);
    expect(rejectSpy).toHaveBeenCalledTimes(1);
    expect(rejectSpy.mock.calls[0][0].message).toContain("Process exited: code=2, signal=SIGTERM");
    expect(onDisconnect).toHaveBeenCalledWith({ code: 2, signal: "SIGTERM" });
  });

  it("propagates process connect errors", async () => {
    const transport = makeTransport({ autoInit: false });
    const onConnect = vi.fn();
    transport.on("connect", onConnect);

    processTransportState.connectError = new Error("connect fail");

    await expect(transport.connect()).rejects.toThrow("connect fail");
    expect(transport.isConnected()).toBe(false);
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("_initialize sends handshake and stores server info", async () => {
    const transport = makeTransport({ clientName: "client", clientVersion: "2.0.0" });
    const request = vi.fn().mockResolvedValue({
      serverInfo: { name: "server" },
      capabilities: { tools: true },
    });
    const notify = vi.fn().mockResolvedValue();
    transport.request = request;
    transport.notify = notify;

    await transport._initialize();

    expect(request).toHaveBeenCalledWith(McpMethods.INITIALIZE, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "client", version: "2.0.0" },
    });
    expect(transport.serverInfo).toEqual({ name: "server" });
    expect(transport.capabilities).toEqual({ tools: true });
    expect(notify).toHaveBeenCalledWith(McpMethods.INITIALIZED, {});
  });

  it("_initialize tolerates null responses", async () => {
    const transport = makeTransport();
    transport.request = vi.fn().mockResolvedValue(null);
    transport.notify = vi.fn().mockResolvedValue();

    await transport._initialize();

    expect(transport.serverInfo).toBe(null);
    expect(transport.capabilities).toEqual({});
    expect(transport.notify).toHaveBeenCalledWith(McpMethods.INITIALIZED, {});
  });

  it("disconnect is a no-op when there is no process", async () => {
    const transport = makeTransport();
    const emitSpy = vi.spyOn(transport, "emit");

    await transport.disconnect();

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it("disconnect rejects pending work, disconnects process, and emits", async () => {
    const transport = makeTransport({ autoInit: false });
    await transport.connect();
    const proc = getLastProcessTransport();
    const rejectSpy = vi.spyOn(transport, "_rejectAllPending");
    const procDisconnectSpy = vi.spyOn(proc, "disconnect");
    const onDisconnect = vi.fn();
    transport.on("disconnect", onDisconnect);

    await transport.disconnect();

    expect(rejectSpy).toHaveBeenCalledTimes(1);
    expect(rejectSpy.mock.calls[0][0].message).toBe("Transport disconnected");
    expect(procDisconnectSpy).toHaveBeenCalledTimes(1);
    expect(transport._process).toBe(null);
    expect(transport._connected).toBe(false);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(onDisconnect.mock.calls[0].length).toBe(0);
  });

  it("send throws when not connected", async () => {
    const transport = makeTransport();
    await expect(transport.send({ jsonrpc: "2.0", method: "ping" }))
      .rejects.toThrow("Transport not connected");

    transport._process = { send: vi.fn() };
    transport._connected = false;
    await expect(transport.send({ jsonrpc: "2.0", method: "ping" }))
      .rejects.toThrow("Transport not connected");
  });

  it("send forwards messages and supports rapid calls", async () => {
    const transport = makeTransport({ autoInit: false });
    await transport.connect();
    const proc = getLastProcessTransport();

    const msg1 = { jsonrpc: "2.0", method: "one" };
    const msg2 = { jsonrpc: "2.0", method: "two" };
    await Promise.all([transport.send(msg1), transport.send(msg2)]);

    expect(proc.sent).toEqual([msg1, msg2]);
  });

  it("isConnected reflects process state", () => {
    const transport = makeTransport();
    expect(transport.isConnected()).toBe(false);

    transport._connected = true;
    transport._process = { isConnected: vi.fn(() => false) };
    expect(transport.isConnected()).toBe(false);

    transport._process = { isConnected: vi.fn(() => true) };
    expect(transport.isConnected()).toBe(true);

    transport._connected = false;
    expect(transport.isConnected()).toBe(false);
  });

  it("list methods return arrays for empty or missing results", async () => {
    const transport = makeTransport();
    transport.request = vi.fn()
      .mockResolvedValueOnce({ tools: ["alpha"] })
      .mockResolvedValueOnce({ resources: [] })
      .mockResolvedValueOnce(undefined);

    await expect(transport.listTools()).resolves.toEqual(["alpha"]);
    await expect(transport.listResources()).resolves.toEqual([]);
    await expect(transport.listPrompts()).resolves.toEqual([]);
  });

  it("forwards boundary params to request for tool/resource/prompt calls", async () => {
    const transport = makeTransport();
    const request = vi.fn().mockResolvedValue("ok");
    transport.request = request;

    const hugeText = "x".repeat(100000);
    const deep = createDeepObject(20);

    await transport.callTool("", { file: hugeText, deep });
    await transport.callTool("tool", []);
    await transport.callTool("tool", null);
    await transport.readResource("");
    await transport.readResource("   ");
    await transport.getPrompt("prompt", undefined);
    await transport.getPrompt("prompt", null);

    expect(request).toHaveBeenCalledWith(McpMethods.TOOLS_CALL, {
      name: "",
      arguments: { file: hugeText, deep },
    });
    expect(request).toHaveBeenCalledWith(McpMethods.TOOLS_CALL, {
      name: "tool",
      arguments: [],
    });
    expect(request).toHaveBeenCalledWith(McpMethods.TOOLS_CALL, {
      name: "tool",
      arguments: null,
    });
    expect(request).toHaveBeenCalledWith(McpMethods.RESOURCES_READ, { uri: "" });
    expect(request).toHaveBeenCalledWith(McpMethods.RESOURCES_READ, { uri: "   " });
    expect(request).toHaveBeenCalledWith(McpMethods.PROMPTS_GET, { name: "prompt", arguments: {} });
    expect(request).toHaveBeenCalledWith(McpMethods.PROMPTS_GET, { name: "prompt", arguments: null });
  });

  it("supports concurrent requests", async () => {
    const transport = makeTransport();
    transport.request = vi.fn(async (method, params) => {
      if (method === McpMethods.TOOLS_CALL) {
        return { ok: params.name };
      }
      if (method === McpMethods.RESOURCES_READ) {
        return { uri: params.uri };
      }
      return null;
    });

    const [toolResult, resourceResult] = await Promise.all([
      transport.callTool("alpha", { id: 1 }),
      transport.readResource("file:///big"),
    ]);

    expect(toolResult).toEqual({ ok: "alpha" });
    expect(resourceResult).toEqual({ uri: "file:///big" });
  });
});

describe("createStdioMcpTransport", () => {
  it("creates a StdioMcpTransport instance", () => {
    const transport = createStdioMcpTransport({ command: "node" });
    expect(transport).toBeInstanceOf(StdioMcpTransport);
    expect(transport.command).toBe("node");
  });
});

describe("default export", () => {
  it("matches StdioMcpTransport", () => {
    expect(StdioMcpTransportDefault).toBe(StdioMcpTransport);
  });
});
