/**
 * Mock Testing Suite 单元测试
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MockModelClient,
  MockMcpProvider,
  MockEventBus,
  ScenarioRunner,
  createMockTestEnv,
} from "../../../js/agents/testing/mock-suite.js";

describe("mock-suite", () => {
  afterEach(() => {
    try {
      vi.runOnlyPendingTimers();
      vi.clearAllTimers();
    } catch {}
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("MockModelClient", () => {
    it("should return default response", async () => {
      const client = new MockModelClient({ responses: { default: "Hello!" } });
      const result = await client.chat({ messages: [{ role: "user", content: "Hi" }] });
      expect(result.content).toBe("Hello!");
      expect(result).toMatchObject({
        model: "mock",
        finish_reason: "stop",
        system_fingerprint: "mock",
      });
    });

    it("should match keyword responses", async () => {
      const client = new MockModelClient({
        responses: {
          search: "I will search for that",
          default: "I don't understand",
        },
      });

      const r1 = await client.chat({ messages: [{ role: "user", content: "Please search for X" }] });
      expect(r1.content).toBe("I will search for that");

      const r2 = await client.chat({ messages: [{ role: "user", content: "Hello" }] });
      expect(r2.content).toBe("I don't understand");
    });

    it("should use sequence responses", async () => {
      const client = new MockModelClient({ sequence: ["First", "Second", "Third"] });

      const r1 = await client.ask("1");
      expect(r1).toBe("First");

      const r2 = await client.ask("2");
      expect(r2).toBe("Second");

      const r3 = await client.ask("3");
      expect(r3).toBe("Third");

      // Wraps around
      const r4 = await client.ask("4");
      expect(r4).toBe("First");
    });

    it("should use dynamic handler", async () => {
      const handler = vi.fn((messages) => `Echo: ${messages[messages.length - 1].content}`);
      const client = new MockModelClient({
        handler,
      });

      const result = await client.ask("Hello World");
      expect(result).toBe("Echo: Hello World");
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should normalize object responses (finishReason/systemFingerprint aliases)", async () => {
      const client = new MockModelClient({
        handler: () => ({
          content: "ok",
          finishReason: "length",
          systemFingerprint: "fp-123",
          usage: { total_tokens: 7 },
        }),
      });

      const result = await client.chat({ messages: [{ role: "user", content: "Hi" }] });
      expect(result).toMatchObject({
        content: "ok",
        finish_reason: "length",
        system_fingerprint: "fp-123",
        usage: { total_tokens: 7 },
      });
    });

    it("should track call history", async () => {
      const client = new MockModelClient({ responses: { default: "OK" } });

      await client.ask("First");
      await client.ask("Second");

      expect(client.callCount).toBe(2);
      expect(client.callHistory[0].messages[0].content).toBe("First");
      expect(client.callHistory[0].usage).toBe("worker");
    });

    it("should reset state", async () => {
      const client = new MockModelClient({ sequence: ["A", "B"] });

      await client.ask("1");
      await client.ask("2");
      expect(client.callCount).toBe(2);

      client.reset();
      expect(client.callCount).toBe(0);

      const r = await client.ask("3");
      expect(r).toBe("A"); // Sequence resets
    });

    it("should support predicate rules", async () => {
      const client = new MockModelClient({ responses: { default: "fallback" } });
      client.when(
        (messages) => String(messages[messages.length - 1]?.content || "").includes("special"),
        { content: "matched", finish_reason: "stop" }
      );

      const r1 = await client.ask("special case");
      expect(r1).toBe("matched");

      const r2 = await client.ask("other");
      expect(r2).toBe("fallback");
    });

    it("should prioritize predicate rules over handler/sequence/keywords", async () => {
      const client = new MockModelClient({
        responses: { hello: "keyword", default: "default" },
        sequence: ["seq"],
        handler: () => "handler",
      });

      client.when(() => true, (messages) => `rule:${messages[messages.length - 1]?.content || ""}`);

      const result = await client.chat({ messages: [{ role: "user", content: "hello" }] });
      expect(result.content).toBe("rule:hello");
    });

    it("when() should validate predicate argument", () => {
      const client = new MockModelClient();
      // @ts-expect-error - invalid predicate
      expect(() => client.when(null, "x")).toThrow(/predicate must be a function/i);
    });

    it("should ignore predicate rule errors", async () => {
      const client = new MockModelClient({ responses: { default: "fallback" } });
      client.when(() => { throw new Error("boom"); }, "bad");

      const result = await client.chat({ messages: [{ role: "user", content: "hi" }] });
      expect(result.content).toBe("fallback");
    });

    it("should respect delay option (fake timers)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));

      const client = new MockModelClient({ responses: { default: "OK" }, delay: 100 });
      const pending = client.chat({ messages: [{ role: "user", content: "Hi" }] });
      const resolved = vi.fn();
      pending.then(resolved);

      await vi.advanceTimersByTimeAsync(99);
      expect(resolved).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      const result = await pending;
      expect(result.content).toBe("OK");
      expect(resolved).toHaveBeenCalledTimes(1);
      expect(client.callHistory[0].timestamp).toBe(new Date("2020-01-01T00:00:00Z").getTime());
    });

    it("ask() should include optional system prompt", async () => {
      const client = new MockModelClient({ responses: { default: "OK" } });
      const output = await client.ask("hello", "you are a bot");
      expect(output).toBe("OK");

      expect(client.callHistory[0].messages).toEqual([
        { role: "system", content: "you are a bot" },
        { role: "user", content: "hello" },
      ]);
    });

    it("chatStream should yield deltas", async () => {
      const client = new MockModelClient({ responses: { default: "HelloWorld" } });
      const chunks = [];
      for await (const evt of client.chatStream({ messages: [{ role: "user", content: "x" }], chunkSize: 3 })) {
        chunks.push(evt.delta);
      }
      expect(chunks).toEqual(["Hel", "loW", "orl", "d"]);
      expect(client.callCount).toBe(1);
    });

    it("chatStream should sanitize invalid chunkSize", async () => {
      const client = new MockModelClient({ responses: { default: "abc" } });
      const deltas = [];

      for await (const evt of client.chatStream({ messages: [{ role: "user", content: "x" }], chunkSize: 0 })) {
        deltas.push(evt.delta);
        expect(evt.content).toBe("abc");
      }

      // chunkSize=0 -> 1
      expect(deltas).toEqual(["a", "b", "c"]);
    });
  });

  describe("MockMcpProvider", () => {
    it("should return default search results", async () => {
      const provider = new MockMcpProvider();
      const result = await provider.search("test query");

      expect(result.success).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].title).toContain("test query");
    });

    it("should use custom tool handlers", async () => {
      const provider = new MockMcpProvider({
        tools: {
          search: (query) => ({ success: true, results: [{ title: `Custom: ${query}` }] }),
        },
      });

      const result = await provider.search("my query");
      expect(result.results[0].title).toBe("Custom: my query");
    });

    it("should track call history", async () => {
      const provider = new MockMcpProvider();

      await provider.search("q1");
      await provider.fetch("http://example.com");
      await provider.callTool("custom", { arg: 1 });

      expect(provider.callHistory.length).toBe(3);
      expect(provider.callHistory[0].method).toBe("search");
      expect(provider.callHistory[1].method).toBe("fetch");
      expect(provider.callHistory[2].method).toBe("callTool");
    });

    it("should register tools and reset history", async () => {
      const provider = new MockMcpProvider();
      provider.registerTool("my-tool", (args) => ({ success: true, data: args }));

      const r1 = await provider.callTool("my-tool", { x: 1 });
      expect(r1).toEqual({ success: true, data: { x: 1 } });

      const r2 = await provider.callTool("unknown", { y: 2 });
      expect(r2).toEqual({ success: true, data: "Mock result for unknown" });

      provider.reset();
      expect(provider.callHistory).toEqual([]);
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

      expect(bus.events.length).toBe(2);
      expect(bus.events[0].name).toBe("test.event");
      expect(bus.events[0].payload.data).toBe(123);
    });

    it("should call listeners", () => {
      let received = null;
      const unsub = bus.on("my.event", (payload) => { received = payload; });

      bus.emit("my.event", { value: "test" });
      expect(received).toEqual({ value: "test" });

      unsub();
      bus.emit("my.event", { value: "ignored" });
      expect(received).toEqual({ value: "test" });
    });

    it("should assertEmitted pass when event exists", () => {
      bus.emit("success.event", {});
      bus.assertEmitted("success.event", 1); // Should not throw
    });

    it("should assertEmitted fail when event missing", () => {
      expect(() => bus.assertEmitted("missing.event", 1)).toThrow(/Expected event "missing\.event"/);
    });

    it("should assertNotEmitted pass when event missing", () => {
      bus.assertNotEmitted("missing.event"); // Should not throw
    });

    it("should assertNotEmitted fail when event exists", () => {
      bus.emit("exists.event", {});
      expect(() => bus.assertNotEmitted("exists.event")).toThrow(/Expected event "exists\.event" not to be emitted/);
    });

    it("should getPayloads return all payloads for event", () => {
      bus.emit("data.event", { id: 1 });
      bus.emit("other.event", { id: 2 });
      bus.emit("data.event", { id: 3 });

      const payloads = bus.getPayloads("data.event");
      expect(payloads.length).toBe(2);
      expect(payloads[0].id).toBe(1);
      expect(payloads[1].id).toBe(3);
    });

    it("should match payloads by regex/function/objects", () => {
      bus.emit("evt", { status: "ok", count: 2, items: ["a", "b"] });
      bus.emit("evt", { status: "fail", count: 0, items: ["a"] });

      // object matcher (partial)
      bus.assertEmitted("evt", { status: "ok" });

      // regex matcher
      bus.assertEmitted("evt", { status: /ok|success/ });

      // function matcher
      bus.assertEmitted("evt", { count: (v) => v > 0 });

      // array matcher
      bus.assertEmitted("evt", { items: ["a", "b"] });
    });

    it("should support assertEmittedWith and assertEmittedInOrder", () => {
      bus.emit("a", { v: 1 });
      bus.emit("b", { v: 2 });
      bus.emit("c", { v: 3 });

      bus.assertEmittedWith("b", (payload) => payload.v === 2);
      expect(() => bus.assertEmittedWith("b", null)).toThrow(/predicate must be a function/i);

      expect(bus.assertEmittedInOrder(["a", "c"])).toBe(true);
      expect(() => bus.assertEmittedInOrder([])).toThrow(/non-empty array/i);
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

      expect(result.passed).toBe(true);
      expect(result.steps.length).toBe(1);
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

      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain("Expected output");
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

      expect(result.passed).toBe(true);
    });

    it("should support deep matching with regex and predicate errors", async () => {
      const runner = new ScenarioRunner({
        mcpProvider: new MockMcpProvider({
          tools: {
            tool: () => ({ success: true, message: "hello", value: 3 }),
          },
        }),
      });

      const ok = await runner.run({
        name: "regex match",
        steps: [{ toolCall: "tool", expectedResult: { message: /hell/ } }],
      });
      expect(ok.passed).toBe(true);

      const bad = await runner.run({
        name: "predicate throws",
        steps: [{ toolCall: "tool", expectedResult: { value: () => { throw new Error("boom"); } } }],
      });
      expect(bad.passed).toBe(false);
      expect(bad.errors[0]).toMatch(/Predicate threw/i);
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

      expect(result.passed).toBe(true);
    });

    it("should run setup function", async () => {
      let setupCalled = false;
      const runner = new ScenarioRunner();

      await runner.run({
        name: "setup test",
        setup: () => { setupCalled = true; },
        steps: [],
      });

      expect(setupCalled).toBe(true);
    });

    it("should run teardown even when a step fails", async () => {
      let teardownCalled = false;
      const runner = new ScenarioRunner({
        modelClient: new MockModelClient({ responses: { default: "Wrong" } }),
      });

      const result = await runner.run({
        name: "teardown test",
        steps: [{ input: "Hello", expectedOutput: "Expected" }],
        teardown: () => { teardownCalled = true; },
      });

      expect(result.passed).toBe(false);
      expect(teardownCalled).toBe(true);
    });

    it("should record teardown failures", async () => {
      const runner = new ScenarioRunner();
      const result = await runner.run({
        name: "teardown throws",
        steps: [],
        teardown: () => { throw new Error("bad teardown"); },
      });

      expect(result.passed).toBe(false);
      expect(result.errors.join("\n")).toMatch(/Teardown failed/i);
    });

    it("should runAll multiple scenarios", async () => {
      const runner = new ScenarioRunner({
        modelClient: new MockModelClient({ sequence: ["A", "B"] }),
      });

      const summary = await runner.runAll([
        { name: "test1", steps: [{ input: "1", expectedOutput: "A" }] },
        { name: "test2", steps: [{ input: "2", expectedOutput: "A" }] }, // Resets between scenarios
      ]);

      expect(summary.total).toBe(2);
      expect(summary.passed).toBe(2);
    });
  });

  describe("createMockTestEnv", () => {
    it("should create complete test environment", () => {
      const env = createMockTestEnv();

      expect(env.modelClient).toBeInstanceOf(MockModelClient);
      expect(env.mcpProvider).toBeInstanceOf(MockMcpProvider);
      expect(env.eventBus).toBeInstanceOf(MockEventBus);
      expect(env.runner).toBeInstanceOf(ScenarioRunner);
    });

    it("should create stageApi compatible object", async () => {
      const env = createMockTestEnv({
        model: { responses: { default: "Test response" } },
      });

      const stageApi = env.createStageApi();

      expect(stageApi.signal).toBeTruthy();
      expect(typeof stageApi.emit).toBe("function");
      expect(stageApi.modelRouter).toBeTruthy();
      expect(stageApi.aiApiService).toBeTruthy();

      // Test modelRouter.call
      const result = await stageApi.modelRouter.call([{ role: "user", content: "Hi" }], {});
      expect(result.content).toBe("Test response");

      // Test emit
      stageApi.emit("test.event", { data: 1 });
      env.eventBus.assertEmitted("test.event");
    });

    it("should allow createStageApi overrides", async () => {
      const env = createMockTestEnv({ model: { responses: { default: "OK" } } });
      const customEmit = vi.fn();
      const stageApi = env.createStageApi({ emit: customEmit });

      await stageApi.aiApiService.chat({ messages: [{ role: "user", content: "Hi" }] });
      expect(customEmit).not.toHaveBeenCalled();
    });
  });
});
