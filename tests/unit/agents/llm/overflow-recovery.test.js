import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../js/agents/shared/index.js", () => ({
  toNonEmptyString: vi.fn((value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  }),
}));

import { toNonEmptyString } from "../../../../js/agents/shared/index.js";
import {
  computeOverflowRetryMaxTokens,
  executeWithOverflowRecovery,
  parseContextOverflowError,
} from "../../../../js/agents/llm/overflow-recovery.js";

const makeOpenAiError = (limit, requested, messages, completion) =>
  new Error(
    `This model's maximum context length is ${limit} tokens. However, you requested ${requested} tokens (${messages} in the messages, ${completion} in the completion).`
  );

const makeAnthropicError = (inputLength, maxTokens, limit) =>
  new Error(`input length and \`max_tokens\` exceed context limit: ${inputLength} + ${maxTokens} > ${limit}`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseContextOverflowError", () => {
  it("parses Anthropic-style context overflow errors", () => {
    const message = "input length and `max_tokens` exceed context limit: 100000 + 4096 > 100000";
    const err = new Error(message);

    expect(parseContextOverflowError(err)).toEqual({
      inputLength: 100000,
      maxTokens: 4096,
      contextLimit: 100000,
      provider: "anthropic",
    });
    expect(toNonEmptyString).toHaveBeenCalledWith(message);
  });

  it("parses OpenAI-style context overflow errors (full variant)", () => {
    const err = makeOpenAiError(8192, 9000, 8000, 1000);
    expect(parseContextOverflowError(err)).toEqual({
      inputLength: 8000,
      maxTokens: 1000,
      contextLimit: 8192,
      provider: "openai",
    });
  });

  it("parses relaxed OpenAI variants with boundary limits", () => {
    const limits = [0, Number.MAX_SAFE_INTEGER];

    for (const limit of limits) {
      const err = new Error(`maximum context length is ${limit} tokens`);
      expect(parseContextOverflowError(err)).toEqual({
        inputLength: 0,
        maxTokens: 0,
        contextLimit: limit,
        provider: "openai",
      });
    }
  });

  it("extracts nested messages and handles long/deep strings", () => {
    const cases = [
      {
        err: { response: { data: { error: { message: "  maximum context length is 2048 tokens  " } } } },
        limit: 2048,
      },
      { err: { response: { data: { message: "maximum context length is 1024 tokens" } } }, limit: 1024 },
      { err: { data: { error: { message: "maximum context length is 512 tokens" } } }, limit: 512 },
      { err: { data: { message: "maximum context length is 256 tokens" } }, limit: 256 },
      { err: { error: { message: "maximum context length is 128 tokens" } }, limit: 128 },
    ];

    for (const { err, limit } of cases) {
      expect(parseContextOverflowError(err)).toMatchObject({ contextLimit: limit, provider: "openai" });
    }

    const longMessage = `${"x".repeat(5000)} maximum context length is 9999 tokens`;
    const deepErr = {
      response: {
        data: {
          error: { message: longMessage },
          extra: { nested: { more: { levels: { ok: true } } } },
        },
      },
    };

    expect(parseContextOverflowError(deepErr)).toMatchObject({ contextLimit: 9999, provider: "openai" });
  });

  it("returns null for empty or non-matching inputs", () => {
    const hugeNumber = "9".repeat(400);
    const inputs = [
      null,
      undefined,
      "",
      "   ",
      [],
      {},
      { message: "" },
      { message: "   " },
      { message: [] },
      { message: 12345 },
      { message: "maximum context length is -1 tokens" },
      { message: `maximum context length is ${hugeNumber} tokens` },
    ];

    for (const input of inputs) {
      expect(parseContextOverflowError(input)).toBe(null);
    }
  });
});

describe("computeOverflowRetryMaxTokens", () => {
  it("computes available tokens with buffer and min floor", () => {
    const out = computeOverflowRetryMaxTokens(
      { inputLength: 900, maxTokens: 300, contextLimit: 1000 },
      { minTokens: 1, bufferTokens: 50.9 }
    );

    expect(out).toBe(50);
  });

  it("returns min when available falls below minTokens", () => {
    const out = computeOverflowRetryMaxTokens(
      { inputLength: 900, maxTokens: 300, contextLimit: 1000 },
      { minTokens: 256, bufferTokens: 128 }
    );

    expect(out).toBe(256);
  });

  it("returns min when input length is missing or <= 0", () => {
    const cases = [
      { inputLength: 0, maxTokens: 0, contextLimit: 1000 },
      { inputLength: -1, maxTokens: 0, contextLimit: 1000 },
      { maxTokens: 0, contextLimit: 1000 },
      { inputLength: " ", maxTokens: 0, contextLimit: 1000 },
    ];

    for (const info of cases) {
      expect(computeOverflowRetryMaxTokens(info)).toBe(256);
    }
  });

  it("clamps options and accepts numeric strings", () => {
    const out = computeOverflowRetryMaxTokens(
      { inputLength: "900", maxTokens: "300", contextLimit: "1000" },
      { minTokens: -5, bufferTokens: -10 }
    );

    expect(out).toBe(100);
  });

  it("returns null for invalid limits or array info", () => {
    const cases = [
      { inputLength: 1, maxTokens: 1, contextLimit: 0 },
      { inputLength: 1, maxTokens: 1, contextLimit: -1 },
      { inputLength: 1, maxTokens: 1, contextLimit: Number.NaN },
      { inputLength: 1, maxTokens: 1, contextLimit: Infinity },
      { inputLength: 1, maxTokens: 1, contextLimit: "nope" },
      null,
      {},
      [],
    ];

    for (const info of cases) {
      expect(computeOverflowRetryMaxTokens(info)).toBe(null);
    }
  });

  it("supports MAX_SAFE_INTEGER limits", () => {
    const limit = Number.MAX_SAFE_INTEGER;
    const out = computeOverflowRetryMaxTokens(
      { inputLength: 1, maxTokens: 0, contextLimit: limit },
      { minTokens: 1, bufferTokens: 0 }
    );

    expect(out).toBe(limit - 1);
  });
});

describe("executeWithOverflowRecovery", () => {
  it("returns result on first attempt and floors initialMaxTokens", async () => {
    const fn = vi.fn(async (maxTokens) => maxTokens);

    const result = await executeWithOverflowRecovery(fn, { initialMaxTokens: 10.9, maxRetries: 2 });

    expect(result).toBe(10);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(10);
  });

  it("retries on context overflow and calls onOverflow", async () => {
    const overflowErr = makeOpenAiError(1000, 1200, 900, 300);

    const fn = vi.fn(async (maxTokens) => {
      if (fn.mock.calls.length === 1) throw overflowErr;
      return { ok: true, maxTokens };
    });

    const onOverflow = vi.fn(async () => {});

    const out = await executeWithOverflowRecovery(fn, {
      initialMaxTokens: 500,
      maxRetries: 2,
      onOverflow,
    });

    expect(out).toEqual({ ok: true, maxTokens: 256 });
    expect(fn.mock.calls.map((call) => call[0])).toEqual([500, 256]);
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(onOverflow.mock.calls[0][0]).toMatchObject({
      attempt: 1,
      nextMaxTokens: 256,
      info: { contextLimit: 1000, inputLength: 900, maxTokens: 300, provider: "openai" },
    });
  });

  it("resumes from archived in-progress retry state", async () => {
    let snapshot = {
      nodeStates: {
        overflowRecovery: {
          version: 1,
          inProgress: true,
          attempt: 1,
          currentMaxTokens: 333,
          updatedAt: Date.now(),
        },
      },
    };

    const archive = {
      load: vi.fn(async () => snapshot),
      save: vi.fn(async (_runId, payload) => {
        snapshot = payload;
      }),
    };

    const fn = vi.fn(async (maxTokens) => maxTokens);
    const out = await executeWithOverflowRecovery(fn, {
      initialMaxTokens: 500,
      maxRetries: 2,
      archive,
      archiveKey: "overflow:case1",
    });

    expect(out).toBe(333);
    expect(fn.mock.calls.map((call) => call[0])).toEqual([333]);
    expect(archive.load).toHaveBeenCalledWith("overflow:case1");
    expect(archive.save).toHaveBeenCalled();
    const lastCall = archive.save.mock.calls[archive.save.mock.calls.length - 1];
    expect(lastCall[0]).toBe("overflow:case1");
    expect(lastCall[1]).toMatchObject({
      nodeStates: {
        overflowRecovery: {
          inProgress: false,
          attempt: 0,
          currentMaxTokens: 333,
        },
      },
    });
  });

  it("persists retry state when overflow happens and clears it after success", async () => {
    const store = new Map();
    const archive = {
      get: vi.fn(async (key) => store.get(key) ?? null),
      set: vi.fn(async (key, value) => {
        store.set(key, value);
      }),
      delete: vi.fn(async (key) => {
        store.delete(key);
      }),
    };

    const overflowErr = makeOpenAiError(1000, 1200, 900, 300);
    const fn = vi.fn(async (maxTokens) => {
      if (fn.mock.calls.length === 1) throw overflowErr;
      return maxTokens;
    });

    const out = await executeWithOverflowRecovery(fn, {
      initialMaxTokens: 600,
      maxRetries: 1,
      archive,
      archiveKey: "overflow:case2",
    });

    expect(out).toBe(256);
    expect(archive.set).toHaveBeenCalledWith(
      "overflow:case2",
      expect.objectContaining({
        inProgress: true,
        attempt: 1,
        currentMaxTokens: 256,
      })
    );
    expect(archive.delete).toHaveBeenCalledWith("overflow:case2");
    expect(store.has("overflow:case2")).toBe(false);
  });

  it("tolerates archive read/write failures", async () => {
    const archive = {
      load: vi.fn(async () => {
        throw new Error("load failed");
      }),
      save: vi.fn(async () => {
        throw new Error("save failed");
      }),
    };

    const overflowErr = makeOpenAiError(1000, 1200, 900, 300);
    const fn = vi.fn(async (maxTokens) => {
      if (fn.mock.calls.length === 1) throw overflowErr;
      return maxTokens;
    });

    const out = await executeWithOverflowRecovery(fn, {
      initialMaxTokens: 500,
      maxRetries: 1,
      archive,
      archiveKey: "overflow:case3",
    });

    expect(out).toBe(256);
    expect(fn.mock.calls.map((call) => call[0])).toEqual([500, 256]);
  });

  it("ensures progress when computed nextMaxTokens would not reduce", async () => {
    const overflowErr = new Error("maximum context length is 8192 tokens");

    const fn = vi.fn(async (maxTokens) => {
      if (fn.mock.calls.length === 1) throw overflowErr;
      return maxTokens;
    });

    const out = await executeWithOverflowRecovery(fn, { initialMaxTokens: 200, maxRetries: 1 });

    expect(out).toBe(150);
    expect(fn.mock.calls.map((call) => call[0])).toEqual([200, 150]);
  });

  it("falls back to proportional reduction when computed nextMaxTokens is null", async () => {
    const overflowErr = new Error("maximum context length is 0 tokens");

    const fn = vi.fn(async (maxTokens) => {
      if (fn.mock.calls.length === 1) throw overflowErr;
      return maxTokens;
    });

    const out = await executeWithOverflowRecovery(fn, { initialMaxTokens: 1000, maxRetries: 1 });

    expect(out).toBe(750);
    expect(fn.mock.calls.map((call) => call[0])).toEqual([1000, 750]);
  });

  it("does not retry non-overflow errors", async () => {
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(executeWithOverflowRecovery(fn, { initialMaxTokens: 100, maxRetries: 3 })).rejects.toThrow(/boom/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rethrows after exhausting retries on overflow", async () => {
    const overflowErr = new Error("maximum context length is 4096 tokens");
    const fn = vi.fn(async () => {
      throw overflowErr;
    });

    await expect(executeWithOverflowRecovery(fn, { initialMaxTokens: 1000, maxRetries: 1 })).rejects.toThrow(/maximum context length/);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("uses defaults for empty or non-finite options", async () => {
    const fn1 = vi.fn(async (maxTokens) => maxTokens);
    const out1 = await executeWithOverflowRecovery(fn1, {});

    const fn2 = vi.fn(async (maxTokens) => maxTokens);
    // @ts-expect-error: invalid input for test
    const out2 = await executeWithOverflowRecovery(fn2, []);

    const fn3 = vi.fn(async (maxTokens) => maxTokens);
    // @ts-expect-error: invalid input for test
    const out3 = await executeWithOverflowRecovery(fn3, { initialMaxTokens: "300" });

    const fn4 = vi.fn(async (maxTokens) => maxTokens);
    // @ts-expect-error: invalid input for test
    const out4 = await executeWithOverflowRecovery(fn4, { initialMaxTokens: "nope" });

    expect(out1).toBe(1024);
    expect(out2).toBe(1024);
    expect(out3).toBe(300);
    expect(out4).toBe(1024);
  });

  it("handles concurrent calls without shared state", async () => {
    const errA = makeOpenAiError(1000, 1200, 900, 300);
    const errB = makeAnthropicError(2000, 500, 2000);

    const fnA = vi.fn(async (maxTokens) => {
      if (fnA.mock.calls.length === 1) throw errA;
      return { label: "a", maxTokens };
    });

    const fnB = vi.fn(async (maxTokens) => {
      if (fnB.mock.calls.length === 1) throw errB;
      return { label: "b", maxTokens };
    });

    const [outA, outB] = await Promise.all([
      executeWithOverflowRecovery(fnA, { initialMaxTokens: 600, maxRetries: 1 }),
      executeWithOverflowRecovery(fnB, { initialMaxTokens: 800, maxRetries: 1, minTokens: 10, bufferTokens: 50 }),
    ]);

    expect(outA).toEqual({ label: "a", maxTokens: 256 });
    expect(outB).toEqual({ label: "b", maxTokens: 10 });
    expect(fnA.mock.calls.map((call) => call[0])).toEqual([600, 256]);
    expect(fnB.mock.calls.map((call) => call[0])).toEqual([800, 10]);
  });

  it("supports rapid sequential calls", async () => {
    const makeFn = () => {
      const overflowErr = new Error("maximum context length is 1000 tokens");
      let called = false;
      return vi.fn(async (maxTokens) => {
        if (!called) {
          called = true;
          throw overflowErr;
        }
        return maxTokens;
      });
    };

    const fn1 = makeFn();
    const out1 = await executeWithOverflowRecovery(fn1, { initialMaxTokens: 400, maxRetries: 1 });

    const fn2 = makeFn();
    const out2 = await executeWithOverflowRecovery(fn2, { initialMaxTokens: 200, maxRetries: 1 });

    expect(out1).toBe(256);
    expect(out2).toBe(150);
    expect(fn1.mock.calls.map((call) => call[0])).toEqual([400, 256]);
    expect(fn2.mock.calls.map((call) => call[0])).toEqual([200, 150]);
  });
});
