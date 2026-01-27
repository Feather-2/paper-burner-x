import { describe, it, expect, vi, beforeEach } from "vitest";

let isNodeLikeValue = true;
let throwStdioTransportImport = false;
let throwStdioProviderImport = false;

// Captured mock modules/exports (reset per fresh import)
let sharedModule;
let mcpClientModule;
let mcpClientInstances;

let localProviderModule;
let nexusProviderModule;

let stdioTransportModule;
let stdioProviderModule;

let transportModule;
let transportFactoryModule;

let resourceManagerModule;
let sseModule;

// --- Mocks (external dependencies) ---

vi.mock("../../../../js/agents/shared/index.js", () => {
  sharedModule = {
    isNodeLike: vi.fn(() => isNodeLikeValue),
  };
  return sharedModule;
});

vi.mock("../../../../js/agents/mcp/mcp-client.js", () => {
  mcpClientInstances = [];

  class McpClient {
    constructor() {
      mcpClientInstances.push(this);
      this.providers = [];
      this.addProvider = vi.fn((provider) => {
        this.providers.push(provider);
      });
    }
  }

  class McpProvider {}
  class McpToolDefinition {}
  class McpToolResult {}

  mcpClientModule = { McpProvider, McpClient, McpToolDefinition, McpToolResult };
  return mcpClientModule;
});

vi.mock("../../../../js/agents/mcp/local-mcp-provider.js", () => {
  const LocalMcpProvider = vi.fn(function (config) {
    this.config = config;
  });

  const createLocalMcpProvider = vi.fn((options) => ({
    kind: "local",
    options,
  }));

  localProviderModule = { LocalMcpProvider, createLocalMcpProvider };
  return localProviderModule;
});

vi.mock("../../../../js/agents/mcp/mcp-nexus-provider.js", () => {
  const McpNexusProvider = vi.fn(function (config) {
    this.config = config;
  });

  nexusProviderModule = { McpNexusProvider };
  return nexusProviderModule;
});

vi.mock("../../../../js/agents/mcp/resource-manager.js", () => {
  class McpResourceManager {}
  resourceManagerModule = { McpResourceManager };
  return resourceManagerModule;
});

vi.mock("../../../../js/agents/mcp/sse.js", () => {
  const createSseParser = vi.fn((options) => ({
    kind: "sse-parser",
    options,
    parse: vi.fn(),
  }));

  const consumeSse = vi.fn((input) => ({ kind: "consumeSse", input }));
  const consumeSseJson = vi.fn((input) => ({ kind: "consumeSseJson", input }));

  sseModule = { createSseParser, consumeSse, consumeSseJson };
  return sseModule;
});

vi.mock("../../../../js/agents/mcp/mcp-transport.js", () => {
  class McpTransport {}
  const MCP_PROTOCOL_VERSION = "mock-protocol-version";
  const MCP_SUPPORTED_VERSIONS = ["mock-v1", "mock-v0"];
  const McpMethods = Object.freeze({
    ping: "ping",
    listTools: "listTools",
    callTool: "callTool",
  });

  transportModule = { McpTransport, MCP_PROTOCOL_VERSION, MCP_SUPPORTED_VERSIONS, McpMethods };
  return transportModule;
});

vi.mock("../../../../js/agents/mcp/transport-factory.js", () => {
  const createMcpTransport = vi.fn((options) => ({ kind: "mcp-transport", options }));
  const getSupportedTransports = vi.fn(() => ["mock-transport"]);

  transportFactoryModule = { createMcpTransport, getSupportedTransports };
  return transportFactoryModule;
});

vi.mock("../../../../js/agents/mcp/stdio-mcp-transport.js", () => {
  if (throwStdioTransportImport) {
    throw new Error("mock stdio transport import failure");
  }

  class StdioMcpTransport {}
  const createStdioMcpTransport = vi.fn((options) => ({ kind: "stdio-transport", options }));

  stdioTransportModule = { StdioMcpTransport, createStdioMcpTransport };
  return stdioTransportModule;
});

vi.mock("../../../../js/agents/mcp/stdio-mcp-provider.js", () => {
  if (throwStdioProviderImport) {
    throw new Error("mock stdio provider import failure");
  }

  const StdioMcpProvider = vi.fn(function (config) {
    this.config = config;
  });
  const createStdioMcpProvider = vi.fn((config) => ({ kind: "stdio-provider", config }));

  stdioProviderModule = { StdioMcpProvider, createStdioMcpProvider };
  return stdioProviderModule;
});

// --- Helpers ---

beforeEach(() => {
  isNodeLikeValue = true;
  throwStdioTransportImport = false;
  throwStdioProviderImport = false;

  sharedModule = undefined;
  mcpClientModule = undefined;
  mcpClientInstances = undefined;
  localProviderModule = undefined;
  nexusProviderModule = undefined;
  stdioTransportModule = undefined;
  stdioProviderModule = undefined;
  transportModule = undefined;
  transportFactoryModule = undefined;
  resourceManagerModule = undefined;
  sseModule = undefined;

  vi.clearAllMocks();
});

async function loadIndexModule({
  isNodeLike = true,
  stdioTransportThrows = false,
  stdioProviderThrows = false,
} = {}) {
  isNodeLikeValue = isNodeLike;
  throwStdioTransportImport = stdioTransportThrows;
  throwStdioProviderImport = stdioProviderThrows;

  // Prevent stale values when certain modules aren't imported (e.g., isNodeLike=false)
  stdioTransportModule = undefined;
  stdioProviderModule = undefined;

  vi.resetModules();
  return await import("../../../../js/agents/mcp/index.js");
}

// --- Tests ---

describe("createMcpClient", () => {
  it("creates a client and adds LocalMcpProvider by default", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });

    const client = mod.createMcpClient();

    expect(sharedModule.isNodeLike).toHaveBeenCalledTimes(1);
    expect(client).toBeInstanceOf(mcpClientModule.McpClient);
    expect(localProviderModule.LocalMcpProvider).toHaveBeenCalledTimes(1);
    expect(nexusProviderModule.McpNexusProvider).not.toHaveBeenCalled();

    const localConfig = localProviderModule.LocalMcpProvider.mock.calls[0][0];
    expect(localConfig).toEqual({ id: "local-mcp" });

    const localInstance = localProviderModule.LocalMcpProvider.mock.instances[0];
    expect(client.addProvider).toHaveBeenCalledTimes(1);
    expect(client.addProvider).toHaveBeenCalledWith(localInstance);
    expect(client.providers).toEqual([localInstance]);
  });

  it("does not add LocalMcpProvider when useLocal is false", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });

    const client = mod.createMcpClient({ useLocal: false });

    expect(client).toBeInstanceOf(mcpClientModule.McpClient);
    expect(localProviderModule.LocalMcpProvider).not.toHaveBeenCalled();
    expect(client.addProvider).not.toHaveBeenCalled();
    expect(client.providers).toEqual([]);
  });

  it("merges localOptions (including overriding default id)", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });

    const client = mod.createMcpClient({
      localOptions: { id: "override-id", extra: "x" },
    });

    expect(client).toBeInstanceOf(mcpClientModule.McpClient);
    const localConfig = localProviderModule.LocalMcpProvider.mock.calls[0][0];
    expect(localConfig).toEqual({ id: "override-id", extra: "x" });
  });

  it("adds McpNexusProvider when nexusEndpoint is provided and merges nexusOptions object", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });

    const nested = { level1: { level2: { level3: { value: 1 } } } };
    const nexusOptions = {
      apiKey: "k",
      timeout: Number.MAX_SAFE_INTEGER,
      nested,
    };

    const client = mod.createMcpClient({
      nexusEndpoint: "http://example.test",
      nexusOptions,
    });

    expect(localProviderModule.LocalMcpProvider).toHaveBeenCalledTimes(1);
    expect(nexusProviderModule.McpNexusProvider).toHaveBeenCalledTimes(1);
    expect(client.addProvider).toHaveBeenCalledTimes(2);

    const nexusConfig = nexusProviderModule.McpNexusProvider.mock.calls[0][0];
    expect(nexusConfig.id).toBe("mcp-nexus");
    expect(nexusConfig.endpoint).toBe("http://example.test");
    expect(nexusConfig.apiKey).toBe("k");
    expect(nexusConfig.timeout).toBe(Number.MAX_SAFE_INTEGER);
    expect(nexusConfig.nested).toBe(nested);
  });

  it("does not add McpNexusProvider when nexusEndpoint is empty string", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });

    const client = mod.createMcpClient({ nexusEndpoint: "" });

    expect(client).toBeInstanceOf(mcpClientModule.McpClient);
    expect(nexusProviderModule.McpNexusProvider).not.toHaveBeenCalled();
    expect(client.providers).toHaveLength(1);
  });

  it("treats whitespace-only nexusEndpoint as truthy and adds McpNexusProvider", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });

    mod.createMcpClient({ nexusEndpoint: "   " });

    expect(nexusProviderModule.McpNexusProvider).toHaveBeenCalledTimes(1);
    const nexusConfig = nexusProviderModule.McpNexusProvider.mock.calls[0][0];
    expect(nexusConfig.endpoint).toBe("   ");
  });

  it("handles nexusOptions type boundaries (string ignored, array spread) without crashing", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });

    mod.createMcpClient({
      nexusEndpoint: "http://example.test",
      nexusOptions: "not-an-object",
    });

    let nexusConfig = nexusProviderModule.McpNexusProvider.mock.calls[0][0];
    expect(nexusConfig).toEqual({ id: "mcp-nexus", endpoint: "http://example.test" });

    nexusProviderModule.McpNexusProvider.mockClear();

    mod.createMcpClient({
      nexusEndpoint: "http://example.test",
      nexusOptions: ["a", "b"],
    });

    nexusConfig = nexusProviderModule.McpNexusProvider.mock.calls[0][0];
    expect(nexusConfig.id).toBe("mcp-nexus");
    expect(nexusConfig.endpoint).toBe("http://example.test");
    expect(nexusConfig["0"]).toBe("a");
    expect(nexusConfig["1"]).toBe("b");
  });

  it("adds StdioMcpProvider for valid stdioProviders and skips invalid entries", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });

    const hugeCommand = "x".repeat(100_000);
    const configs = [
      null,
      undefined,
      {},
      { id: "empty", command: "" },
      { id: "zero", command: 0 },
      { id: "ok1", command: "echo", args: [] },
      { id: "ok2", command: "   " },
      { id: "ok3", command: hugeCommand },
    ];

    const client = mod.createMcpClient({ stdioProviders: configs });

    expect(stdioProviderModule).toBeDefined();
    expect(stdioProviderModule.StdioMcpProvider).toHaveBeenCalledTimes(3);

    const callArgs = stdioProviderModule.StdioMcpProvider.mock.calls.map((c) => c[0]);
    expect(callArgs).toEqual([configs[5], configs[6], configs[7]]);

    expect(client.addProvider).toHaveBeenCalledTimes(4); // 1 local + 3 stdio
    expect(client.providers).toHaveLength(4);
  });

  it("ignores stdioProviders when it is not an array (type boundary: object as array)", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });

    const client = mod.createMcpClient({
      stdioProviders: /** @type {any} */ ({ not: "an-array" }),
    });

    expect(client.providers).toHaveLength(1);
    expect(stdioProviderModule.StdioMcpProvider).not.toHaveBeenCalled();
  });

  it("throws when stdioProviders is used in non-node environment (StdioMcpProvider undefined)", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });

    expect(mod.StdioMcpProvider).toBeUndefined();
    expect(() =>
      mod.createMcpClient({
        stdioProviders: [{ id: "x", command: "echo" }],
      })
    ).toThrow(TypeError);
  });

  it("throws TypeError when options is null", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });

    expect(() => mod.createMcpClient(null)).toThrow(TypeError);
  });

  it("accepts primitive options values (0, -1, MAX_SAFE_INTEGER, '0') without crashing", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });

    for (const value of [0, -1, Number.MAX_SAFE_INTEGER, "0"]) {
      const client = mod.createMcpClient(/** @type {any} */ (value));
      expect(client).toBeInstanceOf(mcpClientModule.McpClient);
      expect(client.providers).toHaveLength(1);
    }
  });

  it("creates independent clients under rapid concurrent calls", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });

    const clients = await Promise.all(
      Array.from({ length: 25 }, () => Promise.resolve(mod.createMcpClient()))
    );

    expect(new Set(clients).size).toBe(25);
    expect(localProviderModule.LocalMcpProvider).toHaveBeenCalledTimes(25);

    const providerArrays = clients.map((c) => c.providers);
    expect(new Set(providerArrays).size).toBe(25);

    clients[0].providers.push({ sentinel: true });
    expect(clients[0].providers).toHaveLength(2);
    for (let i = 1; i < clients.length; i++) {
      expect(clients[i].providers).toHaveLength(1);
    }
  });

  it("passes through long strings and deep objects without mutation", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });

    const longEndpoint = `http://example.test/${"a".repeat(100_000)}`;
    const deep = { a: { b: { c: { d: { e: 1 } } } } };

    mod.createMcpClient({
      nexusEndpoint: longEndpoint,
      nexusOptions: { deep },
    });

    const nexusConfig = nexusProviderModule.McpNexusProvider.mock.calls[0][0];
    expect(nexusConfig.endpoint).toBe(longEndpoint);
    expect(nexusConfig.deep).toBe(deep);
  });
});

describe("McpProvider", () => {
  it("re-exports McpProvider from mcp-client.js", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });
    expect(mod.McpProvider).toBe(mcpClientModule.McpProvider);
  });
});

describe("McpClient", () => {
  it("re-exports McpClient from mcp-client.js and can be constructed", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });

    expect(mod.McpClient).toBe(mcpClientModule.McpClient);

    const client = new mod.McpClient();
    expect(client).toBeInstanceOf(mcpClientModule.McpClient);
    expect(Array.isArray(client.providers)).toBe(true);
    expect(typeof client.addProvider).toBe("function");
  });
});

describe("McpToolDefinition", () => {
  it("re-exports McpToolDefinition from mcp-client.js", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });
    expect(mod.McpToolDefinition).toBe(mcpClientModule.McpToolDefinition);
  });
});

describe("McpToolResult", () => {
  it("re-exports McpToolResult from mcp-client.js", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });
    expect(mod.McpToolResult).toBe(mcpClientModule.McpToolResult);
  });
});

describe("LocalMcpProvider", () => {
  it("re-exports LocalMcpProvider from local-mcp-provider.js", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });
    expect(mod.LocalMcpProvider).toBe(localProviderModule.LocalMcpProvider);
  });
});

describe("createLocalMcpProvider", () => {
  it("re-exports createLocalMcpProvider and forwards calls", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });

    const input = { id: "x", extra: "" };
    const result = mod.createLocalMcpProvider(input);

    expect(localProviderModule.createLocalMcpProvider).toHaveBeenCalledTimes(1);
    expect(localProviderModule.createLocalMcpProvider).toHaveBeenCalledWith(input);
    expect(result).toEqual({ kind: "local", options: input });
  });
});

describe("McpNexusProvider", () => {
  it("re-exports McpNexusProvider from mcp-nexus-provider.js", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });
    expect(mod.McpNexusProvider).toBe(nexusProviderModule.McpNexusProvider);
  });
});

describe("StdioMcpProvider", () => {
  it("is undefined when isNodeLike() is false", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });
    expect(sharedModule.isNodeLike).toHaveBeenCalledTimes(1);
    expect(mod.StdioMcpProvider).toBeUndefined();
  });

  it("re-exports StdioMcpProvider when stdio modules load in node-like environment", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });
    expect(mod.StdioMcpProvider).toBe(stdioProviderModule.StdioMcpProvider);
  });

  it("stays undefined when stdio modules fail to import (error handled)", async () => {
    const mod = await loadIndexModule({ isNodeLike: true, stdioTransportThrows: true });
    expect(mod.StdioMcpProvider).toBeUndefined();
    expect(mod.createMcpClient).toBeTypeOf("function");
  });
});

describe("createStdioMcpProvider", () => {
  it("is undefined when isNodeLike() is false", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });
    expect(mod.createStdioMcpProvider).toBeUndefined();
  });

  it("re-exports createStdioMcpProvider when stdio modules load in node-like environment", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });
    expect(mod.createStdioMcpProvider).toBe(stdioProviderModule.createStdioMcpProvider);
  });

  it("stays undefined when stdio provider import fails (error handled)", async () => {
    const mod = await loadIndexModule({ isNodeLike: true, stdioProviderThrows: true });
    expect(mod.createStdioMcpProvider).toBeUndefined();
  });
});

describe("McpTransport", () => {
  it("re-exports McpTransport from mcp-transport.js", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });
    expect(mod.McpTransport).toBe(transportModule.McpTransport);
  });
});

describe("StdioMcpTransport", () => {
  it("is undefined when isNodeLike() is false", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });
    expect(mod.StdioMcpTransport).toBeUndefined();
  });

  it("re-exports StdioMcpTransport when stdio modules load in node-like environment", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });
    expect(mod.StdioMcpTransport).toBe(stdioTransportModule.StdioMcpTransport);
  });

  it("stays undefined when stdio provider import fails (error handled, no partial assignment)", async () => {
    const mod = await loadIndexModule({ isNodeLike: true, stdioProviderThrows: true });
    expect(mod.StdioMcpTransport).toBeUndefined();
    expect(mod.createStdioMcpTransport).toBeUndefined();
  });
});

describe("createStdioMcpTransport", () => {
  it("is undefined when isNodeLike() is false", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });
    expect(mod.createStdioMcpTransport).toBeUndefined();
  });

  it("re-exports createStdioMcpTransport when stdio modules load in node-like environment", async () => {
    const mod = await loadIndexModule({ isNodeLike: true });
    expect(mod.createStdioMcpTransport).toBe(stdioTransportModule.createStdioMcpTransport);

    const input = { cmd: "x", args: [] };
    const out = mod.createStdioMcpTransport(input);
    expect(stdioTransportModule.createStdioMcpTransport).toHaveBeenCalledWith(input);
    expect(out).toEqual({ kind: "stdio-transport", options: input });
  });
});

describe("createMcpTransport", () => {
  it("re-exports createMcpTransport and forwards calls with boundary inputs", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });

    const inputs = [undefined, null, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, {}, []];

    for (const input of inputs) {
      const result = mod.createMcpTransport(/** @type {any} */ (input));
      expect(result).toEqual({ kind: "mcp-transport", options: input });
    }

    expect(transportFactoryModule.createMcpTransport).toHaveBeenCalledTimes(inputs.length);
  });
});

describe("getSupportedTransports", () => {
  it("re-exports getSupportedTransports and can be called repeatedly", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });

    const a = mod.getSupportedTransports();
    const b = mod.getSupportedTransports();

    expect(transportFactoryModule.getSupportedTransports).toHaveBeenCalledTimes(2);
    expect(a).toEqual(["mock-transport"]);
    expect(b).toEqual(["mock-transport"]);
  });
});

describe("MCP_PROTOCOL_VERSION", () => {
  it("re-exports MCP_PROTOCOL_VERSION from mcp-transport.js", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });
    expect(mod.MCP_PROTOCOL_VERSION).toBe(transportModule.MCP_PROTOCOL_VERSION);
  });
});

describe("MCP_SUPPORTED_VERSIONS", () => {
  it("re-exports MCP_SUPPORTED_VERSIONS from mcp-transport.js", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });
    expect(mod.MCP_SUPPORTED_VERSIONS).toBe(transportModule.MCP_SUPPORTED_VERSIONS);
    expect(Array.isArray(mod.MCP_SUPPORTED_VERSIONS)).toBe(true);
  });
});

describe("McpMethods", () => {
  it("re-exports McpMethods from mcp-transport.js", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });
    expect(mod.McpMethods).toBe(transportModule.McpMethods);
    expect(mod.McpMethods.callTool).toBe("callTool");
  });
});

describe("McpResourceManager", () => {
  it("re-exports McpResourceManager from resource-manager.js", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });
    expect(mod.McpResourceManager).toBe(resourceManagerModule.McpResourceManager);
  });
});

describe("createSseParser", () => {
  it("re-exports createSseParser and forwards calls (including empty object)", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });

    const parser1 = mod.createSseParser({});
    const parser2 = mod.createSseParser(undefined);

    expect(sseModule.createSseParser).toHaveBeenCalledTimes(2);
    expect(parser1.kind).toBe("sse-parser");
    expect(typeof parser1.parse).toBe("function");
    expect(parser2).toEqual({ kind: "sse-parser", options: undefined, parse: expect.any(Function) });
  });
});

describe("consumeSse", () => {
  it("re-exports consumeSse and forwards calls with boundary inputs", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });

    const inputs = [undefined, null, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, {}, []];
    for (const input of inputs) {
      const out = mod.consumeSse(/** @type {any} */ (input));
      expect(out).toEqual({ kind: "consumeSse", input });
    }

    expect(sseModule.consumeSse).toHaveBeenCalledTimes(inputs.length);
  });
});

describe("consumeSseJson", () => {
  it("re-exports consumeSseJson and forwards calls with boundary inputs", async () => {
    const mod = await loadIndexModule({ isNodeLike: false });

    const inputs = [undefined, null, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, {}, []];
    for (const input of inputs) {
      const out = mod.consumeSseJson(/** @type {any} */ (input));
      expect(out).toEqual({ kind: "consumeSseJson", input });
    }

    expect(sseModule.consumeSseJson).toHaveBeenCalledTimes(inputs.length);
  });
});