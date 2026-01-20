import { describe, it, expect, vi, beforeEach } from "vitest";

const { compressMock, CicadaCompressorMock } = vi.hoisted(() => {
  const compressMock = vi.fn();
  const CicadaCompressorMock = vi.fn(function CicadaCompressorMock(config) {
    this.config = config;
    this.compress = compressMock;
  });
  return { compressMock, CicadaCompressorMock };
});

vi.mock("../../../../../js/agents/plugins/compression/impl/cicada-compressor.js", () => ({
  CicadaCompressor: CicadaCompressorMock,
}));

import cicadaPlugin from "../../../../../js/agents/plugins/compression/cicada.js";

const DEFAULT_CONFIG = {
  aggressive: false,
  maxContextTokens: 100,
  compressionRatio: 0.6,
};

function createMockCtx({ config = {}, initialState = {} } = {}) {
  const state = new Map(Object.entries(initialState));
  const listeners = new Map();

  const ctx = {
    config: { ...DEFAULT_CONFIG, ...config },
    state: {
      get: vi.fn((path) => state.get(path)),
      set: vi.fn((path, value) => {
        state.set(path, value);
      }),
    },
    events: { emit: vi.fn() },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn((name, service) => {
      ctx._services[name] = service;
    }),
    on: vi.fn((event, handler) => {
      listeners.set(event, handler);
      return vi.fn();
    }),
    _services: {},
    _listeners: listeners,
    __state: state,
  };

  return ctx;
}

beforeEach(() => {
  vi.clearAllMocks();
  compressMock.mockImplementation(async (messages) => ({
    messages: Array.isArray(messages) ? messages.slice(0, 1) : [],
    ratio: Array.isArray(messages) && messages.length ? 1 / messages.length : 1,
  }));
});

describe("plugins/compression/cicada.js default export", () => {
  it("installs, registers compression service, and wires token listener", async () => {
    const ctx = createMockCtx();

    await cicadaPlugin.install(ctx);

    expect(ctx.registerService).toHaveBeenCalledWith("compression", expect.any(Object));
    expect(ctx._services.compression).toEqual(
      expect.objectContaining({
        compress: expect.any(Function),
        shouldCompress: expect.any(Function),
        getStats: expect.any(Function),
      }),
    );
    expect(ctx.on).toHaveBeenCalledWith("runtime.tokens.updated", expect.any(Function));
    expect(ctx.log.info).toHaveBeenCalledWith("Cicada compression plugin installed");
  });

  it("compresses messages, updates state, and emits completion event", async () => {
    const ctx = createMockCtx({ config: { maxContextTokens: 200 } });
    compressMock.mockResolvedValueOnce({
      messages: [{ role: "user", content: "keep" }],
      ratio: 0.5,
    });

    await cicadaPlugin.install(ctx);

    const service = ctx._services.compression;
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ];
    const options = { aggressive: true, targetTokens: 0 };

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1234);
    const result = await service.compress(messages, options);
    nowSpy.mockRestore();

    expect(CicadaCompressorMock).toHaveBeenCalledWith(ctx.config);
    expect(compressMock).toHaveBeenCalledWith(messages, options);
    expect(result).toEqual({ messages: [{ role: "user", content: "keep" }], ratio: 0.5 });
    expect(ctx.state.set).toHaveBeenCalledWith("lastCompression", {
      before: 2,
      after: 1,
      timestamp: 1234,
    });
    expect(ctx.events.emit).toHaveBeenCalledWith("compression:done", {
      originalCount: 2,
      compressedCount: 1,
      ratio: 0.5,
    });
  });

  it("falls back to input length when compressor returns no messages", async () => {
    const ctx = createMockCtx();
    compressMock.mockResolvedValueOnce({ ratio: 1 });

    await cicadaPlugin.install(ctx);

    const service = ctx._services.compression;
    const messages = [];
    const result = await service.compress(messages, {});

    expect(result.ratio).toBe(1);
    expect(ctx.state.set).toHaveBeenCalledWith("lastCompression", {
      before: 0,
      after: 0,
      timestamp: expect.any(Number),
    });
    expect(ctx.events.emit).toHaveBeenCalledWith("compression:done", {
      originalCount: 0,
      compressedCount: undefined,
      ratio: 1,
    });
  });

  it("shouldCompress handles boundary values and type coercion", async () => {
    const ctx = createMockCtx({ config: { maxContextTokens: 100 } });

    await cicadaPlugin.install(ctx);

    const service = ctx._services.compression;
    const cases = [
      { tokenCount: 0, expected: false },
      { tokenCount: -1, expected: false },
      { tokenCount: Number.MAX_SAFE_INTEGER, expected: true },
      { tokenCount: "81", expected: true },
      { tokenCount: "", expected: false },
      { tokenCount: "   ", expected: false },
      { tokenCount: undefined, expected: false },
      { tokenCount: null, expected: false },
      { tokenCount: {}, expected: false },
    ];

    for (const { tokenCount, expected } of cases) {
      await expect(service.shouldCompress({}, tokenCount)).resolves.toBe(expected);
    }
  });

  it("getStats returns empty object when state missing and snapshot when present", async () => {
    const ctx = createMockCtx();

    await cicadaPlugin.install(ctx);

    const service = ctx._services.compression;
    expect(service.getStats()).toEqual({});

    const snapshot = { lastCompression: { before: 1, after: 1 } };
    ctx.__state.set("", snapshot);

    expect(service.getStats()).toBe(snapshot);
    expect(ctx.state.get).toHaveBeenCalledWith("");
  });

  it("emits warning only when token usage exceeds threshold", async () => {
    const ctx = createMockCtx({ config: { maxContextTokens: 100 } });

    await cicadaPlugin.install(ctx);

    const handler = ctx._listeners.get("runtime.tokens.updated");
    expect(handler).toEqual(expect.any(Function));

    handler({ payload: { total: 89 } });
    handler({ payload: { total: 90 } });
    handler({});
    handler(null);
    handler({ payload: { total: 91 } });

    expect(ctx.events.emit).toHaveBeenCalledTimes(1);
    expect(ctx.events.emit).toHaveBeenCalledWith("compression:warning", {
      current: 91,
      threshold: 100,
    });
  });

  it("propagates compressor errors without emitting completion", async () => {
    const ctx = createMockCtx();
    compressMock.mockRejectedValueOnce(new Error("boom"));

    await cicadaPlugin.install(ctx);

    const service = ctx._services.compression;

    await expect(
      service.compress([{ role: "user", content: "oops" }]),
    ).rejects.toThrow("boom");

    expect(ctx.state.set).not.toHaveBeenCalled();
    expect(ctx.events.emit).not.toHaveBeenCalled();
  });

  it("throws on nullish messages input", async () => {
    const ctx = createMockCtx();

    await cicadaPlugin.install(ctx);

    const service = ctx._services.compression;

    for (const value of [null, undefined]) {
      await expect(service.compress(value)).rejects.toThrow();
    }
  });

  it("handles large inputs, deep options, and concurrent/rapid calls", async () => {
    const ctx = createMockCtx({ config: { maxContextTokens: 1000 } });

    compressMock.mockImplementation(async (messages, options) => ({
      messages: Array.isArray(messages) ? messages.slice(0, 1) : [],
      ratio: Array.isArray(messages) && messages.length ? 1 / messages.length : 1,
      options,
    }));

    await cicadaPlugin.install(ctx);

    const service = ctx._services.compression;
    const hugeText = "x".repeat(20000);
    const largeMessages = Array.from({ length: 200 }, (_, index) => ({
      role: "user",
      content: `${index}-${hugeText}`,
      meta: { nested: { level: { index } } },
    }));
    const deepOptions = { targetTokens: 0, meta: { a: { b: { c: { d: "deep" } } } } };

    const first = await service.compress(largeMessages, deepOptions);
    const second = await service.compress(largeMessages.slice(0, 2), { aggressive: false });

    expect(CicadaCompressorMock).toHaveBeenCalledTimes(1);
    expect(first.messages).toHaveLength(1);
    expect(second.messages).toHaveLength(1);

    const [concurrentA, concurrentB] = await Promise.all([
      service.compress(largeMessages.slice(0, 3), { aggressive: true }),
      service.compress(largeMessages.slice(0, 4), { aggressive: true }),
    ]);

    expect(concurrentA.messages).toHaveLength(1);
    expect(concurrentB.messages).toHaveLength(1);

    const [firstCallMessages, firstCallOptions] = compressMock.mock.calls[0];
    expect(firstCallMessages).toHaveLength(200);
    expect(firstCallMessages[0].content.length).toBeGreaterThan(10000);
    expect(firstCallOptions).toBe(deepOptions);
  });

  it("logs on uninstall", async () => {
    const ctx = createMockCtx();

    await cicadaPlugin.uninstall(ctx);

    expect(ctx.log.info).toHaveBeenCalledWith("Cicada compression plugin uninstalled");
  });
});
