/**
 * ToolRegistry 单元测试
 *
 * 覆盖范围:
 * - registerTool / registerTools
 * - hasTool / getToolNames
 * - useHook (before/after)
 * - callTool (执行 + hooks + quota + trace)
 * - usePolicyManager
 * - resolveToolExecutor
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  ToolRegistry,
  resolveToolExecutor,
  normalizeToolResult,
} from "../../js/agents/runtime/core/tool-registry.js";

describe("ToolRegistry", () => {
  describe("constructor", () => {
    it("should create empty registry", () => {
      const registry = new ToolRegistry();
      expect(registry.getToolNames()).toEqual([]);
    });

    it("should accept tools via options", () => {
      const registry = new ToolRegistry({
        tools: {
          foo: () => "foo",
          bar: () => "bar",
        },
      });
      expect(registry.getToolNames().sort()).toEqual(["bar", "foo"]);
    });

    it("should accept hooks via options", () => {
      const beforeHook = () => null;
      const afterHook = () => undefined;
      const registry = new ToolRegistry({
        hooks: {
          before: [beforeHook],
          after: [afterHook],
        },
      });
      // 内部 _hooks 包含传入的 hook + 内置 PreToolUseHook
      expect(registry._hooks.before.length).toBeGreaterThanOrEqual(2);
      expect(registry._hooks.after).toContain(afterHook);
    });

    it("should accept logger via options", async () => {
      const warnings = [];
      const logger = { warn: (msg) => warnings.push(msg) };
      const registry = new ToolRegistry({
        tools: { test: () => "ok" },
        hooks: {
          before: [
            () => {
              throw new Error("hook error");
            },
          ],
        },
        logger,
      });
      await registry.callTool("test", {}, {});
      expect(warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("BeforeHook failed")])
      );
    });
  });

  describe("registerTool", () => {
    it("should register a tool", () => {
      const registry = new ToolRegistry();
      registry.registerTool("greet", (params) => `Hello ${params.name}`);
      expect(registry.hasTool("greet")).toBe(true);
    });

    it("should throw if name is empty", () => {
      const registry = new ToolRegistry();
      expect(() => registry.registerTool("", () => {})).toThrow(/name must be a non-empty string/);
    });

    it("should throw if name is not a string", () => {
      const registry = new ToolRegistry();
      expect(() => registry.registerTool(123, () => {})).toThrow(/name must be a non-empty string/);
    });

    it("should throw if fn is not a function", () => {
      const registry = new ToolRegistry();
      expect(() => registry.registerTool("test", "not a function")).toThrow(/fn must be a function/);
    });

    it("should overwrite existing tool", () => {
      const registry = new ToolRegistry();
      registry.registerTool("test", () => "v1");
      registry.registerTool("test", () => "v2");
      expect(registry.hasTool("test")).toBe(true);
    });
  });

  describe("registerTools", () => {
    it("should register tools from object", () => {
      const registry = new ToolRegistry();
      registry.registerTools({
        a: () => "a",
        b: () => "b",
      });
      expect(registry.getToolNames().sort()).toEqual(["a", "b"]);
    });

    it("should register tools from Map", () => {
      const registry = new ToolRegistry();
      const map = new Map([
        ["x", () => "x"],
        ["y", () => "y"],
      ]);
      registry.registerTools(map);
      expect(registry.getToolNames().sort()).toEqual(["x", "y"]);
    });

    it("should register tools from array of tuples", () => {
      const registry = new ToolRegistry();
      registry.registerTools([
        ["p", () => "p"],
        ["q", () => "q"],
      ]);
      expect(registry.getToolNames().sort()).toEqual(["p", "q"]);
    });

    it("should throw for invalid input", () => {
      const registry = new ToolRegistry();
      expect(() => registry.registerTools("invalid")).toThrow(/tools must be an object, array, or map/);
    });

    it("should handle null/undefined gracefully", () => {
      const registry = new ToolRegistry();
      registry.registerTools(null);
      registry.registerTools(undefined);
      expect(registry.getToolNames()).toEqual([]);
    });
  });

  describe("hasTool", () => {
    it("should return true for registered tool", () => {
      const registry = new ToolRegistry({ tools: { test: () => {} } });
      expect(registry.hasTool("test")).toBe(true);
    });

    it("should return false for unregistered tool", () => {
      const registry = new ToolRegistry();
      expect(registry.hasTool("nonexistent")).toBe(false);
    });
  });

  describe("getToolNames", () => {
    it("should return empty array for empty registry", () => {
      const registry = new ToolRegistry();
      expect(registry.getToolNames()).toEqual([]);
    });

    it("should return all tool names", () => {
      const registry = new ToolRegistry({
        tools: { alpha: () => {}, beta: () => {}, gamma: () => {} },
      });
      expect(registry.getToolNames().sort()).toEqual(["alpha", "beta", "gamma"]);
    });
  });

  describe("useHook", () => {
    it("should register before hook", () => {
      const registry = new ToolRegistry();
      const hook = () => null;
      const result = registry.useHook("before", hook);
      expect(result).toBe(registry); // chainable
      expect(registry._hooks.before).toContain(hook);
    });

    it("should register after hook", () => {
      const registry = new ToolRegistry();
      const hook = () => undefined;
      registry.useHook("after", hook);
      expect(registry._hooks.after).toContain(hook);
    });

    it("should throw for invalid phase", () => {
      const registry = new ToolRegistry();
      expect(() => registry.useHook("invalid", () => {})).toThrow(/Invalid hook phase/);
    });

    it("should throw for non-function hook", () => {
      const registry = new ToolRegistry();
      expect(() => registry.useHook("before", "not a function")).toThrow(/Hook must be a function/);
    });
  });

  describe("callTool", () => {
    it("should execute registered tool", async () => {
      const registry = new ToolRegistry({
        tools: {
          add: (params) => params.a + params.b,
        },
      });
      const result = await registry.callTool("add", { a: 2, b: 3 }, {});
      expect(result.ok).toBe(true);
      expect(result.data).toBe(5);
    });

    it("should return error for unknown tool", async () => {
      const registry = new ToolRegistry();
      const result = await registry.callTool("unknown", {}, {});
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Unknown tool");
    });

    it("should catch tool errors", async () => {
      const registry = new ToolRegistry({
        tools: {
          fail: () => {
            throw new Error("Intentional failure");
          },
        },
      });
      const result = await registry.callTool("fail", {}, {});
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Intentional failure");
    });

    it("should handle async tools", async () => {
      const registry = new ToolRegistry({
        tools: {
          delay: async (params) => {
            await new Promise((r) => setTimeout(r, 10));
            return params.value * 2;
          },
        },
      });
      const result = await registry.callTool("delay", { value: 5 }, {});
      expect(result.ok).toBe(true);
      expect(result.data).toBe(10);
    });

    it("should pass context to tool", async () => {
      const registry = new ToolRegistry({
        tools: {
          echo: (params, context) => ({ params, userId: context.userId }),
        },
      });
      const result = await registry.callTool("echo", { msg: "hi" }, { userId: 42 });
      expect(result.ok).toBe(true);
      expect(result.data.userId).toBe(42);
      expect(result.data.params.msg).toBe("hi");
    });
  });

  describe("callTool with hooks", () => {
    it("should run before hooks", async () => {
      const calls = [];
      const registry = new ToolRegistry({
        tools: { test: () => "ok" },
        hooks: {
          before: [
            ({ tool, params }) => {
              calls.push({ tool, params });
              return null;
            },
          ],
        },
      });
      await registry.callTool("test", { x: 1 }, {});
      expect(calls.length).toBe(1);
      expect(calls[0].tool).toBe("test");
      expect(calls[0].params.x).toBe(1);
    });

    it("should allow before hook to skip execution", async () => {
      const registry = new ToolRegistry({
        tools: { test: () => "should not run" },
        hooks: {
          before: [() => ({ skip: true, value: { skipped: true } })],
        },
      });
      const result = await registry.callTool("test", {}, {});
      expect(result.ok).toBe(true);
      expect(result.data.skipped).toBe(true);
    });

    it("should allow before hook to modify params", async () => {
      const registry = new ToolRegistry({
        tools: { double: (params) => params.n * 2 },
        hooks: {
          before: [({ params }) => ({ params: { n: params.n + 10 } })],
        },
      });
      const result = await registry.callTool("double", { n: 5 }, {});
      expect(result.ok).toBe(true);
      expect(result.data).toBe(30); // (5 + 10) * 2
    });

    it("should run after hooks", async () => {
      const calls = [];
      const registry = new ToolRegistry({
        tools: { test: () => "ok" },
        hooks: {
          after: [
            ({ tool, result }) => {
              calls.push({ tool, data: result.data });
              return undefined;
            },
          ],
        },
      });
      await registry.callTool("test", {}, {});
      expect(calls.length).toBe(1);
      expect(calls[0].tool).toBe("test");
      expect(calls[0].data).toBe("ok");
    });

    it("should allow after hook to transform result", async () => {
      const registry = new ToolRegistry({
        tools: { test: () => 5 },
        hooks: {
          after: [({ result }) => ({ ok: true, data: result.data * 3 })],
        },
      });
      const result = await registry.callTool("test", {}, {});
      expect(result.ok).toBe(true);
      expect(result.data).toBe(15);
    });

    it("should catch before hook errors", async () => {
      const warnings = [];
      const registry = new ToolRegistry({
        tools: { test: () => "ok" },
        hooks: {
          before: [
            () => {
              throw new Error("before hook error");
            },
          ],
        },
        logger: { warn: (msg) => warnings.push(msg) },
      });
      const result = await registry.callTool("test", {}, {});
      expect(result.ok).toBe(true);
      expect(result.data).toBe("ok");
      expect(warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("BeforeHook failed")])
      );
    });

    it("should catch after hook errors", async () => {
      const warnings = [];
      const registry = new ToolRegistry({
        tools: { test: () => "ok" },
        hooks: {
          after: [
            () => {
              throw new Error("after hook error");
            },
          ],
        },
        logger: { warn: (msg) => warnings.push(msg) },
      });
      const result = await registry.callTool("test", {}, {});
      expect(result.ok).toBe(true);
      expect(warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("AfterHook failed")])
      );
    });
  });

  describe("callTool with external toolExecutor", () => {
    it("should use toolExecutor from context", async () => {
      const registry = new ToolRegistry();
      const context = {
        toolExecutor: (name, params) => ({ executed: name, params }),
      };
      const result = await registry.callTool("anyTool", { key: "val" }, context);
      expect(result.ok).toBe(true);
      expect(result.data.executed).toBe("anyTool");
    });

    it("should use toolExecutor.execute method", async () => {
      const registry = new ToolRegistry();
      const context = {
        toolExecutor: {
          execute: (name, params) => ({ method: "execute", name }),
        },
      };
      const result = await registry.callTool("test", {}, context);
      expect(result.ok).toBe(true);
      expect(result.data.method).toBe("execute");
    });

    it("should use context.tools as executor", async () => {
      const registry = new ToolRegistry();
      const context = {
        tools: (name, params) => ({ via: "tools", name }),
      };
      const result = await registry.callTool("myTool", {}, context);
      expect(result.ok).toBe(true);
      expect(result.data.via).toBe("tools");
    });
  });

  describe("callTool with quota manager", () => {
    it("should block tool when quota exceeded in block mode", async () => {
      const registry = new ToolRegistry({
        tools: { test: () => "ok" },
      });
      const context = {
        toolQuotaManager: {
          tryCall: () => ({ allowed: false, reason: "quota exceeded" }),
          getToolStats: () => ({ calls: 10, limit: 5 }),
        },
        toolQuotaConfig: { mode: "block" },
      };
      const result = await registry.callTool("test", {}, context);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("quota exceeded");
      expect(result.quota).toEqual({ calls: 10, limit: 5 });
    });

    it("should emit quota exceeded event", async () => {
      const events = [];
      const registry = new ToolRegistry({
        tools: { test: () => "ok" },
      });
      const context = {
        toolQuotaManager: {
          tryCall: () => ({ allowed: false, reason: "limit" }),
        },
        toolQuotaConfig: { mode: "block" },
        emit: (name, data) => events.push({ name, data }),
      };
      await registry.callTool("test", {}, context);
      expect(events).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "tool.quota.exceeded" })])
      );
    });

    it("should warn but continue in warn mode", async () => {
      const registry = new ToolRegistry({
        tools: { test: () => "ok" },
      });
      const recordedCalls = [];
      const context = {
        toolQuotaManager: {
          tryCall: () => ({ allowed: false, reason: "over limit" }),
          recordCall: (name) => recordedCalls.push(name),
        },
        toolQuotaConfig: { mode: "warn" },
      };
      const result = await registry.callTool("test", {}, context);
      expect(result.ok).toBe(true);
      expect(result.data).toBe("ok");
      expect(recordedCalls).toContain("test");
    });

    it("should skip quota check when mode is off", async () => {
      const registry = new ToolRegistry({
        tools: { test: () => "ok" },
      });
      const context = {
        toolQuotaManager: {
          tryCall: () => ({ allowed: false, reason: "blocked" }),
        },
        toolQuotaConfig: { mode: "off" },
      };
      const result = await registry.callTool("test", {}, context);
      expect(result.ok).toBe(true);
    });

    it("should resolve quota manager from stageApi", async () => {
      const registry = new ToolRegistry({
        tools: { test: () => "ok" },
      });
      const context = {
        stageApi: {
          toolQuotaManager: {
            tryCall: () => ({ allowed: false, reason: "stage blocked" }),
          },
          toolQuotas: { mode: "block" },
        },
      };
      const result = await registry.callTool("test", {}, context);
      expect(result.ok).toBe(false);
    });

    it("should attach quota snapshot to result", async () => {
      const registry = new ToolRegistry({
        tools: { test: () => "ok" },
      });
      const context = {
        toolQuotaManager: {
          tryCall: () => ({ allowed: true, remaining: 5 }),
        },
        toolQuotaConfig: { mode: "warn" },
      };
      const result = await registry.callTool("test", {}, context);
      expect(result.ok).toBe(true);
      expect(result.quota.remaining).toBe(5);
    });
  });

  describe("callTool with trace context", () => {
    it("should wrap execution in span", async () => {
      const spans = [];
      const registry = new ToolRegistry({
        tools: { test: () => "traced" },
      });
      const context = {
        traceContext: {
          startSpan: () => {},
          endSpan: () => {},
          withSpan: async (name, fn, opts) => {
            const span = {
              name,
              attrs: {},
              status: null,
              setAttribute: (k, v) => (span.attrs[k] = v),
              setStatus: (s, msg) => (span.status = { s, msg }),
            };
            spans.push(span);
            return await fn(span);
          },
        },
      };
      const result = await registry.callTool("test", {}, context);
      expect(result.ok).toBe(true);
      expect(spans.length).toBe(1);
      expect(spans[0].name).toBe("tool.test");
      expect(spans[0].attrs["tool.name"]).toBe("test");
    });

    it("should set error status on failure", async () => {
      const spans = [];
      const registry = new ToolRegistry({
        tools: {
          fail: () => {
            throw new Error("trace error");
          },
        },
      });
      const context = {
        traceContext: {
          startSpan: () => {},
          endSpan: () => {},
          withSpan: async (name, fn, opts) => {
            const span = {
              name,
              status: null,
              setAttribute: () => {},
              setStatus: (s, msg) => (span.status = { s, msg }),
            };
            spans.push(span);
            return await fn(span);
          },
        },
      };
      const result = await registry.callTool("fail", {}, context);
      expect(result.ok).toBe(false);
      expect(spans[0].status.s).toBe("error");
    });
  });

  describe("usePolicyManager", () => {
    it("should integrate policy manager as before hook", async () => {
      const registry = new ToolRegistry({
        tools: { test: () => "ok" },
      });
      const policyManager = {
        check: async (req) => {
          if (req.tool === "test") {
            return { effect: "deny", reason: "policy denied", ruleId: "R1" };
          }
          return { effect: "allow" };
        },
      };
      const result = registry.usePolicyManager(policyManager);
      expect(result).toBe(registry); // chainable

      const callResult = await registry.callTool("test", {}, {});
      expect(callResult.ok).toBe(false);
      expect(callResult.error).toContain("policy denied");
      // policy 字段被 normalizeToolResult 丢弃，这是设计行为
    });

    it("should allow tool when policy allows", async () => {
      const registry = new ToolRegistry({
        tools: { allowed: () => "success" },
      });
      registry.usePolicyManager({
        check: async () => ({ effect: "allow" }),
      });
      const result = await registry.callTool("allowed", {}, {});
      expect(result.ok).toBe(true);
      expect(result.data).toBe("success");
    });

    it("should handle policy check errors gracefully", async () => {
      const warnings = [];
      const registry = new ToolRegistry({
        tools: { test: () => "ok" },
        logger: { warn: (msg) => warnings.push(msg) },
      });
      registry.usePolicyManager({
        check: async () => {
          throw new Error("policy error");
        },
      });
      const result = await registry.callTool("test", {}, {});
      expect(result.ok).toBe(true); // fail-open
      expect(warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("PolicyManager.check failed")])
      );
    });

    it("should ignore invalid policy manager", () => {
      const registry = new ToolRegistry();
      const result1 = registry.usePolicyManager(null);
      const result2 = registry.usePolicyManager({});
      const result3 = registry.usePolicyManager({ check: "not a function" });
      expect(result1).toBe(registry);
      expect(result2).toBe(registry);
      expect(result3).toBe(registry);
    });

    it("should include resource in policy request", async () => {
      const requests = [];
      const registry = new ToolRegistry({
        tools: { test: () => "ok" },
      });
      registry.usePolicyManager({
        check: async (req) => {
          requests.push(req);
          return { effect: "allow" };
        },
      });
      await registry.callTool("test", { url: "https://example.com", query: "test" }, {});
      expect(requests[0].resource).toBe("https://example.com");
      expect(requests[0].args.query).toBe("test");
    });
  });
});

describe("resolveToolExecutor", () => {
  it("should return function executor directly", () => {
    const fn = (name, params) => ({ name, params });
    const context = { toolExecutor: fn };
    const resolved = resolveToolExecutor(context);
    expect(resolved).toBe(fn);
  });

  it("should wrap executor with execute method", () => {
    const executor = { execute: (name, params) => ({ name }) };
    const context = { toolExecutor: executor };
    const resolved = resolveToolExecutor(context);
    expect(typeof resolved).toBe("function");
    const result = resolved("test", {});
    expect(result.name).toBe("test");
  });

  it("should use context.tools as executor", () => {
    const fn = (name) => name;
    const context = { tools: fn };
    const resolved = resolveToolExecutor(context);
    expect(resolved).toBe(fn);
  });

  it("should return null for invalid context", () => {
    expect(resolveToolExecutor(null)).toBe(null);
    expect(resolveToolExecutor(undefined)).toBe(null);
    expect(resolveToolExecutor({})).toBe(null);
    expect(resolveToolExecutor({ toolExecutor: "string" })).toBe(null);
  });
});

describe("normalizeToolResult (re-export)", () => {
  it("should normalize successful result", () => {
    const result = normalizeToolResult({ ok: true, data: "value" });
    expect(result.ok).toBe(true);
    expect(result.success).toBe(true);
    expect(result.data).toBe("value");
  });

  it("should normalize error result", () => {
    const result = normalizeToolResult({ ok: false, error: "failed" });
    expect(result.ok).toBe(false);
    expect(result.success).toBe(false);
    expect(result.error).toBe("failed");
  });

  it("should normalize primitive values", () => {
    const result = normalizeToolResult(42);
    expect(result.ok).toBe(true);
    expect(result.data).toBe(42);
  });

  it("should normalize Error objects", () => {
    const result = normalizeToolResult(new Error("test error"));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("test error");
  });

  it("should normalize null/undefined", () => {
    const result1 = normalizeToolResult(null);
    const result2 = normalizeToolResult(undefined);
    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
  });
});
