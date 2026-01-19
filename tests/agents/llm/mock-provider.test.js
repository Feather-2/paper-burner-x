import { afterEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "../../../js/agents/llm/mock-provider.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("agents/llm/mock-provider", () => {
  it("setBehaviors()/pushOutcome() validate model id", () => {
    const p = new MockProvider();
    expect(() => p.setBehaviors("", [{ content: "x" }])).toThrow(/modelId must be a non-empty string/i);
    expect(() => p.pushOutcome("   ", { content: "x" })).toThrow(/modelId must be a non-empty string/i);
  });

  it("chat() validates inputs and records calls", async () => {
    const p = new MockProvider({ behaviors: { m1: [{ content: "ok" }] } });

    // model must be non-empty.
    // @ts-expect-error: invalid input for test
    await expect(p.chat({ model: "", messages: [] })).rejects.toThrow(/model must be a non-empty string/i);

    // messages must satisfy assertChatMessages
    // @ts-expect-error: invalid input for test
    await expect(p.chat({ model: "m1", messages: "nope" })).rejects.toThrow(/messages must be an array/i);

    const out = await p.chat({ model: "m1", messages: [{ role: "user", content: "hi" }] });
    expect(out).toMatchObject({ content: "ok", model: "m1", provider: "mock" });
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]).toMatchObject({ model: "m1" });
  });

  it("supports function outcomes (ctx.callIndex) and wildcard behaviors", async () => {
    const p = new MockProvider({
      behaviors: {
        "*": [
          ({ model, callIndex }) => ({ content: `${model}-${callIndex}` }),
          { content: "second" },
        ],
      },
      defaultOutcome: { content: "default" },
    });

    const out1 = await p.chat({ model: "mX", messages: [{ role: "user", content: "hi" }] });
    const out2 = await p.chat({ model: "mX", messages: [{ role: "user", content: "hi2" }] });
    const out3 = await p.chat({ model: "mX", messages: [{ role: "user", content: "hi3" }] });

    expect(out1.content).toBe("mX-0");
    expect(out2.content).toBe("second");
    expect(out3.content).toBe("default");
  });

  it("supports delayMs and throws on outcome.throw", async () => {
    vi.useFakeTimers();

    const p = new MockProvider({
      behaviors: {
        m1: [{ content: "slow", delayMs: 50 }, { throw: "boom" }],
      },
    });

    const slow = p.chat({ model: "m1", messages: [{ role: "user", content: "hi" }] });
    await vi.advanceTimersByTimeAsync(49);
    let settled = false;
    slow.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(slow).resolves.toMatchObject({ content: "slow" });

    await expect(p.chat({ model: "m1", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/boom/);
  });

  it("normalizes non-object outcomes and pushOutcome() initializes missing queues", async () => {
    const p = new MockProvider({ defaultOutcome: 123 });
    // No behaviors configured => uses defaultOutcome, which should be normalized via String().
    const out1 = await p.chat({ model: "m1", messages: [{ role: "user", content: "x" }] });
    expect(out1.content).toBe("123");

    // pushOutcome() should work even when the model has no existing queue.
    p.pushOutcome("newModel", 42);
    const out2 = await p.chat({ model: "newModel", messages: [{ role: "user", content: "x" }] });
    expect(out2.content).toBe("42");
  });

  it("call() aliases chat() (BaseProvider unified entrypoint)", async () => {
    const p = new MockProvider({ behaviors: { m1: [{ content: "ok" }] } });
    const out = await p.call({ model: "m1", messages: [{ role: "user", content: "hi" }] });
    expect(out.content).toBe("ok");
  });
});
