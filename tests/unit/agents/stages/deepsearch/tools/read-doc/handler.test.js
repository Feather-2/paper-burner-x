import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  instances: [],
  defaultReadImpl: (sourceId) => ({
    success: true,
    sourceId,
    content: "content",
    contentLength: 7,
    readMode: "full",
    truncated: false,
  }),
}));

vi.mock("../../../../../../../js/agents/stages/deepsearch/source-manager.js", () => {
  class SourceManager {
    constructor(sources = []) {
      this.sources = sources;
      this.read = vi.fn((sourceId, options) => mockState.defaultReadImpl(sourceId, options));
      this.syncSources = vi.fn();
      mockState.instances.push(this);
    }
  }

  return { __esModule: true, default: SourceManager };
});

const handlerPath = "../../../../../../../js/agents/stages/deepsearch/tools/read-doc/handler.js";
const sourceManagerPath = "../../../../../../../js/agents/stages/deepsearch/source-manager.js";

beforeEach(() => {
  mockState.instances.length = 0;
  mockState.defaultReadImpl = (sourceId) => ({
    success: true,
    sourceId,
    content: "content",
    contentLength: 7,
    readMode: "full",
    truncated: false,
  });
  vi.clearAllMocks();
});

describe("definition", () => {
  it("exposes stable metadata", async () => {
    const { definition } = await import(handlerPath);

    expect(definition).toMatchObject({ name: "read-doc", layer: 0 });
    expect(definition.description).toContain("read-doc");
    expect(definition.activation.keywords).toEqual(expect.arrayContaining(["read"]));
    expect(definition.parameters).toHaveProperty("sourceId");
    expect(definition.parameters).toHaveProperty("section");
  });
});

describe("handler", () => {
  it.each([
    ["undefined", {}],
    ["null", { sourceId: null }],
    ["empty string", { sourceId: "" }],
  ])("returns error when sourceId is %s", async (_label, args) => {
    const { handler } = await import(handlerPath);
    const emit = vi.fn();
    const state = {};

    const result = await handler(args, { state, emit });

    expect(result).toEqual({ success: false, error: "sourceId is required" });
    expect(emit).not.toHaveBeenCalled();
    expect(mockState.instances).toHaveLength(0);
    expect(state.L1).toBeUndefined();
  });

  it("accepts whitespace sourceId and records it", async () => {
    const { handler } = await import(handlerPath);
    const emit = vi.fn();
    const state = { L0: { sources: [] }, L1: {} };

    const result = await handler({ sourceId: "   " }, { state, emit });

    expect(result.success).toBe(true);
    expect(state.L1.readDocIds).toEqual(["   "]);
  });

  it("uses injected sourceManager instance and emits with contentLength", async () => {
    const { handler } = await import(handlerPath);
    const { default: SourceManager } = await import(sourceManagerPath);
    const emit = vi.fn();
    const state = { L0: { sources: [{ sourceId: "s1", name: "Doc1", sourceText: "A" }] } };

    const sourceManager = new SourceManager(state.L0.sources);
    sourceManager.read.mockReturnValue({
      success: true,
      sourceId: "s1",
      content: "abc",
      contentLength: Number.MAX_SAFE_INTEGER,
      truncated: true,
      readMode: "preview",
    });

    const out = await handler({ sourceId: "s1", preview: true }, { state, emit, sourceManager });

    expect(out.success).toBe(true);
    expect(mockState.instances).toHaveLength(1);
    expect(sourceManager.syncSources).toHaveBeenCalledWith(state.L0.sources);
    expect(sourceManager.read).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ sourceId: "s1", preview: true, maxLength: 5000 })
    );
    expect(state.L1.readDocIds).toEqual(["s1"]);
    expect(emit).toHaveBeenCalledWith("deepsearch.doc.read", {
      sourceId: "s1",
      length: Number.MAX_SAFE_INTEGER,
      truncated: true,
      readMode: "preview",
    });
  });

  it("passes boundary values through to manager.read", async () => {
    const { handler } = await import(handlerPath);
    const emit = vi.fn();
    const state = { L0: { sources: [] }, L1: {} };
    const args = {
      sourceId: "doc-boundary",
      start: 0,
      end: -1,
      maxLength: Number.MAX_SAFE_INTEGER,
      startLine: "1",
      endLine: "2",
      section: "   ",
    };

    await handler(args, { state, emit });

    const manager = mockState.instances[0];
    expect(manager.syncSources).toHaveBeenCalledWith(state.L0.sources);
    expect(manager.read).toHaveBeenCalledWith(
      "doc-boundary",
      expect.objectContaining({
        sourceId: "doc-boundary",
        start: 0,
        end: -1,
        maxLength: Number.MAX_SAFE_INTEGER,
        startLine: "1",
        endLine: "2",
        section: "   ",
      })
    );
  });

  it("returns early when manager.read fails", async () => {
    const { handler } = await import(handlerPath);
    const emit = vi.fn();
    const state = { L0: { sources: [] } };
    mockState.defaultReadImpl = () => ({ success: false, error: "not found" });

    const result = await handler({ sourceId: "s1" }, { state, emit });

    expect(result).toEqual({ success: false, error: "not found" });
    expect(state.L1).toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });

  it("initializes readDocIds and avoids duplicates on rapid calls", async () => {
    const { handler } = await import(handlerPath);
    const emit = vi.fn();
    const state = { L0: { sources: [] }, L1: { readDocIds: "bad" } };

    await handler({ sourceId: "s1" }, { state, emit });
    await handler({ sourceId: "s1" }, { state, emit });

    expect(Array.isArray(state.L1.readDocIds)).toBe(true);
    expect(state.L1.readDocIds).toEqual(["s1"]);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("supports concurrent calls without losing ids", async () => {
    const { handler } = await import(handlerPath);
    const emit = vi.fn();
    const state = { L0: { sources: [] }, L1: {} };

    await Promise.all([
      handler({ sourceId: "a" }, { state, emit }),
      handler({ sourceId: "b" }, { state, emit }),
    ]);

    expect(state.L1.readDocIds).toHaveLength(2);
    expect(state.L1.readDocIds).toEqual(expect.arrayContaining(["a", "b"]));
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("falls back to content length for large strings when contentLength is not finite", async () => {
    const { handler } = await import(handlerPath);
    const emit = vi.fn();
    const state = { L0: { sources: [] }, L1: {} };
    const large = "x".repeat(10000);

    mockState.defaultReadImpl = (sourceId) => ({
      success: true,
      sourceId,
      content: large,
      contentLength: Number.NaN,
      truncated: false,
      readMode: "full",
    });

    await handler({ sourceId: "big" }, { state, emit });

    expect(emit).toHaveBeenCalledWith(
      "deepsearch.doc.read",
      expect.objectContaining({ length: large.length })
    );
  });

  it("handles non-array sources and deep nested data", async () => {
    const { handler } = await import(handlerPath);
    const emit = vi.fn();
    const deepSource = { sourceId: "deep", meta: { nested: { level: { more: { depth: true } } } } };
    const state = { L0: { sources: deepSource }, L1: {} };

    await handler({ sourceId: "deep" }, { state, emit });

    const manager = mockState.instances[0];
    expect(manager.sources).toBe(deepSource);
    expect(manager.syncSources).toHaveBeenCalledWith(deepSource);
  });
});

describe("default", () => {
  it("exports definition and handler", async () => {
    const mod = await import(handlerPath);

    expect(mod.default).toBeDefined();
    expect(mod.default.definition).toBe(mod.definition);
    expect(mod.default.handler).toBe(mod.handler);
  });
});
