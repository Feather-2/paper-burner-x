
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  ToolExecutor,
  createToolExecutor,
  executeTool,
  __test,
} from '../../../../../js/agents/runtime/tools/tool-executor.js';

const { WorkerPool } = __test;

const busyLoopUrl = new URL("../../fixtures/tool-executor/busy-loop.mjs", import.meta.url).toString();

class WorkerSpyExecutor extends ToolExecutor {
  constructor(options) {
    super(options);
    this.workerCalls = [];
  }

  async _executeInWorker(moduleUrl, exportName, args, context, timeoutMs) {
    this.workerCalls.push({ moduleUrl, exportName, args, context, timeoutMs });
    return { ok: true, data: { moduleUrl, exportName } };
  }
}

async function withBrowserLikeRuntime(fn) {
  const originalDeno = globalThis.Deno;
  try {
    globalThis.Deno = {};
    return await fn();
  } finally {
    if (originalDeno === undefined) {
      delete globalThis.Deno;
    } else {
      globalThis.Deno = originalDeno;
    }
  }
}

describe("ToolExecutor", () => {
  describe("execute", () => {
    it("should execute a tool successfully", async () => {
      const executor = new ToolExecutor({
        tools: {
          greet: { handler: async (args) => ({ message: `Hello, ${args.name}!` }) },
        },
      });

      const result = await executor.execute("greet", { name: "World" }, {});

      expect(result.success).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.data.message).toBe("Hello, World!");
    });

    it("should return error for unknown tool", async () => {
      const executor = new ToolExecutor({ tools: {} });

      const result = await executor.execute("unknown", {}, {});

      expect(result.success).toBe(false);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Unknown tool");
    });

    it("should handle tool errors", async () => {
      const executor = new ToolExecutor({
        tools: {
          fail: { handler: async () => { throw new Error("Intentional failure"); } },
        },
        maxRetries: 0,
      });

      const result = await executor.execute("fail", {}, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Intentional failure");
    });

    it("should retry on failure", async () => {
      let attempts = 0;
      const executor = new ToolExecutor({
        tools: {
          flaky: {
            handler: async () => {
              attempts++;
              if (attempts < 2) throw new Error("Flaky");
              return { ok: true };
            },
          },
        },
        maxRetries: 2,
      });

      const result = await executor.execute("flaky", {}, {});

      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
    });

    it("should timeout long-running tools", async () => {
      const executor = new ToolExecutor({
        tools: {
          slow: { handler: () => new Promise(() => {}) },
        },
        timeoutMs: 50,
        maxRetries: 0,
      });

      const result = await executor.execute("slow", {}, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    });

    it("should support function-style tools", async () => {
      const executor = new ToolExecutor({
        tools: {
          add: async (args) => args.a + args.b,
        },
      });

      const result = await executor.execute("add", { a: 2, b: 3 }, {});

      expect(result.success).toBe(true);
      expect(result.data).toBe(5);
    });

    it("should return error if tool has no handler", async () => {
      const executor = new ToolExecutor({
        tools: {
          noHandler: { description: "Tool without handler" },
        },
      });

      const result = await executor.execute("noHandler", {}, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("no handler");
    });

    it("should use per-call timeoutMs option", async () => {
      const executor = new ToolExecutor({
        tools: {
          slow: { handler: () => new Promise(() => {}) },
        },
        timeoutMs: 10000,
        maxRetries: 0,
      });

      const result = await executor.execute("slow", {}, {}, { timeoutMs: 30 });

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    });

    it("should use per-call retries option", async () => {
      let attempts = 0;
      const executor = new ToolExecutor({
        tools: {
          flaky: {
            handler: async () => {
              attempts++;
              if (attempts < 3) throw new Error("Flaky");
              return { ok: true };
            },
          },
        },
        maxRetries: 0,
      });

      const result = await executor.execute("flaky", {}, {}, { retries: 5 });

      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
    });
  });

  describe("schema validation", () => {
    it("should validate args against tool parameters schema", async () => {
      const emitted = [];
      const executor = new ToolExecutor({
        tools: {
          search: {
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            },
            handler: async (args) => args.query,
          },
        },
        validateSchema: true,
        emit: (name, payload) => emitted.push({ name, payload }),
      });

      const result = await executor.execute("search", {}, {});

      expect(result.success).toBe(true);
      expect(emitted).toEqual(expect.arrayContaining([expect.objectContaining({ name: "tool.validation.failed" })]));
    });

    it("should fail in strict validation mode when schema invalid", async () => {
      const executor = new ToolExecutor({
        tools: {
          search: {
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            },
            handler: async (args) => args.query,
          },
        },
        validateSchema: true,
        strictValidation: true,
      });

      const result = await executor.execute("search", {}, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Validation failed");
    });

    it("should skip validation when validateSchema is false", async () => {
      const emitted = [];
      const executor = new ToolExecutor({
        tools: {
          search: {
            parameters: {
              type: "object",
              required: ["query"],
            },
            handler: async () => "ok",
          },
        },
        validateSchema: false,
        emit: (name, payload) => emitted.push({ name, payload }),
      });

      const result = await executor.execute("search", {}, {});

      expect(result.success).toBe(true);
      expect(emitted.some(e => e.name === "tool.validation.failed")).toBe(false);
    });

    it("should allow per-call validation override", async () => {
      const executor = new ToolExecutor({
        tools: {
          search: {
            parameters: { type: "object", required: ["query"] },
            handler: async () => "ok",
          },
        },
        validateSchema: false,
        strictValidation: true,
      });

      const result = await executor.execute("search", {}, {}, {
        validateSchema: true,
        strictValidation: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Validation failed");
    });

    it("should use definition.parameters as fallback", async () => {
      const executor = new ToolExecutor({
        tools: {
          search: {
            definition: {
              parameters: { type: "object", required: ["q"] },
            },
            handler: async () => "ok",
          },
        },
        strictValidation: true,
      });

      const result = await executor.execute("search", {}, {});

      expect(result.success).toBe(false);
    });
  });

  describe("before hooks", () => {
    it("should run before hooks and allow arg modification", async () => {
      const executor = new ToolExecutor({
        tools: {
          echo: { handler: async (args) => args },
        },
        hooks: {
          before: [
            async ({ params }) => ({ params: { ...params, injected: true } }),
          ],
          after: [],
        },
      });

      const result = await executor.execute("echo", { original: true }, {});

      expect(result.success).toBe(true);
      expect(result.data.injected).toBe(true);
      expect(result.data.original).toBe(true);
    });

    it("should allow before hook to skip execution", async () => {
      const executor = new ToolExecutor({
        tools: {
          echo: { handler: async () => "should not run" },
        },
        hooks: {
          before: [
            async () => ({ skip: true, value: { intercepted: true } }),
          ],
          after: [],
        },
      });

      const result = await executor.execute("echo", {}, {});

      expect(result.success).toBe(true);
      expect(result.data.intercepted).toBe(true);
    });

    it("should continue if before hook throws", async () => {
      const logged = [];
      const executor = new ToolExecutor({
        tools: {
          echo: { handler: async () => "executed" },
        },
        hooks: {
          before: [
            async () => { throw new Error("Hook error"); },
          ],
          after: [],
        },
        logger: {
          warn: (msg, data) => logged.push({ msg, data }),
          debug: () => {},
        },
      });

      const result = await executor.execute("echo", {}, {});

      expect(result.success).toBe(true);
      expect(result.data).toBe("executed");
      expect(logged).toEqual(expect.arrayContaining([expect.objectContaining({
        msg: expect.stringContaining("Before hook failed"),
      })]));
    });
  });

  describe("after hooks", () => {
    it("should run after hooks and allow result modification", async () => {
      const executor = new ToolExecutor({
        tools: {
          echo: { handler: async (args) => args.val },
        },
        hooks: {
          before: [],
          after: [
            async ({ result }) => `modified:${result}`,
          ],
        },
      });

      const result = await executor.execute("echo", { val: "original" }, {});

      expect(result.success).toBe(true);
      expect(result.data).toBe("modified:original");
    });

    it("should continue if after hook throws", async () => {
      const logged = [];
      const executor = new ToolExecutor({
        tools: {
          echo: { handler: async () => "value" },
        },
        hooks: {
          before: [],
          after: [
            async () => { throw new Error("After hook error"); },
          ],
        },
        logger: {
          warn: (msg, data) => logged.push({ msg, data }),
          debug: () => {},
        },
      });

      const result = await executor.execute("echo", {}, {});

      expect(result.success).toBe(true);
      expect(result.data).toBe("value");
      expect(logged).toEqual(expect.arrayContaining([expect.objectContaining({
        msg: expect.stringContaining("After hook failed"),
      })]));
    });

    it("should accept per-call hooks override", async () => {
      const globalAfter = vi.fn(async () => "global");
      const localAfter = vi.fn(async () => "local");

      const executor = new ToolExecutor({
        tools: {
          echo: { handler: async () => "value" },
        },
        hooks: {
          before: [],
          after: [globalAfter],
        },
      });

      const result = await executor.execute("echo", {}, {}, {
        hooks: { before: [], after: [localAfter] },
      });

      expect(result.data).toBe("local");
      expect(globalAfter.mock.calls.length).toBe(0);
      expect(localAfter.mock.calls.length).toBe(1);
    });
  });

  describe("policy authorization", () => {
    it("should deny execution when policy returns allowed=false", async () => {
      const emitted = [];
      const executor = new ToolExecutor({
        tools: {
          dangerous: { handler: async () => "executed" },
        },
        policy: {
          authorize: async () => ({ allowed: false, reason: "forbidden" }),
        },
        policyMapper: (name) => ({ tool: name }),
        emit: (name, payload) => emitted.push({ name, payload }),
      });

      const result = await executor.execute("dangerous", {}, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Policy denied");
      expect(emitted).toEqual(expect.arrayContaining([expect.objectContaining({ name: "tool.denied" })]));
    });

    it("should allow execution when policy returns allowed=true", async () => {
      const executor = new ToolExecutor({
        tools: {
          safe: { handler: async () => "executed" },
        },
        policy: {
          authorize: async () => ({ allowed: true }),
        },
        policyMapper: (name) => ({ tool: name }),
      });

      const result = await executor.execute("safe", {}, {});

      expect(result.success).toBe(true);
      expect(result.data).toBe("executed");
    });

    it("should skip policy check if no policyMapper", async () => {
      const executor = new ToolExecutor({
        tools: {
          test: { handler: async () => "ok" },
        },
        policy: {
          authorize: async () => ({ allowed: false, reason: "should not be called" }),
        },
      });

      const result = await executor.execute("test", {}, {});

      expect(result.success).toBe(true);
    });

    it("should skip policy check if mapper returns null", async () => {
      const executor = new ToolExecutor({
        tools: {
          test: { handler: async () => "ok" },
        },
        policy: {
          authorize: async () => ({ allowed: false }),
        },
        policyMapper: () => null,
      });

      const result = await executor.execute("test", {}, {});

      expect(result.success).toBe(true);
    });

    it("should handle policy.authorize throwing", async () => {
      const emitted = [];
      const executor = new ToolExecutor({
        tools: {
          test: { handler: async () => "ok" },
        },
        policy: {
          authorize: async () => { throw new Error("Policy error"); },
        },
        policyMapper: (name) => ({ tool: name }),
        emit: (name, payload) => emitted.push({ name, payload }),
      });

      const result = await executor.execute("test", {}, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Policy error");
      expect(emitted).toEqual(expect.arrayContaining([expect.objectContaining({
        name: "tool.denied",
        payload: expect.objectContaining({ reason: "policy_error" }),
      })]));
    });

    it("should use per-call policy override", async () => {
      const globalPolicy = { authorize: async () => ({ allowed: false }) };
      const localPolicy = { authorize: async () => ({ allowed: true }) };

      const executor = new ToolExecutor({
        tools: {
          test: { handler: async () => "ok" },
        },
        policy: globalPolicy,
        policyMapper: (name) => ({ tool: name }),
      });

      const result = await executor.execute("test", {}, {}, {
        policy: localPolicy,
        policyMapper: (name) => ({ tool: name }),
      });

      expect(result.success).toBe(true);
    });
  });

  describe("events and logging", () => {
    it("should emit tool.completed event on success", async () => {
      const emitted = [];
      const executor = new ToolExecutor({
        tools: {
          ping: { handler: async () => "pong" },
        },
        emit: (name, payload) => emitted.push({ name, payload }),
      });

      await executor.execute("ping", {}, {});

      const completed = emitted.find(e => e.name === "tool.completed");
      expect(completed).toEqual(expect.objectContaining({ name: "tool.completed" }));
      expect(completed.payload.tool).toBe("ping");
      expect(completed.payload.duration).toEqual(expect.any(Number));
    });

    it("should emit tool.failed event on all retries exhausted", async () => {
      const emitted = [];
      const executor = new ToolExecutor({
        tools: {
          fail: { handler: async () => { throw new Error("Always fails"); } },
        },
        maxRetries: 1,
        emit: (name, payload) => emitted.push({ name, payload }),
      });

      await executor.execute("fail", {}, {});

      const failed = emitted.find(e => e.name === "tool.failed");
      expect(failed).toEqual(expect.objectContaining({ name: "tool.failed" }));
      expect(failed.payload.tool).toBe("fail");
      expect(failed.payload.error).toContain("Always fails");
    });

    it("should call logger.debug on success", async () => {
      const logged = [];
      const executor = new ToolExecutor({
        tools: {
          ping: { handler: async () => "pong" },
        },
        logger: {
          debug: (msg, data) => logged.push({ level: "debug", msg, data }),
        },
      });

      await executor.execute("ping", {}, {});

      expect(logged).toEqual(expect.arrayContaining([expect.objectContaining({
        level: "debug",
        msg: expect.stringContaining("completed"),
      })]));
    });

    it("should call logger.warn on retry", async () => {
      let attempts = 0;
      const logged = [];
      const executor = new ToolExecutor({
        tools: {
          flaky: {
            handler: async () => {
              attempts++;
              if (attempts < 2) throw new Error("Flaky");
              return "ok";
            },
          },
        },
        maxRetries: 2,
        logger: {
          warn: (msg, data) => logged.push({ level: "warn", msg, data }),
          debug: () => {},
        },
      });

      await executor.execute("flaky", {}, {});

      expect(logged).toEqual(expect.arrayContaining([expect.objectContaining({
        level: "warn",
        msg: expect.stringContaining("failed"),
      })]));
    });
  });

  describe("executeBatch", () => {
    it("should execute multiple tools in parallel", async () => {
      const executor = new ToolExecutor({
        tools: {
          double: { handler: async (args) => args.n * 2 },
          triple: { handler: async (args) => args.n * 3 },
        },
      });

      const results = await executor.executeBatch([
        { action: "double", args: { n: 5 } },
        { action: "triple", args: { n: 5 } },
      ], {});

      expect(results.length).toBe(2);
      expect(results[0].data).toBe(10);
      expect(results[1].data).toBe(15);
    });

    it("should handle mixed success and failure", async () => {
      const executor = new ToolExecutor({
        tools: {
          ok: { handler: async () => "ok" },
          fail: { handler: async () => { throw new Error("Fail"); } },
        },
        maxRetries: 0,
      });

      const results = await executor.executeBatch([
        { action: "ok", args: {} },
        { action: "fail", args: {} },
      ], {});

      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });

    it("should support name field as alias for action", async () => {
      const executor = new ToolExecutor({
        tools: {
          ping: { handler: async () => "pong" },
        },
      });

      const results = await executor.executeBatch([
        { name: "ping", args: {} },
      ], {});

      expect(results[0].data).toBe("pong");
    });
  });

  describe("register", () => {
    it("should register tools dynamically", async () => {
      const executor = new ToolExecutor();

      executor.register("echo", { handler: async (args) => args });

      const result = await executor.execute("echo", { msg: "test" }, {});
      expect(result.success).toBe(true);
      expect(result.data.msg).toBe("test");
    });

    it("should register multiple tools at once", async () => {
      const executor = new ToolExecutor();

      executor.registerAll({
        a: { handler: async () => "a" },
        b: { handler: async () => "b" },
      });

      const resultA = await executor.execute("a", {}, {});
      const resultB = await executor.execute("b", {}, {});

      expect(resultA.data).toBe("a");
      expect(resultB.data).toBe("b");
    });
  });

  describe("tool lookup", () => {
    it("should report hasTool and getTool", () => {
      const executor = new ToolExecutor({
        tools: {
          ping: { handler: async () => "pong" },
        },
      });

      expect(executor.hasTool("ping")).toBe(true);
      expect(executor.hasTool("missing")).toBe(false);
      expect(typeof executor.getTool("ping").handler).toBe("function");
      expect(executor.getTool("missing")).toBe(undefined);
    });
  });

  describe("getToolDefinitions", () => {
    it("should return tool definitions", () => {
      const executor = new ToolExecutor({
        tools: {
          search: {
            description: "Search documents",
            parameters: { query: { type: "string" } },
            handler: async () => {},
          },
        },
      });

      const defs = executor.getToolDefinitions();

      expect(defs.length).toBe(1);
      expect(defs[0].name).toBe("search");
      expect(defs[0].description).toBe("Search documents");
    });

    it("should use definition.parameters as fallback", () => {
      const executor = new ToolExecutor({
        tools: {
          search: {
            description: "Search",
            definition: {
              parameters: { q: { type: "string" } },
            },
            handler: async () => {},
          },
        },
      });

      const defs = executor.getToolDefinitions();

      expect(defs[0].parameters).toEqual({ q: { type: "string" } });
    });
  });

  describe("createToolExecutor", () => {
    it("should create executor with factory function", async () => {
      const executor = createToolExecutor({
        tools: { test: { handler: async () => "ok" } },
      });

      const result = await executor.execute("test", {}, {});
      expect(result.data).toBe("ok");
    });
  });

  describe("executeTool (compat)", () => {
    it("should execute tool with simple function", async () => {
      const tools = {
        ping: { handler: async () => "pong" },
      };

      const result = await executeTool(tools, "ping", {}, {});
      expect(result.data).toBe("pong");
    });
  });

  describe("result normalization", () => {
    it("should normalize { success, data } format", async () => {
      const executor = new ToolExecutor({
        tools: { t: { handler: async () => ({ success: true, data: "value" }) } },
      });

      const result = await executor.execute("t", {}, {});
      expect(result.success).toBe(true);
      expect(result.data).toBe("value");
    });

    it("should normalize { ok, result } format", async () => {
      const executor = new ToolExecutor({
        tools: { t: { handler: async () => ({ ok: true, result: "value" }) } },
      });

      const result = await executor.execute("t", {}, {});
      expect(result.success).toBe(true);
    });

    it("should normalize { error } format", async () => {
      const executor = new ToolExecutor({
        tools: { t: { handler: async () => ({ error: "failed" }) } },
      });

      const result = await executor.execute("t", {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toBe("failed");
    });

    it("should handle null return value", async () => {
      const executor = new ToolExecutor({
        tools: { t: { handler: async () => null } },
      });

      const result = await executor.execute("t", {}, {});
      expect(result.success).toBe(true);
      expect(result.data).toBe(null);
    });

    it("should handle undefined return value", async () => {
      const executor = new ToolExecutor({
        tools: { t: { handler: async () => undefined } },
      });

      const result = await executor.execute("t", {}, {});
      expect(result.success).toBe(true);
      expect(result.data).toBe(null);
    });

    it("should handle primitive return values", async () => {
      const executor = new ToolExecutor({
        tools: {
          num: { handler: async () => 42 },
          str: { handler: async () => "hello" },
          bool: { handler: async () => true },
        },
      });

      const numResult = await executor.execute("num", {}, {});
      const strResult = await executor.execute("str", {}, {});
      const boolResult = await executor.execute("bool", {}, {});

      expect(numResult.data).toBe(42);
      expect(strResult.data).toBe("hello");
      expect(boolResult.data).toBe(true);
    });

    it("should include raw property for object results", async () => {
      const rawValue = { ok: true, extra: "metadata" };
      const executor = new ToolExecutor({
        tools: { t: { handler: async () => rawValue } },
      });

      const result = await executor.execute("t", {}, {});
      expect(result.raw).toEqual(rawValue);
    });
  });

  describe("constructor options", () => {
    it("should use default timeoutMs of 30000", () => {
      const executor = new ToolExecutor({});
      expect(executor.defaultTimeoutMs).toBe(30000);
    });

    it("should use default maxRetries of 1", () => {
      const executor = new ToolExecutor({});
      expect(executor.maxRetries).toBe(1);
    });

    it("should respect custom timeoutMs", () => {
      const executor = new ToolExecutor({ timeoutMs: 5000 });
      expect(executor.defaultTimeoutMs).toBe(5000);
    });

    it("should respect custom maxRetries", () => {
      const executor = new ToolExecutor({ maxRetries: 3 });
      expect(executor.maxRetries).toBe(3);
    });

    it("should default validateSchema to true", () => {
      const executor = new ToolExecutor({});
      expect(executor.validateSchema).toBe(true);
    });

    it("should default strictValidation to false", () => {
      const executor = new ToolExecutor({});
      expect(executor.strictValidation).toBe(false);
    });

    it("should normalize isolation mode", () => {
      const e1 = new ToolExecutor({ isolation: true });
      const e2 = new ToolExecutor({ isolation: "worker" });
      const e3 = new ToolExecutor({ isolation: "WORKER" });
      const e4 = new ToolExecutor({ isolation: "none" });
      const e5 = new ToolExecutor({ isolation: "invalid" });

      expect(e1.defaultIsolation).toBe("worker");
      expect(e2.defaultIsolation).toBe("worker");
      expect(e3.defaultIsolation).toBe("worker");
      expect(e4.defaultIsolation).toBe("none");
      expect(e5.defaultIsolation).toBe("none");
    });

    it("should initialize hooks arrays", () => {
      const executor = new ToolExecutor({});
      expect(executor.hooks.before).toBeInstanceOf(Array);
      expect(executor.hooks.after).toBeInstanceOf(Array);
      expect(executor.hooks.before.length).toBeGreaterThan(0); // createPreToolUseHook added
    });

    it("should copy provided hooks arrays", () => {
      const before = [async () => null];
      const after = [async () => null];
      const executor = new ToolExecutor({ hooks: { before, after } });

      expect(executor.hooks.before).not.toBe(before);
      expect(executor.hooks.after).not.toBe(after);
    });
  });

  describe("worker isolation", () => {
    it("should execute via worker when isolation is worker", async () => {
      const executor = new WorkerSpyExecutor({
        tools: {
          t: {
            handler: async () => "direct",
            worker: { moduleUrl: busyLoopUrl, exportName: "handler" },
            isolation: "worker",
          },
        },
      });

      const result = await executor.execute("t", { value: 1 }, {});

      expect(result.success).toBe(true);
      expect(executor.workerCalls.length).toBe(1);
      expect(executor.workerCalls[0].moduleUrl).toBe(busyLoopUrl);
    });

    it("should allow per-call isolation override", async () => {
      const executor = new WorkerSpyExecutor({
        tools: {
          t: {
            handler: async () => "direct",
            worker: { moduleUrl: busyLoopUrl, exportName: "handler" },
            isolation: "none",
          },
        },
      });

      const result = await executor.execute("t", { value: 1 }, {}, { isolation: "worker" });

      expect(result.success).toBe(true);
      expect(executor.workerCalls.length).toBe(1);
    });

    it("should allow per-call isolation to disable worker execution", async () => {
      const executor = new WorkerSpyExecutor({
        tools: {
          t: {
            handler: async () => "direct",
            worker: { moduleUrl: busyLoopUrl, exportName: "handler" },
            isolation: "worker",
          },
        },
      });

      const result = await executor.execute("t", {}, {}, { isolation: "none" });

      expect(result.success).toBe(true);
      expect(result.data).toBe("direct");
      expect(executor.workerCalls.length).toBe(0);
    });
  });

  describe("worker module URL policy", () => {
    it("should allow bare moduleUrl when policy is allow", async () => {
      const executor = new WorkerSpyExecutor();

      const result = await executor._executeWithTimeout(
        () => "direct",
        {},
        {},
        50,
        {
          isolationMode: "worker",
          tool: { worker: { moduleUrl: "tool-module", moduleUrlPolicy: "allow", exportName: "handler" } },
        }
      );

      expect(result.data.moduleUrl).toBe("tool-module");
    });

    it("should block bare moduleUrl when policy is sameOrigin", async () => {
      const executor = new WorkerSpyExecutor();

      await expect(() => executor._executeWithTimeout(
          () => "direct",
          {},
          {},
          50,
          {
            isolationMode: "worker",
            tool: { worker: { moduleUrl: "tool-module", moduleUrlPolicy: "sameOrigin" } },
          }
        ),
        /bare specifiers require moduleUrlPolicy=allow/
      );
    });

    it("should allow file URLs when policy is local", async () => {
      const executor = new WorkerSpyExecutor();

      const result = await executor._executeWithTimeout(
        () => "direct",
        {},
        {},
        50,
        {
          isolationMode: "worker",
          tool: { worker: { moduleUrl: busyLoopUrl, moduleUrlPolicy: "local" } },
        }
      );

      expect(result.data.moduleUrl).toBe(busyLoopUrl);
    });

    it("should enforce allowed origins in browser-like runtime", async () => {
      const executor = new WorkerSpyExecutor();

      await withBrowserLikeRuntime(async () => {
        await expect(() => executor._executeWithTimeout(
            () => "direct",
            {},
            {},
            50,
            {
              isolationMode: "worker",
              tool: {
                worker: {
                  moduleUrl: "https://denied.example.com/worker.mjs",
                  moduleUrlPolicy: "sameOrigin",
                  allowedOrigins: ["https://allowed.example.com"],
                },
              },
            }
          ),
          /origin not allowed/
        );

        const result = await executor._executeWithTimeout(
          () => "direct",
          {},
          {},
          50,
          {
            isolationMode: "worker",
            tool: {
              worker: {
                moduleUrl: "https://allowed.example.com/worker.mjs",
                moduleUrlPolicy: "sameOrigin",
                allowedOrigins: ["https://allowed.example.com"],
              },
            },
          }
        );

        expect(result.data.moduleUrl).toBe("https://allowed.example.com/worker.mjs");
      });
    });
  });

  describe("_createWorkerContextSnapshot", () => {
    it("should copy state and runId with cloning", () => {
      const executor = new ToolExecutor();
      const state = { nested: { value: 1 } };
      const snapshot = executor._createWorkerContextSnapshot({
        state,
        runId: "run-1",
        extra: "skip",
      });

      expect(snapshot).toEqual({ state: { nested: { value: 1 } }, runId: "run-1" });

      state.nested.value = 2;
      expect(snapshot.state.nested.value).toBe(1);
    });

    it("should return empty object when snapshot is not cloneable", () => {
      const executor = new ToolExecutor();
      const snapshot = executor._createWorkerContextSnapshot({
        state: { fn: () => "nope" },
        runId: "run-2",
      });

      expect(snapshot).toEqual({});
    });
  });

  describe("_executeInWorker", () => {
    it("should route to node worker implementation in node-like runtime", async () => {
      class RoutingExecutor extends ToolExecutor {
        constructor() {
          super();
          this.nodeCalls = 0;
          this.webCalls = 0;
        }

        async _executeInNodeWorker() {
          this.nodeCalls += 1;
          return "node";
        }

        async _executeInWebWorker() {
          this.webCalls += 1;
          return "web";
        }
      }

      const executor = new RoutingExecutor();
      const result = await executor._executeInWorker("module", "handler", {}, {}, 10);

      expect(result).toBe("node");
      expect(executor.nodeCalls).toBe(1);
      expect(executor.webCalls).toBe(0);
    });
  });

  describe("_executeInNodeWorker", () => {
    it("should execute module handlers in node workers", async () => {
      const executor = new ToolExecutor();
      const result = await executor._executeInNodeWorker(
        busyLoopUrl,
        "handler",
        { durationMs: 5 },
        { runId: "run-node", state: { ok: true } },
        500
      );

      expect(result.ok).toBe(true);
      expect(result.durationMs).toBe(5);
    });

    it("should surface worker errors from missing handlers", async () => {
      const executor = new ToolExecutor();

      await expect(() => executor._executeInNodeWorker(
          busyLoopUrl,
          "missing",
          {},
          {},
          500
        ),
        /not a function/
      );
    });
  });

  describe("_executeInWebWorker", () => {
    const originalWorker = globalThis.Worker;
    const originalPools = globalThis.__PB_TOOL_EXECUTOR_WORKER_POOLS_V1__;

    class MockWorker {
      constructor(url, options) {
        this.url = url;
        this.options = options;
        this.listeners = {
          message: new Set(),
          error: new Set(),
        };
      }

      addEventListener(type, cb) {
        this.listeners[type]?.add(cb);
      }

      removeEventListener(type, cb) {
        this.listeners[type]?.delete(cb);
      }

      postMessage(msg) {
        const behavior = MockWorker.behavior;
        if (behavior === "error-event") {
          queueMicrotask(() => {
            const err = new Error("Worker error");
            this.listeners.error.forEach((cb) => cb(err));
          });
          return;
        }

        const response = typeof behavior === "function"
          ? behavior(msg)
          : { type: "result", result: { ok: true, echo: msg } };

        queueMicrotask(() => {
          this.listeners.message.forEach((cb) => cb({ data: response }));
        });
      }

      terminate() {
        this.terminated = true;
      }
    }

    beforeEach(() => {
      globalThis.Worker = MockWorker;
      globalThis.__PB_TOOL_EXECUTOR_WORKER_POOLS_V1__ = new Map();
      MockWorker.behavior = undefined;
    });

    afterEach(() => {
      globalThis.Worker = originalWorker;
      if (originalPools === undefined) {
        delete globalThis.__PB_TOOL_EXECUTOR_WORKER_POOLS_V1__;
      } else {
        globalThis.__PB_TOOL_EXECUTOR_WORKER_POOLS_V1__ = originalPools;
      }
    });

    it("should execute in web worker with mocked Worker", async () => {
      MockWorker.behavior = (msg) => ({
        type: "result",
        result: { ok: true, echo: msg },
      });

      const executor = new ToolExecutor();
      const result = await executor._executeInWebWorker(
        "https://example.com/worker.mjs",
        "handler",
        { value: 1 },
        { runId: "run-web", state: { ok: true }, extra: "skip" },
        200
      );

      expect(result.ok).toBe(true);
      expect(result.echo.context).toEqual({ state: { ok: true }, runId: "run-web" });
    });

    it("should surface web worker error messages", async () => {
      MockWorker.behavior = () => ({
        type: "error",
        error: { message: "Boom", name: "BoomError" },
      });

      const executor = new ToolExecutor();
      await expect(() => executor._executeInWebWorker(
          "https://example.com/worker.mjs",
          "handler",
          {},
          {},
          200
        ),
        /Boom/
      );
    });

    it("should reject on worker error events", async () => {
      MockWorker.behavior = "error-event";

      const executor = new ToolExecutor();
      await expect(() => executor._executeInWebWorker(
          "https://example.com/worker.mjs",
          "handler",
          {},
          {},
          200
        ),
        /Worker error/
      );
    });

    it("should throw when Worker is unavailable", async () => {
      globalThis.Worker = undefined;
      const executor = new ToolExecutor();

      await expect(() => executor._executeInWebWorker(
          "https://example.com/worker.mjs",
          "handler",
          {},
          {},
          200
        ),
        /Worker unavailable/
      );
    });
  });

  describe("WorkerPool", () => {
    it("should throw if createWorker is not a function", () => {
      expect(() => new WorkerPool({})).toThrow(TypeError);
      expect(() => new WorkerPool({ createWorker: "not a function" })).toThrow(TypeError);
    });

    it("should use default maxWorkers of 2", () => {
      const pool = new WorkerPool({ createWorker: async () => ({}) });
      expect(pool._maxWorkers).toBe(2);
    });

    it("should respect custom maxWorkers", () => {
      const pool = new WorkerPool({ createWorker: async () => ({}), maxWorkers: 5 });
      expect(pool._maxWorkers).toBe(5);
    });

    it("should acquire and release workers", async () => {
      let created = 0;
      const pool = new WorkerPool({
        createWorker: async () => {
          created++;
          return {
            ref: () => {},
            unref: () => {},
            terminate: async () => {},
          };
        },
        maxWorkers: 2,
      });

      const w1 = await pool.acquire();
      const w2 = await pool.acquire();

      expect(created).toBe(2);
      expect(pool._idle.length).toBe(0);

      pool.release(w1);
      expect(pool._idle.length).toBe(1);

      pool.release(w2);
      expect(pool._idle.length).toBe(2);

      // Re-acquire should reuse
      const w3 = await pool.acquire();
      expect(created).toBe(2);
      expect(pool._idle.length).toBe(1);

      pool.release(w3);
    });

    it("should call ref/unref on pooled workers", async () => {
      let refCount = 0;
      let unrefCount = 0;
      const pool = new WorkerPool({
        createWorker: async () => ({
          ref: () => { refCount++; },
          unref: () => { unrefCount++; },
          terminate: async () => {},
        }),
        maxWorkers: 1,
      });

      const w1 = await pool.acquire();
      expect(refCount).toBe(1);

      pool.release(w1);
      expect(unrefCount).toBe(1);
    });

    it("should queue acquires when pool is exhausted", async () => {
      const pool = new WorkerPool({
        createWorker: async () => ({
          ref: () => {},
          unref: () => {},
          terminate: async () => {},
        }),
        maxWorkers: 1,
      });

      const w1 = await pool.acquire();
      const acquirePromise = pool.acquire();

      let resolved = false;
      acquirePromise.then(() => { resolved = true; });

      await new Promise(r => setTimeout(r, 10));
      expect(resolved).toBe(false);

      pool.release(w1);
      await new Promise(r => setTimeout(r, 10));
      expect(resolved).toBe(true);
    });

    it("should destroy worker and remove from pool", async () => {
      let terminated = false;
      const pool = new WorkerPool({
        createWorker: async () => ({
          ref: () => {},
          unref: () => {},
          terminate: async () => { terminated = true; },
        }),
        maxWorkers: 1,
      });

      const w1 = await pool.acquire();
      expect(pool._all.size).toBe(1);

      await pool.destroy(w1);
      expect(terminated).toBe(true);
      expect(pool._all.size).toBe(0);
    });

    it("should only increase maxWorkers via setMaxWorkers", () => {
      const pool = new WorkerPool({ createWorker: async () => ({}), maxWorkers: 3 });

      expect(pool.setMaxWorkers(5)).toBe(5);
      expect(pool._maxWorkers).toBe(5);

      expect(pool.setMaxWorkers(2)).toBe(5);
      expect(pool._maxWorkers).toBe(5);
    });

    it("should reject all waiters when createWorker fails", async () => {
      let shouldFail = true;
      const pool = new WorkerPool({
        createWorker: async () => {
          if (shouldFail) throw new Error("Creation failed");
          return { ref: () => {}, unref: () => {}, terminate: async () => {} };
        },
        maxWorkers: 1,
      });

      await expect(pool.acquire()).rejects.toThrow(/Creation failed/);
    });

    it("should ignore release of destroyed worker", async () => {
      const pool = new WorkerPool({
        createWorker: async () => ({
          ref: () => {},
          unref: () => {},
          terminate: async () => {},
        }),
        maxWorkers: 1,
      });

      const w1 = await pool.acquire();
      await pool.destroy(w1);

      pool.release(w1);
      expect(pool._idle.length).toBe(0);
    });

    it("should try to fulfill waiter after destroy", async () => {
      let createCount = 0;
      const pool = new WorkerPool({
        createWorker: async () => {
          createCount++;
          return {
            ref: () => {},
            unref: () => {},
            terminate: async () => {},
          };
        },
        maxWorkers: 1,
      });

      const w1 = await pool.acquire();
      const acquirePromise = pool.acquire();

      await pool.destroy(w1);
      const w2 = await acquirePromise;

      expect(createCount).toBe(2);
      expect(w2).toBeDefined();
    });
  });
});
