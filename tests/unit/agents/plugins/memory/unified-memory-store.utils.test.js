import { describe, it, expect, vi, beforeEach } from "vitest";

let mockPlatformIsBrowser = false;
const estimateTokensCachedMock = vi.fn();
const makeSecureTimestampedIdMock = vi.fn();

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  estimateTokensCached: (...args) => estimateTokensCachedMock(...args),
  makeSecureTimestampedId: (...args) => makeSecureTimestampedIdMock(...args),
  Platform: {
    get isBrowser() {
      return mockPlatformIsBrowser;
    },
  },
}));

async function importUtils({ isBrowser = false } = {}) {
  mockPlatformIsBrowser = isBrowser;
  vi.resetModules();
  return await import(
    "../../../../../js/agents/plugins/memory/unified-memory-store.utils.js"
  );
}

beforeEach(() => {
  mockPlatformIsBrowser = false;
  estimateTokensCachedMock.mockReset();
  makeSecureTimestampedIdMock.mockReset();
});

describe("DEFAULT_CONFIG", () => {
  it("provides expected defaults and is frozen", async () => {
    const { DEFAULT_CONFIG } = await importUtils({ isBrowser: false });

    expect(DEFAULT_CONFIG).toMatchObject({
      maxMessages: 20,
      maxSignals: 50,
      maxDecisions: 30,
      keepLastTurns: 6,
      compressThreshold: 0.8,
      contextWindow: 128000,
    });
    expect(DEFAULT_CONFIG.maxL3Bytes).toBe(Infinity);
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);

    const original = DEFAULT_CONFIG.maxMessages;
    try {
      DEFAULT_CONFIG.maxMessages = 999;
    } catch {}
    expect(DEFAULT_CONFIG.maxMessages).toBe(original);
  });

  it("caps maxL3Bytes to 5GB in browser", async () => {
    const { DEFAULT_CONFIG } = await importUtils({ isBrowser: true });
    expect(DEFAULT_CONFIG.maxL3Bytes).toBe(5 * 1024 * 1024 * 1024);
  });
});

describe("estimateBytes", () => {
  it("returns 0 for nullish values", async () => {
    const { estimateBytes } = await importUtils();
    expect(estimateBytes(null)).toBe(0);
    expect(estimateBytes(undefined)).toBe(0);
  });

  it("estimates primitives (string/number/boolean)", async () => {
    const { estimateBytes } = await importUtils();

    expect(estimateBytes("")).toBe(0);
    expect(estimateBytes("   ")).toBe(6);

    expect(estimateBytes(0)).toBe(8);
    expect(estimateBytes(-1)).toBe(8);
    expect(estimateBytes(Number.MAX_SAFE_INTEGER)).toBe(8);

    expect(estimateBytes(true)).toBe(4);
    expect(estimateBytes(false)).toBe(4);
  });

  it("estimates JSON-serializable objects and arrays", async () => {
    const { estimateBytes } = await importUtils();

    const obj = { a: 1, b: "x" };
    const arr = [1, 2, 3];

    expect(estimateBytes({})).toBe(JSON.stringify({}).length * 2);
    expect(estimateBytes([])).toBe(JSON.stringify([]).length * 2);
    expect(estimateBytes(obj)).toBe(JSON.stringify(obj).length * 2);
    expect(estimateBytes(arr)).toBe(JSON.stringify(arr).length * 2);
  });

  it("handles deep nesting and very long strings", async () => {
    const { estimateBytes } = await importUtils();

    let deep = {};
    let cursor = deep;
    for (let i = 0; i < 200; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    const deepJson = JSON.stringify(deep);
    expect(estimateBytes(deep)).toBe(deepJson.length * 2);

    const huge = "x".repeat(200_000);
    expect(estimateBytes(huge)).toBe(huge.length * 2);
  });

  it("falls back for circular or non-serializable values", async () => {
    const { estimateBytes } = await importUtils();

    const circular = { a: 1 };
    circular.self = circular;
    expect(estimateBytes(circular)).toBe(1024);

    expect(estimateBytes(() => {})).toBe(1024);
    expect(estimateBytes(1n)).toBe(1024);
  });
});

describe("estimateTokensValue", () => {
  it("returns 0 for nullish values without calling counter", async () => {
    const { estimateTokensValue } = await importUtils();

    expect(estimateTokensValue(null)).toBe(0);
    expect(estimateTokensValue(undefined)).toBe(0);
    expect(estimateTokensCachedMock).not.toHaveBeenCalled();
  });

  it("passes through strings to estimateTokensCached", async () => {
    estimateTokensCachedMock.mockReturnValue(42);
    const { estimateTokensValue } = await importUtils();

    const tokenCounter = vi.fn((t) => t.length);
    const result = estimateTokensValue("hello", tokenCounter);

    expect(result).toBe(42);
    expect(estimateTokensCachedMock).toHaveBeenCalledTimes(1);
    expect(estimateTokensCachedMock).toHaveBeenCalledWith("hello", tokenCounter);
  });

  it("JSON-stringifies objects/arrays before counting", async () => {
    estimateTokensCachedMock.mockReturnValue(7);
    const { estimateTokensValue } = await importUtils();

    const input = { a: 1, b: ["x"] };
    const tokenCounter = vi.fn();

    expect(estimateTokensValue(input, tokenCounter)).toBe(7);
    expect(estimateTokensCachedMock).toHaveBeenCalledWith(
      JSON.stringify(input),
      tokenCounter
    );

    estimateTokensCachedMock.mockClear();
    expect(estimateTokensValue([], tokenCounter)).toBe(7);
    expect(estimateTokensCachedMock).toHaveBeenCalledWith("[]", tokenCounter);

    estimateTokensCachedMock.mockClear();
    expect(estimateTokensValue({}, tokenCounter)).toBe(7);
    expect(estimateTokensCachedMock).toHaveBeenCalledWith("{}", tokenCounter);
  });

  it("stringifies numeric boundary inputs", async () => {
    estimateTokensCachedMock.mockReturnValue(1);
    const { estimateTokensValue } = await importUtils();

    expect(estimateTokensValue(0)).toBe(1);
    expect(estimateTokensValue(-1)).toBe(1);
    expect(estimateTokensValue(Number.MAX_SAFE_INTEGER)).toBe(1);

    const calledWith = estimateTokensCachedMock.mock.calls.map(
      ([rawText]) => rawText
    );
    expect(calledWith).toEqual(["0", "-1", String(Number.MAX_SAFE_INTEGER)]);
  });

  it("falls back to String(value) when JSON.stringify throws", async () => {
    estimateTokensCachedMock.mockReturnValue(99);
    const { estimateTokensValue } = await importUtils();

    const circular = {};
    circular.self = circular;

    expect(estimateTokensValue(circular)).toBe(99);
    expect(estimateTokensCachedMock).toHaveBeenCalledWith(
      "[object Object]",
      undefined
    );

    estimateTokensCachedMock.mockClear();
    expect(estimateTokensValue(1n)).toBe(99);
    expect(estimateTokensCachedMock).toHaveBeenCalledWith("1", undefined);
  });

  it("forwards undefined when JSON.stringify returns undefined", async () => {
    estimateTokensCachedMock.mockReturnValue(5);
    const { estimateTokensValue } = await importUtils();

    expect(estimateTokensValue(() => {})).toBe(5);
    expect(estimateTokensCachedMock).toHaveBeenCalledWith(undefined, undefined);
  });

  it("handles rapid concurrent calls deterministically", async () => {
    estimateTokensCachedMock.mockImplementation(
      (rawText) => String(rawText).length
    );
    const { estimateTokensValue } = await importUtils();

    const inputs = Array.from({ length: 25 }, (_, i) => `payload-${i}`);
    const results = await Promise.all(
      inputs.map((t) => Promise.resolve().then(() => estimateTokensValue(t)))
    );

    expect(results).toEqual(inputs.map((t) => t.length));
    expect(estimateTokensCachedMock).toHaveBeenCalledTimes(inputs.length);

    const calledWith = estimateTokensCachedMock.mock.calls.map(
      ([rawText]) => rawText
    );
    for (const t of inputs) {
      expect(calledWith).toContain(t);
    }
  });
});

describe("truncate", () => {
  it("returns input unchanged for nullish/empty/short strings", async () => {
    const { truncate } = await importUtils();

    expect(truncate(null)).toBe(null);
    expect(truncate(undefined)).toBe(undefined);
    expect(truncate("")).toBe("");
    expect(truncate("   ")).toBe("   ");

    expect(truncate("hello", 5)).toBe("hello");
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello", Number.MAX_SAFE_INTEGER)).toBe("hello");
  });

  it("truncates long strings and appends ellipsis", async () => {
    const { truncate } = await importUtils();

    expect(truncate("123456", 5)).toBe("12...");
    expect(truncate("123456", 6)).toBe("123456");

    const long = "x".repeat(10_000);
    const out = truncate(long, 200);

    expect(out).toHaveLength(200);
    expect(out.endsWith("...")).toBe(true);
    expect(out.startsWith("x".repeat(197))).toBe(true);
  });

  it("handles small or negative maxLen without throwing", async () => {
    const { truncate } = await importUtils();

    const input = "abcdef";
    for (const maxLen of [3, 2, 1, 0, -1]) {
      const out = truncate(input, maxLen);
      expect(typeof out).toBe("string");
      expect(out.endsWith("...")).toBe(true);
    }
  });

  it("is safe under rapid concurrent calls", async () => {
    const { truncate } = await importUtils();

    const inputs = Array.from({ length: 30 }, (_, i) => "x".repeat(500 + i));
    const outputs = await Promise.all(
      inputs.map((s) => Promise.resolve().then(() => truncate(s, 100)))
    );

    for (const out of outputs) {
      expect(out).toHaveLength(100);
      expect(out.endsWith("...")).toBe(true);
    }
  });
});

describe("genId", () => {
  it("delegates to makeSecureTimestampedId with default prefix", async () => {
    makeSecureTimestampedIdMock.mockImplementation((prefix) => `${prefix}-mock`);
    const { genId } = await importUtils();

    expect(genId()).toBe("id-mock");
    expect(makeSecureTimestampedIdMock).toHaveBeenCalledTimes(1);
    expect(makeSecureTimestampedIdMock).toHaveBeenCalledWith("id");
  });

  it("forwards the provided prefix verbatim (type boundary)", async () => {
    makeSecureTimestampedIdMock.mockImplementation((prefix) => prefix);
    const { genId } = await importUtils();

    expect(genId("mem")).toBe("mem");
    expect(genId(123)).toBe(123);

    expect(makeSecureTimestampedIdMock).toHaveBeenNthCalledWith(1, "mem");
    expect(makeSecureTimestampedIdMock).toHaveBeenNthCalledWith(2, 123);
  });

  it("handles rapid concurrent calls", async () => {
    let counter = 0;
    makeSecureTimestampedIdMock.mockImplementation(
      (prefix) => `${prefix}-${(counter += 1)}`
    );
    const { genId } = await importUtils();

    const ids = await Promise.all(
      Array.from({ length: 50 }, () =>
        Promise.resolve().then(() => genId("g"))
      )
    );

    expect(ids).toHaveLength(50);
    expect(new Set(ids).size).toBe(50);
    expect(makeSecureTimestampedIdMock).toHaveBeenCalledTimes(50);
    for (const id of ids) {
      expect(id.startsWith("g-")).toBe(true);
    }
  });
});

describe("isFiniteNumber", () => {
  it("returns true only for finite numbers", async () => {
    const { isFiniteNumber } = await importUtils();

    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-1)).toBe(true);
    expect(isFiniteNumber(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isFiniteNumber(123.456)).toBe(true);

    expect(isFiniteNumber(NaN)).toBe(false);
    expect(isFiniteNumber(Infinity)).toBe(false);
    expect(isFiniteNumber(-Infinity)).toBe(false);

    expect(isFiniteNumber(null)).toBe(false);
    expect(isFiniteNumber(undefined)).toBe(false);
    expect(isFiniteNumber("0")).toBe(false);
    expect(isFiniteNumber("123")).toBe(false);
    expect(isFiniteNumber(new Number(1))).toBe(false);
    expect(isFiniteNumber([])).toBe(false);
    expect(isFiniteNumber({})).toBe(false);
  });

  it("is stable under rapid mixed inputs", async () => {
    const { isFiniteNumber } = await importUtils();

    const inputs = [0, 1, -1, NaN, Infinity, "1", {}, Number.MAX_SAFE_INTEGER];
    const results = await Promise.all(
      inputs.map((v) => Promise.resolve().then(() => isFiniteNumber(v)))
    );

    expect(results).toEqual([true, true, true, false, false, false, false, true]);
  });
});