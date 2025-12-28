import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ToolExecutor, createToolExecutor, executeTool } from "../../../js/agents/runtime/tools/tool-executor.js";

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
      assert.equal(result.data.message, "Hello, World!");
    });

    it("should return error for unknown tool", async () => {
      const executor = new ToolExecutor({ tools: {} });

      const result = await executor.execute("unknown", {}, {});

      assert.equal(result.success, false);
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
          slow: { handler: () => new Promise(resolve => setTimeout(resolve, 5000)) },
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
  });
});
