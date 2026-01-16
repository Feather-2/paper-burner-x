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

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import {
  ToolRegistry,
  resolveToolExecutor,
  normalizeToolResult,
} from "../../js/agents/runtime/core/tool-registry.js";

describe("ToolRegistry", () => {
  describe("constructor", () => {
    it("should create empty registry", () => {
      const registry = new ToolRegistry();
      assert.deepEqual(registry.getToolNames(), []);
    });

    it("should accept tools via options", () => {
      const registry = new ToolRegistry({
        tools: {
          foo: () => "foo",
          bar: () => "bar",
        },
      });
      assert.deepEqual(registry.getToolNames().sort(), ["bar", "foo"]);
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
      assert.ok(registry._hooks.before.length >= 2);
      assert.ok(registry._hooks.after.includes(afterHook));
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
      assert.ok(warnings.some((w) => w.includes("BeforeHook failed")));
    });
  });

  describe("registerTool", () => {
    it("should register a tool", () => {
      const registry = new ToolRegistry();
      registry.registerTool("greet", (params) => `Hello ${params.name}`);
      assert.ok(registry.hasTool("greet"));
    });

    it("should throw if name is empty", () => {
      const registry = new ToolRegistry();
      assert.throws(
        () => registry.registerTool("", () => {}),
        /name must be a non-empty string/
      );
    });

    it("should throw if name is not a string", () => {
      const registry = new ToolRegistry();
      assert.throws(
        () => registry.registerTool(123, () => {}),
        /name must be a non-empty string/
      );
    });

    it("should throw if fn is not a function", () => {
      const registry = new ToolRegistry();
      assert.throws(
        () => registry.registerTool("test", "not a function"),
        /fn must be a function/
      );
    });

    it("should overwrite existing tool", () => {
      const registry = new ToolRegistry();
      registry.registerTool("test", () => "v1");
      registry.registerTool("test", () => "v2");
      assert.ok(registry.hasTool("test"));
    });
  });

  describe("registerTools", () => {
    it("should register tools from object", () => {
      const registry = new ToolRegistry();
      registry.registerTools({
        a: () => "a",
        b: () => "b",
      });
      assert.deepEqual(registry.getToolNames().sort(), ["a", "b"]);
    });

    it("should register tools from Map", () => {
      const registry = new ToolRegistry();
      const map = new Map([
        ["x", () => "x"],
        ["y", () => "y"],
      ]);
      registry.registerTools(map);
      assert.deepEqual(registry.getToolNames().sort(), ["x", "y"]);
    });

    it("should register tools from array of tuples", () => {
      const registry = new ToolRegistry();
      registry.registerTools([
        ["p", () => "p"],
        ["q", () => "q"],
      ]);
      assert.deepEqual(registry.getToolNames().sort(), ["p", "q"]);
    });

    it("should throw for invalid input", () => {
      const registry = new ToolRegistry();
      assert.throws(
        () => registry.registerTools("invalid"),
        /tools must be an object, array, or map/
      );
    });

    it("should handle null/undefined gracefully", () => {
      const registry = new ToolRegistry();
      registry.registerTools(null);
      registry.registerTools(undefined);
      assert.deepEqual(registry.getToolNames(), []);
    });
  });

  describe("hasTool", () => {
    it("should return true for registered tool", () => {
      const registry = new ToolRegistry({ tools: { test: () => {} } });
      assert.equal(registry.hasTool("test"), true);
    });

    it("should return false for unregistered tool", () => {
      const registry = new ToolRegistry();
      assert.equal(registry.hasTool("nonexistent"), false);
    });
  });

  describe("getToolNames", () => {
    it("should return empty array for empty registry", () => {
      const registry = new ToolRegistry();
      assert.deepEqual(registry.getToolNames(), []);
    });

    it("should return all tool names", () => {
      const registry = new ToolRegistry({
        tools: { alpha: () => {}, beta: () => {}, gamma: () => {} },
      });
      assert.deepEqual(registry.getToolNames().sort(), ["alpha", "beta", "gamma"]);
    });
  });

  describe("useHook", () => {
    it("should register before hook", () => {
      const registry = new ToolRegistry();
      const hook = () => null;
      const result = registry.useHook("before", hook);
      assert.equal(result, registry); // chainable
      assert.ok(registry._hooks.before.includes(hook));
    });

    it("should register after hook", () => {
      const registry = new ToolRegistry();
      const hook = () => undefined;
      registry.useHook("after", hook);
      assert.ok(registry._hooks.after.includes(hook));
    });

    it("should throw for invalid phase", () => {
      const registry = new ToolRegistry();
      assert.throws(() => registry.useHook("invalid", () => {}), /Invalid hook phase/);
    });

    it("should throw for non-function hook", () => {
      const registry = new ToolRegistry();
      assert.throws(() => registry.useHook("before", "not a function"), /Hook must be a function/);
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
      assert.equal(result.ok, true);
      assert.equal(result.data, 5);
    });

    it("should return error for unknown tool", async () => {
      const registry = new ToolRegistry();
      const result = await registry.callTool("unknown", {}, {});
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("Unknown tool"));
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
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("Intentional failure"));
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
      assert.equal(result.ok, true);
      assert.equal(result.data, 10);
    });

    it("should pass context to tool", async () => {
      const registry = new ToolRegistry({
        tools: {
          echo: (params, context) => ({ params, userId: context.userId }),
        },
      });
      const result = await registry.callTool("echo", { msg: "hi" }, { userId: 42 });
      assert.equal(result.ok, true);
      assert.equal(result.data.userId, 42);
      assert.equal(result.data.params.msg, "hi");
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
      assert.equal(calls.length, 1);
      assert.equal(calls[0].tool, "test");
      assert.equal(calls[0].params.x, 1);
    });

    it("should allow before hook to skip execution", async () => {
      const registry = new ToolRegistry({
        tools: { test: () => "should not run" },
        hooks: {
          before: [() => ({ skip: true, value: { skipped: true } })],
        },
      });
      const result = await registry.callTool("test", {}, {});
      assert.equal(result.ok, true);
      assert.equal(result.data.skipped, true);
    });

    it("should allow before hook to modify params", async () => {
      const registry = new ToolRegistry({
        tools: { double: (params) => params.n * 2 },
        hooks: {
          before: [({ params }) => ({ params: { n: params.n + 10 } })],
        },
      });
      const result = await registry.callTool("double", { n: 5 }, {});
      assert.equal(result.ok, true);
      assert.equal(result.data, 30); // (5 + 10) * 2
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
      assert.equal(calls.length, 1);
      assert.equal(calls[0].tool, "test");
      assert.equal(calls[0].data, "ok");
    });

    it("should allow after hook to transform result", async () => {
      const registry = new ToolRegistry({
        tools: { test: () => 5 },
        hooks: {
          after: [({ result }) => ({ ok: true, data: result.data * 3 })],
        },
      });
      const result = await registry.callTool("test", {}, {});
      assert.equal(result.ok, true);
      assert.equal(result.data, 15);
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
      assert.equal(result.ok, true);
      assert.equal(result.data, "ok");
      assert.ok(warnings.some((w) => w.includes("BeforeHook failed")));
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
      assert.equal(result.ok, true);
      assert.ok(warnings.some((w) => w.includes("AfterHook failed")));
    });
  });

  describe("callTool with external toolExecutor", () => {
    it("should use toolExecutor from context", async () => {
      const registry = new ToolRegistry();
      const context = {
        toolExecutor: (name, params) => ({ executed: name, params }),
      };
      const result = await registry.callTool("anyTool", { key: "val" }, context);
      assert.equal(result.ok, true);
      assert.equal(result.data.executed, "anyTool");
    });

    it("should use toolExecutor.execute method", async () => {
      const registry = new ToolRegistry();
      const context = {
        toolExecutor: {
          execute: (name, params) => ({ method: "execute", name }),
        },
      };
      const result = await registry.callTool("test", {}, context);
      assert.equal(result.ok, true);
      assert.equal(result.data.method, "execute");
    });

    it("should use context.tools as executor", async () => {
      const registry = new ToolRegistry();
      const context = {
        tools: (name, params) => ({ via: "tools", name }),
      };
      const result = await registry.callTool("myTool", {}, context);
      assert.equal(result.ok, true);
      assert.equal(result.data.via, "tools");
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
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("quota exceeded"));
      assert.ok(result.quota);
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
      assert.ok(events.some((e) => e.name === "tool.quota.exceeded"));
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
      assert.equal(result.ok, true);
      assert.equal(result.data, "ok");
      assert.ok(recordedCalls.includes("test"));
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
      assert.equal(result.ok, true);
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
      assert.equal(result.ok, false);
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
      assert.equal(result.ok, true);
      assert.equal(result.quota.remaining, 5);
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
      assert.equal(result.ok, true);
      assert.equal(spans.length, 1);
      assert.equal(spans[0].name, "tool.test");
      assert.equal(spans[0].attrs["tool.name"], "test");
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
      assert.equal(result.ok, false);
      assert.equal(spans[0].status.s, "error");
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
      assert.equal(result, registry); // chainable

      const callResult = await registry.callTool("test", {}, {});
      assert.equal(callResult.ok, false);
      assert.ok(callResult.error.includes("policy denied"));
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
      assert.equal(result.ok, true);
      assert.equal(result.data, "success");
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
      assert.equal(result.ok, true); // fail-open
      assert.ok(warnings.some((w) => w.includes("PolicyManager.check failed")));
    });

    it("should ignore invalid policy manager", () => {
      const registry = new ToolRegistry();
      const result1 = registry.usePolicyManager(null);
      const result2 = registry.usePolicyManager({});
      const result3 = registry.usePolicyManager({ check: "not a function" });
      assert.equal(result1, registry);
      assert.equal(result2, registry);
      assert.equal(result3, registry);
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
      assert.equal(requests[0].resource, "https://example.com");
      assert.equal(requests[0].args.query, "test");
    });
  });
});

describe("resolveToolExecutor", () => {
  it("should return function executor directly", () => {
    const fn = (name, params) => ({ name, params });
    const context = { toolExecutor: fn };
    const resolved = resolveToolExecutor(context);
    assert.equal(resolved, fn);
  });

  it("should wrap executor with execute method", () => {
    const executor = { execute: (name, params) => ({ name }) };
    const context = { toolExecutor: executor };
    const resolved = resolveToolExecutor(context);
    assert.equal(typeof resolved, "function");
    const result = resolved("test", {});
    assert.equal(result.name, "test");
  });

  it("should use context.tools as executor", () => {
    const fn = (name) => name;
    const context = { tools: fn };
    const resolved = resolveToolExecutor(context);
    assert.equal(resolved, fn);
  });

  it("should return null for invalid context", () => {
    assert.equal(resolveToolExecutor(null), null);
    assert.equal(resolveToolExecutor(undefined), null);
    assert.equal(resolveToolExecutor({}), null);
    assert.equal(resolveToolExecutor({ toolExecutor: "string" }), null);
  });
});

describe("normalizeToolResult (re-export)", () => {
  it("should normalize successful result", () => {
    const result = normalizeToolResult({ ok: true, data: "value" });
    assert.equal(result.ok, true);
    assert.equal(result.success, true);
    assert.equal(result.data, "value");
  });

  it("should normalize error result", () => {
    const result = normalizeToolResult({ ok: false, error: "failed" });
    assert.equal(result.ok, false);
    assert.equal(result.success, false);
    assert.equal(result.error, "failed");
  });

  it("should normalize primitive values", () => {
    const result = normalizeToolResult(42);
    assert.equal(result.ok, true);
    assert.equal(result.data, 42);
  });

  it("should normalize Error objects", () => {
    const result = normalizeToolResult(new Error("test error"));
    assert.equal(result.ok, false);
    assert.equal(result.error, "test error");
  });

  it("should normalize null/undefined", () => {
    const result1 = normalizeToolResult(null);
    const result2 = normalizeToolResult(undefined);
    assert.equal(result1.ok, true);
    assert.equal(result2.ok, true);
  });
});
