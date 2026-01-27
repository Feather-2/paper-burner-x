import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mcpProviderCtorArgs: [],
  transportInstances: [],
  nextConnectDeferred: null,
  nextConnectError: null,
  nextDisconnectError: null,
}));

function createDeferred() {
  /** @type {(value?: any) => void} */
  let resolve;
  /** @type {(reason?: any) => void} */
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

vi.mock("../../../../js/agents/mcp/mcp-client.js", () => {
  class McpProvider {
    constructor(options) {
      state.mcpProviderCtorArgs.push(options);
      this.id = options?.id;
      this.name = options?.name;
      this.endpoint = options?.endpoint;
    }
  }

  class McpToolDefinition {}
  class McpToolResult {}

  return { McpProvider, McpToolDefinition, McpToolResult };
});

vi.mock("../../../../js/agents/shared/index.js", () => {
  function toNonEmptyString(value) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "";
  }
  return { toNonEmptyString };
});

vi.mock("../../../../js/agents/mcp/stdio-mcp-transport.js", () => {
  class StdioMcpTransport {
    constructor(options) {
      this.options = options;
      this._connected = false;

      this.isConnected = vi.fn(() => this._connected);

      this.connect = vi.fn(() => {
        if (state.nextConnectError) {
          const error = state.nextConnectError;
          state.nextConnectError = null;
          return Promise.reject(error);
        }

        const deferred = state.nextConnectDeferred;
        if (deferred) {
          state.nextConnectDeferred = null;
          return deferred.promise.then(() => {
            this._connected = true;
          });
        }

        this._connected = true;
        return Promise.resolve();
      });

      this.disconnect = vi.fn(() => {
        if (state.nextDisconnectError) {
          const error = state.nextDisconnectError;
          state.nextDisconnectError = null;
          return Promise.reject(error);
        }

        this._connected = false;
        return Promise.resolve();
      });

      state.transportInstances.push(this);
    }
  }

  return { StdioMcpTransport };
});

import { StdioMcpProvider } from "../../../../js/agents/mcp/stdio-mcp-provider.js";

beforeEach(() => {
  state.mcpProviderCtorArgs.length = 0;
  state.transportInstances.length = 0;
  state.nextConnectDeferred = null;
  state.nextConnectError = null;
  state.nextDisconnectError = null;
  vi.clearAllMocks();
});

describe("StdioMcpProvider", () => {
  describe("constructor", () => {
    it("defaults id/name and initializes properties", () => {
      const provider = new StdioMcpProvider({
        command: "cmd",
        allowedCommands: ["cmd"],
      });

      expect(state.mcpProviderCtorArgs).toEqual([
        { id: "stdio-mcp", name: "stdio-mcp", endpoint: "stdio" },
      ]);

      expect(provider.id).toBe("stdio-mcp");
      expect(provider.name).toBe("stdio-mcp");
      expect(provider.endpoint).toBe("stdio");

      expect(provider.command).toBe("cmd");
      expect(provider.args).toEqual([]);
      expect(provider.env).toEqual({});
      expect(provider.cwd).toBe(undefined);
      expect(provider.timeout).toBe(30000);
      expect(provider.autoConnect).toBe(true);
      expect(provider.lazyConnect).toBe(false);

      expect(provider._transport).toBe(null);
      expect(provider._toolsCache).toBe(null);
      expect(provider._connectPromise).toBe(null);
    });

    it("trims id/name/command via toNonEmptyString", () => {
      const provider = new StdioMcpProvider({
        id: "  my-id  ",
        name: "  My Provider  ",
        command: "  cmd  ",
        allowedCommands: ["cmd"],
      });

      expect(provider.id).toBe("my-id");
      expect(provider.name).toBe("My Provider");
      expect(provider.command).toBe("cmd");
      expect(state.mcpProviderCtorArgs[0]).toEqual({
        id: "my-id",
        name: "My Provider",
        endpoint: "stdio",
      });
    });

    it("throws when options is undefined (null/undefined boundary)", () => {
      expect(() => new StdioMcpProvider(/** @type {any} */ (undefined))).toThrow();
      expect(() => new StdioMcpProvider(/** @type {any} */ (null))).toThrow();
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["empty string", ""],
      ["whitespace string", "   "],
      ["number (type boundary)", 123],
      ["object (type boundary)", { command: "cmd" }],
    ])("throws when command is invalid: %s", (_label, command) => {
      expect(
        () =>
          new StdioMcpProvider({
            command: /** @type {any} */ (command),
            allowedCommands: ["cmd"],
          })
      ).toThrow("StdioMcpProvider: command is required");
    });

    it("throws when unsafe is not enabled and allowlist is missing", () => {
      expect(() => new StdioMcpProvider({ command: "cmd" })).toThrow(
        "StdioMcpProvider: command not allowed without allowlist or allowUnsafeCommand"
      );
    });

    it("throws when allowedCommands is not an array (type boundary)", () => {
      expect(
        () =>
          new StdioMcpProvider({
            command: "cmd",
            allowedCommands: /** @type {any} */ ({}),
          })
      ).toThrow("StdioMcpProvider: command not allowed without allowlist or allowUnsafeCommand");
    });

    it("throws when command is not in allowedCommands", () => {
      expect(
        () =>
          new StdioMcpProvider({
            command: "cmd",
            allowedCommands: ["other"],
          })
      ).toThrow("StdioMcpProvider: command is not in allowedCommands");
    });

    it("allows command when allowedCommands contains the trimmed command (ignores empty entries)", () => {
      const provider = new StdioMcpProvider({
        command: "  cmd  ",
        allowedCommands: ["", "   ", "cmd", "  cmd  "],
      });

      expect(provider.command).toBe("cmd");
    });

    it("allows command when allowUnsafeCommand is true even without allowlist", () => {
      const provider = new StdioMcpProvider({
        command: "cmd",
        allowUnsafeCommand: true,
      });

      expect(provider.command).toBe("cmd");
    });

    it("allows command when allowUnsafeCommands (legacy) is true even without allowlist", () => {
      const provider = new StdioMcpProvider({
        command: "cmd",
        allowUnsafeCommands: true,
      });

      expect(provider.command).toBe("cmd");
    });

    it("forwards extreme/edge option shapes without mutation (resource/type boundaries)", async () => {
      const longCommand = "x".repeat(10_000);
      /** @type {any} */
      const argsObject = { not: ["an", "array"], deep: { level: { n: 1 } } };
      /** @type {any} */
      const deepEnv = {
        A: "1",
        nested: { level2: { level3: { level4: { value: "x" } } } },
      };

      const provider = new StdioMcpProvider({
        id: "   ",
        name: "   ",
        command: longCommand,
        args: argsObject,
        env: deepEnv,
        cwd: "",
        timeout: Number.MAX_SAFE_INTEGER,
        autoConnect: /** @type {any} */ (0),
        lazyConnect: /** @type {any} */ ("true"),
        allowUnsafeCommand: true,
      });

      expect(provider.id).toBe("stdio-mcp");
      expect(provider.name).toBe("stdio-mcp");
      expect(provider.command).toBe(longCommand);
      expect(provider.args).toBe(argsObject);
      expect(provider.env).toBe(deepEnv);
      expect(provider.cwd).toBe("");
      expect(provider.timeout).toBe(Number.MAX_SAFE_INTEGER);
      expect(provider.autoConnect).toBe(true);
      expect(provider.lazyConnect).toBe(false);

      await provider.connect();
      expect(state.transportInstances).toHaveLength(1);
      expect(state.transportInstances[0].options).toEqual({
        command: longCommand,
        args: argsObject,
        env: deepEnv,
        cwd: "",
        timeout: Number.MAX_SAFE_INTEGER,
        autoInit: true,
      });
    });
  });

  describe("connect", () => {
    it("creates a transport and connects with expected options", async () => {
      const provider = new StdioMcpProvider({
        command: "cmd",
        args: ["--foo", "bar"],
        env: { FOO: "1" },
        cwd: "/work",
        timeout: 123,
        allowedCommands: ["cmd"],
      });

      await provider.connect();

      expect(state.transportInstances).toHaveLength(1);
      const transport = state.transportInstances[0];

      expect(transport.options).toEqual({
        command: "cmd",
        args: ["--foo", "bar"],
        env: { FOO: "1" },
        cwd: "/work",
        timeout: 123,
        autoInit: true,
      });

      expect(transport.connect).toHaveBeenCalledTimes(1);
      expect(provider._transport).toBe(transport);
      expect(provider._connectPromise).toBe(null);
    });

    it("is a no-op when already connected", async () => {
      const provider = new StdioMcpProvider({
        command: "cmd",
        allowedCommands: ["cmd"],
      });

      await provider.connect();
      const transport = state.transportInstances[0];

      await provider.connect();

      expect(state.transportInstances).toHaveLength(1);
      expect(transport.connect).toHaveBeenCalledTimes(1);
    });

    it("deduplicates concurrent connect() calls (concurrency boundary)", async () => {
      const provider = new StdioMcpProvider({
        command: "cmd",
        allowedCommands: ["cmd"],
      });

      const deferred = createDeferred();
      state.nextConnectDeferred = deferred;

      const p1 = provider.connect();
      const p2 = provider.connect();

      expect(state.transportInstances).toHaveLength(1);
      const transport = state.transportInstances[0];

      expect(transport.connect).toHaveBeenCalledTimes(1);
      expect(provider._connectPromise).not.toBe(null);

      deferred.resolve();
      await Promise.all([p1, p2]);

      expect(provider._connectPromise).toBe(null);
      expect(transport.isConnected()).toBe(true);

      await provider.connect();
      expect(state.transportInstances).toHaveLength(1);
      expect(transport.connect).toHaveBeenCalledTimes(1);
    });

    it("clears _connectPromise and allows retry after connect failure", async () => {
      const provider = new StdioMcpProvider({
        command: "cmd",
        allowedCommands: ["cmd"],
      });

      state.nextConnectError = new Error("boom");
      await expect(provider.connect()).rejects.toThrow("boom");
      expect(provider._connectPromise).toBe(null);

      await provider.connect();
      expect(state.transportInstances).toHaveLength(2);
      expect(state.transportInstances[1].connect).toHaveBeenCalledTimes(1);
      expect(provider._transport).toBe(state.transportInstances[1]);
    });

    it.each([
      ["0", 0],
      ["-1", -1],
      ["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
      ["string (type boundary)", "123"],
    ])("forwards timeout boundary value: %s", async (_label, timeout) => {
      const provider = new StdioMcpProvider({
        command: "cmd",
        timeout: /** @type {any} */ (timeout),
        allowedCommands: ["cmd"],
      });

      await provider.connect();
      expect(state.transportInstances[0].options.timeout).toBe(timeout);
    });
  });

  describe("disconnect", () => {
    it("disconnects transport, clears transport reference and tools cache, and is idempotent", async () => {
      const provider = new StdioMcpProvider({
        command: "cmd",
        allowedCommands: ["cmd"],
      });

      await provider.connect();
      const transport = state.transportInstances[0];

      provider._toolsCache = /** @type {any} */ ([{ name: "tool" }]);

      await provider.disconnect();
      expect(transport.disconnect).toHaveBeenCalledTimes(1);
      expect(provider._transport).toBe(null);
      expect(provider._toolsCache).toBe(null);

      await provider.disconnect();
      expect(transport.disconnect).toHaveBeenCalledTimes(1);
      expect(provider._transport).toBe(null);
      expect(provider._toolsCache).toBe(null);
    });

    it("clears tools cache even when no transport exists", async () => {
      const provider = new StdioMcpProvider({
        command: "cmd",
        allowedCommands: ["cmd"],
      });

      provider._toolsCache = /** @type {any} */ ([{ name: "cached" }]);
      await provider.disconnect();

      expect(state.transportInstances).toHaveLength(0);
      expect(provider._transport).toBe(null);
      expect(provider._toolsCache).toBe(null);
    });

    it("propagates errors from transport.disconnect()", async () => {
      const provider = new StdioMcpProvider({
        command: "cmd",
        allowedCommands: ["cmd"],
      });

      await provider.connect();
      const transport = state.transportInstances[0];

      state.nextDisconnectError = new Error("disconnect-failed");
      await expect(provider.disconnect()).rejects.toThrow("disconnect-failed");
      expect(provider._transport).toBe(transport);
    });
  });
});