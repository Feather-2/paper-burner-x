import { afterEach, describe, expect, it, vi } from "vitest";

import { computeOverflowRetryMaxTokens, executeWithOverflowRecovery, parseContextOverflowError } from '../../../../js/agents/llm/overflow-recovery.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agents/llm/overflow-recovery", () => {
  it("parses Anthropic-style context overflow errors", () => {
    const err = new Error("input length and `max_tokens` exceed context limit: 100000 + 4096 > 100000");
    expect(parseContextOverflowError(err)).toEqual({
      inputLength: 100000,
      maxTokens: 4096,
      contextLimit: 100000,
      provider: "anthropic",
    });
  });

  it("parses OpenAI-style context overflow errors (full + relaxed variants)", () => {
    const full = new Error(
      "This model's maximum context length is 8192 tokens. However, you requested 9000 tokens (8000 in the messages, 1000 in the completion)."
    );
    expect(parseContextOverflowError(full)).toEqual({
      inputLength: 8000,
      maxTokens: 1000,
      contextLimit: 8192,
      provider: "openai",
    });

    const relaxed = new Error("maximum context length is 4096 tokens");
    expect(parseContextOverflowError(relaxed)).toEqual({
      inputLength: 0,
      maxTokens: 0,
      contextLimit: 4096,
      provider: "openai",
    });
  });

  it("extracts nested error message shapes (response.data.error.message)", () => {
    const err = {
      response: { data: { error: { message: "maximum context length is 2048 tokens" } } },
    };
    expect(parseContextOverflowError(err)).toMatchObject({ contextLimit: 2048, provider: "openai" });
  });

  it("computes retry maxTokens from overflow info (min + buffer semantics)", () => {
    expect(computeOverflowRetryMaxTokens({ inputLength: 900, maxTokens: 300, contextLimit: 1000 }, { minTokens: 1, bufferTokens: 50 })).toBe(
      50
    );

    // Available < minTokens => return minTokens.
    expect(computeOverflowRetryMaxTokens({ inputLength: 900, maxTokens: 300, contextLimit: 1000 }, { minTokens: 256, bufferTokens: 128 })).toBe(
      256
    );

    // Unknown input length => conservative minTokens.
    expect(computeOverflowRetryMaxTokens({ inputLength: 0, maxTokens: 0, contextLimit: 8192 })).toBe(256);

    // Invalid limit => null.
    // @ts-expect-error: invalid input for test
    expect(computeOverflowRetryMaxTokens({ inputLength: 1, maxTokens: 1, contextLimit: 0 })).toBe(null);
  });

  it("retries on context overflow with reduced maxTokens and calls onOverflow()", async () => {
    const overflowErr = new Error(
      "This model's maximum context length is 1000 tokens. However, you requested 1200 tokens (900 in the messages, 300 in the completion)."
    );

    const fn = vi.fn(async (maxTokens) => {
      if (fn.mock.calls.length === 1) throw overflowErr;
      return { ok: true, maxTokens };
    });

    const onOverflow = vi.fn();

    const out = await executeWithOverflowRecovery(fn, {
      initialMaxTokens: 500,
      maxRetries: 2,
      onOverflow,
    });

    expect(out).toEqual({ ok: true, maxTokens: 256 });
    expect(fn.mock.calls.map((c) => c[0])).toEqual([500, 256]);
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(onOverflow.mock.calls[0][0]).toMatchObject({
      attempt: 1,
      nextMaxTokens: 256,
      info: { contextLimit: 1000, inputLength: 900, maxTokens: 300, provider: "openai" },
    });
  });

  it("ensures progress even when computed nextMaxTokens would not reduce", async () => {
    const overflowErr = new Error("maximum context length is 8192 tokens");

    const fn = vi.fn(async (maxTokens) => {
      if (fn.mock.calls.length === 1) throw overflowErr;
      return maxTokens;
    });

    const out = await executeWithOverflowRecovery(fn, { initialMaxTokens: 200, maxRetries: 2 });
    expect(out).toBe(150);
    expect(fn.mock.calls.map((c) => c[0])).toEqual([200, 150]);
  });

  it("does not retry non-overflow errors and rethrows after exhausting retries", async () => {
    const fn1 = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(executeWithOverflowRecovery(fn1, { initialMaxTokens: 100, maxRetries: 3 })).rejects.toThrow(/boom/);
    expect(fn1).toHaveBeenCalledTimes(1);

    const overflowErr = new Error("maximum context length is 4096 tokens");
    const fn2 = vi.fn(async () => {
      throw overflowErr;
    });
    await expect(executeWithOverflowRecovery(fn2, { initialMaxTokens: 1000, maxRetries: 1 })).rejects.toThrow(/maximum context length/);
    expect(fn2).toHaveBeenCalledTimes(2);
  });

  it("covers additional branches: empty messages, option coercion, and null computed nextMaxTokens", async () => {
    expect(parseContextOverflowError({})).toBe(null);

    // Exercise alternative nested message extraction paths.
    expect(parseContextOverflowError({ response: { data: { message: "maximum context length is 1024 tokens" } } })).toMatchObject({
      contextLimit: 1024,
    });
    expect(parseContextOverflowError({ data: { error: { message: "maximum context length is 512 tokens" } } })).toMatchObject({ contextLimit: 512 });
    expect(parseContextOverflowError({ error: { message: "maximum context length is 256 tokens" } })).toMatchObject({ contextLimit: 256 });

    // minTokens/bufferTokens coercion branches.
    expect(computeOverflowRetryMaxTokens({ inputLength: 0, maxTokens: 0, contextLimit: 100 }, { minTokens: Number.NaN, bufferTokens: Number.NaN })).toBe(256);

    // Force computeOverflowRetryMaxTokens() to return null inside executeWithOverflowRecovery():
    // parseContextOverflowError() accepts `contextLimit=0` (finite), but compute rejects non-positive limits.
    const overflowErr = new Error("maximum context length is 0 tokens");
    const fn = vi.fn(async (maxTokens) => {
      if (fn.mock.calls.length === 1) throw overflowErr;
      return maxTokens;
    });

    const out = await executeWithOverflowRecovery(fn, {
      // Non-finite values should be sanitized by executeWithOverflowRecovery.
      // @ts-expect-error: invalid input for test
      initialMaxTokens: "nope",
      // @ts-expect-error: invalid input for test
      maxRetries: "nope",
      // Not a function => ignored.
      // @ts-expect-error: invalid input for test
      onOverflow: "nope",
    });

    // initialMaxTokens defaults to 1024, and with null next => fallback uses 0.75 reduction.
    expect(out).toBe(768);
    expect(fn.mock.calls.map((c) => c[0])).toEqual([1024, 768]);
  });
});
