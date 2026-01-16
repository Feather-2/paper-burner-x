import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import {
  ToolExecutor,
  createToolExecutor,
  executeTool,
  __test,
} from "../../../js/agents/runtime/tools/tool-executor.js";

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

      assert.equal(result.success, true);
      assert.equal(result.ok, true);
      assert.equal(result.data.message, "Hello, World!");
    });

    it("should return error for unknown tool", async () => {
      const executor = new ToolExecutor({ tools: {} });

      const result = await executor.execute("unknown", {}, {});

      assert.equal(result.success, false);
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("Unknown tool"));
    });

    it("should handle tool errors", async () => {
      const executor = new ToolExecutor({
        tools: {
          fail: { handler: async () => { throw new Error("Intentional failure"); } },
        },
        maxRetries: 0,
      });

      const result = await executor.execute("fail", {}, {});

      assert.equal(result.success, false);
      assert.ok(result.error.includes("Intentional failure"));
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

      assert.equal(result.success, true);
      assert.equal(attempts, 2);
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

      assert.equal(result.success, false);
      assert.ok(result.error.includes("timed out"));
    });

    it("should support function-style tools", async () => {
      const executor = new ToolExecutor({
        tools: {
          add: async (args) => args.a + args.b,
        },
      });

      const result = await executor.execute("add", { a: 2, b: 3 }, {});

      assert.equal(result.success, true);
      assert.equal(result.data, 5);
    });

    it("should return error if tool has no handler", async () => {
      const executor = new ToolExecutor({
        tools: {
          noHandler: { description: "Tool without handler" },
        },
      });

      const result = await executor.execute("noHandler", {}, {});

      assert.equal(result.success, false);
      assert.ok(result.error.includes("no handler"));
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

      assert.equal(result.success, false);
      assert.ok(result.error.includes("timed out"));
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

      assert.equal(result.success, true);
      assert.equal(attempts, 3);
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

      assert.equal(result.success, true);
      assert.ok(emitted.some(e => e.name === "tool.validation.failed"));
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

      assert.equal(result.success, false);
      assert.ok(result.error.includes("Validation failed"));
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

      assert.equal(result.success, true);
      assert.ok(!emitted.some(e => e.name === "tool.validation.failed"));
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

      assert.equal(result.success, false);
      assert.ok(result.error.includes("Validation failed"));
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

      assert.equal(result.success, false);
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

      assert.equal(result.success, true);
      assert.equal(result.data.injected, true);
      assert.equal(result.data.original, true);
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

      assert.equal(result.success, true);
      assert.equal(result.data.intercepted, true);
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

      assert.equal(result.success, true);
      assert.equal(result.data, "executed");
      assert.ok(logged.some(l => l.msg.includes("Before hook failed")));
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

      assert.equal(result.success, true);
      assert.equal(result.data, "modified:original");
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

      assert.equal(result.success, true);
      assert.equal(result.data, "value");
      assert.ok(logged.some(l => l.msg.includes("After hook failed")));
    });

    it("should accept per-call hooks override", async () => {
      const globalAfter = mock.fn(async () => "global");
      const localAfter = mock.fn(async () => "local");

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

      assert.equal(result.data, "local");
      assert.equal(globalAfter.mock.calls.length, 0);
      assert.equal(localAfter.mock.calls.length, 1);
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

      assert.equal(result.success, false);
      assert.ok(result.error.includes("Policy denied"));
      assert.ok(emitted.some(e => e.name === "tool.denied"));
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

      assert.equal(result.success, true);
      assert.equal(result.data, "executed");
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

      assert.equal(result.success, true);
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

      assert.equal(result.success, true);
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

      assert.equal(result.success, false);
      assert.ok(result.error.includes("Policy error"));
      assert.ok(emitted.some(e => e.name === "tool.denied" && e.payload.reason === "policy_error"));
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

      assert.equal(result.success, true);
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
      assert.ok(completed);
      assert.equal(completed.payload.tool, "ping");
      assert.ok(typeof completed.payload.duration === "number");
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
      assert.ok(failed);
      assert.equal(failed.payload.tool, "fail");
      assert.ok(failed.payload.error.includes("Always fails"));
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

      assert.ok(logged.some(l => l.level === "debug" && l.msg.includes("completed")));
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

      assert.ok(logged.some(l => l.level === "warn" && l.msg.includes("failed")));
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

      assert.equal(results.length, 2);
      assert.equal(results[0].data, 10);
      assert.equal(results[1].data, 15);
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

      assert.equal(results[0].success, true);
      assert.equal(results[1].success, false);
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

      assert.equal(results[0].data, "pong");
    });
  });

  describe("register", () => {
    it("should register tools dynamically", async () => {
      const executor = new ToolExecutor();

      executor.register("echo", { handler: async (args) => args });

      const result = await executor.execute("echo", { msg: "test" }, {});
      assert.equal(result.success, true);
      assert.equal(result.data.msg, "test");
    });

    it("should register multiple tools at once", async () => {
      const executor = new ToolExecutor();

      executor.registerAll({
        a: { handler: async () => "a" },
        b: { handler: async () => "b" },
      });

      const resultA = await executor.execute("a", {}, {});
      const resultB = await executor.execute("b", {}, {});

      assert.equal(resultA.data, "a");
      assert.equal(resultB.data, "b");
    });
  });

  describe("tool lookup", () => {
    it("should report hasTool and getTool", () => {
      const executor = new ToolExecutor({
        tools: {
          ping: { handler: async () => "pong" },
        },
      });

      assert.equal(executor.hasTool("ping"), true);
      assert.equal(executor.hasTool("missing"), false);
      assert.equal(typeof executor.getTool("ping").handler, "function");
      assert.equal(executor.getTool("missing"), undefined);
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

      assert.equal(defs.length, 1);
      assert.equal(defs[0].name, "search");
      assert.equal(defs[0].description, "Search documents");
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

      assert.deepEqual(defs[0].parameters, { q: { type: "string" } });
    });
  });

  describe("createToolExecutor", () => {
    it("should create executor with factory function", async () => {
      const executor = createToolExecutor({
        tools: { test: { handler: async () => "ok" } },
      });

      const result = await executor.execute("test", {}, {});
      assert.equal(result.data, "ok");
    });
  });

  describe("executeTool (compat)", () => {
    it("should execute tool with simple function", async () => {
      const tools = {
        ping: { handler: async () => "pong" },
      };

      const result = await executeTool(tools, "ping", {}, {});
      assert.equal(result.data, "pong");
    });
  });

  describe("result normalization", () => {
    it("should normalize { success, data } format", async () => {
      const executor = new ToolExecutor({
        tools: { t: { handler: async () => ({ success: true, data: "value" }) } },
      });

      const result = await executor.execute("t", {}, {});
      assert.equal(result.success, true);
      assert.equal(result.data, "value");
    });

    it("should normalize { ok, result } format", async () => {
      const executor = new ToolExecutor({
        tools: { t: { handler: async () => ({ ok: true, result: "value" }) } },
      });

      const result = await executor.execute("t", {}, {});
      assert.equal(result.success, true);
    });

    it("should normalize { error } format", async () => {
      const executor = new ToolExecutor({
        tools: { t: { handler: async () => ({ error: "failed" }) } },
      });

      const result = await executor.execute("t", {}, {});
      assert.equal(result.success, false);
      assert.equal(result.error, "failed");
    });

    it("should handle null return value", async () => {
      const executor = new ToolExecutor({
        tools: { t: { handler: async () => null } },
      });

      const result = await executor.execute("t", {}, {});
      assert.equal(result.success, true);
      assert.equal(result.data, null);
    });

    it("should handle undefined return value", async () => {
      const executor = new ToolExecutor({
        tools: { t: { handler: async () => undefined } },
      });

      const result = await executor.execute("t", {}, {});
      assert.equal(result.success, true);
      assert.equal(result.data, null);
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

      assert.equal(numResult.data, 42);
      assert.equal(strResult.data, "hello");
      assert.equal(boolResult.data, true);
    });

    it("should include raw property for object results", async () => {
      const rawValue = { ok: true, extra: "metadata" };
      const executor = new ToolExecutor({
        tools: { t: { handler: async () => rawValue } },
      });

      const result = await executor.execute("t", {}, {});
      assert.deepEqual(result.raw, rawValue);
    });
  });

  describe("constructor options", () => {
    it("should use default timeoutMs of 30000", () => {
      const executor = new ToolExecutor({});
      assert.equal(executor.defaultTimeoutMs, 30000);
    });

    it("should use default maxRetries of 1", () => {
      const executor = new ToolExecutor({});
      assert.equal(executor.maxRetries, 1);
    });

    it("should respect custom timeoutMs", () => {
      const executor = new ToolExecutor({ timeoutMs: 5000 });
      assert.equal(executor.defaultTimeoutMs, 5000);
    });

    it("should respect custom maxRetries", () => {
      const executor = new ToolExecutor({ maxRetries: 3 });
      assert.equal(executor.maxRetries, 3);
    });

    it("should default validateSchema to true", () => {
      const executor = new ToolExecutor({});
      assert.equal(executor.validateSchema, true);
    });

    it("should default strictValidation to false", () => {
      const executor = new ToolExecutor({});
      assert.equal(executor.strictValidation, false);
    });

    it("should normalize isolation mode", () => {
      const e1 = new ToolExecutor({ isolation: true });
      const e2 = new ToolExecutor({ isolation: "worker" });
      const e3 = new ToolExecutor({ isolation: "WORKER" });
      const e4 = new ToolExecutor({ isolation: "none" });
      const e5 = new ToolExecutor({ isolation: "invalid" });

      assert.equal(e1.defaultIsolation, "worker");
      assert.equal(e2.defaultIsolation, "worker");
      assert.equal(e3.defaultIsolation, "worker");
      assert.equal(e4.defaultIsolation, "none");
      assert.equal(e5.defaultIsolation, "none");
    });

    it("should initialize hooks arrays", () => {
      const executor = new ToolExecutor({});
      assert.ok(Array.isArray(executor.hooks.before));
      assert.ok(Array.isArray(executor.hooks.after));
      assert.ok(executor.hooks.before.length > 0); // createPreToolUseHook added
    });

    it("should copy provided hooks arrays", () => {
      const before = [async () => null];
      const after = [async () => null];
      const executor = new ToolExecutor({ hooks: { before, after } });

      assert.notEqual(executor.hooks.before, before);
      assert.notEqual(executor.hooks.after, after);
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

      assert.equal(result.success, true);
      assert.equal(executor.workerCalls.length, 1);
      assert.equal(executor.workerCalls[0].moduleUrl, busyLoopUrl);
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

      assert.equal(result.success, true);
      assert.equal(executor.workerCalls.length, 1);
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

      assert.equal(result.success, true);
      assert.equal(result.data, "direct");
      assert.equal(executor.workerCalls.length, 0);
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

      assert.equal(result.data.moduleUrl, "tool-module");
    });

    it("should block bare moduleUrl when policy is sameOrigin", async () => {
      const executor = new WorkerSpyExecutor();

      await assert.rejects(
        () => executor._executeWithTimeout(
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

      assert.equal(result.data.moduleUrl, busyLoopUrl);
    });

    it("should enforce allowed origins in browser-like runtime", async () => {
      const executor = new WorkerSpyExecutor();

      await withBrowserLikeRuntime(async () => {
        await assert.rejects(
          () => executor._executeWithTimeout(
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

        assert.equal(result.data.moduleUrl, "https://allowed.example.com/worker.mjs");
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

      assert.deepEqual(snapshot, { state: { nested: { value: 1 } }, runId: "run-1" });

      state.nested.value = 2;
      assert.equal(snapshot.state.nested.value, 1);
    });

    it("should return empty object when snapshot is not cloneable", () => {
      const executor = new ToolExecutor();
      const snapshot = executor._createWorkerContextSnapshot({
        state: { fn: () => "nope" },
        runId: "run-2",
      });

      assert.deepEqual(snapshot, {});
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

      assert.equal(result, "node");
      assert.equal(executor.nodeCalls, 1);
      assert.equal(executor.webCalls, 0);
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

      assert.equal(result.ok, true);
      assert.equal(result.durationMs, 5);
    });

    it("should surface worker errors from missing handlers", async () => {
      const executor = new ToolExecutor();

      await assert.rejects(
        () => executor._executeInNodeWorker(
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

      assert.equal(result.ok, true);
      assert.deepEqual(result.echo.context, { state: { ok: true }, runId: "run-web" });
    });

    it("should surface web worker error messages", async () => {
      MockWorker.behavior = () => ({
        type: "error",
        error: { message: "Boom", name: "BoomError" },
      });

      const executor = new ToolExecutor();
      await assert.rejects(
        () => executor._executeInWebWorker(
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
      await assert.rejects(
        () => executor._executeInWebWorker(
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

      await assert.rejects(
        () => executor._executeInWebWorker(
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
      assert.throws(() => new WorkerPool({}), TypeError);
      assert.throws(() => new WorkerPool({ createWorker: "not a function" }), TypeError);
    });

    it("should use default maxWorkers of 2", () => {
      const pool = new WorkerPool({ createWorker: async () => ({}) });
      assert.equal(pool._maxWorkers, 2);
    });

    it("should respect custom maxWorkers", () => {
      const pool = new WorkerPool({ createWorker: async () => ({}), maxWorkers: 5 });
      assert.equal(pool._maxWorkers, 5);
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

      assert.equal(created, 2);
      assert.equal(pool._idle.length, 0);

      pool.release(w1);
      assert.equal(pool._idle.length, 1);

      pool.release(w2);
      assert.equal(pool._idle.length, 2);

      // Re-acquire should reuse
      const w3 = await pool.acquire();
      assert.equal(created, 2);
      assert.equal(pool._idle.length, 1);

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
      assert.equal(refCount, 1);

      pool.release(w1);
      assert.equal(unrefCount, 1);
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
      assert.equal(resolved, false);

      pool.release(w1);
      await new Promise(r => setTimeout(r, 10));
      assert.equal(resolved, true);
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
      assert.equal(pool._all.size, 1);

      await pool.destroy(w1);
      assert.equal(terminated, true);
      assert.equal(pool._all.size, 0);
    });

    it("should only increase maxWorkers via setMaxWorkers", () => {
      const pool = new WorkerPool({ createWorker: async () => ({}), maxWorkers: 3 });

      assert.equal(pool.setMaxWorkers(5), 5);
      assert.equal(pool._maxWorkers, 5);

      assert.equal(pool.setMaxWorkers(2), 5);
      assert.equal(pool._maxWorkers, 5);
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

      await assert.rejects(pool.acquire(), /Creation failed/);
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
      assert.equal(pool._idle.length, 0);
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

      assert.equal(createCount, 2);
      assert.ok(w2);
    });
  });
});
