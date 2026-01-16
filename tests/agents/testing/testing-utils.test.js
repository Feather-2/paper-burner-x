import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  MockModelClient,
  MockMcpProvider,
  MockEventBus,
  MockServer,
  ScenarioRunner,
  createMockTestEnv,
} from "../../../js/agents/testing/mock-suite.js";

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
      assert.deepEqual(client.responses, {});
      assert.deepEqual(client.sequence, []);
      assert.equal(client.handler, null);
      assert.deepEqual(client.rules, []);
      assert.equal(client.delay, 0);
      assert.deepEqual(client.callHistory, []);
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
      assert.deepEqual(c.responses, { hello: "world" });
      assert.deepEqual(c.sequence, ["a", "b"]);
      assert.equal(typeof c.handler, "function");
      assert.equal(c.rules.length, 1);
      assert.equal(c.delay, 100);
    });
  });

  describe("chat()", () => {
    it("returns default response when no match", async () => {
      const result = await client.chat({ messages: [{ role: "user", content: "test" }] });
      assert.equal(result.content, "Mock response");
      assert.equal(result.model, "mock");
      assert.equal(result.finish_reason, "stop");
    });

    it("matches keyword in responses", async () => {
      client.responses = { greeting: "Hello there!" };
      const result = await client.chat({ messages: [{ role: "user", content: "send greeting" }] });
      assert.equal(result.content, "Hello there!");
    });

    it("uses custom default response", async () => {
      client.responses = { default: "custom default" };
      const result = await client.chat({ messages: [{ role: "user", content: "xyz" }] });
      assert.equal(result.content, "custom default");
    });

    it("uses sequence in order", async () => {
      client.sequence = ["first", "second", "third"];
      const r1 = await client.chat({ messages: [] });
      const r2 = await client.chat({ messages: [] });
      const r3 = await client.chat({ messages: [] });
      const r4 = await client.chat({ messages: [] });
      assert.equal(r1.content, "first");
      assert.equal(r2.content, "second");
      assert.equal(r3.content, "third");
      assert.equal(r4.content, "first"); // wraps around
    });

    it("uses handler function", async () => {
      client.handler = (messages) => `Handled: ${messages.length} messages`;
      const result = await client.chat({ messages: [{}, {}, {}] });
      assert.equal(result.content, "Handled: 3 messages");
    });

    it("tracks call history", async () => {
      await client.chat({ messages: [{ role: "user", content: "q1" }], usage: "test" });
      await client.chat({ messages: [{ role: "user", content: "q2" }] });
      assert.equal(client.callHistory.length, 2);
      assert.equal(client.callCount, 2);
      assert.equal(client.callHistory[0].usage, "test");
    });

    it("respects delay", async () => {
      client.delay = 50;
      const start = Date.now();
      await client.chat({ messages: [] });
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 40, `Expected delay of ~50ms, got ${elapsed}ms`);
    });

    it("normalizes object response", async () => {
      client.handler = () => ({
        content: "obj",
        model: "custom-model",
        usage: { total_tokens: 50 },
        finishReason: "length",
      });
      const result = await client.chat({ messages: [] });
      assert.equal(result.content, "obj");
      assert.equal(result.model, "custom-model");
      assert.equal(result.usage.total_tokens, 50);
      assert.equal(result.finish_reason, "length");
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
      assert.equal(r1.content, "special response");
      assert.equal(r2.content, "Mock response");
    });

    it("throws if predicate is not a function", () => {
      assert.throws(() => client.when("not a function", "response"), /predicate must be a function/);
    });

    it("supports function response", async () => {
      client.when(
        () => true,
        (msgs) => `Dynamic: ${msgs.length}`
      );
      const result = await client.chat({ messages: [{}, {}] });
      assert.equal(result.content, "Dynamic: 2");
    });

    it("rules take precedence over handler", async () => {
      client.handler = () => "from handler";
      client.when(() => true, "from rule");
      const result = await client.chat({ messages: [] });
      assert.equal(result.content, "from rule");
    });

    it("ignores rule errors gracefully", async () => {
      client.when(() => { throw new Error("boom"); }, "should not reach");
      client.responses.default = "fallback";
      const result = await client.chat({ messages: [] });
      assert.equal(result.content, "fallback");
    });
  });

  describe("chatStream()", () => {
    it("yields chunks", async () => {
      client.handler = () => "Hello World";
      const chunks = [];
      for await (const chunk of client.chatStream({ messages: [], chunkSize: 5 })) {
        chunks.push(chunk.delta);
      }
      assert.deepEqual(chunks, ["Hello", " Worl", "d"]);
    });

    it("uses default chunk size", async () => {
      client.handler = () => "A".repeat(50);
      const chunks = [];
      for await (const chunk of client.chatStream({ messages: [] })) {
        chunks.push(chunk.delta);
      }
      assert.equal(chunks.length, 3); // 50/20 = 2.5 -> 3 chunks
    });
  });

  describe("ask()", () => {
    it("returns content string", async () => {
      client.handler = () => "answer";
      const result = await client.ask("question");
      assert.equal(result, "answer");
    });

    it("includes system prompt when provided", async () => {
      client.handler = (msgs) => `Got ${msgs.length} messages`;
      const result = await client.ask("user msg", "system msg");
      assert.equal(result, "Got 2 messages");
    });
  });

  describe("reset()", () => {
    it("clears call history and sequence index", async () => {
      client.sequence = ["a", "b"];
      await client.chat({ messages: [] });
      assert.equal(client.callCount, 1);
      client.reset();
      assert.equal(client.callCount, 0);
      const result = await client.chat({ messages: [] });
      assert.equal(result.content, "a"); // sequence reset
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
      assert.deepEqual(mcp.tools, {});
      assert.deepEqual(mcp.callHistory, []);
    });

    it("accepts initial tools", () => {
      const provider = new MockMcpProvider({ tools: { foo: () => "bar" } });
      assert.ok(typeof provider.tools.foo === "function");
    });
  });

  describe("registerTool()", () => {
    it("adds tool handler", () => {
      mcp.registerTool("myTool", () => "result");
      assert.ok(typeof mcp.tools.myTool === "function");
    });
  });

  describe("search()", () => {
    it("returns default mock results", async () => {
      const result = await mcp.search("test query");
      assert.equal(result.success, true);
      assert.equal(result.results.length, 1);
      assert.ok(result.results[0].title.includes("test query"));
    });

    it("uses custom search handler", async () => {
      mcp.tools.search = () => ({ success: true, results: [{ custom: true }] });
      const result = await mcp.search("q");
      assert.equal(result.results[0].custom, true);
    });

    it("records call history", async () => {
      await mcp.search("q1", { limit: 5 });
      assert.equal(mcp.callHistory.length, 1);
      assert.equal(mcp.callHistory[0].method, "search");
      assert.equal(mcp.callHistory[0].query, "q1");
      assert.deepEqual(mcp.callHistory[0].options, { limit: 5 });
    });
  });

  describe("fetch()", () => {
    it("returns default mock content", async () => {
      const result = await mcp.fetch("https://example.com");
      assert.equal(result.success, true);
      assert.ok(result.content.includes("example.com"));
    });

    it("uses custom fetch handler", async () => {
      mcp.tools.fetch = (url) => ({ success: true, content: `Custom: ${url}` });
      const result = await mcp.fetch("http://test.com");
      assert.equal(result.content, "Custom: http://test.com");
    });

    it("records call history", async () => {
      await mcp.fetch("https://test.com", { timeout: 1000 });
      assert.equal(mcp.callHistory[0].method, "fetch");
      assert.equal(mcp.callHistory[0].url, "https://test.com");
    });
  });

  describe("callTool()", () => {
    it("returns default result for unknown tool", async () => {
      const result = await mcp.callTool("unknownTool", { arg: 1 });
      assert.equal(result.success, true);
      assert.ok(result.data.includes("unknownTool"));
    });

    it("invokes registered tool", async () => {
      mcp.registerTool("add", ({ a, b }) => ({ sum: a + b }));
      const result = await mcp.callTool("add", { a: 2, b: 3 });
      assert.equal(result.sum, 5);
    });

    it("records call history", async () => {
      await mcp.callTool("tool1", { x: 1 });
      assert.equal(mcp.callHistory[0].method, "callTool");
      assert.equal(mcp.callHistory[0].name, "tool1");
    });
  });

  describe("reset()", () => {
    it("clears call history", async () => {
      await mcp.search("q");
      mcp.reset();
      assert.equal(mcp.callHistory.length, 0);
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
      assert.equal(bus.events.length, 1);
      assert.equal(bus.events[0].name, "test:event");
      assert.deepEqual(bus.events[0].payload, { data: 1 });
    });

    it("calls registered handlers", () => {
      const received = [];
      bus.on("my:event", (payload) => received.push(payload));
      bus.emit("my:event", "first");
      bus.emit("my:event", "second");
      assert.deepEqual(received, ["first", "second"]);
    });

    it("returns unsubscribe function", () => {
      const received = [];
      const unsub = bus.on("event", (p) => received.push(p));
      bus.emit("event", 1);
      unsub();
      bus.emit("event", 2);
      assert.deepEqual(received, [1]);
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
      assert.deepEqual(received, [1]);
    });
  });

  describe("assertEmitted()", () => {
    it("passes when event was emitted", () => {
      bus.emit("success", {});
      bus.assertEmitted("success");
    });

    it("throws when event was not emitted", () => {
      assert.throws(
        () => bus.assertEmitted("missing"),
        /Expected event "missing" to be emitted/
      );
    });

    it("checks count", () => {
      bus.emit("e", {});
      bus.emit("e", {});
      bus.assertEmitted("e", 2);
      assert.throws(() => bus.assertEmitted("e", 3), /at least 3 time/);
    });

    it("matches payload object", () => {
      bus.emit("status", { code: 200, msg: "ok" });
      bus.assertEmitted("status", { code: 200 });
    });

    it("throws on payload mismatch", () => {
      bus.emit("status", { code: 500 });
      assert.throws(
        () => bus.assertEmitted("status", { code: 200 }),
        /payload to match/
      );
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
      assert.equal(matches.length, 2);
    });
  });

  describe("assertEmittedWith()", () => {
    it("passes when predicate matches", () => {
      bus.emit("data", { value: 42 });
      bus.assertEmittedWith("data", (p) => p.value === 42);
    });

    it("throws when event not emitted", () => {
      assert.throws(
        () => bus.assertEmittedWith("missing", () => true),
        /never emitted/
      );
    });

    it("throws when no payload satisfies predicate", () => {
      bus.emit("data", { value: 1 });
      assert.throws(
        () => bus.assertEmittedWith("data", (p) => p.value > 100, "value > 100"),
        /satisfy predicate.*value > 100/
      );
    });

    it("throws if predicate is not a function", () => {
      assert.throws(
        () => bus.assertEmittedWith("e", "not a function"),
        /predicate must be a function/
      );
    });

    it("handles predicate errors gracefully", () => {
      bus.emit("e", { x: 1 });
      assert.throws(
        () => bus.assertEmittedWith("e", () => { throw new Error("boom"); }),
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
      assert.throws(
        () => bus.assertEmittedInOrder(["a", "b"]),
        /Expected event "b" to be emitted/
      );
    });

    it("throws on empty array", () => {
      assert.throws(
        () => bus.assertEmittedInOrder([]),
        /non-empty array/
      );
    });
  });

  describe("assertNotEmitted()", () => {
    it("passes when event was not emitted", () => {
      bus.assertNotEmitted("never");
    });

    it("throws when event was emitted", () => {
      bus.emit("oops", {});
      assert.throws(
        () => bus.assertNotEmitted("oops"),
        /not to be emitted/
      );
    });
  });

  describe("getPayloads()", () => {
    it("returns all payloads for event", () => {
      bus.emit("e", { n: 1 });
      bus.emit("other", { n: 99 });
      bus.emit("e", { n: 2 });
      const payloads = bus.getPayloads("e");
      assert.deepEqual(payloads, [{ n: 1 }, { n: 2 }]);
    });

    it("returns empty array for unknown event", () => {
      assert.deepEqual(bus.getPayloads("unknown"), []);
    });
  });

  describe("reset()", () => {
    it("clears all events", () => {
      bus.emit("a", {});
      bus.reset();
      assert.equal(bus.events.length, 0);
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
      assert.equal(resp.status, 200);
      assert.equal(await resp.text(), "Hello World");
    });

    it("supports custom status", async () => {
      server.setTextResponse("/error", "Not Found", { status: 404 });
      const resp = await server.fetch("/error");
      assert.equal(resp.status, 404);
      assert.equal(resp.ok, false);
    });

    it("supports method matching", async () => {
      server.setTextResponse("/data", "posted", { method: "POST" });
      const getResp = await server.fetch("/data", { method: "GET" });
      const postResp = await server.fetch("/data", { method: "POST" });
      assert.equal(getResp.status, 404);
      assert.equal(await postResp.text(), "posted");
    });
  });

  describe("setJsonResponse()", () => {
    it("responds with JSON", async () => {
      server.setJsonResponse("/api/data", { id: 1, name: "test" });
      const resp = await server.fetch("/api/data");
      const data = await resp.json();
      assert.deepEqual(data, { id: 1, name: "test" });
      assert.equal(resp.headers.get("content-type"), "application/json");
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
      assert.deepEqual(chunks, ["chunk1", "chunk2", "chunk3"]);
    });
  });

  describe("setHandler()", () => {
    it("uses custom handler function", async () => {
      server.setHandler("/custom", (req) => ({
        status: 200,
        body: `Path: ${req.path}`,
      }));
      const resp = await server.fetch("/custom");
      assert.equal(await resp.text(), "Path: /custom");
    });
  });

  describe("path matching", () => {
    it("matches regex paths", async () => {
      server.setTextResponse(/\/api\/.*/, "API matched");
      const resp = await server.fetch("/api/users/123");
      assert.equal(await resp.text(), "API matched");
    });

    it("matches function paths", async () => {
      server.setTextResponse((path) => path.startsWith("/v1"), "V1 API");
      const resp = await server.fetch("/v1/endpoint");
      assert.equal(await resp.text(), "V1 API");
    });
  });

  describe("fetch()", () => {
    it("returns 404 for unmatched routes", async () => {
      const resp = await server.fetch("/unknown");
      assert.equal(resp.status, 404);
      assert.equal(await resp.text(), "Not Found");
    });

    it("records call history", async () => {
      server.setTextResponse("/test", "ok");
      await server.fetch("/test", { method: "POST", body: '{"x":1}' });
      assert.equal(server.callHistory.length, 1);
      assert.equal(server.callHistory[0].method, "POST");
      assert.equal(server.callHistory[0].path, "/test");
    });

    it("handles URL with query string", async () => {
      server.setTextResponse("/search?q=test", "found");
      const resp = await server.fetch("/search?q=test");
      assert.equal(await resp.text(), "found");
    });
  });

  describe("MockResponse", () => {
    it("ok is true for 2xx status", async () => {
      server.setTextResponse("/a", "ok", { status: 200 });
      server.setTextResponse("/b", "created", { status: 201 });
      server.setTextResponse("/c", "error", { status: 400 });
      assert.equal((await server.fetch("/a")).ok, true);
      assert.equal((await server.fetch("/b")).ok, true);
      assert.equal((await server.fetch("/c")).ok, false);
    });

    it("arrayBuffer() returns ArrayBuffer", async () => {
      server.setTextResponse("/bin", "hello");
      const resp = await server.fetch("/bin");
      const buf = await resp.arrayBuffer();
      assert.ok(buf instanceof ArrayBuffer);
      const text = new TextDecoder().decode(buf);
      assert.equal(text, "hello");
    });

    it("respects delay option", async () => {
      server.setTextResponse("/slow", "done", { delay: 50 });
      const start = Date.now();
      const resp = await server.fetch("/slow");
      await resp.text();
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 40, `Expected delay ~50ms, got ${elapsed}ms`);
    });
  });

  describe("reset()", () => {
    it("clears routes and history", async () => {
      server.setTextResponse("/a", "ok");
      await server.fetch("/a");
      server.reset();
      assert.equal(server.routes.length, 0);
      assert.equal(server.callHistory.length, 0);
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
      assert.ok(runner.modelClient instanceof MockModelClient);
      assert.ok(runner.mcpProvider instanceof MockMcpProvider);
      assert.ok(runner.eventBus instanceof MockEventBus);
    });

    it("accepts custom mocks", () => {
      const customModel = new MockModelClient({ delay: 100 });
      const r = new ScenarioRunner({ modelClient: customModel });
      assert.equal(r.modelClient.delay, 100);
    });
  });

  describe("run()", () => {
    it("runs scenario with input steps", async () => {
      runner.modelClient.responses.default = "expected output";
      const result = await runner.run({
        name: "test scenario",
        steps: [{ input: "test", expectedOutput: "expected" }],
      });
      assert.equal(result.name, "test scenario");
      assert.equal(result.passed, true);
      assert.equal(result.steps.length, 1);
    });

    it("fails when output does not match", async () => {
      runner.modelClient.responses.default = "wrong output";
      const result = await runner.run({
        name: "fail scenario",
        steps: [{ input: "test", expectedOutput: "expected" }],
      });
      assert.equal(result.passed, false);
      assert.ok(result.errors[0].includes("Expected output"));
    });

    it("runs scenario with tool call steps", async () => {
      runner.mcpProvider.registerTool("calc", ({ a, b }) => ({ sum: a + b }));
      const result = await runner.run({
        name: "tool scenario",
        steps: [{ toolCall: "calc", args: { a: 2, b: 3 }, expectedResult: { sum: 5 } }],
      });
      assert.equal(result.passed, true);
    });

    it("fails when tool result does not match", async () => {
      runner.mcpProvider.registerTool("calc", () => ({ sum: 99 }));
      const result = await runner.run({
        name: "tool fail",
        steps: [{ toolCall: "calc", args: {}, expectedResult: { sum: 5 } }],
      });
      assert.equal(result.passed, false);
    });

    it("runs scenario with event assertions", async () => {
      const result = await runner.run({
        name: "event scenario",
        steps: [{ input: "trigger" }],
        setup: ({ eventBus }) => {
          eventBus.emit("test:event", {});
        },
      });
      assert.equal(result.passed, true);
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
      assert.equal(setupCalled, true);
      assert.equal(teardownCalled, true);
    });

    it("calls teardown even on failure", async () => {
      let teardownCalled = false;
      runner.modelClient.responses.default = "wrong";
      await runner.run({
        name: "fail with teardown",
        steps: [{ input: "x", expectedOutput: "expected" }],
        teardown: () => { teardownCalled = true; },
      });
      assert.equal(teardownCalled, true);
    });

    it("handles teardown errors", async () => {
      const result = await runner.run({
        name: "teardown error",
        steps: [],
        teardown: () => { throw new Error("teardown boom"); },
      });
      assert.equal(result.passed, false);
      assert.ok(result.errors.some((e) => e.includes("Teardown failed")));
    });

    it("supports regex in expectedResult", async () => {
      runner.mcpProvider.registerTool("greet", () => ({ msg: "Hello World" }));
      const result = await runner.run({
        name: "regex match",
        steps: [{ toolCall: "greet", args: {}, expectedResult: { msg: /Hello/ } }],
      });
      assert.equal(result.passed, true);
    });

    it("supports function predicate in expectedResult", async () => {
      runner.mcpProvider.registerTool("num", () => ({ value: 42 }));
      const result = await runner.run({
        name: "predicate match",
        steps: [{ toolCall: "num", args: {}, expectedResult: { value: (v) => v > 40 } }],
      });
      assert.equal(result.passed, true);
    });
  });

  describe("runAll()", () => {
    it("runs multiple scenarios", async () => {
      runner.modelClient.responses.default = "ok";
      const results = await runner.runAll([
        { name: "s1", steps: [{ input: "a", expectedOutput: "ok" }] },
        { name: "s2", steps: [{ input: "b", expectedOutput: "ok" }] },
      ]);
      assert.equal(results.total, 2);
      assert.equal(results.passed, 2);
      assert.equal(results.failed, 0);
    });

    it("resets between scenarios", async () => {
      runner.modelClient.sequence = ["first", "second"];
      const results = await runner.runAll([
        { name: "s1", steps: [{ input: "x", expectedOutput: "first" }] },
        { name: "s2", steps: [{ input: "y", expectedOutput: "first" }] }, // reset means first again
      ]);
      assert.equal(results.passed, 2);
    });
  });

  describe("reset()", () => {
    it("resets all mocks", async () => {
      await runner.modelClient.chat({ messages: [] });
      runner.eventBus.emit("e", {});
      await runner.mcpProvider.search("q");
      runner.reset();
      assert.equal(runner.modelClient.callCount, 0);
      assert.equal(runner.eventBus.events.length, 0);
      assert.equal(runner.mcpProvider.callHistory.length, 0);
    });
  });
});

// ============================================================================
// createMockTestEnv
// ============================================================================

describe("createMockTestEnv()", () => {
  it("creates all mock components", () => {
    const env = createMockTestEnv();
    assert.ok(env.modelClient instanceof MockModelClient);
    assert.ok(env.mcpProvider instanceof MockMcpProvider);
    assert.ok(env.eventBus instanceof MockEventBus);
    assert.ok(env.runner instanceof ScenarioRunner);
  });

  it("accepts model options", () => {
    const env = createMockTestEnv({ model: { delay: 100 } });
    assert.equal(env.modelClient.delay, 100);
  });

  it("accepts mcp options", () => {
    const env = createMockTestEnv({ mcp: { tools: { foo: () => "bar" } } });
    assert.ok(typeof env.mcpProvider.tools.foo === "function");
  });

  describe("createStageApi()", () => {
    it("creates stageApi compatible object", () => {
      const env = createMockTestEnv();
      const stageApi = env.createStageApi();
      assert.ok(stageApi.signal instanceof AbortSignal);
      assert.ok(typeof stageApi.emit === "function");
      assert.ok(stageApi.eventBus === env.eventBus);
      assert.ok(typeof stageApi.modelRouter.call === "function");
      assert.ok(typeof stageApi.aiApiService.chat === "function");
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
      assert.equal(result.content, "router response");
    });

    it("aiApiService.chat() uses modelClient", async () => {
      const env = createMockTestEnv();
      env.modelClient.responses.default = "api response";
      const stageApi = env.createStageApi();
      const result = await stageApi.aiApiService.chat({ messages: [] });
      assert.equal(result.content, "api response");
    });

    it("accepts overrides", () => {
      const env = createMockTestEnv();
      const customSignal = new AbortController().signal;
      const stageApi = env.createStageApi({ signal: customSignal, custom: "value" });
      assert.equal(stageApi.signal, customSignal);
      assert.equal(stageApi.custom, "value");
    });
  });
});
