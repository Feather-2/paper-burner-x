// MockProvider unit tests cover validation, normalization, delays, concurrency, and large payloads.
// Targets tests/unit/agents/llm/mock-provider.test.js to exercise edge cases and error handling.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/llm/provider.js", async () => {
  const actual = await vi.importActual("../../../../js/agents/llm/provider.js");
  return {
    ...actual,
    assertChatMessages: vi.fn(actual.assertChatMessages),
    assertChatResponse: vi.fn(actual.assertChatResponse),
  };
});

vi.mock("../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../js/agents/shared/index.js");
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
  };
});

import { MockProvider } from "../../../../js/agents/llm/mock-provider.js";

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const makeMessages = (content = "hi") => [{ role: "user", content }];

const makeDeepObject = (depth) => {
  let node = { level: depth, leaf: true };
  for (let i = depth - 1; i >= 0; i -= 1) {
    node = { level: i, child: node };
  }
  return node;
};

describe("MockProvider", () => {
  it("setBehaviors and pushOutcome reject empty model ids", () => {
    const p = new MockProvider();
    const invalid = ["", "   ", null, undefined];
    for (const value of invalid) {
      expect(() => p.setBehaviors(value, { content: "x" })).toThrow(/modelId must be a non-empty string/i);
      expect(() => p.pushOutcome(value, { content: "x" })).toThrow(/modelId must be a non-empty string/i);
    }
  });

  it("chat validates model and message shapes, including empty objects", async () => {
    const p = new MockProvider();

    const invalidModels = [null, undefined, "", "   "];
    for (const value of invalidModels) {
      await expect(p.chat({ model: value, messages: [] })).rejects.toThrow(/model must be a non-empty string/i);
    }

    await expect(p.chat({ model: "m1", messages: "nope" })).rejects.toThrow(/messages must be an array/i);
    await expect(p.chat({ model: "m1", messages: { role: "user", content: "x" } })).rejects.toThrow(/messages must be an array/i);
    await expect(p.chat({ model: "m1", messages: [{}] })).rejects.toThrow(/messages.role must be a non-empty string/i);
    await expect(p.chat({ model: "m1", messages: [{ role: "user", content: 123 }] })).rejects.toThrow(
      /messages.content must be a string or an array of objects/i
    );

    const out = await p.chat({ model: "m1", messages: [] });
    expect(out).toMatchObject({ content: "", model: "m1", provider: "mock" });
  });

  it("uses defaultOutcome when queues are empty and prefers specific model over wildcard", async () => {
    const p = new MockProvider({
      defaultOutcome: 0,
      behaviors: {
        m1: [],
        "*": ["wild"],
      },
    });

    const out1 = await p.chat({ model: "m1", messages: [] });
    expect(out1.content).toBe("0");

    const out2 = await p.chat({ model: "other", messages: [] });
    expect(out2.content).toBe("wild");

    const p2 = new MockProvider({ defaultOutcome: null });
    const out3 = await p2.chat({ model: "m2", messages: [] });
    expect(out3.content).toBe("");
  });

  it("supports function outcomes, async outcomes, and records calls with images", async () => {
    const p = new MockProvider({
      behaviors: {
        m1: [
          ({ model, callIndex, messages, images }) => ({
            content: `${model}-${callIndex}-${messages.length}-${images.tag}`,
          }),
          async ({ callIndex }) => ({ content: `async-${callIndex}` }),
        ],
      },
      defaultOutcome: { content: "fallback" },
    });

    const messages = makeMessages("hi");
    const images = { tag: "img" };

    const out1 = await p.chat({ model: "m1", messages, images });
    const out2 = await p.chat({ model: "m1", messages, images });
    const out3 = await p.chat({ model: "m1", messages, images });

    expect(out1.content).toBe("m1-0-1-img");
    expect(out2.content).toBe("async-1");
    expect(out3.content).toBe("fallback");

    expect(p.calls).toHaveLength(3);
    expect(p.calls[0]).toMatchObject({ model: "m1", images });
    expect(p.calls[0].messages).toBe(messages);
  });

  it("pushOutcome initializes queues and normalizes error outcomes", async () => {
    const p = new MockProvider({ defaultOutcome: "def" });
    p.pushOutcome("m1", "first");
    p.pushOutcome("m1", new Error("boom"));
    p.pushOutcome("m1", { content: "second" });

    const out1 = await p.chat({ model: "m1", messages: makeMessages("x") });
    expect(out1.content).toBe("first");
    await expect(p.chat({ model: "m1", messages: makeMessages("x") })).rejects.toThrow("boom");
    const out3 = await p.chat({ model: "m1", messages: makeMessages("x") });
    expect(out3.content).toBe("second");
    const out4 = await p.chat({ model: "m1", messages: makeMessages("x") });
    expect(out4.content).toBe("def");
  });

  it("handles delayMs boundaries and outcome.throw values", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    const p = new MockProvider({
      behaviors: {
        m1: [
          { content: "zero", delayMs: 0 },
          { content: "neg", delayMs: -1 },
          { content: "string", delayMs: "10" },
          { content: "slow", delayMs: 5 },
          { throw: "boom" },
        ],
      },
    });

    const messages = makeMessages("hi");

    await expect(p.chat({ model: "m1", messages })).resolves.toMatchObject({ content: "zero" });
    await expect(p.chat({ model: "m1", messages })).resolves.toMatchObject({ content: "neg" });
    await expect(p.chat({ model: "m1", messages })).resolves.toMatchObject({ content: "string" });
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    const slowPromise = p.chat({ model: "m1", messages });
    let settled = false;
    slowPromise.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(5);

    await vi.advanceTimersByTimeAsync(5);
    await expect(slowPromise).resolves.toMatchObject({ content: "slow" });

    await expect(p.chat({ model: "m1", messages })).rejects.toThrow("boom");

    setTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });

  it("schedules huge delayMs values and resolves with timers", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    const p = new MockProvider({
      behaviors: {
        m1: [{ content: "huge", delayMs: Number.MAX_SAFE_INTEGER }],
      },
    });

    const promise = p.chat({ model: "m1", messages: makeMessages("hi") });
    let settled = false;
    promise.finally(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(Number.MAX_SAFE_INTEGER);

    await vi.runOnlyPendingTimersAsync();
    await expect(promise).resolves.toMatchObject({ content: "huge" });

    setTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });

  it("supports concurrent calls without queue corruption", async () => {
    vi.useFakeTimers();

    const p = new MockProvider({
      behaviors: {
        m1: [
          { content: "first", delayMs: 20 },
          { content: "second", delayMs: 5 },
          { content: "third", delayMs: 0 },
        ],
      },
    });

    const messages = makeMessages("hi");

    const p1 = p.chat({ model: "m1", messages });
    const p2 = p.chat({ model: "m1", messages });
    const p3 = p.chat({ model: "m1", messages });

    expect(p.calls).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(20);
    const results = await Promise.all([p1, p2, p3]);

    expect(results.map((r) => r.content)).toEqual(["first", "second", "third"]);

    vi.useRealTimers();
  });

  it("handles rapid consecutive calls and falls back to default outcome", async () => {
    const p = new MockProvider({
      behaviors: {
        m1: ["a", "b", "c"],
      },
      defaultOutcome: "d",
    });

    const messages = makeMessages("hi");
    const contents = [];
    for (let i = 0; i < 4; i += 1) {
      const out = await p.chat({ model: "m1", messages });
      contents.push(out.content);
    }

    expect(contents).toEqual(["a", "b", "c", "d"]);
    expect(p.calls).toHaveLength(4);
  });

  it("accepts large payloads and deep nested message content", async () => {
    const longText = "x".repeat(200_000);
    const largeFile = "f".repeat(300_000);
    const deepNested = makeDeepObject(50);

    const messages = [
      { role: "user", content: longText },
      { role: "assistant", content: [{ type: "meta", payload: deepNested }] },
    ];

    const p = new MockProvider({
      behaviors: {
        m1: [{ content: "ok" }],
      },
    });

    const out = await p.chat({ model: "m1", messages, images: largeFile });
    expect(out.content).toBe("ok");
    expect(p.calls[0].messages).toBe(messages);
    expect(p.calls[0].images).toBe(largeFile);
  });
});
