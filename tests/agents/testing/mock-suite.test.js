/**
 * Mock Testing Suite 单元测试
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  MockModelClient,
  MockMcpProvider,
  MockEventBus,
  ScenarioRunner,
  createMockTestEnv,
} from "../../../js/agents/testing/mock-suite.js";

describe("mock-suite", () => {
  describe("MockModelClient", () => {
    it("should return default response", async () => {
      const client = new MockModelClient({ responses: { default: "Hello!" } });
      const result = await client.chat({ messages: [{ role: "user", content: "Hi" }] });
      assert.strictEqual(result.content, "Hello!");
    });

    it("should match keyword responses", async () => {
      const client = new MockModelClient({
        responses: {
          search: "I will search for that",
          default: "I don't understand",
        },
      });

      const r1 = await client.chat({ messages: [{ role: "user", content: "Please search for X" }] });
      assert.strictEqual(r1.content, "I will search for that");

      const r2 = await client.chat({ messages: [{ role: "user", content: "Hello" }] });
      assert.strictEqual(r2.content, "I don't understand");
    });

    it("should use sequence responses", async () => {
      const client = new MockModelClient({ sequence: ["First", "Second", "Third"] });

      const r1 = await client.ask("1");
      assert.strictEqual(r1, "First");

      const r2 = await client.ask("2");
      assert.strictEqual(r2, "Second");

      const r3 = await client.ask("3");
      assert.strictEqual(r3, "Third");

      // Wraps around
      const r4 = await client.ask("4");
      assert.strictEqual(r4, "First");
    });

    it("should use dynamic handler", async () => {
      const client = new MockModelClient({
        handler: (messages) => `Echo: ${messages[messages.length - 1].content}`,
      });

      const result = await client.ask("Hello World");
      assert.strictEqual(result, "Echo: Hello World");
    });

    it("should track call history", async () => {
      const client = new MockModelClient({ responses: { default: "OK" } });

      await client.ask("First");
      await client.ask("Second");

      assert.strictEqual(client.callCount, 2);
      assert.strictEqual(client.callHistory[0].messages[0].content, "First");
    });

    it("should reset state", async () => {
      const client = new MockModelClient({ sequence: ["A", "B"] });

      await client.ask("1");
      await client.ask("2");
      assert.strictEqual(client.callCount, 2);

      client.reset();
      assert.strictEqual(client.callCount, 0);

      const r = await client.ask("3");
      assert.strictEqual(r, "A"); // Sequence resets
    });
  });

  describe("MockMcpProvider", () => {
    it("should return default search results", async () => {
      const provider = new MockMcpProvider();
      const result = await provider.search("test query");

      assert.strictEqual(result.success, true);
      assert.ok(result.results.length > 0);
      assert.ok(result.results[0].title.includes("test query"));
    });

    it("should use custom tool handlers", async () => {
      const provider = new MockMcpProvider({
        tools: {
          search: (query) => ({ success: true, results: [{ title: `Custom: ${query}` }] }),
        },
      });

      const result = await provider.search("my query");
      assert.strictEqual(result.results[0].title, "Custom: my query");
    });

    it("should track call history", async () => {
      const provider = new MockMcpProvider();

      await provider.search("q1");
      await provider.fetch("http://example.com");
      await provider.callTool("custom", { arg: 1 });

      assert.strictEqual(provider.callHistory.length, 3);
      assert.strictEqual(provider.callHistory[0].method, "search");
      assert.strictEqual(provider.callHistory[1].method, "fetch");
      assert.strictEqual(provider.callHistory[2].method, "callTool");
    });
  });

  describe("MockEventBus", () => {
    let bus;

    beforeEach(() => {
      bus = new MockEventBus();
    });

    it("should emit and capture events", () => {
      bus.emit("test.event", { data: 123 });
      bus.emit("test.event", { data: 456 });

      assert.strictEqual(bus.events.length, 2);
      assert.strictEqual(bus.events[0].name, "test.event");
      assert.strictEqual(bus.events[0].payload.data, 123);
    });

    it("should call listeners", () => {
      let received = null;
      bus.on("my.event", (payload) => { received = payload; });

      bus.emit("my.event", { value: "test" });
      assert.deepStrictEqual(received, { value: "test" });
    });

    it("should assertEmitted pass when event exists", () => {
      bus.emit("success.event", {});
      bus.assertEmitted("success.event", 1); // Should not throw
    });

    it("should assertEmitted fail when event missing", () => {
      assert.throws(() => {
        bus.assertEmitted("missing.event", 1);
      }, /Expected event "missing.event"/);
    });

    it("should assertNotEmitted pass when event missing", () => {
      bus.assertNotEmitted("missing.event"); // Should not throw
    });

    it("should assertNotEmitted fail when event exists", () => {
      bus.emit("exists.event", {});
      assert.throws(() => {
        bus.assertNotEmitted("exists.event");
      }, /Expected event "exists.event" not to be emitted/);
    });

    it("should getPayloads return all payloads for event", () => {
      bus.emit("data.event", { id: 1 });
      bus.emit("other.event", { id: 2 });
      bus.emit("data.event", { id: 3 });

      const payloads = bus.getPayloads("data.event");
      assert.strictEqual(payloads.length, 2);
      assert.strictEqual(payloads[0].id, 1);
      assert.strictEqual(payloads[1].id, 3);
    });
  });

  describe("ScenarioRunner", () => {
    it("should run simple scenario", async () => {
      const runner = new ScenarioRunner({
        modelClient: new MockModelClient({ responses: { default: "OK" } }),
      });

      const result = await runner.run({
        name: "simple test",
        steps: [
          { input: "Hello", expectedOutput: "OK" },
        ],
      });

      assert.strictEqual(result.passed, true);
      assert.strictEqual(result.steps.length, 1);
    });

    it("should fail on output mismatch", async () => {
      const runner = new ScenarioRunner({
        modelClient: new MockModelClient({ responses: { default: "Wrong" } }),
      });

      const result = await runner.run({
        name: "failing test",
        steps: [
          { input: "Hello", expectedOutput: "Expected" },
        ],
      });

      assert.strictEqual(result.passed, false);
      assert.ok(result.errors[0].includes("Expected output"));
    });

    it("should run tool call steps", async () => {
      const runner = new ScenarioRunner({
        mcpProvider: new MockMcpProvider({
          tools: {
            "read-doc": () => ({ success: true, content: "Doc content" }),
          },
        }),
      });

      const result = await runner.run({
        name: "tool test",
        steps: [
          { toolCall: "read-doc", args: { sourceId: "doc1" }, expectedResult: { success: true } },
        ],
      });

      assert.strictEqual(result.passed, true);
    });

    it("should run event assertion steps", async () => {
      const eventBus = new MockEventBus();
      const runner = new ScenarioRunner({ eventBus });

      // Pre-emit event
      eventBus.emit("test.event", {});

      const result = await runner.run({
        name: "event test",
        steps: [
          { assertEvent: "test.event" },
        ],
      });

      assert.strictEqual(result.passed, true);
    });

    it("should run setup function", async () => {
      let setupCalled = false;
      const runner = new ScenarioRunner();

      await runner.run({
        name: "setup test",
        setup: () => { setupCalled = true; },
        steps: [],
      });

      assert.strictEqual(setupCalled, true);
    });

    it("should runAll multiple scenarios", async () => {
      const runner = new ScenarioRunner({
        modelClient: new MockModelClient({ sequence: ["A", "B"] }),
      });

      const summary = await runner.runAll([
        { name: "test1", steps: [{ input: "1", expectedOutput: "A" }] },
        { name: "test2", steps: [{ input: "2", expectedOutput: "A" }] }, // Resets between scenarios
      ]);

      assert.strictEqual(summary.total, 2);
      assert.strictEqual(summary.passed, 2);
    });
  });

  describe("createMockTestEnv", () => {
    it("should create complete test environment", () => {
      const env = createMockTestEnv();

      assert.ok(env.modelClient instanceof MockModelClient);
      assert.ok(env.mcpProvider instanceof MockMcpProvider);
      assert.ok(env.eventBus instanceof MockEventBus);
      assert.ok(env.runner instanceof ScenarioRunner);
    });

    it("should create stageApi compatible object", async () => {
      const env = createMockTestEnv({
        model: { responses: { default: "Test response" } },
      });

      const stageApi = env.createStageApi();

      assert.ok(stageApi.signal);
      assert.ok(typeof stageApi.emit === "function");
      assert.ok(stageApi.modelRouter);
      assert.ok(stageApi.aiApiService);

      // Test modelRouter.call
      const result = await stageApi.modelRouter.call([{ role: "user", content: "Hi" }], {});
      assert.strictEqual(result.content, "Test response");

      // Test emit
      stageApi.emit("test.event", { data: 1 });
      env.eventBus.assertEmitted("test.event");
    });
  });
});
