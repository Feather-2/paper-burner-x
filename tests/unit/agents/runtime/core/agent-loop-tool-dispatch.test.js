import { describe, it, expect, vi, beforeEach } from "vitest";

const { toolRegistryInstances, normalizeToolResultMock, resolveToolExecutorMock } = vi.hoisted(() => ({
  toolRegistryInstances: [],
  normalizeToolResultMock: vi.fn((value) => ({ ok: true, data: value })),
  resolveToolExecutorMock: vi.fn((ctx) => ctx?.executor ?? null),
}));

vi.mock("../../../../../js/agents/runtime/core/tool-registry.js", () => {
  class ToolRegistry {
    constructor(options = {}) {
      this.options = options;
      this._tools = options.tools ?? {};
      this._hooks = options.hooks ?? { before: [], after: [] };
      this.registerTools = vi.fn();
      this.registerTool = vi.fn();
      this.useHook = vi.fn();
      this.callTool = vi.fn(async (name, params, context) => ({
        ok: true,
        data: { name, params, context },
      }));
      toolRegistryInstances.push(this);
    }
  }

  return {
    ToolRegistry,
    normalizeToolResult: normalizeToolResultMock,
    resolveToolExecutor: resolveToolExecutorMock,
  };
});

import {
  ToolDispatch,
  normalizeToolResult,
  resolveToolExecutor,
} from "../../../../../js/agents/runtime/core/agent-loop-tool-dispatch.js";

beforeEach(() => {
  toolRegistryInstances.length = 0;
  vi.clearAllMocks();
});

const createDispatchWithRegistry = () => {
  const loop = {};
  const registry = {
    _tools: {},
    _hooks: { before: [], after: [] },
    registerTools: vi.fn(),
    registerTool: vi.fn(),
    useHook: vi.fn(),
    callTool: vi.fn(async (name, params, context) => ({
      ok: true,
      data: { name, params, context },
    })),
  };
  loop._toolRegistry = registry;
  const dispatch = new ToolDispatch(loop, { reuseExistingRegistry: true });
  return { loop, registry, dispatch };
};

describe("ToolDispatch constructor", () => {
  it("initializes ToolRegistry and exposes tools/hooks", () => {
    const loop = {};
    const tools = { ping: vi.fn() };
    const hooks = { before: [vi.fn()], after: [] };
    const logger = { info: vi.fn() };

    const dispatch = new ToolDispatch(loop, { tools, hooks, logger });

    expect(toolRegistryInstances).toHaveLength(1);
    const instance = toolRegistryInstances[0];
    expect(dispatch).toBeInstanceOf(ToolDispatch);
    expect(instance.options).toEqual({ tools, hooks, logger });
    expect(loop._toolRegistry).toBe(instance);
    expect(loop._tools).toBe(instance._tools);
    expect(loop._hooks).toBe(instance._hooks);
  });

  it("passes through boundary options including empty and numeric values", () => {
    const cases = [
      { tools: null, hooks: null, logger: null },
      { tools: "", hooks: [], logger: {} },
      { tools: 0, hooks: -1, logger: Number.MAX_SAFE_INTEGER },
      { tools: "   ", hooks: { before: [], after: [] }, logger: undefined },
    ];

    for (const options of cases) {
      const loop = {};
      new ToolDispatch(loop, options);
      const instance = toolRegistryInstances[toolRegistryInstances.length - 1];
      expect(instance.options).toEqual({
        tools: options.tools,
        hooks: options.hooks,
        logger: options.logger,
      });
      expect(loop._toolRegistry).toBe(instance);
      expect(loop._tools).toBe(instance._tools);
      expect(loop._hooks).toBe(instance._hooks);
    }

    const loop = {};
    new ToolDispatch(loop);
    const instance = toolRegistryInstances[toolRegistryInstances.length - 1];
    expect(instance.options).toEqual({ tools: undefined, hooks: undefined, logger: undefined });
  });

  it("throws when loop is null or undefined", () => {
    expect(() => new ToolDispatch(null)).toThrow();
    expect(() => new ToolDispatch(undefined)).toThrow();
  });
});

describe("ToolDispatch methods", () => {
  it("adds dispatch methods and forwards to the registry", async () => {
    const { loop, registry, dispatch } = createDispatchWithRegistry();
    const tools = { ping: vi.fn() };
    const toolFn = vi.fn();
    const hook = vi.fn();
    const context = { trace: true };

    dispatch.registerTools(tools);
    dispatch.registerTool("ping", toolFn);
    const returned = dispatch.useHook("before", hook);
    const result = await dispatch._callTool("ping", { n: 1 }, context);

    expect(registry.registerTools).toHaveBeenCalledWith(tools);
    expect(registry.registerTool).toHaveBeenCalledWith("ping", toolFn);
    expect(registry.useHook).toHaveBeenCalledWith("before", hook);
    expect(returned).toBe(loop);
    expect(registry.callTool).toHaveBeenCalledWith("ping", { n: 1 }, context);
    expect(result).toEqual({ ok: true, data: { name: "ping", params: { n: 1 }, context } });
  });

  it("forwards boundary and resource-heavy inputs", async () => {
    const { dispatch, registry } = createDispatchWithRegistry();
    const emptyArray = [];
    const emptyObject = {};
    const objectAsArray = { 0: "a", 1: "b", length: 2 };
    const longString = "x".repeat(100000);
    const largeBuffer = Buffer.alloc(1024 * 1024);
    const deepNested = { level1: { level2: { level3: { level4: { level5: { value: longString } } } } } };

    dispatch.registerTools(null);
    dispatch.registerTools(undefined);
    dispatch.registerTools(emptyArray);
    dispatch.registerTools(emptyObject);
    dispatch.registerTools(objectAsArray);
    dispatch.registerTool("", vi.fn());
    dispatch.registerTool("   ", vi.fn());

    const params = {
      value: 0,
      min: -1,
      max: Number.MAX_SAFE_INTEGER,
      numericString: "42",
      blank: "",
      whitespace: "   ",
      deepNested,
      file: largeBuffer,
    };

    await dispatch._callTool("process", params, { listLike: objectAsArray });

    expect(registry.registerTools).toHaveBeenCalledWith(null);
    expect(registry.registerTools).toHaveBeenCalledWith(undefined);
    expect(registry.registerTools).toHaveBeenCalledWith(emptyArray);
    expect(registry.registerTools).toHaveBeenCalledWith(emptyObject);
    expect(registry.registerTools).toHaveBeenCalledWith(objectAsArray);
    expect(registry.registerTool).toHaveBeenCalledWith("", expect.any(Function));
    expect(registry.registerTool).toHaveBeenCalledWith("   ", expect.any(Function));
    expect(registry.callTool).toHaveBeenCalledWith("process", params, { listLike: objectAsArray });
  });

  it("supports concurrent and rapid successive calls", async () => {
    const { dispatch, registry } = createDispatchWithRegistry();
    registry.callTool.mockImplementation(async (name, params, context) => ({
      ok: true,
      data: { name, params, context },
    }));

    const concurrent = await Promise.all([
      dispatch._callTool("t1", { id: 0 }, { seq: 1 }),
      dispatch._callTool("t2", { id: -1 }, { seq: 2 }),
      dispatch._callTool("t3", { id: Number.MAX_SAFE_INTEGER }, { seq: 3 }),
    ]);

    expect(concurrent).toHaveLength(3);
    expect(registry.callTool).toHaveBeenCalledWith("t1", { id: 0 }, { seq: 1 });
    expect(registry.callTool).toHaveBeenCalledWith("t2", { id: -1 }, { seq: 2 });
    expect(registry.callTool).toHaveBeenCalledWith("t3", { id: Number.MAX_SAFE_INTEGER }, { seq: 3 });

    await dispatch._callTool("t4", { id: "4" }, { seq: 4 });
    await dispatch._callTool("t5", { id: "5" }, { seq: 5 });

    expect(registry.callTool).toHaveBeenCalledWith("t4", { id: "4" }, { seq: 4 });
    expect(registry.callTool).toHaveBeenCalledWith("t5", { id: "5" }, { seq: 5 });
  });

  it("bubbles registry errors", async () => {
    const { dispatch, registry } = createDispatchWithRegistry();
    registry.registerTool.mockImplementation(() => {
      throw new Error("register-failed");
    });
    registry.callTool.mockRejectedValue(new Error("call-failed"));

    expect(() => dispatch.registerTool("fail", () => {})).toThrow("register-failed");
    await expect(dispatch._callTool("fail", {}, {})).rejects.toThrow("call-failed");
  });
});

describe("normalizeToolResult", () => {
  it("delegates to tool-registry normalizeToolResult", () => {
    const payload = { ok: true, data: { nested: { value: "ok" } } };
    const result = normalizeToolResult(payload);

    expect(normalizeToolResultMock).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ ok: true, data: payload });
  });

  it("propagates errors from normalizeToolResult", () => {
    normalizeToolResultMock.mockImplementationOnce(() => {
      throw new Error("normalize-failed");
    });

    expect(() => normalizeToolResult({})).toThrow("normalize-failed");
  });
});

describe("resolveToolExecutor", () => {
  it("delegates to tool-registry resolveToolExecutor", () => {
    const executor = () => "ok";
    const context = { executor };
    const result = resolveToolExecutor(context);

    expect(resolveToolExecutorMock).toHaveBeenCalledWith(context);
    expect(result).toBe(executor);
  });

  it("handles empty and typed contexts", () => {
    expect(resolveToolExecutor(null)).toBeNull();
    expect(resolveToolExecutor(undefined)).toBeNull();
    expect(resolveToolExecutor({ executor: "" })).toBe("");
    expect(resolveToolExecutor({ executor: "   " })).toBe("   ");
    expect(resolveToolExecutor({ executor: 0 })).toBe(0);
  });

  it("propagates errors from resolveToolExecutor", () => {
    resolveToolExecutorMock.mockImplementationOnce(() => {
      throw new Error("resolve-failed");
    });

    expect(() => resolveToolExecutor({})).toThrow("resolve-failed");
  });
});
