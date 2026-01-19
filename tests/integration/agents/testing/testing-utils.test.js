
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  MockModelClient,
  MockMcpProvider,
  MockEventBus,
  MockServer,
  ScenarioRunner,
  createMockTestEnv,
} from '../../../../js/agents/testing/mock-suite.js';

// ============================================================================
// MockModelClient
// ============================================================================

describe("MockModelClient", () => {
  let client;

  beforeEach(() => {
    client = new MockModelClient();
  });

  describe("constructor", () => {
    it("initializes with default values", () => {
      expect(client.responses).toEqual({});
      expect(client.sequence).toEqual([]);
      expect(client.handler).toBe(null);
      expect(client.rules).toEqual([]);
      expect(client.delay).toBe(0);
      expect(client.callHistory).toEqual([]);
    });

    it("accepts options", () => {
      const opts = {
        responses: { hello: "world" },
        sequence: ["a", "b"],
        handler: () => "x",
        rules: [{ predicate: () => true, response: "y" }],
        delay: 100,
      };
      const c = new MockModelClient(opts);
      expect(c.responses).toEqual({ hello: "world" });
      expect(c.sequence).toEqual(["a", "b"]);
      expect(typeof c.handler).toBe("function");
      expect(c.rules.length).toBe(1);
      expect(c.delay).toBe(100);
    });
  });

  describe("chat()", () => {
    it("returns default response when no match", async () => {
      const result = await client.chat({ messages: [{ role: "user", content: "test" }] });
      expect(result.content).toBe("Mock response");
      expect(result.model).toBe("mock");
      expect(result.finish_reason).toBe("stop");
    });

    it("matches keyword in responses", async () => {
      client.responses = { greeting: "Hello there!" };
      const result = await client.chat({ messages: [{ role: "user", content: "send greeting" }] });
      expect(result.content).toBe("Hello there!");
    });

    it("uses custom default response", async () => {
      client.responses = { default: "custom default" };
      const result = await client.chat({ messages: [{ role: "user", content: "xyz" }] });
      expect(result.content).toBe("custom default");
    });

    it("uses sequence in order", async () => {
      client.sequence = ["first", "second", "third"];
      const r1 = await client.chat({ messages: [] });
      const r2 = await client.chat({ messages: [] });
      const r3 = await client.chat({ messages: [] });
      const r4 = await client.chat({ messages: [] });
      expect(r1.content).toBe("first");
      expect(r2.content).toBe("second");
      expect(r3.content).toBe("third");
      expect(r4.content).toBe("first"); // wraps around
    });

    it("uses handler function", async () => {
      client.handler = (messages) => `Handled: ${messages.length} messages`;
      const result = await client.chat({ messages: [{}, {}, {}] });
      expect(result.content).toBe("Handled: 3 messages");
    });

    it("tracks call history", async () => {
      await client.chat({ messages: [{ role: "user", content: "q1" }], usage: "test" });
      await client.chat({ messages: [{ role: "user", content: "q2" }] });
      expect(client.callHistory.length).toBe(2);
      expect(client.callCount).toBe(2);
      expect(client.callHistory[0].usage).toBe("test");
    });

    it("respects delay", async () => {
      client.delay = 50;
      const start = Date.now();
      await client.chat({ messages: [] });
      const elapsed = Date.now() - start;
      expect(elapsed, `Expected delay of ~50ms, got ${elapsed}ms`).toBeGreaterThanOrEqual(40);
    });

    it("normalizes object response", async () => {
      client.handler = () => ({
        content: "obj",
        model: "custom-model",
        usage: { total_tokens: 50 },
        finishReason: "length",
      });
      const result = await client.chat({ messages: [] });
      expect(result.content).toBe("obj");
      expect(result.model).toBe("custom-model");
      expect(result.usage.total_tokens).toBe(50);
      expect(result.finish_reason).toBe("length");
    });
  });

  describe("when()", () => {
    it("registers predicate rule", async () => {
      client.when(
        (msgs) => msgs.some((m) => m.content?.includes("special")),
        "special response"
      );
      const r1 = await client.chat({ messages: [{ role: "user", content: "special request" }] });
      const r2 = await client.chat({ messages: [{ role: "user", content: "normal request" }] });
      expect(r1.content).toBe("special response");
      expect(r2.content).toBe("Mock response");
    });

    it("throws if predicate is not a function", () => {
      expect(() => client.when("not a function", "response")).toThrow(/predicate must be a function/);
    });

    it("supports function response", async () => {
      client.when(
        () => true,
        (msgs) => `Dynamic: ${msgs.length}`
      );
      const result = await client.chat({ messages: [{}, {}] });
      expect(result.content).toBe("Dynamic: 2");
    });

    it("rules take precedence over handler", async () => {
      client.handler = () => "from handler";
      client.when(() => true, "from rule");
      const result = await client.chat({ messages: [] });
      expect(result.content).toBe("from rule");
    });

    it("ignores rule errors gracefully", async () => {
      client.when(() => { throw new Error("boom"); }, "should not reach");
      client.responses.default = "fallback";
      const result = await client.chat({ messages: [] });
      expect(result.content).toBe("fallback");
    });
  });

  describe("chatStream()", () => {
    it("yields chunks", async () => {
      client.handler = () => "Hello World";
      const chunks = [];
      for await (const chunk of client.chatStream({ messages: [], chunkSize: 5 })) {
        chunks.push(chunk.delta);
      }
      expect(chunks).toEqual(["Hello", " Worl", "d"]);
    });

    it("uses default chunk size", async () => {
      client.handler = () => "A".repeat(50);
      const chunks = [];
      for await (const chunk of client.chatStream({ messages: [] })) {
        chunks.push(chunk.delta);
      }
      expect(chunks.length).toBe(3); // 50/20 = 2.5 -> 3 chunks
    });
  });

  describe("ask()", () => {
    it("returns content string", async () => {
      client.handler = () => "answer";
      const result = await client.ask("question");
      expect(result).toBe("answer");
    });

    it("includes system prompt when provided", async () => {
      client.handler = (msgs) => `Got ${msgs.length} messages`;
      const result = await client.ask("user msg", "system msg");
      expect(result).toBe("Got 2 messages");
    });
  });

  describe("reset()", () => {
    it("clears call history and sequence index", async () => {
      client.sequence = ["a", "b"];
      await client.chat({ messages: [] });
      expect(client.callCount).toBe(1);
      client.reset();
      expect(client.callCount).toBe(0);
      const result = await client.chat({ messages: [] });
      expect(result.content).toBe("a"); // sequence reset
    });
  });
});

// ============================================================================
// MockMcpProvider
// ============================================================================

describe("MockMcpProvider", () => {
  let mcp;

  beforeEach(() => {
    mcp = new MockMcpProvider();
  });

  describe("constructor", () => {
    it("initializes with empty state", () => {
      expect(mcp.tools).toEqual({});
      expect(mcp.callHistory).toEqual([]);
    });

    it("accepts initial tools", () => {
      const provider = new MockMcpProvider({ tools: { foo: () => "bar" } });
      expect(typeof provider.tools.foo).toBe("function");
    });
  });

  describe("registerTool()", () => {
    it("adds tool handler", () => {
      mcp.registerTool("myTool", () => "result");
      expect(typeof mcp.tools.myTool).toBe("function");
    });
  });

  describe("search()", () => {
    it("returns default mock results", async () => {
      const result = await mcp.search("test query");
      expect(result.success).toBe(true);
      expect(result.results.length).toBe(1);
      expect(result.results[0].title).toContain("test query");
    });

    it("uses custom search handler", async () => {
      mcp.tools.search = () => ({ success: true, results: [{ custom: true }] });
      const result = await mcp.search("q");
      expect(result.results[0].custom).toBe(true);
    });

    it("records call history", async () => {
      await mcp.search("q1", { limit: 5 });
      expect(mcp.callHistory.length).toBe(1);
      expect(mcp.callHistory[0].method).toBe("search");
      expect(mcp.callHistory[0].query).toBe("q1");
      expect(mcp.callHistory[0].options).toEqual({ limit: 5 });
    });
  });

  describe("fetch()", () => {
    it("returns default mock content", async () => {
      const result = await mcp.fetch("https://example.com");
      expect(result.success).toBe(true);
      expect(result.content).toContain("example.com");
    });

    it("uses custom fetch handler", async () => {
      mcp.tools.fetch = (url) => ({ success: true, content: `Custom: ${url}` });
      const result = await mcp.fetch("http://test.com");
      expect(result.content).toBe("Custom: http://test.com");
    });

    it("records call history", async () => {
      await mcp.fetch("https://test.com", { timeout: 1000 });
      expect(mcp.callHistory[0].method).toBe("fetch");
      expect(mcp.callHistory[0].url).toBe("https://test.com");
    });
  });

  describe("callTool()", () => {
    it("returns default result for unknown tool", async () => {
      const result = await mcp.callTool("unknownTool", { arg: 1 });
      expect(result.success).toBe(true);
      expect(result.data).toContain("unknownTool");
    });

    it("invokes registered tool", async () => {
      mcp.registerTool("add", ({ a, b }) => ({ sum: a + b }));
      const result = await mcp.callTool("add", { a: 2, b: 3 });
      expect(result.sum).toBe(5);
    });

    it("records call history", async () => {
      await mcp.callTool("tool1", { x: 1 });
      expect(mcp.callHistory[0].method).toBe("callTool");
      expect(mcp.callHistory[0].name).toBe("tool1");
    });
  });

  describe("reset()", () => {
    it("clears call history", async () => {
      await mcp.search("q");
      mcp.reset();
      expect(mcp.callHistory.length).toBe(0);
    });
  });
});

// ============================================================================
// MockEventBus
// ============================================================================

describe("MockEventBus", () => {
  let bus;

  beforeEach(() => {
    bus = new MockEventBus();
  });

  describe("emit() and on()", () => {
    it("records emitted events", () => {
      bus.emit("test:event", { data: 1 });
      expect(bus.events.length).toBe(1);
      expect(bus.events[0].name).toBe("test:event");
      expect(bus.events[0].payload).toEqual({ data: 1 });
    });

    it("calls registered handlers", () => {
      const received = [];
      bus.on("my:event", (payload) => received.push(payload));
      bus.emit("my:event", "first");
      bus.emit("my:event", "second");
      expect(received).toEqual(["first", "second"]);
    });

    it("returns unsubscribe function", () => {
      const received = [];
      const unsub = bus.on("event", (p) => received.push(p));
      bus.emit("event", 1);
      unsub();
      bus.emit("event", 2);
      expect(received).toEqual([1]);
    });
  });

  describe("off()", () => {
    it("removes specific handler", () => {
      const received = [];
      const handler = (p) => received.push(p);
      bus.on("e", handler);
      bus.emit("e", 1);
      bus.off("e", handler);
      bus.emit("e", 2);
      expect(received).toEqual([1]);
    });
  });

  describe("assertEmitted()", () => {
    it("passes when event was emitted", () => {
      bus.emit("success", {});
      bus.assertEmitted("success");
    });

    it("throws when event was not emitted", () => {
      expect(() => bus.assertEmitted("missing")).toThrow(/Expected event "missing" to be emitted/);
    });

    it("checks count", () => {
      bus.emit("e", {});
      bus.emit("e", {});
      bus.assertEmitted("e", 2);
      expect(() => bus.assertEmitted("e", 3)).toThrow(/at least 3 time/);
    });

    it("matches payload object", () => {
      bus.emit("status", { code: 200, msg: "ok" });
      bus.assertEmitted("status", { code: 200 });
    });

    it("throws on payload mismatch", () => {
      bus.emit("status", { code: 500 });
      expect(() => bus.assertEmitted("status", { code: 200 })).toThrow(/payload to match/);
    });

    it("matches with regex", () => {
      bus.emit("log", { message: "Error: something failed" });
      bus.assertEmitted("log", { message: /Error:/ });
    });

    it("matches with function predicate", () => {
      bus.emit("num", { count: 10 });
      bus.assertEmitted("num", { count: (v) => v > 5 });
    });

    it("matches arrays", () => {
      bus.emit("arr", { items: [1, 2, 3] });
      bus.assertEmitted("arr", { items: [1, 2] }); // partial match
    });

    it("returns matched events", () => {
      bus.emit("x", { a: 1 });
      bus.emit("x", { a: 2 });
      const matches = bus.assertEmitted("x", 2);
      expect(matches.length).toBe(2);
    });
  });

  describe("assertEmittedWith()", () => {
    it("passes when predicate matches", () => {
      bus.emit("data", { value: 42 });
      bus.assertEmittedWith("data", (p) => p.value === 42);
    });

    it("throws when event not emitted", () => {
      expect(() => bus.assertEmittedWith("missing", () => true),
        /never emitted/
      );
    });

    it("throws when no payload satisfies predicate", () => {
      bus.emit("data", { value: 1 });
      expect(() => bus.assertEmittedWith("data", (p) => p.value > 100, "value > 100")).toThrow(
        /satisfy predicate.*value > 100/
      );
    });

    it("throws if predicate is not a function", () => {
      expect(() => bus.assertEmittedWith("e", "not a function")).toThrow(/predicate must be a function/);
    });

    it("handles predicate errors gracefully", () => {
      bus.emit("e", { x: 1 });
      expect(() => bus.assertEmittedWith("e", () => { throw new Error("boom"); }),
        /satisfy predicate/
      );
    });
  });

  describe("assertEmittedInOrder()", () => {
    it("passes when events are in order", () => {
      bus.emit("a", {});
      bus.emit("b", {});
      bus.emit("c", {});
      bus.assertEmittedInOrder(["a", "b", "c"]);
    });

    it("passes with interleaved events", () => {
      bus.emit("a", {});
      bus.emit("x", {});
      bus.emit("b", {});
      bus.assertEmittedInOrder(["a", "b"]);
    });

    it("throws when order is wrong", () => {
      bus.emit("b", {});
      bus.emit("a", {});
      expect(() => bus.assertEmittedInOrder(["a", "b"])).toThrow(/Expected event "b" to be emitted/);
    });

    it("throws on empty array", () => {
      expect(() => bus.assertEmittedInOrder([])).toThrow(/non-empty array/);
    });
  });

  describe("assertNotEmitted()", () => {
    it("passes when event was not emitted", () => {
      bus.assertNotEmitted("never");
    });

    it("throws when event was emitted", () => {
      bus.emit("oops", {});
      expect(() => bus.assertNotEmitted("oops")).toThrow(/not to be emitted/);
    });
  });

  describe("getPayloads()", () => {
    it("returns all payloads for event", () => {
      bus.emit("e", { n: 1 });
      bus.emit("other", { n: 99 });
      bus.emit("e", { n: 2 });
      const payloads = bus.getPayloads("e");
      expect(payloads).toEqual([{ n: 1 }, { n: 2 }]);
    });

    it("returns empty array for unknown event", () => {
      expect(bus.getPayloads("unknown")).toEqual([]);
    });
  });

  describe("reset()", () => {
    it("clears all events", () => {
      bus.emit("a", {});
      bus.reset();
      expect(bus.events.length).toBe(0);
    });
  });
});

// ============================================================================
// MockServer
// ============================================================================

describe("MockServer", () => {
  let server;

  beforeEach(() => {
    server = new MockServer();
  });

  describe("setTextResponse()", () => {
    it("responds with text", async () => {
      server.setTextResponse("/hello", "Hello World");
      const resp = await server.fetch("/hello");
      expect(resp.status).toBe(200);
      expect(await resp.text()).toBe("Hello World");
    });

    it("supports custom status", async () => {
      server.setTextResponse("/error", "Not Found", { status: 404 });
      const resp = await server.fetch("/error");
      expect(resp.status).toBe(404);
      expect(resp.ok).toBe(false);
    });

    it("supports method matching", async () => {
      server.setTextResponse("/data", "posted", { method: "POST" });
      const getResp = await server.fetch("/data", { method: "GET" });
      const postResp = await server.fetch("/data", { method: "POST" });
      expect(getResp.status).toBe(404);
      expect(await postResp.text()).toBe("posted");
    });
  });

  describe("setJsonResponse()", () => {
    it("responds with JSON", async () => {
      server.setJsonResponse("/api/data", { id: 1, name: "test" });
      const resp = await server.fetch("/api/data");
      const data = await resp.json();
      expect(data).toEqual({ id: 1, name: "test" });
      expect(resp.headers.get("content-type")).toBe("application/json");
    });
  });

  describe("setStreamResponse()", () => {
    it("responds with stream chunks", async () => {
      server.setStreamResponse("/stream", ["chunk1", "chunk2", "chunk3"]);
      const resp = await server.fetch("/stream");
      const chunks = [];
      for await (const chunk of resp.stream()) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(["chunk1", "chunk2", "chunk3"]);
    });
  });

  describe("setHandler()", () => {
    it("uses custom handler function", async () => {
      server.setHandler("/custom", (req) => ({
        status: 200,
        body: `Path: ${req.path}`,
      }));
      const resp = await server.fetch("/custom");
      expect(await resp.text()).toBe("Path: /custom");
    });
  });

  describe("path matching", () => {
    it("matches regex paths", async () => {
      server.setTextResponse(/\/api\/.*/, "API matched");
      const resp = await server.fetch("/api/users/123");
      expect(await resp.text()).toBe("API matched");
    });

    it("matches function paths", async () => {
      server.setTextResponse((path) => path.startsWith("/v1"), "V1 API");
      const resp = await server.fetch("/v1/endpoint");
      expect(await resp.text()).toBe("V1 API");
    });
  });

  describe("fetch()", () => {
    it("returns 404 for unmatched routes", async () => {
      const resp = await server.fetch("/unknown");
      expect(resp.status).toBe(404);
      expect(await resp.text()).toBe("Not Found");
    });

    it("records call history", async () => {
      server.setTextResponse("/test", "ok");
      await server.fetch("/test", { method: "POST", body: '{"x":1}' });
      expect(server.callHistory.length).toBe(1);
      expect(server.callHistory[0].method).toBe("POST");
      expect(server.callHistory[0].path).toBe("/test");
    });

    it("handles URL with query string", async () => {
      server.setTextResponse("/search?q=test", "found");
      const resp = await server.fetch("/search?q=test");
      expect(await resp.text()).toBe("found");
    });
  });

  describe("MockResponse", () => {
    it("ok is true for 2xx status", async () => {
      server.setTextResponse("/a", "ok", { status: 200 });
      server.setTextResponse("/b", "created", { status: 201 });
      server.setTextResponse("/c", "error", { status: 400 });
      expect((await server.fetch("/a")).ok).toBe(true);
      expect((await server.fetch("/b")).ok).toBe(true);
      expect((await server.fetch("/c")).ok).toBe(false);
    });

    it("arrayBuffer() returns ArrayBuffer", async () => {
      server.setTextResponse("/bin", "hello");
      const resp = await server.fetch("/bin");
      const buf = await resp.arrayBuffer();
      expect(buf).toBeInstanceOf(ArrayBuffer);
      const text = new TextDecoder().decode(buf);
      expect(text).toBe("hello");
    });

    it("respects delay option", async () => {
      server.setTextResponse("/slow", "done", { delay: 50 });
      const start = Date.now();
      const resp = await server.fetch("/slow");
      await resp.text();
      const elapsed = Date.now() - start;
      expect(elapsed, `Expected delay ~50ms, got ${elapsed}ms`).toBeGreaterThanOrEqual(40);
    });
  });

  describe("reset()", () => {
    it("clears routes and history", async () => {
      server.setTextResponse("/a", "ok");
      await server.fetch("/a");
      server.reset();
      expect(server.routes.length).toBe(0);
      expect(server.callHistory.length).toBe(0);
    });
  });
});

// ============================================================================
// ScenarioRunner
// ============================================================================

describe("ScenarioRunner", () => {
  let runner;

  beforeEach(() => {
    runner = new ScenarioRunner();
  });

  describe("constructor", () => {
    it("creates default mocks", () => {
      expect(runner.modelClient).toBeInstanceOf(MockModelClient);
      expect(runner.mcpProvider).toBeInstanceOf(MockMcpProvider);
      expect(runner.eventBus).toBeInstanceOf(MockEventBus);
    });

    it("accepts custom mocks", () => {
      const customModel = new MockModelClient({ delay: 100 });
      const r = new ScenarioRunner({ modelClient: customModel });
      expect(r.modelClient.delay).toBe(100);
    });
  });

  describe("run()", () => {
    it("runs scenario with input steps", async () => {
      runner.modelClient.responses.default = "expected output";
      const result = await runner.run({
        name: "test scenario",
        steps: [{ input: "test", expectedOutput: "expected" }],
      });
      expect(result.name).toBe("test scenario");
      expect(result.passed).toBe(true);
      expect(result.steps.length).toBe(1);
    });

    it("fails when output does not match", async () => {
      runner.modelClient.responses.default = "wrong output";
      const result = await runner.run({
        name: "fail scenario",
        steps: [{ input: "test", expectedOutput: "expected" }],
      });
      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain("Expected output");
    });

    it("runs scenario with tool call steps", async () => {
      runner.mcpProvider.registerTool("calc", ({ a, b }) => ({ sum: a + b }));
      const result = await runner.run({
        name: "tool scenario",
        steps: [{ toolCall: "calc", args: { a: 2, b: 3 }, expectedResult: { sum: 5 } }],
      });
      expect(result.passed).toBe(true);
    });

    it("fails when tool result does not match", async () => {
      runner.mcpProvider.registerTool("calc", () => ({ sum: 99 }));
      const result = await runner.run({
        name: "tool fail",
        steps: [{ toolCall: "calc", args: {}, expectedResult: { sum: 5 } }],
      });
      expect(result.passed).toBe(false);
    });

    it("runs scenario with event assertions", async () => {
      const result = await runner.run({
        name: "event scenario",
        steps: [{ input: "trigger" }],
        setup: ({ eventBus }) => {
          eventBus.emit("test:event", {});
        },
      });
      expect(result.passed).toBe(true);
    });

    it("executes setup and teardown", async () => {
      let setupCalled = false;
      let teardownCalled = false;
      await runner.run({
        name: "lifecycle",
        steps: [],
        setup: () => { setupCalled = true; },
        teardown: () => { teardownCalled = true; },
      });
      expect(setupCalled).toBe(true);
      expect(teardownCalled).toBe(true);
    });

    it("calls teardown even on failure", async () => {
      let teardownCalled = false;
      runner.modelClient.responses.default = "wrong";
      await runner.run({
        name: "fail with teardown",
        steps: [{ input: "x", expectedOutput: "expected" }],
        teardown: () => { teardownCalled = true; },
      });
      expect(teardownCalled).toBe(true);
    });

    it("handles teardown errors", async () => {
      const result = await runner.run({
        name: "teardown error",
        steps: [],
        teardown: () => { throw new Error("teardown boom"); },
      });
      expect(result.passed).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining("Teardown failed")]));
    });

    it("supports regex in expectedResult", async () => {
      runner.mcpProvider.registerTool("greet", () => ({ msg: "Hello World" }));
      const result = await runner.run({
        name: "regex match",
        steps: [{ toolCall: "greet", args: {}, expectedResult: { msg: /Hello/ } }],
      });
      expect(result.passed).toBe(true);
    });

    it("supports function predicate in expectedResult", async () => {
      runner.mcpProvider.registerTool("num", () => ({ value: 42 }));
      const result = await runner.run({
        name: "predicate match",
        steps: [{ toolCall: "num", args: {}, expectedResult: { value: (v) => v > 40 } }],
      });
      expect(result.passed).toBe(true);
    });
  });

  describe("runAll()", () => {
    it("runs multiple scenarios", async () => {
      runner.modelClient.responses.default = "ok";
      const results = await runner.runAll([
        { name: "s1", steps: [{ input: "a", expectedOutput: "ok" }] },
        { name: "s2", steps: [{ input: "b", expectedOutput: "ok" }] },
      ]);
      expect(results.total).toBe(2);
      expect(results.passed).toBe(2);
      expect(results.failed).toBe(0);
    });

    it("resets between scenarios", async () => {
      runner.modelClient.sequence = ["first", "second"];
      const results = await runner.runAll([
        { name: "s1", steps: [{ input: "x", expectedOutput: "first" }] },
        { name: "s2", steps: [{ input: "y", expectedOutput: "first" }] }, // reset means first again
      ]);
      expect(results.passed).toBe(2);
    });
  });

  describe("reset()", () => {
    it("resets all mocks", async () => {
      await runner.modelClient.chat({ messages: [] });
      runner.eventBus.emit("e", {});
      await runner.mcpProvider.search("q");
      runner.reset();
      expect(runner.modelClient.callCount).toBe(0);
      expect(runner.eventBus.events.length).toBe(0);
      expect(runner.mcpProvider.callHistory.length).toBe(0);
    });
  });
});

// ============================================================================
// createMockTestEnv
// ============================================================================

describe("createMockTestEnv()", () => {
  it("creates all mock components", () => {
    const env = createMockTestEnv();
    expect(env.modelClient).toBeInstanceOf(MockModelClient);
    expect(env.mcpProvider).toBeInstanceOf(MockMcpProvider);
    expect(env.eventBus).toBeInstanceOf(MockEventBus);
    expect(env.runner).toBeInstanceOf(ScenarioRunner);
  });

  it("accepts model options", () => {
    const env = createMockTestEnv({ model: { delay: 100 } });
    expect(env.modelClient.delay).toBe(100);
  });

  it("accepts mcp options", () => {
    const env = createMockTestEnv({ mcp: { tools: { foo: () => "bar" } } });
    expect(typeof env.mcpProvider.tools.foo).toBe("function");
  });

  describe("createStageApi()", () => {
    it("creates stageApi compatible object", () => {
      const env = createMockTestEnv();
      const stageApi = env.createStageApi();
      expect(stageApi.signal).toBeInstanceOf(AbortSignal);
      expect(typeof stageApi.emit).toBe("function");
      expect(stageApi.eventBus).toBe(env.eventBus);
      expect(typeof stageApi.modelRouter.call).toBe("function");
      expect(typeof stageApi.aiApiService.chat).toBe("function");
    });

    it("emit() forwards to eventBus", () => {
      const env = createMockTestEnv();
      const stageApi = env.createStageApi();
      stageApi.emit("test:event", { data: 1 });
      env.eventBus.assertEmitted("test:event", { data: 1 });
    });

    it("modelRouter.call() uses modelClient", async () => {
      const env = createMockTestEnv();
      env.modelClient.responses.default = "router response";
      const stageApi = env.createStageApi();
      const result = await stageApi.modelRouter.call([{ role: "user", content: "hi" }], {});
      expect(result.content).toBe("router response");
    });

    it("aiApiService.chat() uses modelClient", async () => {
      const env = createMockTestEnv();
      env.modelClient.responses.default = "api response";
      const stageApi = env.createStageApi();
      const result = await stageApi.aiApiService.chat({ messages: [] });
      expect(result.content).toBe("api response");
    });

    it("accepts overrides", () => {
      const env = createMockTestEnv();
      const customSignal = new AbortController().signal;
      const stageApi = env.createStageApi({ signal: customSignal, custom: "value" });
      expect(stageApi.signal).toBe(customSignal);
      expect(stageApi.custom).toBe("value");
    });
  });
});
