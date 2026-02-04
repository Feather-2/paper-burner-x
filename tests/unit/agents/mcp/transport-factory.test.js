import { describe, it, expect, vi, beforeEach } from "vitest";

const sharedMocks = vi.hoisted(() => ({
  isNodeLike: vi.fn(),
}));

const transportMocks = vi.hoisted(() => {
  const stdioCtor = vi.fn(function(options) {
    this.kind = "stdio";
    this.options = options;
  });
  const httpCtor = vi.fn(function(options) {
    this.kind = "http";
    this.options = options;
  });
  const sseCtor = vi.fn(function(options) {
    this.kind = "sse";
    this.options = options;
  });
  return { stdioCtor, httpCtor, sseCtor };
});

vi.mock("../../../../js/agents/shared/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isNodeLike: sharedMocks.isNodeLike,
  };
});

vi.mock("../../../../js/agents/mcp/stdio-mcp-transport.js", () => ({
  StdioMcpTransport: transportMocks.stdioCtor,
}));

vi.mock("../../../../js/agents/mcp/http-mcp-transport.js", () => ({
  HttpMcpTransport: transportMocks.httpCtor,
}));

vi.mock("../../../../js/agents/mcp/sse-mcp-transport.js", () => ({
  SseMcpTransport: transportMocks.sseCtor,
}));

import { createMcpTransport, getSupportedTransports } from "../../../../js/agents/mcp/transport-factory.js";

function buildDeepObject(depth) {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
}

beforeEach(() => {
  sharedMocks.isNodeLike.mockReset();
  sharedMocks.isNodeLike.mockReturnValue(false);

  transportMocks.stdioCtor.mockClear();
  transportMocks.httpCtor.mockClear();
  transportMocks.sseCtor.mockClear();
});

describe("createMcpTransport", () => {
  it("throws in auto mode when url is missing (non-node-like)", async () => {
    await expect(createMcpTransport()).rejects.toThrow("HttpMcpTransport requires url");
    await expect(createMcpTransport({})).rejects.toThrow("HttpMcpTransport requires url");

    expect(transportMocks.httpCtor).not.toHaveBeenCalled();
    expect(transportMocks.stdioCtor).not.toHaveBeenCalled();
    expect(transportMocks.sseCtor).not.toHaveBeenCalled();
  });

  it("uses stdio for auto mode with command in node-like environments and forwards boundary options", async () => {
    sharedMocks.isNodeLike.mockReturnValue(true);

    const largeString = "x".repeat(256 * 1024);
    const largeFile = new Uint8Array(1024 * 1024);
    const deepMeta = buildDeepObject(40);
    const options = {
      type: "auto",
      command: "node",
      args: [],
      timeout: 0,
      retries: -1,
      limit: Number.MAX_SAFE_INTEGER,
      note: "   ",
      payload: largeString,
      file: largeFile,
      meta: deepMeta,
    };

    const transport = await createMcpTransport(options);

    expect(transportMocks.stdioCtor).toHaveBeenCalledTimes(1);
    const [[calledOptions]] = transportMocks.stdioCtor.mock.calls;
    expect(calledOptions).not.toBe(options);
    expect(calledOptions).toEqual(expect.objectContaining(options));
    expect(transport.kind).toBe("stdio");
    expect(transport.options).toBe(calledOptions);
    expect(transport.options.payload.length).toBe(256 * 1024);
    expect(transport.options.file.byteLength).toBe(1024 * 1024);
    expect(transport.options.meta).toBe(deepMeta);
  });

  it("falls back to http in auto mode when command is empty even if node-like", async () => {
    sharedMocks.isNodeLike.mockReturnValue(true);

    const transport = await createMcpTransport({ type: "auto", command: "", url: "http://example" });

    expect(transportMocks.httpCtor).toHaveBeenCalledTimes(1);
    expect(transport.kind).toBe("http");
    expect(transportMocks.stdioCtor).not.toHaveBeenCalled();
  });

  it("throws when stdio is requested but the environment is not node-like", async () => {
    sharedMocks.isNodeLike.mockReturnValue(false);

    await expect(createMcpTransport({ type: "stdio", command: "node" })).rejects.toThrow(
      "StdioMcpTransport is only available in Node.js",
    );
  });

  it("uses http for explicit type and preserves string/array type boundaries", async () => {
    sharedMocks.isNodeLike.mockReturnValue(true);

    const options = {
      type: "http",
      url: "http://local",
      timeout: "123",
      args: { 0: "not-array" },
      command: "node",
    };

    const transport = await createMcpTransport(options);

    expect(transportMocks.httpCtor).toHaveBeenCalledTimes(1);
    expect(transport.kind).toBe("http");
    expect(transport.options.timeout).toBe("123");
    expect(transport.options.args).toEqual({ 0: "not-array" });
  });

  it("creates sse transport when type is sse", async () => {
    const transport = await createMcpTransport({ type: "sse", url: "http://sse" });

    expect(transportMocks.sseCtor).toHaveBeenCalledTimes(1);
    expect(transport.kind).toBe("sse");
  });

  it("throws for unknown transport types including numeric boundaries", async () => {
    const invalidTypes = ["", "   ", "websocket", "42", 0, -1, Number.MAX_SAFE_INTEGER];

    for (const type of invalidTypes) {
      await expect(createMcpTransport({ type })).rejects.toThrow(/Unknown MCP transport type/);
    }
  });

  it("supports concurrent transport creation", async () => {
    sharedMocks.isNodeLike.mockReturnValue(true);

    const [http, sse, stdio] = await Promise.all([
      createMcpTransport({ type: "http", url: "http://a", id: 1 }),
      createMcpTransport({ type: "sse", url: "http://b", id: 2 }),
      createMcpTransport({ type: "stdio", command: "node", id: 3 }),
    ]);

    expect(http.kind).toBe("http");
    expect(sse.kind).toBe("sse");
    expect(stdio.kind).toBe("stdio");
    expect(transportMocks.httpCtor).toHaveBeenCalledTimes(1);
    expect(transportMocks.sseCtor).toHaveBeenCalledTimes(1);
    expect(transportMocks.stdioCtor).toHaveBeenCalledTimes(1);
  });

  it("handles rapid consecutive creation calls without sharing options", async () => {
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await createMcpTransport({ type: "http", url: `http://x/${i}`, id: i }));
    }

    expect(results.map((transport) => transport.options.id)).toEqual([0, 1, 2]);
    expect(transportMocks.httpCtor).toHaveBeenCalledTimes(3);
  });

  it("throws when options is null", async () => {
    await expect(createMcpTransport(null)).rejects.toThrow(TypeError);
  });
});

describe("getSupportedTransports", () => {
  it("includes stdio for node-like environments", () => {
    sharedMocks.isNodeLike.mockReturnValue(true);

    expect(getSupportedTransports()).toEqual(["stdio", "http", "sse"]);
  });

  it("omits stdio when not node-like and returns a fresh array each call", () => {
    sharedMocks.isNodeLike.mockReturnValue(false);

    const first = getSupportedTransports();
    first.push("extra");

    const second = getSupportedTransports();
    expect(second).toEqual(["http", "sse"]);
  });
});
