import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/runtime/hooks/hook-runner.js", () => ({
  createPreToolUseHook: vi.fn(),
}));

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    normalizeToolResult: vi.fn(actual.normalizeToolResult),
  };
});

vi.mock("../../../../../js/agents/runtime/tools/schema-validator.js", () => ({
  validateArgs: vi.fn(),
}));

import { ToolRegistry, resolveToolExecutor, normalizeToolResult } from "../../../../../js/agents/runtime/core/tool-registry.js";
import { createPreToolUseHook } from "../../../../../js/agents/runtime/hooks/hook-runner.js";
import { validateArgs } from "../../../../../js/agents/runtime/tools/schema-validator.js";

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

const makeDeepObject = (depth) => {
  let node = { value: "leaf" };
  for (let i = 0; i < depth; i += 1) {
    node = { level: i, child: node };
  }
  return node;
};

const createDeferred = () => {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

let preToolHook;

beforeEach(() => {
  vi.clearAllMocks();
  preToolHook = vi.fn(async () => null);
  vi.mocked(createPreToolUseHook).mockReturnValue(preToolHook);
  vi.mocked(validateArgs).mockReturnValue({ valid: true, errors: [] });
});

describe("resolveToolExecutor", () => {
  it("returns null for missing or invalid executors", () => {
    expect(resolveToolExecutor()).toBeNull();
    expect(resolveToolExecutor(null)).toBeNull();
    expect(resolveToolExecutor({})).toBeNull();
    expect(resolveToolExecutor({ toolExecutor: 0 })).toBeNull();
    expect(resolveToolExecutor({ tools: "not-a-function" })).toBeNull();
  });

  it("returns direct executor from toolExecutor or tools", async () => {
    const executor = vi.fn(async () => "ok");
    expect(resolveToolExecutor({ toolExecutor: executor })).toBe(executor);

    const toolsFn = vi.fn(async () => "tool");
    expect(resolveToolExecutor({ tools: toolsFn })).toBe(toolsFn);

    await executor("ping", { value: 1 }, { tag: "ctx" });
    expect(executor).toHaveBeenCalledWith("ping", { value: 1 }, { tag: "ctx" });
  });

  it("wraps executor containers with execute()", async () => {
    const execute = vi.fn(async (name, params, ctx) => ({ name, params, ctx }));
    const wrapped = resolveToolExecutor({ toolExecutor: { execute } });

    expect(typeof wrapped).toBe("function");

    const context = { value: "ctx" };
    const result = await wrapped("ping", { value: 1 }, context);

    expect(result).toEqual({ name: "ping", params: { value: 1 }, ctx: context });
    expect(execute).toHaveBeenCalledWith("ping", { value: 1 }, context);
  });
});

describe("normalizeToolResult", () => {
  it("re-exports shared normalizeToolResult and normalizes nullish inputs", () => {
    const nullResult = normalizeToolResult(null);
    const undefinedResult = normalizeToolResult(undefined);

    expect(nullResult).toMatchObject({ ok: true, success: true, data: null });
    expect(undefinedResult).toMatchObject({ ok: true, success: true, data: null });
    expect(normalizeToolResult).toHaveBeenCalledTimes(2);
  });
});

describe("ToolRegistry", () => {
  it("injects pre-tool hook and preserves before-hook ordering", async () => {
    const order = [];
    const localPreHook = vi.fn(async () => {
      order.push("pre");
      return null;
    });
    createPreToolUseHook.mockReturnValueOnce(localPreHook);

    const beforeHook = vi.fn(async () => {
      order.push("before");
      return null;
    });
    const afterHook = vi.fn(async () => {
      order.push("after");
    });
    const toolFn = vi.fn(async () => "pong");

    const registry = new ToolRegistry({
      tools: { ping: toolFn },
      hooks: { before: [beforeHook], after: [afterHook] },
    });

    const result = await registry.callTool("ping", {}, {});

    expect(result).toMatchObject({ ok: true, data: "pong" });
    expect(createPreToolUseHook).toHaveBeenCalledTimes(1);
    expect(localPreHook).toHaveBeenCalledWith(expect.objectContaining({ tool: "ping", params: {}, context: {} }));
    expect(beforeHook).toHaveBeenCalledTimes(1);
    expect(afterHook).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["pre", "before", "after"]);
  });

  it("validates hook registration and tool registration boundaries", () => {
    const registry = new ToolRegistry();

    expect(() => registry.useHook("nope", () => {})).toThrow(/Invalid hook phase/i);
    expect(() => registry.useHook("before", null)).toThrow(/Hook must be a function/i);

    expect(() => registry.registerTools(null)).not.toThrow();
    expect(() => registry.registerTools("nope")).toThrow(/tools must be an object, array, or map/i);
    expect(() => registry.registerTools([123])).toThrow(/tools must be an object, array, or map/i);

    expect(() => registry.registerTool("", () => {})).toThrow(/name must be a non-empty string/i);
    expect(() => registry.registerTool("__proto__", () => {})).toThrow(/disallowed tool name/i);
    expect(() => registry.registerTool("prototype", () => {})).toThrow(/disallowed tool name/i);
    expect(() => registry.registerTool("constructor", () => {})).toThrow(/disallowed tool name/i);
    expect(() => registry.registerTool("demo", null)).toThrow(/fn must be a function/i);

    const badMap = new Map([[123, () => {}]]);
    expect(() => registry.registerTools(badMap)).toThrow(/name must be a non-empty string/i);
  });

  it("registers tools from map/array/object entries and exposes lookups", async () => {
    const mapFn = vi.fn(async () => "map");
    const arrayFn = vi.fn(async () => "array");
    const objectFn = vi.fn(async () => "object");
    const schema = { type: "object" };
    const registry = new ToolRegistry();

    registry.registerTools(new Map([["mapTool", { fn: mapFn, schema }]]));
    registry.registerTools([["arrayTool", arrayFn, schema], { name: "objectTool", fn: objectFn, schema }]);
    registry.registerTools({ directTool: objectFn });

    const names = registry.getToolNames().sort();
    expect(names).toEqual(["arrayTool", "directTool", "mapTool", "objectTool"].sort());
    expect(registry.hasTool("mapTool")).toBe(true);
    expect(registry.getTool("mapTool")).toBe(mapFn);
    expect(registry.getTool("missing")).toBeUndefined();

    const result = await registry.callTool("mapTool", {}, {});
    expect(result).toMatchObject({ ok: true, data: "map" });
    expect(validateArgs).toHaveBeenCalledWith({}, schema);
  });

  it("allows before hooks to override params and handles numeric boundaries", async () => {
    const toolFn = vi.fn(async ({ a, b, c }) => a + b + c);
    const registry = new ToolRegistry({ tools: { sum: toolFn } });

    registry.useHook("before", async ({ params }) => ({ params: { ...params, b: params.b - 1 } }));

    const params = { a: 0, b: -1, c: MAX_SAFE_INTEGER };
    const result = await registry.callTool("sum", params, {});

    expect(result).toMatchObject({ ok: true, data: MAX_SAFE_INTEGER - 2 });
    expect(toolFn).toHaveBeenCalledWith({ a: 0, b: -2, c: MAX_SAFE_INTEGER }, {});
  });

  it("supports before-hook skip and bypasses after hooks", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });
    const afterHook = vi.fn();

    registry.useHook("before", async () => ({ skip: true, value: { data: "skipped" } }));
    registry.useHook("after", afterHook);

    const result = await registry.callTool("ping", {}, {});

    expect(result).toMatchObject({ ok: true, data: "skipped" });
    expect(toolFn).not.toHaveBeenCalled();
    expect(afterHook).not.toHaveBeenCalled();
    expect(normalizeToolResult).toHaveBeenCalledWith({ data: "skipped" });
  });

  it("uses context executor and normalizes executor results", async () => {
    const toolFn = vi.fn(async () => "pong");
    const executor = vi.fn(async () => "from-executor");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });
    const context = { toolExecutor: executor };

    const result = await registry.callTool("ping", { value: 0 }, context);

    expect(result).toMatchObject({ ok: true, success: true, data: "from-executor" });
    expect(executor).toHaveBeenCalledWith("ping", { value: 0 }, context);
    expect(toolFn).not.toHaveBeenCalled();
    expect(normalizeToolResult).toHaveBeenCalledWith("from-executor");
  });

  it("returns error result when tool throws non-Error values", async () => {
    const registry = new ToolRegistry({
      tools: {
        boom: () => {
          throw "bad";
        },
      },
    });

    const result = await registry.callTool("boom", {}, {});

    expect(result).toEqual({ ok: false, error: "bad" });
  });

  it("rejects non-object params (null/undefined/empty string/empty array/whitespace) and emits validation events", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });
    registry.registerTool("ping", toolFn, { type: "object" });

    const afterHook = vi.fn();
    registry.useHook("after", afterHook);
    const emit = vi.fn();

    const invalidParams = [null, undefined, [], "", "   "];
    for (const params of invalidParams) {
      const result = await registry.callTool("ping", params, { emit });
      expect(result).toMatchObject({
        ok: false,
        error: "Invalid tool params for ping",
        validationErrors: ["params: expected object"],
      });
    }

    expect(toolFn).not.toHaveBeenCalled();
    expect(afterHook).toHaveBeenCalledTimes(invalidParams.length);
    expect(emit).toHaveBeenCalledTimes(invalidParams.length);
    expect(emit).toHaveBeenCalledWith(
      "tool:call:error",
      expect.objectContaining({
        tool: "ping",
        errors: ["params: expected object"],
        reason: "validation_failed",
      })
    );
    expect(validateArgs).not.toHaveBeenCalled();
  });

  it("reports schema validation errors for type boundaries", async () => {
    const toolFn = vi.fn(async () => "ok");
    const schema = {
      type: "object",
      properties: {
        count: { type: "number" },
        items: { type: "array" },
      },
    };
    const registry = new ToolRegistry({ tools: { typed: toolFn } });
    registry.registerTool("typed", toolFn, schema);

    validateArgs.mockImplementation((params) => {
      const errors = [];
      if (typeof params.count !== "number") errors.push("count: expected number");
      if (!Array.isArray(params.items)) errors.push("items: expected array");
      return { valid: errors.length === 0, errors };
    });

    const emit = vi.fn();
    const result = await registry.callTool("typed", { count: "1", items: {} }, { emit });

    expect(result).toMatchObject({ ok: false, error: "Invalid tool params for typed" });
    expect(result.validationErrors).toEqual(expect.arrayContaining(["count: expected number", "items: expected array"]));
    expect(emit).toHaveBeenCalledWith(
      "tool:call:error",
      expect.objectContaining({ tool: "typed", reason: "validation_failed" })
    );
    expect(toolFn).not.toHaveBeenCalled();
  });

  it("emits quota warnings in default warn mode and records calls", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "over" })),
      getToolStats: vi.fn(() => ({ limit: 1, used: 2 })),
      recordCall: vi.fn(() => {
        throw new Error("record-failed");
      }),
    };

    const container = {
      tryGet: vi.fn((name) => (name === "toolQuotaManager" ? quotaManager : null)),
    };
    const eventBus = { emit: vi.fn() };

    const result = await registry.callTool("ping", {}, { container, eventBus });

    expect(result).toMatchObject({ ok: true, data: "pong", quota: { allowed: false, reason: "over" } });
    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(quotaManager.tryCall).toHaveBeenCalledWith("ping");
    expect(quotaManager.recordCall).toHaveBeenCalledWith("ping");
    expect(eventBus.emit).toHaveBeenCalledWith(
      "tool:quota:exceeded",
      expect.objectContaining({
        tool: "ping",
        reason: "over",
        stats: { limit: 1, used: 2 },
      })
    );
  });

  it("blocks execution in enforce mode and allows after-hook overrides", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });

    const afterHook = vi.fn(async () => ({ ok: true, data: "override" }));
    registry.useHook("after", afterHook);

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "limit" })),
      getToolStats: vi.fn(() => ({ limit: 1, used: 1 })),
    };

    const result = await registry.callTool("ping", {}, { toolQuotaManager: quotaManager, toolQuotaConfig: { enforce: true } });

    expect(result).toMatchObject({ ok: true, data: "override" });
    expect(toolFn).not.toHaveBeenCalled();
    expect(afterHook).toHaveBeenCalledTimes(1);
    expect(normalizeToolResult).toHaveBeenCalledWith({ ok: true, data: "override" });
  });

  it("skips quota checks when disabled/off config", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });
    const quotaManager = { tryCall: vi.fn(() => ({ allowed: false, reason: "nope" })) };

    const configs = [{ enabled: false }, { mode: "off" }, { mode: "disabled" }];
    for (const cfg of configs) {
      const result = await registry.callTool("ping", {}, { toolQuotaManager: quotaManager, toolQuotaConfig: cfg });
      expect(result).toMatchObject({ ok: true, data: "pong" });
    }

    expect(toolFn).toHaveBeenCalledTimes(configs.length);
    expect(quotaManager.tryCall).not.toHaveBeenCalled();
  });

  it("uses trace context and marks errors from missing tools", async () => {
    const registry = new ToolRegistry();
    const span = { setAttribute: vi.fn(), setStatus: vi.fn() };
    const traceContext = {
      startSpan: vi.fn(),
      endSpan: vi.fn(),
      withSpan: vi.fn(async (name, fn, options) => fn(span, options)),
    };

    const result = await registry.callTool("missing", {}, { traceContext });

    expect(result).toEqual({ ok: false, error: "Unknown tool: missing" });
    expect(traceContext.withSpan).toHaveBeenCalledWith("tool.missing", expect.any(Function), { attributes: { tool: "missing" } });
    expect(span.setAttribute).toHaveBeenCalledWith("tool.name", "missing");
    expect(span.setStatus).toHaveBeenCalledWith("error", "Unknown tool: missing");
  });

  it("logs hook failures but continues execution", async () => {
    const logger = { warn: vi.fn() };
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn }, logger });

    registry.useHook("before", async () => {
      throw new Error("before-fail");
    });
    registry.useHook("after", async () => {
      throw new Error("after-fail");
    });

    const result = await registry.callTool("ping", {}, {});

    expect(result).toMatchObject({ ok: true, data: "pong" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("BeforeHook failed for ping: before-fail"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("AfterHook failed for ping: after-fail"));
  });

  it("blocks execution when PolicyManager denies", async () => {
    const toolFn = vi.fn(async () => "ok");
    const registry = new ToolRegistry({ tools: { readFile: toolFn } });

    const policyManager = {
      check: vi.fn(async () => ({ effect: "deny", reason: "nope", ruleId: "rule-1" })),
    };

    registry.usePolicyManager(policyManager);

    const result = await registry.callTool("readFile", { path: "/tmp/demo.txt" }, {});

    // normalizeToolResult strips unknown keys (like `policy`) from the returned ToolResult.
    expect(result).toMatchObject({ ok: false, success: false, error: "nope" });
    expect(normalizeToolResult).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: "nope",
        policy: { effect: "deny", ruleId: "rule-1" },
      })
    );
    expect(toolFn).not.toHaveBeenCalled();
  });

  it("fails closed when PolicyManager check throws", async () => {
    const logger = { error: vi.fn() };
    const toolFn = vi.fn(async () => "ok");
    const registry = new ToolRegistry({ tools: { readFile: toolFn }, logger });

    const policyManager = {
      check: vi.fn(async () => {
        throw new Error("policy-failed");
      }),
    };

    registry.usePolicyManager(policyManager);

    const result = await registry.callTool("readFile", { path: "/tmp/demo.txt" }, {});

    expect(result).toMatchObject({ ok: false, success: false, error: "Policy check failed: policy-failed" });
    expect(normalizeToolResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: "Policy check failed: policy-failed" })
    );
    expect(toolFn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("PolicyManager.check failed: policy-failed"));
  });

  it("passes resource to PolicyManager and handles large/deep params", async () => {
    const toolFn = vi.fn(async ({ content, nested }) => {
      let cursor = nested;
      while (cursor && cursor.child) {
        cursor = cursor.child;
      }
      return { size: content.length, leaf: cursor?.value };
    });
    const registry = new ToolRegistry({ tools: { readFile: toolFn } });

    const policyManager = { check: vi.fn(async () => ({ effect: "allow" })) };
    registry.usePolicyManager(policyManager);

    const largeContent = "x".repeat(50000);
    const deepParams = makeDeepObject(20);
    const longUrl = `file://${"a".repeat(1024)}`;
    const params = { url: longUrl, content: largeContent, nested: deepParams };

    const result = await registry.callTool("readFile", params, {});

    expect(result).toMatchObject({ ok: true, data: { size: largeContent.length, leaf: "leaf" } });
    expect(toolFn).toHaveBeenCalledWith(params, {});
    expect(policyManager.check).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "readFile", resource: longUrl, args: params })
    );
  });

  it("supports concurrent and rapid consecutive calls without cross-talk", async () => {
    const deferreds = [];
    const toolFn = vi.fn(() => {
      const deferred = createDeferred();
      deferreds.push(deferred);
      return deferred.promise;
    });
    const registry = new ToolRegistry({ tools: { echo: toolFn } });

    const first = registry.callTool("echo", { id: 0 }, {});
    const second = registry.callTool("echo", { id: 1 }, {});
    const third = registry.callTool("echo", { id: 2 }, {});

    // Wait for all tool functions to be invoked and deferreds to be created
    await vi.waitFor(() => expect(deferreds.length).toBe(3));

    deferreds[1].resolve("second");
    deferreds[0].resolve("first");
    deferreds[2].resolve("third");

    const results = await Promise.all([first, second, third]);

    expect(results.map((res) => res.data)).toEqual(["first", "second", "third"]);
    expect(toolFn).toHaveBeenCalledTimes(3);
  });
});
