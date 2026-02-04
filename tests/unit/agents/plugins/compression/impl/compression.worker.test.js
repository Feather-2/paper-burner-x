import { describe, it, expect, vi, beforeEach } from "vitest";

const MODULE_PATH = "../../../../../../js/agents/plugins/compression/impl/compression.worker.js";
const SHARED_PATH = vi.hoisted(() => "../../../../../../js/agents/shared/index.js");
const RPC_PATH = vi.hoisted(() => "../../../../../../js/agents/runtime/core/worker-rpc.js");

function isPlainObjectImpl(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

vi.mock(SHARED_PATH, () => ({
  isPlainObject: vi.fn(isPlainObjectImpl),
}));

vi.mock(RPC_PATH, () => ({
  createRpcHandler: vi.fn(() => {
    const handler = vi.fn();
    handler.handle = handler;
    handler.start = vi.fn();
    return handler;
  }),
}));

// Provide minimal Worker-ish globals for Node test env
if (!("self" in globalThis)) {
  Object.defineProperty(globalThis, "self", {
    value: globalThis,
    writable: true,
    configurable: true,
  });
}
if (typeof globalThis.addEventListener !== "function") {
  Object.defineProperty(globalThis, "addEventListener", {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
}
if (typeof globalThis.removeEventListener !== "function") {
  Object.defineProperty(globalThis, "removeEventListener", {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
}
if (typeof globalThis.postMessage !== "function") {
  Object.defineProperty(globalThis, "postMessage", {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
}

async function importWorkerFresh() {
  vi.resetModules();
  return await import(MODULE_PATH);
}

async function importMocks() {
  const shared = await import(SHARED_PATH);
  const rpc = await import(RPC_PATH);
  return {
    isPlainObject: vi.mocked(shared.isPlainObject),
    createRpcHandler: vi.mocked(rpc.createRpcHandler),
  };
}

async function outcomeOf(fn, args) {
  try {
    const value = fn(...args);
    const awaited = value && typeof value.then === "function" ? await value : value;
    return { ok: true, value: awaited };
  } catch (error) {
    return { ok: false, error };
  }
}

const initialModule = await import(MODULE_PATH);
const EXPORT_NAMES = Object.keys(initialModule);

describe("compression.worker module init", () => {
  it("wires WorkerRpc via createRpcHandler on import", async () => {
    await importWorkerFresh();
    const { createRpcHandler } = await importMocks();

    expect(createRpcHandler).toHaveBeenCalled();

    const call = createRpcHandler.mock.calls[0] ?? [];
    const candidateObjects = call.filter((arg) => arg && typeof arg === "object" && !Array.isArray(arg));
    const handlers = candidateObjects.find((obj) => {
      const keys = Object.keys(obj);
      if (keys.length === 0 || keys.length > 25) return false;
      return Object.values(obj).some((v) => typeof v === "function");
    });

    expect(handlers).toBeTruthy();
  });
});

describe.each(EXPORT_NAMES)("export: %s", (exportName) => {
  let mod;
  let exported;

  beforeEach(async () => {
    mod = await importWorkerFresh();
    exported = mod[exportName];
  });

  it("is defined", () => {
    expect(exported).not.toBeUndefined();
  });

  if (exportName === "containsCjk") {
    it("detects CJK characters", () => {
      expect(exported("hello")).toBe(false);
      expect(exported("你好")).toBe(true);
      expect(exported("test你好world")).toBe(true);
      expect(exported("カタカナ")).toBe(false);
    });

    it("handles nullish/empty and non-string inputs", () => {
      expect(exported(null)).toBe(false);
      expect(exported(undefined)).toBe(false);
      expect(exported("")).toBe(false);
      expect(exported("   ")).toBe(false);
      expect(exported(0)).toBe(false);
      expect(exported(123)).toBe(false);
      expect(exported({})).toBe(false);
    });

    it("supports huge input and rapid repeated calls", async () => {
      const huge = "a".repeat(200_000) + "中" + "b".repeat(50_000);
      const results = await Promise.all(Array.from({ length: 40 }, () => Promise.resolve(exported(huge))));
      expect(results.every((v) => v === true)).toBe(true);
    });
  } else if (exportName === "normalizeSummaryText") {
    it("collapses whitespace and trims", () => {
      expect(exported("  a\t\tb \n c  ")).toBe("a b c");
      expect(exported("one   two")).toBe("one two");
      expect(exported("\n\nx\r\n")).toBe("x");
    });

    it("handles nullish and falsy edge inputs", () => {
      expect(exported(null)).toBe("");
      expect(exported(undefined)).toBe("");
      expect(exported("")).toBe("");
      expect(exported(0)).toBe("");
      expect(exported(NaN)).toBe("");
      expect(exported(false)).toBe("");
      expect(exported(123)).toBe("123");
      expect(exported("   ")).toBe("");
    });

    it("supports huge input and concurrent calls", async () => {
      const huge = `  ${"x".repeat(150_000)}   ${"y".repeat(50_000)}  `;
      const results = await Promise.all(Array.from({ length: 20 }, () => Promise.resolve(exported(huge))));
      expect(results[0]).toBe(results[1]);
      expect(results[0].startsWith("x")).toBe(true);
      expect(results[0].includes(" ")).toBe(true);
    });
  } else if (exportName === "toTitle") {
    it("returns empty string for empty/whitespace-only input", () => {
      expect(exported("")).toBe("");
      expect(exported("   ")).toBe("");
      expect(exported(null)).toBe("");
      expect(exported(undefined)).toBe("");
    });

    it("generates word-based titles for non-CJK text (default limits)", () => {
      const text = "one two   three\nfour five six seven eight nine ten eleven";
      expect(exported(text)).toBe("one two three four five six seven eight nine ten...");
    });

    it("clamps maxWords to >= 1 and truncates with ellipsis", () => {
      expect(exported("one two three", { maxWords: 0 })).toBe("one...");
      expect(exported("one two three", { maxWords: -1 })).toBe("one...");
    });

    it("applies maxChars (and may exceed by 3 due to ellipsis)", () => {
      const longOneWord =
        "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz";
      expect(exported(longOneWord, { maxWords: 50, maxChars: 20 })).toBe(longOneWord.slice(0, 20) + "...");
    });

    it("treats numeric-string options as numbers (via Number())", () => {
      expect(exported("one two three", { maxWords: "2", maxChars: "11" })).toBe("one two...");
    });

    it("uses character-based clipping for CJK text", () => {
      const cjk = "这是一个很长的中文标题用于测试截断逻辑";
      // maxChars is clamped to >= 10 in implementation
      const out = exported(cjk, { maxChars: 5 });
      expect(out.startsWith(cjk.slice(0, 10))).toBe(true);
      expect(out.endsWith("...")).toBe(true);
    });

    it("supports rapid repeated calls (concurrency boundary)", async () => {
      const text = "one two three four five six seven eight nine ten eleven twelve";
      const results = await Promise.all(
        Array.from({ length: 25 }, () => Promise.resolve(exported(text, { maxWords: 5, maxChars: 30 }))),
      );
      expect(results.every((v) => v === results[0])).toBe(true);
    });
  } else if (exportName === "truncateText") {
    it("returns empty string for non-string input", () => {
      expect(exported(null, 10)).toBe("");
      expect(exported(undefined, 10)).toBe("");
      expect(exported(123, 10)).toBe("");
      expect(exported({ text: "hi" }, 10)).toBe("");
    });

    it("returns original string when within limit", () => {
      expect(exported("abc", 3)).toBe("abc");
      expect(exported("abc", 10)).toBe("abc");
      expect(exported("abc", Number.MAX_SAFE_INTEGER)).toBe("abc");
    });

    it("uses slice when maxChars <= 3 (including 0 and negatives)", () => {
      expect(exported("abcdefghij", 3)).toBe("abc");
      expect(exported("abcdefghij", 0)).toBe("");
      expect(exported("abcdefghij", -1)).toBe("abcdefghi");
    });

    it("uses head/tail with ellipsis for typical truncation", () => {
      expect(exported("abcdefghij", 9)).toBe("abcde...j");
      expect(exported("abcdefghij", 6)).toBe("abc...");
    });

    it("exhibits current behavior for small maxChars > 3 (can exceed maxChars)", () => {
      expect(exported("abcdefghij", 4)).toBe("ab...");
      expect(exported("abcdefghij", 5)).toBe("abc...");
    });

    it("handles huge strings without throwing (resource boundary)", () => {
      const huge = "x".repeat(250_000) + "TAIL";
      const out = exported(huge, 50);
      expect(out.includes("...")).toBe(true);
      expect(out.startsWith("x")).toBe(true);
      expect(out.endsWith("TAIL")).toBe(true);
    });

    it("supports rapid repeated calls (concurrency boundary)", async () => {
      const text = "a".repeat(10_000) + "END";
      const results = await Promise.all(Array.from({ length: 30 }, () => Promise.resolve(exported(text, 100))));
      expect(results.every((v) => v === results[0])).toBe(true);
    });
  } else if (exportName === "isThinkingMessage") {
    it("returns false for non-objects and empty content", () => {
      expect(exported(null)).toBe(false);
      expect(exported(undefined)).toBe(false);
      expect(exported("analysis: x")).toBe(false);
      expect(exported(0)).toBe(false);
      expect(exported({})).toBe(false);
      expect(exported({ content: "   " })).toBe(false);
      expect(exported([])).toBe(false);
    });

    it("detects explicit flags and types", () => {
      expect(exported({ thinking: true })).toBe(true);
      expect(exported({ internal: true })).toBe(true);
      expect(exported({ type: "thinking" })).toBe(true);
      expect(exported({ meta: { type: "thinking" } })).toBe(true);
    });

    it("detects thinking markers in content/text", () => {
      expect(exported({ content: "<think> hello" })).toBe(true);
      expect(exported({ content: "<analysis> hello" })).toBe(true);
      expect(exported({ content: "thought: hello" })).toBe(true);
      expect(exported({ content: "Thoughts: hello" })).toBe(true);
      expect(exported({ content: "analysis: hello" })).toBe(true);
      expect(exported({ content: "internal: hello" })).toBe(true);
      expect(exported({ text: "analysis: hello" })).toBe(true);
      expect(exported({ content: "analysis hello" })).toBe(false);
    });

    it("supports rapid repeated calls (concurrency boundary)", async () => {
      const msg = { content: "<think> x" };
      const results = await Promise.all(Array.from({ length: 40 }, () => Promise.resolve(exported(msg))));
      expect(results.every((v) => v === true)).toBe(true);
    });
  } else if (exportName === "normalizeMessage") {
    it("normalizes string input to assistant role", () => {
      expect(exported("hi")).toEqual({ role: "assistant", content: "hi" });
    });

    it("normalizes object content/text to string and preserves fields", () => {
      const msg = { role: "user", content: 123, extra: { k: "v" } };
      const out = exported(msg);
      expect(out).toEqual({ role: "user", content: "123", extra: { k: "v" } });
      expect(msg.content).toBe(123);
    });

    it("falls back to text when content is nullish", () => {
      expect(exported({ role: "assistant", content: null, text: "hello" })).toEqual({
        role: "assistant",
        content: "hello",
        text: "hello",
      });
    });

    it("returns default assistant message for non-string/non-object", () => {
      expect(exported(null)).toEqual({ role: "assistant", content: "" });
      expect(exported(undefined)).toEqual({ role: "assistant", content: "" });
      expect(exported(0)).toEqual({ role: "assistant", content: "" });
      expect(exported(false)).toEqual({ role: "assistant", content: "" });
    });

    it("treats arrays as objects (current behavior)", () => {
      expect(exported(["x"])).toEqual({ 0: "x", content: "" });
      expect(exported([])).toEqual({ content: "" });
    });

    it("supports rapid repeated calls (concurrency boundary)", async () => {
      const msg = { role: "user", content: 1 };
      const results = await Promise.all(Array.from({ length: 25 }, () => Promise.resolve(exported(msg))));
      expect(results.every((v) => v.content === "1")).toBe(true);
    });
  } else if (exportName === "isMergeSafeMessage") {
    it("returns false for non-objects", () => {
      expect(exported(null)).toBe(false);
      expect(exported(undefined)).toBe(false);
      expect(exported("x")).toBe(false);
      expect(exported(0)).toBe(false);
    });

    it("returns true only when keys are limited to role/content", () => {
      expect(exported({})).toBe(true);
      expect(exported({ role: "assistant" })).toBe(true);
      expect(exported({ content: "hi" })).toBe(true);
      expect(exported({ role: "assistant", content: "hi" })).toBe(true);
      expect(exported({ role: "assistant", content: "hi", meta: {} })).toBe(false);
      expect(exported({ role: "assistant", content: "hi", extra: undefined })).toBe(false);
    });

    it("treats arrays based on their enumerable keys (current behavior)", () => {
      expect(exported([])).toBe(true);
      expect(exported(["x"])).toBe(false);
    });
  } else if (exportName === "isContextSummaryMessage") {
    it("detects system messages with [Context Summary] prefix", () => {
      expect(exported({ role: "system", content: "[Context Summary] hello" })).toBe(true);
      expect(exported({ role: "system", content: "   [Context Summary] hello" })).toBe(true);
      expect(exported({ role: "system", content: "[context summary] hello" })).toBe(false);
    });

    it("returns false for non-system or empty content", () => {
      expect(exported({ role: "user", content: "[Context Summary] hello" })).toBe(false);
      expect(exported({ role: "system", content: "" })).toBe(false);
      expect(exported({ role: "system" })).toBe(false);
      expect(exported(null)).toBe(false);
    });
  } else if (exportName === "summarizeMessages") {
    it("summarizes messages with truncation (normal path)", () => {
      const out = exported([{ role: "user", content: "  hello   world " }], 10);
      expect(out).toBe("user: hello ...d");
    });

    it("skips empty/whitespace content and preserves unknown roles", () => {
      expect(exported([{ role: "user", content: "   " }], 10)).toBe("");
      expect(exported([{ content: "hi" }], 10)).toBe("unknown: hi");
    });

    it("treats falsy non-empty values in content as empty due to `||` (current behavior)", () => {
      expect(exported([{ role: "user", content: 0 }], 10)).toBe("");
      expect(exported([{ role: "user", content: false }], 10)).toBe("");
      expect(exported([{ role: "user", content: NaN }], 10)).toBe("");
    });

    it("supports titleOnly mode", () => {
      const out = exported(
        [{ role: "user", content: "one two three four" }],
        50,
        { titleOnly: true, titleMaxWords: 2, titleMaxChars: 80 },
      );
      expect(out).toBe("user: one two...");
    });

    it("throws on non-iterable messages input (error handling)", () => {
      expect(() => exported(null, 10)).toThrow();
      expect(() => exported(undefined, 10)).toThrow();
    });

    it("handles large inputs (resource boundary) and rapid calls (concurrency boundary)", async () => {
      const huge = "x".repeat(200_000) + " END";
      const messages = [
        { role: "system", content: "[Context Summary] prior" },
        { role: "user", content: huge },
        { role: "assistant", content: "ok" },
      ];

      const results = await Promise.all(Array.from({ length: 15 }, () => Promise.resolve(exported(messages, 120))));
      expect(results[0]).toBe(results[1]);
      expect(results[0].split("\n").length).toBe(3);
    });
  } else if (exportName === "compressSessionHistory") {
    it("returns { compressed, stats } for a minimal context object", async () => {
      const ctx = {
        layers: {
          SESSION_HISTORY: {
            messages: [
              { role: "user", content: "hello" },
              { role: "assistant", content: "world" },
            ],
          },
        },
        sessionHistory: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "world" },
        ],
      };

      const result = exported(ctx, {});
      const awaited = result && typeof result.then === "function" ? await result : result;

      expect(awaited).toBeTruthy();
      expect(typeof awaited).toBe("object");
      expect(awaited).toHaveProperty("compressed");
      expect(awaited).toHaveProperty("stats");
    });

    it("handles boundary keepLastTurns values without throwing", async () => {
      const ctx = { sessionHistory: [{ role: "user", content: "hi" }] };

      const cases = [
        { keepLastTurns: 0 },
        { keepLastTurns: -1 },
        { keepLastTurns: Number.MAX_SAFE_INTEGER },
        { keepLastTurns: NaN },
        { keepLastTurns: "6" },
      ];

      const results = [];
      for (const options of cases) {
        const out = exported(ctx, options);
        results.push(out && typeof out.then === "function" ? await out : out);
      }

      for (const r of results) {
        expect(r).toBeTruthy();
        expect(typeof r).toBe("object");
        expect(r).toHaveProperty("compressed");
        expect(r).toHaveProperty("stats");
      }
    });

    it("uses isPlainObject during processing (dependency interaction)", async () => {
      await importWorkerFresh();
      const { isPlainObject } = await importMocks();

      const ctx = { sessionHistory: [{ role: "user", content: "hi" }] };
      const out = exported(ctx, {});
      await (out && typeof out.then === "function" ? out : Promise.resolve(out));

      expect(isPlainObject).toHaveBeenCalled();
    });

    it("supports concurrent calls with deep/large context (concurrency + resource boundary)", async () => {
      const deep = {};
      let cur = deep;
      for (let i = 0; i < 120; i += 1) {
        cur.next = {};
        cur = cur.next;
      }

      const hugeText = "x".repeat(120_000);
      const ctx = {
        layers: {
          SESSION_HISTORY: {
            messages: [
              { role: "user", content: hugeText },
              { role: "assistant", content: "reply" },
              { role: "assistant", content: "<think>internal</think>" },
            ],
          },
        },
        deep,
      };

      const tasks = Array.from({ length: 10 }, () => outcomeOf(exported, [ctx, { keepLastTurns: 6 }]));
      const outcomes = await Promise.all(tasks);

      expect(outcomes.every((o) => o.ok)).toBe(true);
      const first = outcomes[0].value;
      expect(first).toBeTruthy();
      expect(typeof first).toBe("object");
      expect(first).toHaveProperty("compressed");
      expect(first).toHaveProperty("stats");
    });
  } else {
    it("has stable behavior for boundary inputs (generic)", async () => {
      if (typeof exported !== "function") return;

      const argSets = [[], [undefined], [null], [""], [0], [-1], [Number.MAX_SAFE_INTEGER], [{}], [[]]];

      for (const args of argSets) {
        const a = await outcomeOf(exported, args);
        const b = await outcomeOf(exported, args);

        expect(b.ok).toBe(a.ok);

        if (a.ok) {
          if (typeof a.value === "undefined") {
            expect(typeof b.value).toBe("undefined");
          } else {
            expect(b.value).toEqual(a.value);
          }
        } else {
          expect(b.error && b.error.name).toBe(a.error && a.error.name);
          expect(String(b.error && b.error.message)).toBe(String(a.error && a.error.message));
        }
      }
    });

    it("supports rapid consecutive invocations (generic concurrency)", async () => {
      if (typeof exported !== "function") return;

      const tasks = Array.from({ length: 25 }, () => outcomeOf(exported, []));
      const outcomes = await Promise.all(tasks);

      // All should either consistently succeed or consistently fail for empty input
      const okCount = outcomes.filter((o) => o.ok).length;
      expect(okCount === 0 || okCount === outcomes.length).toBe(true);
    });
  }
});
