import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import {
  ProcessTransport,
  createProcessTransport,
  BinarySkillProvider,
  createBinarySkillProvider,
} from "../../../../../js/agents/plugins/transports/index.node.js";

const createMockChildProcess = () => {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
  proc.killed = false;
  proc.kill = vi.fn((signal) => {
    proc.killed = true;
    proc.emit("exit", 0, signal);
  });
  return proc;
};

let mockProcess;

beforeEach(() => {
  spawnMock.mockReset();
  mockProcess = createMockChildProcess();
  spawnMock.mockReturnValue(mockProcess);
});

describe("ProcessTransport", () => {
  it("constructs with defaults and empty args", () => {
    const transport = new ProcessTransport({ command: "echo", args: [] });

    expect(transport.command).toBe("echo");
    expect(transport.args).toEqual([]);
    expect(transport.cwd).toBe(process.cwd());
    expect(transport.timeout).toBe(30000);
    expect(transport.signal).toBe(null);
  });

  it("handles timeout boundary values", () => {
    const zeroTimeout = new ProcessTransport({ command: "echo", timeout: 0 });
    const negativeTimeout = new ProcessTransport({ command: "echo", timeout: -1 });

    expect(zeroTimeout.timeout).toBe(30000);
    expect(negativeTimeout.timeout).toBe(-1);
  });

  it("treats non-array args as empty array", () => {
    const transport = new ProcessTransport({ command: "echo", args: {} });

    expect(transport.args).toEqual([]);
  });

  it("rejects invalid command values", () => {
    const invalidValues = [null, undefined, "", "   "];

    for (const value of invalidValues) {
      expect(() => new ProcessTransport({ command: value })).toThrow();
    }
  });

  it("rejects non-string cwd and non-string args entries", () => {
    expect(() => new ProcessTransport({ command: "echo", cwd: {} })).toThrow(
      "ProcessTransport cwd must be a string",
    );
    expect(() => new ProcessTransport({ command: "echo", args: [0] })).toThrow(
      "ProcessTransport args must be strings",
    );
  });

  it("send throws when not connected", () => {
    const transport = new ProcessTransport({ command: "echo" });

    expect(() => transport.send({ jsonrpc: "2.0", method: "ping" })).toThrow(
      "ProcessTransport not connected",
    );
  });

  it("connects on stdout data", async () => {
    const transport = new ProcessTransport({ command: "echo" });

    const connectPromise = transport.connect();
    mockProcess.stdout.emit("data", "ready\n");

    await expect(connectPromise).resolves.toBeUndefined();
    expect(transport.isConnected()).toBe(true);
  });

  it("handles concurrent requests and out-of-order responses", async () => {
    const transport = new ProcessTransport({ command: "echo" });
    transport.connected = true;
    transport.process = createMockChildProcess();

    const first = transport.request("first", { value: 1 });
    const second = transport.request("second", { value: 2 });

    transport._handleMessage({ id: 2, result: "two" });
    transport._handleMessage({ id: 1, result: "one" });

    await expect(first).resolves.toBe("one");
    await expect(second).resolves.toBe("two");
    expect(transport._pending.size).toBe(0);
  });

  it("rejects request on error response", async () => {
    const transport = new ProcessTransport({ command: "echo" });
    transport.connected = true;
    transport.process = createMockChildProcess();

    const promise = transport.request("boom", { value: 1 });
    transport._handleMessage({ id: 1, error: { message: "boom" } });

    await expect(promise).rejects.toThrow("boom");
  });

  it("times out requests when timeout is a string", async () => {
    vi.useFakeTimers();
    try {
      const transport = new ProcessTransport({ command: "echo", timeout: "1" });
      transport.connected = true;
      transport.process = createMockChildProcess();

      const promise = transport.request("slow", { value: 1 });
      vi.runAllTimers();

      await expect(promise).rejects.toThrow("Request timeout: slow");
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports MAX_SAFE_INTEGER request ids", async () => {
    const transport = new ProcessTransport({ command: "echo" });
    transport.connected = true;
    transport.process = createMockChildProcess();
    transport._requestId = Number.MAX_SAFE_INTEGER - 1;

    const promise = transport.request("max", { value: 1 });
    expect(transport._pending.has(Number.MAX_SAFE_INTEGER)).toBe(true);

    transport._handleMessage({ id: Number.MAX_SAFE_INTEGER, result: "ok" });

    await expect(promise).resolves.toBe("ok");
  });

  it("emits parse_error and invalid_message for malformed inputs", () => {
    const transport = new ProcessTransport({ command: "echo" });
    const parseSpy = vi.fn();
    const invalidSpy = vi.fn();

    transport.on("transport:parse_error", parseSpy);
    transport.on("transport:invalid_message", invalidSpy);

    transport.buffer = "{bad}\n{}\n";
    transport._processBuffer();

    expect(parseSpy).toHaveBeenCalledWith(
      expect.objectContaining({ line: "{bad}" }),
    );
    expect(invalidSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "invalid_keys" }),
    );
  });

  it("enforces buffer and message size limits", () => {
    const transport = new ProcessTransport({ command: "echo" });
    const overflowSpy = vi.fn();
    const tooLargeSpy = vi.fn();

    transport.on("transport:buffer_overflow", overflowSpy);
    transport.on("transport:message_too_large", tooLargeSpy);

    const oversizedBuffer = "a".repeat(transport._maxBufferSize + 10);
    transport.buffer = oversizedBuffer;
    transport._processBuffer();

    expect(overflowSpy).toHaveBeenCalledWith(
      expect.objectContaining({ size: oversizedBuffer.length }),
    );

    const largeLine = "b".repeat(transport._maxMessageSize + 1);
    transport.buffer = `${largeLine}\n`;
    transport._processBuffer();

    expect(tooLargeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ size: largeLine.length }),
    );
  });

  it("rejects long strings and deep nesting in params", () => {
    const transport = new ProcessTransport({ command: "echo" });
    const invalidSpy = vi.fn();

    transport.on("transport:invalid_message", invalidSpy);

    const longParam = "a".repeat(10001);
    let nested = "end";
    for (let i = 0; i < 9; i += 1) {
      nested = [nested];
    }

    transport.buffer =
      `${JSON.stringify({ jsonrpc: "2.0", method: "test", params: longParam })}\n` +
      `${JSON.stringify({ jsonrpc: "2.0", method: "test", params: nested })}\n`;
    transport._processBuffer();

    const reasons = invalidSpy.mock.calls.map((call) => call[0].reason);
    expect(reasons).toEqual(["invalid_params", "invalid_params"]);
  });
});

describe("createProcessTransport", () => {
  it("creates a ProcessTransport instance", () => {
    const transport = createProcessTransport({ command: "echo" });

    expect(transport).toBeInstanceOf(ProcessTransport);
  });

  it("throws when options are invalid", () => {
    expect(() => createProcessTransport({ command: "" })).toThrow(
      "ProcessTransport command is required",
    );
  });
});

describe("BinarySkillProvider", () => {
  const buildProvider = (skills) => {
    const eventBus = { emit: vi.fn() };
    const serviceBus = { register: vi.fn() };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    return {
      provider: new BinarySkillProvider({ skills, eventBus, serviceBus, logger }),
      eventBus,
      serviceBus,
      logger,
    };
  };

  it("initializes skills, registers services, and forwards events", async () => {
    const connectSpy = vi
      .spyOn(ProcessTransport.prototype, "connect")
      .mockResolvedValue();
    try {
      const { provider, eventBus, serviceBus } = buildProvider([
        { name: "alpha", command: "echo", methods: ["ping"] },
      ]);

      await provider.initialize();

      expect(serviceBus.register).toHaveBeenCalledWith(
        "alpha",
        expect.objectContaining({
          call: expect.any(Function),
          notify: expect.any(Function),
          isConnected: expect.any(Function),
        }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        "binary:alpha:connected",
        expect.objectContaining({ payload: {} }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        "binary:provider:ready",
        expect.objectContaining({ payload: { skills: ["alpha"] } }),
      );

      const { transport } = provider._connections.get("alpha");
      transport.emit("transport:message", { method: "ping", params: { ok: true } });

      expect(eventBus.emit).toHaveBeenCalledWith(
        "binary:alpha:message",
        expect.objectContaining({ payload: { method: "ping", params: { ok: true } } }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        "binary:alpha:ping",
        expect.objectContaining({ payload: { ok: true } }),
      );
    } finally {
      connectSpy.mockRestore();
    }
  });

  it("initializes with an empty skills list", async () => {
    const { provider, eventBus } = buildProvider([]);

    await provider.initialize();

    expect(eventBus.emit).toHaveBeenCalledWith(
      "binary:provider:ready",
      expect.objectContaining({ payload: { skills: [] } }),
    );
  });

  it("reports connection failures", async () => {
    const connectSpy = vi
      .spyOn(ProcessTransport.prototype, "connect")
      .mockRejectedValue(new Error("connect failed"));
    try {
      const { provider, logger } = buildProvider([
        { name: "beta", command: "echo" },
      ]);

      await expect(provider.initialize()).rejects.toThrow("connect failed");
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to connect binary skill: beta",
        expect.any(Error),
      );
      expect(provider.getConnectedSkills()).toEqual([]);
    } finally {
      connectSpy.mockRestore();
    }
  });

  it("emits call and result events", async () => {
    const { provider, eventBus } = buildProvider([]);
    const transport = {
      request: vi.fn().mockResolvedValue("ok"),
      notify: vi.fn(),
      isConnected: vi.fn(() => true),
    };

    provider._connections.set("skill", {
      transport,
      config: { name: "skill", methods: ["run"] },
    });

    const result = await provider.call("skill", "run", { value: 1 });

    expect(result).toBe("ok");
    expect(eventBus.emit).toHaveBeenCalledWith(
      "binary:skill:call",
      expect.objectContaining({ payload: { method: "run", params: { value: 1 } } }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      "binary:skill:result",
      expect.objectContaining({ payload: { method: "run", result: "ok" } }),
    );
  });

  it("emits error events when call fails", async () => {
    const { provider, eventBus } = buildProvider([]);
    const transport = {
      request: vi.fn().mockRejectedValue(new Error("boom")),
      notify: vi.fn(),
      isConnected: vi.fn(() => true),
    };

    provider._connections.set("skill", {
      transport,
      config: { name: "skill", methods: ["run"] },
    });

    await expect(provider.call("skill", "run", { value: 1 })).rejects.toThrow(
      "boom",
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      "binary:skill:error",
      expect.objectContaining({ payload: { method: "run", error: "boom" } }),
    );
  });

  it("handles concurrent calls", async () => {
    const { provider } = buildProvider([]);
    const transport = {
      request: vi
        .fn()
        .mockResolvedValueOnce("first")
        .mockResolvedValueOnce("second"),
      notify: vi.fn(),
      isConnected: vi.fn(() => true),
    };

    provider._connections.set("skill", {
      transport,
      config: { name: "skill", methods: ["run"] },
    });

    const [first, second] = await Promise.all([
      provider.call("skill", "run", { value: 1 }),
      provider.call("skill", "run", { value: 2 }),
    ]);

    expect(first).toBe("first");
    expect(second).toBe("second");
    expect(transport.request).toHaveBeenCalledTimes(2);
  });

  it("builds tool definitions with defaults and empty methods", () => {
    const { provider } = buildProvider([]);
    const transport = {
      request: vi.fn(),
      notify: vi.fn(),
      isConnected: vi.fn(() => true),
    };

    provider._connections.set("alpha", {
      transport,
      config: { name: "alpha" },
    });
    provider._connections.set("beta", {
      transport,
      config: { name: "beta", methods: [] },
    });

    const tools = provider.getToolDefinitions();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(["alpha.run"]);
  });

  it("shutdown disconnects transports and clears state", async () => {
    const { provider, eventBus } = buildProvider([]);
    const transport = {
      disconnect: vi.fn(),
      request: vi.fn(),
      notify: vi.fn(),
      isConnected: vi.fn(() => true),
    };

    provider._connections.set("alpha", { transport, config: { name: "alpha" } });
    provider._connections.set("beta", { transport, config: { name: "beta" } });

    await provider.shutdown();

    expect(transport.disconnect).toHaveBeenCalledTimes(2);
    expect(provider.getConnectedSkills()).toEqual([]);
    expect(eventBus.emit).toHaveBeenCalledWith(
      "binary:alpha:disconnected",
      expect.objectContaining({ payload: {} }),
    );
  });

  it("throws when skills is not iterable", async () => {
    const { provider } = buildProvider({});

    await expect(provider.initialize()).rejects.toThrow();
  });

  it("throws when calling missing skill", async () => {
    const { provider } = buildProvider([]);

    await expect(provider.call("missing", "run", {})).rejects.toThrow(
      "Binary skill not found: missing",
    );
  });
});

describe("createBinarySkillProvider", () => {
  it("creates a BinarySkillProvider instance", () => {
    const provider = createBinarySkillProvider({ skills: [] });

    expect(provider).toBeInstanceOf(BinarySkillProvider);
  });

  it("throws when options are null", () => {
    expect(() => createBinarySkillProvider(null)).toThrow();
  });
});
