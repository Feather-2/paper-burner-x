import { describe, it, expect, vi, beforeEach } from "vitest";

const INDEX_PATH = "../../../../js/agents/mcp/index.js";

const mockState = vi.hoisted(() => ({
  clientInstances: [],
  localProviderArgs: [],
  nexusProviderArgs: [],
  stdioProviderArgs: [],
  stdioProviderInstances: [],
  stdioTransportInstances: [],
  createLocalProviderCalls: [],
  createStdioProviderCalls: [],
  createStdioTransportCalls: [],
  createMcpTransportCalls: [],
  getSupportedTransportsCalls: [],
  createSseParserCalls: [],
  consumeSseCalls: [],
  consumeSseJsonCalls: [],
  isNodeLike: false,
  throwStdioTransportImport: false,
  throwStdioProviderImport: false,
  exports: {},
}));

vi.mock("../../../../js/agents/mcp/mcp-client.js", () => {
  class McpProvider {
    constructor(...args) {
      this.args = args;
    }
  }

  class McpClient {
    constructor(...args) {
      this.args = args;
      this.providers = [];
      this.addProvider = vi.fn((provider) => {
        this.providers.push(provider);
        return provider;
      });
      mockState.clientInstances.push(this);
    }
  }

  class McpToolDefinition {
    constructor(...args) {
      this.args = args;
    }
  }

  class McpToolResult {
    constructor(...args) {
      this.args = args;
    }
  }

  const exports = { McpProvider, McpClient, McpToolDefinition, McpToolResult };
  mockState.exports.mcpClient = exports;
  return exports;
});

vi.mock("../../../../js/agents/mcp/local-mcp-provider.js", () => {
  class LocalMcpProvider {
    constructor(config) {
      this.config = config;
      mockState.localProviderArgs.push(config);
    }
  }

  const createLocalMcpProvider = vi.fn((config) => {
    mockState.createLocalProviderCalls.push(config);
    return new LocalMcpProvider(config);
  });

  const exports = { LocalMcpProvider, createLocalMcpProvider };
  mockState.exports.localProvider = exports;
  return exports;
});

vi.mock("../../../../js/agents/mcp/mcp-nexus-provider.js", () => {
  class McpNexusProvider {
    constructor(config) {
      this.config = config;
      mockState.nexusProviderArgs.push(config);
    }
  }

  const exports = { McpNexusProvider };
  mockState.exports.nexusProvider = exports;
  return exports;
});

vi.mock("../../../../js/agents/mcp/resource-manager.js", () => {
  class McpResourceManager {
    constructor(...args) {
      this.args = args;
    }
  }

  const exports = { McpResourceManager };
  mockState.exports.resourceManager = exports;
  return exports;
});

vi.mock("../../../../js/agents/mcp/sse.js", () => {
  const createSseParser = vi.fn((input) => {
    mockState.createSseParserCalls.push(input);
    return { kind: "parser", input };
  });

  const consumeSse = vi.fn((input) => {
    mockState.consumeSseCalls.push(input);
    return { kind: "sse", input };
  });

  const consumeSseJson = vi.fn((input) => {
    mockState.consumeSseJsonCalls.push(input);
    return { kind: "sse-json", input };
  });

  const exports = { createSseParser, consumeSse, consumeSseJson };
  mockState.exports.sse = exports;
  return exports;
});

vi.mock("../../../../js/agents/mcp/mcp-transport.js", () => {
  class McpTransport {
    constructor(...args) {
      this.args = args;
    }
  }

  const MCP_PROTOCOL_VERSION = "test-protocol";
  const MCP_SUPPORTED_VERSIONS = ["test-protocol", "legacy-protocol"];
  const McpMethods = { LIST: "list", CALL: "call" };

  const exports = { McpTransport, MCP_PROTOCOL_VERSION, MCP_SUPPORTED_VERSIONS, McpMethods };
  mockState.exports.mcpTransport = exports;
  return exports;
});

vi.mock("../../../../js/agents/mcp/transport-factory.js", () => {
  const createMcpTransport = vi.fn((input) => {
    mockState.createMcpTransportCalls.push(input);
    return { kind: "transport", input };
  });

  const getSupportedTransports = vi.fn((input) => {
    mockState.getSupportedTransportsCalls.push(input);
    return ["stdio", "sse"];
  });

  const exports = { createMcpTransport, getSupportedTransports };
  mockState.exports.transportFactory = exports;
  return exports;
});

vi.mock("../../../../js/agents/shared/index.js", () => ({
  isNodeLike: vi.fn(() => mockState.isNodeLike),
}));

vi.mock("../../../../js/agents/mcp/stdio-mcp-transport.js", () => {
  if (mockState.throwStdioTransportImport) {
    throw new Error("stdio transport import failed");
  }

  class StdioMcpTransport {
    constructor(config) {
      this.config = config;
      mockState.stdioTransportInstances.push(config);
    }
  }

  const createStdioMcpTransport = vi.fn((config) => {
    mockState.createStdioTransportCalls.push(config);
    return { kind: "stdio-transport", config };
  });

  const exports = { StdioMcpTransport, createStdioMcpTransport };
  mockState.exports.stdioTransport = exports;
  return exports;
});

vi.mock("../../../../js/agents/mcp/stdio-mcp-provider.js", () => {
  if (mockState.throwStdioProviderImport) {
    throw new Error("stdio provider import failed");
  }

  class StdioMcpProvider {
    constructor(config) {
      this.config = config;
      mockState.stdioProviderArgs.push(config);
      mockState.stdioProviderInstances.push(this);
    }
  }

  const createStdioMcpProvider = vi.fn((config) => {
    mockState.createStdioProviderCalls.push(config);
    return new StdioMcpProvider(config);
  });

  const exports = { StdioMcpProvider, createStdioMcpProvider };
  mockState.exports.stdioProvider = exports;
  return exports;
});

const resetMockState = () => {
  mockState.clientInstances.length = 0;
  mockState.localProviderArgs.length = 0;
  mockState.nexusProviderArgs.length = 0;
  mockState.stdioProviderArgs.length = 0;
  mockState.stdioProviderInstances.length = 0;
  mockState.stdioTransportInstances.length = 0;
  mockState.createLocalProviderCalls.length = 0;
  mockState.createStdioProviderCalls.length = 0;
  mockState.createStdioTransportCalls.length = 0;
  mockState.createMcpTransportCalls.length = 0;
  mockState.getSupportedTransportsCalls.length = 0;
  mockState.createSseParserCalls.length = 0;
  mockState.consumeSseCalls.length = 0;
  mockState.consumeSseJsonCalls.length = 0;
  mockState.isNodeLike = false;
  mockState.throwStdioTransportImport = false;
  mockState.throwStdioProviderImport = false;
};

const loadIndex = async (options = {}) => {
  if (Object.prototype.hasOwnProperty.call(options, "isNodeLike")) {
    mockState.isNodeLike = options.isNodeLike;
  }
  if (Object.prototype.hasOwnProperty.call(options, "throwStdioTransportImport")) {
    mockState.throwStdioTransportImport = options.throwStdioTransportImport;
  }
  if (Object.prototype.hasOwnProperty.call(options, "throwStdioProviderImport")) {
    mockState.throwStdioProviderImport = options.throwStdioProviderImport;
  }
  return import(INDEX_PATH);
};

const buildDeepNested = (depth) => {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  resetMockState();
});

describe("McpProvider", () => {
  it("re-exports McpProvider from mcp-client", async () => {
    const { McpProvider } = await loadIndex();

    expect(McpProvider).toBe(mockState.exports.mcpClient.McpProvider);
  });
});

describe("McpClient", () => {
  it("re-exports McpClient and tracks providers", async () => {
    const { McpClient } = await loadIndex();
    const client = new McpClient();
    const provider = { id: "p-1" };

    client.addProvider(provider);

    expect(client.providers).toEqual([provider]);
    expect(client.addProvider).toHaveBeenCalledWith(provider);
  });
});

describe("McpToolDefinition", () => {
  it("re-exports McpToolDefinition", async () => {
    const { McpToolDefinition } = await loadIndex();

    expect(McpToolDefinition).toBe(mockState.exports.mcpClient.McpToolDefinition);
  });
});

describe("McpToolResult", () => {
  it("re-exports McpToolResult", async () => {
    const { McpToolResult } = await loadIndex();

    expect(McpToolResult).toBe(mockState.exports.mcpClient.McpToolResult);
  });
});

describe("LocalMcpProvider", () => {
  it("re-exports LocalMcpProvider and stores config", async () => {
    const { LocalMcpProvider } = await loadIndex();
    const config = { id: "local", name: "demo" };
    const instance = new LocalMcpProvider(config);

    expect(instance.config).toBe(config);
    expect(mockState.localProviderArgs).toEqual([config]);
  });
});

describe("createLocalMcpProvider", () => {
  it("creates LocalMcpProvider instances", async () => {
    const { createLocalMcpProvider, LocalMcpProvider } = await loadIndex();
    const config = { id: "local", name: "demo" };
    const instance = createLocalMcpProvider(config);

    expect(instance).toBeInstanceOf(LocalMcpProvider);
    expect(mockState.createLocalProviderCalls).toEqual([config]);
  });
});

describe("McpNexusProvider", () => {
  it("re-exports McpNexusProvider and stores config", async () => {
    const { McpNexusProvider } = await loadIndex();
    const config = { id: "nexus", endpoint: "https://example.com" };
    const instance = new McpNexusProvider(config);

    expect(instance.config).toBe(config);
    expect(mockState.nexusProviderArgs).toEqual([config]);
  });
});

describe("StdioMcpProvider", () => {
  it("is undefined when not running in a Node-like environment", async () => {
    const { StdioMcpProvider } = await loadIndex({ isNodeLike: false });

    expect(StdioMcpProvider).toBeUndefined();
  });

  it("re-exports StdioMcpProvider when available", async () => {
    const { StdioMcpProvider } = await loadIndex({ isNodeLike: true });

    expect(StdioMcpProvider).toBe(mockState.exports.stdioProvider.StdioMcpProvider);
  });
});

describe("createStdioMcpProvider", () => {
  it("is undefined when not running in a Node-like environment", async () => {
    const { createStdioMcpProvider } = await loadIndex({ isNodeLike: false });

    expect(createStdioMcpProvider).toBeUndefined();
  });

  it("creates StdioMcpProvider instances when available", async () => {
    const { createStdioMcpProvider, StdioMcpProvider } = await loadIndex({ isNodeLike: true });
    const config = { id: "stdio-1", command: "tool" };
    const instance = createStdioMcpProvider(config);

    expect(instance).toBeInstanceOf(StdioMcpProvider);
    expect(mockState.createStdioProviderCalls).toEqual([config]);
  });
});

describe("McpTransport", () => {
  it("re-exports McpTransport", async () => {
    const { McpTransport } = await loadIndex();
    const instance = new McpTransport({ mode: "test" });

    expect(instance.args).toEqual([{ mode: "test" }]);
  });
});

describe("StdioMcpTransport", () => {
  it("is undefined when not running in a Node-like environment", async () => {
    const { StdioMcpTransport } = await loadIndex({ isNodeLike: false });

    expect(StdioMcpTransport).toBeUndefined();
  });

  it("re-exports StdioMcpTransport when available", async () => {
    const { StdioMcpTransport } = await loadIndex({ isNodeLike: true });

    expect(StdioMcpTransport).toBe(mockState.exports.stdioTransport.StdioMcpTransport);
  });
});

describe("createStdioMcpTransport", () => {
  it("is undefined when not running in a Node-like environment", async () => {
    const { createStdioMcpTransport } = await loadIndex({ isNodeLike: false });

    expect(createStdioMcpTransport).toBeUndefined();
  });

  it("creates stdio transports when available", async () => {
    const { createStdioMcpTransport } = await loadIndex({ isNodeLike: true });
    const config = { command: "tool" };
    const result = createStdioMcpTransport(config);

    expect(result).toEqual({ kind: "stdio-transport", config });
    expect(mockState.createStdioTransportCalls).toEqual([config]);
  });
});

describe("createMcpTransport", () => {
  it("forwards boundary values to the transport factory", async () => {
    const { createMcpTransport } = await loadIndex();
    const inputs = [
      null,
      undefined,
      "",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "42",
      { 0: "value", length: 1 },
      [],
    ];

    const results = inputs.map((input) => createMcpTransport(input));

    expect(mockState.createMcpTransportCalls).toEqual(inputs);
    results.forEach((result, index) => {
      expect(result).toEqual({ kind: "transport", input: inputs[index] });
    });
  });
});

describe("getSupportedTransports", () => {
  it("re-exports getSupportedTransports and forwards calls", async () => {
    const { getSupportedTransports } = await loadIndex();
    const result = getSupportedTransports();

    expect(result).toEqual(["stdio", "sse"]);
    expect(mockState.getSupportedTransportsCalls).toEqual([undefined]);
  });
});

describe("MCP_PROTOCOL_VERSION", () => {
  it("re-exports MCP_PROTOCOL_VERSION", async () => {
    const { MCP_PROTOCOL_VERSION } = await loadIndex();

    expect(MCP_PROTOCOL_VERSION).toBe(mockState.exports.mcpTransport.MCP_PROTOCOL_VERSION);
  });
});

describe("MCP_SUPPORTED_VERSIONS", () => {
  it("re-exports MCP_SUPPORTED_VERSIONS", async () => {
    const { MCP_SUPPORTED_VERSIONS } = await loadIndex();

    expect(MCP_SUPPORTED_VERSIONS).toBe(mockState.exports.mcpTransport.MCP_SUPPORTED_VERSIONS);
  });
});

describe("McpMethods", () => {
  it("re-exports McpMethods", async () => {
    const { McpMethods } = await loadIndex();

    expect(McpMethods).toBe(mockState.exports.mcpTransport.McpMethods);
  });
});

describe("McpResourceManager", () => {
  it("re-exports McpResourceManager", async () => {
    const { McpResourceManager } = await loadIndex();
    const instance = new McpResourceManager("root");

    expect(instance.args).toEqual(["root"]);
  });
});

describe("createSseParser", () => {
  it("re-exports createSseParser and forwards calls", async () => {
    const { createSseParser } = await loadIndex();
    const input = "data";
    const result = createSseParser(input);

    expect(result).toEqual({ kind: "parser", input });
    expect(mockState.createSseParserCalls).toEqual([input]);
  });
});

describe("consumeSse", () => {
  it("re-exports consumeSse and forwards calls", async () => {
    const { consumeSse } = await loadIndex();
    const input = "event";
    const result = consumeSse(input);

    expect(result).toEqual({ kind: "sse", input });
    expect(mockState.consumeSseCalls).toEqual([input]);
  });
});

describe("consumeSseJson", () => {
  it("re-exports consumeSseJson and forwards calls", async () => {
    const { consumeSseJson } = await loadIndex();
    const input = "{\"ok\":true}";
    const result = consumeSseJson(input);

    expect(result).toEqual({ kind: "sse-json", input });
    expect(mockState.consumeSseJsonCalls).toEqual([input]);
  });
});

describe("createMcpClient", () => {
  it("creates a client with the local provider by default", async () => {
    const { createMcpClient, LocalMcpProvider } = await loadIndex();
    const client = createMcpClient();

    expect(client).toBe(mockState.clientInstances[0]);
    expect(mockState.localProviderArgs).toHaveLength(1);
    expect(mockState.localProviderArgs[0]).toEqual({ id: "local-mcp" });
    expect(client.providers[0]).toBeInstanceOf(LocalMcpProvider);
  });

  it("skips the local provider when useLocal is false", async () => {
    const { createMcpClient } = await loadIndex();
    const client = createMcpClient({ useLocal: false });

    expect(mockState.localProviderArgs).toHaveLength(0);
    expect(client.addProvider).not.toHaveBeenCalled();
  });

  it("adds nexus provider with endpoint and options", async () => {
    const { createMcpClient } = await loadIndex();
    const nested = buildDeepNested(4);
    createMcpClient({
      nexusEndpoint: "https://example.com",
      nexusOptions: { token: "secret", nested },
    });

    expect(mockState.nexusProviderArgs).toHaveLength(1);
    expect(mockState.nexusProviderArgs[0]).toEqual({
      id: "mcp-nexus",
      endpoint: "https://example.com",
      token: "secret",
      nested,
    });
  });

  it("ignores non-object nexusOptions", async () => {
    const { createMcpClient } = await loadIndex();

    createMcpClient({
      nexusEndpoint: "https://example.com",
      nexusOptions: "invalid",
    });

    expect(mockState.nexusProviderArgs[0]).toEqual({
      id: "mcp-nexus",
      endpoint: "https://example.com",
    });
  });

  it("adds stdio providers with commands when available", async () => {
    const { createMcpClient, StdioMcpProvider } = await loadIndex({ isNodeLike: true });
    const client = createMcpClient({
      stdioProviders: [
        { id: "stdio-1", command: "tool" },
        { id: "skip" },
        null,
      ],
    });

    expect(mockState.stdioProviderArgs).toHaveLength(1);
    expect(mockState.stdioProviderArgs[0]).toEqual({ id: "stdio-1", command: "tool" });
    expect(client.providers.some((provider) => provider instanceof StdioMcpProvider)).toBe(true);
  });

  it("handles empty option values without extra providers", async () => {
    const { createMcpClient } = await loadIndex();
    const client = createMcpClient({
      localOptions: {},
      nexusEndpoint: "",
      stdioProviders: [],
    });

    expect(mockState.localProviderArgs).toHaveLength(1);
    expect(mockState.nexusProviderArgs).toHaveLength(0);
    expect(mockState.stdioProviderArgs).toHaveLength(0);
    expect(client.providers).toHaveLength(1);
  });

  it("treats whitespace endpoints as truthy", async () => {
    const { createMcpClient } = await loadIndex();

    createMcpClient({ nexusEndpoint: "   " });

    expect(mockState.nexusProviderArgs[0].endpoint).toBe("   ");
  });

  it("passes numeric and type boundary values through local options", async () => {
    const { createMcpClient } = await loadIndex();
    const localOptions = {
      timeout: 0,
      retries: -1,
      limit: Number.MAX_SAFE_INTEGER,
      mode: "42",
      name: "   ",
    };

    createMcpClient({ localOptions });

    expect(mockState.localProviderArgs[0]).toEqual({
      id: "local-mcp",
      ...localOptions,
    });
  });

  it("ignores stdioProviders when not an array", async () => {
    const { createMcpClient } = await loadIndex({ isNodeLike: true });
    const client = createMcpClient({
      stdioProviders: { 0: { id: "bad", command: "tool" }, length: 1 },
    });

    expect(mockState.stdioProviderArgs).toHaveLength(0);
    expect(client.providers).toHaveLength(1);
  });

  it("throws when options are null", async () => {
    const { createMcpClient } = await loadIndex();

    expect(() => createMcpClient(null)).toThrow();
  });

  it("supports concurrent and rapid successive calls", async () => {
    const { createMcpClient } = await loadIndex();
    const make = (index) => Promise.resolve().then(() => createMcpClient({
      localOptions: { name: `client-${index}` },
    }));

    const [first, second] = await Promise.all([make(0), make(1)]);
    expect(first).not.toBe(second);
    expect(mockState.clientInstances).toHaveLength(2);

    createMcpClient({ localOptions: { name: "client-2" } });
    createMcpClient({ localOptions: { name: "client-3" } });

    expect(mockState.clientInstances).toHaveLength(4);
    expect(mockState.localProviderArgs.map((config) => config.name)).toEqual([
      "client-0",
      "client-1",
      "client-2",
      "client-3",
    ]);
  });

  it("handles long strings, huge payloads, and deep nesting", async () => {
    const { createMcpClient } = await loadIndex({ isNodeLike: true });
    const longCommand = "x".repeat(10000);
    const hugePayload = "y".repeat(200000);
    const deep = buildDeepNested(25);

    createMcpClient({
      nexusEndpoint: "https://big",
      nexusOptions: { payload: hugePayload, deep },
      stdioProviders: [
        { id: "stdio-big", command: longCommand, args: [hugePayload] },
      ],
    });

    expect(mockState.nexusProviderArgs).toHaveLength(1);
    expect(mockState.nexusProviderArgs[0].payload.length).toBe(200000);
    expect(mockState.nexusProviderArgs[0].deep).toBe(deep);
    expect(mockState.stdioProviderArgs[0].command).toBe(longCommand);
    expect(mockState.stdioProviderArgs[0].args[0]).toBe(hugePayload);
  });
});
