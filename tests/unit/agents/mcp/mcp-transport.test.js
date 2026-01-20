import { describe, it, expect, vi, beforeEach } from "vitest";

const sharedMocks = vi.hoisted(() => {
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const createLogger = vi.fn(() => logger);
  return { logger, createLogger };
});

vi.mock("../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../js/agents/shared/index.js");
  return {
    ...actual,
    createLogger: sharedMocks.createLogger,
  };
});

import { validateMcpMessage, McpTransport } from "../../../../js/agents/mcp/mcp-transport.js";

class TestTransport extends McpTransport {
  constructor(options = {}) {
    super(options);
    this.sent = [];
  }

  async connect() {
    this._connected = true;
  }

  async disconnect() {
    this._connected = false;
  }

  async send(message) {
    this.sent.push(message);
  }
}

function buildDeepObject(depth) {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
}

describe("validateMcpMessage", () => {
  beforeEach(() => {
    sharedMocks.logger.warn.mockClear();
    sharedMocks.logger.info.mockClear();
    sharedMocks.logger.error.mockClear();
    sharedMocks.logger.debug.mockClear();
  });

  it("accepts valid request/response/notification messages", () => {
    const cases = [
      { jsonrpc: "2.0", id: 0, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: -1, result: { ok: true } },
      {
        jsonrpc: "2.0",
        id: Number.MAX_SAFE_INTEGER,
        error: { code: -32600, message: "Invalid" },
      },
      { jsonrpc: "2.0", method: "notifications/initialized", params: [] },
      { jsonrpc: "2.0", id: "abc", method: "ping", params: null },
    ];

    for (const message of cases) {
      expect(validateMcpMessage(message)).toBeNull();
    }
  });

  it("rejects empty and non-object messages", () => {
    const cases = [
      { value: null, error: "message must be an object" },
      { value: undefined, error: "message must be an object" },
      { value: "", error: "message must be an object" },
      { value: [], error: "message must be an object" },
      { value: {}, error: "jsonrpc must be '2.0'" },
    ];

    for (const { value, error } of cases) {
      expect(validateMcpMessage(value)).toBe(error);
    }
  });

  it("validates id boundaries and rejects invalid ids", () => {
    const validIds = [0, -1, Number.MAX_SAFE_INTEGER, "42"];
    for (const id of validIds) {
      const message = { jsonrpc: "2.0", id, method: "ping" };
      expect(validateMcpMessage(message)).toBeNull();
    }

    const invalidIds = [NaN, Infinity, {}, []];
    for (const id of invalidIds) {
      const message = { jsonrpc: "2.0", id, method: "ping" };
      expect(validateMcpMessage(message)).toBe("id must be a string or number");
    }
  });

  it("rejects invalid method and params types", () => {
    expect(validateMcpMessage({ jsonrpc: "2.0", method: "" })).toBe("method must be a non-empty string");
    expect(validateMcpMessage({ jsonrpc: "2.0", method: "   " })).toBe("method must be a non-empty string");
    expect(validateMcpMessage({ jsonrpc: "2.0", method: "ping", params: "nope" })).toBe(
      "params must be an object or array",
    );

    const okObject = validateMcpMessage({ jsonrpc: "2.0", method: "ping", params: {} });
    const okArray = validateMcpMessage({ jsonrpc: "2.0", method: "ping", params: [] });
    expect(okObject).toBeNull();
    expect(okArray).toBeNull();
  });

  it("requires method, result, or error", () => {
    const message = { jsonrpc: "2.0", id: 1 };
    expect(validateMcpMessage(message)).toBe("message must include method, result, or error");
  });

  it("rejects invalid error shapes", () => {
    const cases = [
      { error: null },
      { error: { code: "1", message: "bad" } },
      { error: { code: 1, message: "" } },
      { error: { code: 1, message: "   " } },
    ];

    for (const { error } of cases) {
      const message = { jsonrpc: "2.0", id: 1, error };
      expect(validateMcpMessage(message)).toBe("error must include numeric code and string message");
    }
  });

  it("accepts large payloads and deep nesting", () => {
    const largeContent = "x".repeat(1024 * 1024);
    const deepParams = buildDeepObject(60);
    const message = {
      jsonrpc: "2.0",
      method: "upload",
      params: {
        content: largeContent,
        meta: deepParams,
        filename: "report.txt",
      },
    };

    expect(validateMcpMessage(message)).toBeNull();
  });
});

describe("McpTransport", () => {
  let transport;

  beforeEach(() => {
    sharedMocks.logger.warn.mockClear();
    sharedMocks.logger.info.mockClear();
    sharedMocks.logger.error.mockClear();
    sharedMocks.logger.debug.mockClear();
    transport = new TestTransport({ timeout: 20, heartbeatInterval: 15, maxRetries: 1, reconnectDelayBase: 5 });
  });

  it("constructs with defaults and preserves boundary option values", () => {
    const defaults = new TestTransport();
    expect(defaults.timeout).toBe(30000);
    expect(defaults.heartbeatInterval).toBe(30000);
    expect(defaults.maxRetries).toBe(3);
    expect(defaults.reconnectDelayBase).toBe(1000);
    expect(defaults.isConnected()).toBe(false);

    const custom = new TestTransport({
      timeout: 0,
      heartbeatInterval: -1,
      maxRetries: 0,
      reconnectDelayBase: Number.MAX_SAFE_INTEGER,
    });
    expect(custom.timeout).toBe(0);
    expect(custom.heartbeatInterval).toBe(-1);
    expect(custom.maxRetries).toBe(0);
    expect(custom.reconnectDelayBase).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("base abstract methods throw not implemented errors", async () => {
    const base = new McpTransport();
    await expect(base.connect()).rejects.toThrow(/not implemented/i);
    await expect(base.disconnect()).rejects.toThrow(/not implemented/i);
    await expect(base.send({ jsonrpc: "2.0", method: "ping" })).rejects.toThrow(/not implemented/i);
  });

  it("rejects request when not connected", async () => {
    await expect(transport.request("ping", {})).rejects.toThrow("Transport not connected");
  });

  it("sends requests and resolves when response arrives", async () => {
    await transport.connect();

    const promise = transport.request("tools/list", { filter: "all" });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/list",
      params: { filter: "all" },
    });

    const { id } = transport.sent[0];
    transport._handleMessage({ jsonrpc: "2.0", id, result: { tools: [] } });

    await expect(promise).resolves.toEqual({ tools: [] });
    expect(transport._pending.size).toBe(0);
  });

  it("rejects request when response contains error", async () => {
    await transport.connect();

    const promise = transport.request("tools/call", { name: "bad" });
    const { id } = transport.sent[0];
    transport._handleMessage({ jsonrpc: "2.0", id, error: { code: 500, message: "Boom" } });

    await expect(promise).rejects.toThrow("Boom");
  });

  it("rejects request when send fails and clears pending", async () => {
    await transport.connect();
    const failure = new Error("send failed");
    transport.send = vi.fn().mockRejectedValue(failure);

    const promise = transport.request("ping", {});
    await expect(promise).rejects.toThrow("send failed");
    expect(transport._pending.size).toBe(0);
  });

  it("times out pending requests", async () => {
    transport = new TestTransport({ timeout: 5 });
    await transport.connect();

    vi.useFakeTimers();
    const promise = transport.request("slow", {});
    const rejection = expect(promise).rejects.toThrow("Request timeout: slow");
    await vi.runAllTimersAsync();
    await rejection;
    expect(transport._pending.size).toBe(0);
    vi.useRealTimers();
  });

  it("sends notifications without awaiting responses", async () => {
    await transport.connect();
    await transport.notify("notifications/initialized", { ok: true });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toEqual({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: { ok: true },
    });
  });

  it("handles invalid incoming messages by emitting error and rejecting pending", async () => {
    await transport.connect();
    const errorHandler = vi.fn();
    transport.on("error", errorHandler);

    const promise = transport.request("ping", {});
    const { id } = transport.sent[0];

    transport._handleMessage({ jsonrpc: "1.0", id, method: "ping" });

    await expect(promise).rejects.toThrow(/Invalid MCP message/);
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(sharedMocks.logger.warn).toHaveBeenCalledWith(
      "Rejected MCP message",
      expect.objectContaining({ error: expect.stringContaining("Invalid MCP message") }),
    );
  });

  it("emits message and notification events for notifications", async () => {
    await transport.connect();
    const onMessage = vi.fn();
    const onNotification = vi.fn();

    transport.on("message", onMessage);
    transport.on("notification:ping", onNotification);

    const message = { jsonrpc: "2.0", method: "ping", params: { t: 1 } };
    transport._handleMessage(message);

    expect(onMessage).toHaveBeenCalledWith(message);
    expect(onNotification).toHaveBeenCalledWith({ t: 1 });
  });

  it("rejects all pending requests", async () => {
    await transport.connect();

    const p1 = transport.request("one", {});
    const p2 = transport.request("two", {});

    const error = new Error("shutdown");
    transport._rejectAllPending(error);

    const results = await Promise.allSettled([p1, p2]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(transport._pending.size).toBe(0);
  });

  it("handles concurrent requests with out-of-order responses", async () => {
    await transport.connect();

    const p1 = transport.request("first", { value: 1 });
    const p2 = transport.request("second", { value: 2 });

    const [firstMessage, secondMessage] = transport.sent;
    expect(firstMessage.id).toBe(1);
    expect(secondMessage.id).toBe(2);

    transport._handleMessage({ jsonrpc: "2.0", id: secondMessage.id, result: "two" });
    transport._handleMessage({ jsonrpc: "2.0", id: firstMessage.id, result: "one" });

    await expect(p2).resolves.toBe("two");
    await expect(p1).resolves.toBe("one");
  });
});
