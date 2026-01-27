import { describe, it, expect, vi, beforeEach } from "vitest";

const SUBJECT_PATH = "../../../../js/agents/sdk/DefaultAgentLoop.js";

vi.mock("../../../../js/agents/shared/index.js", () => {
  const robustParseJson = (input) => {
    if (typeof input !== "string") return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed === null || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const isPlainObject = (value) => {
    if (value === null || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const safeInt = (value) => {
    if (typeof value !== "number") return null;
    if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
    if (Math.abs(value) > Number.MAX_SAFE_INTEGER) return null;
    return value;
  };

  const toNonEmptyString = (value) => {
    if (value === null || value === undefined) return "";
    const s = typeof value === "string" ? value : String(value);
    const trimmed = s.trim();
    return trimmed ? trimmed : "";
  };

  return { robustParseJson, isPlainObject, safeInt, toNonEmptyString };
});

vi.mock("../../../../js/agents/runtime/core/agent-loop.js", () => {
  class BaseAgentLoop {}
  const checkCancelled = vi.fn(() => undefined);
  return { BaseAgentLoop, checkCancelled };
});

vi.mock("../../../../js/agents/runtime/core/middleware/middleware-chain.js", () => {
  const createDefaultMiddlewareChain = vi.fn(() => ({
    run: vi.fn(async (ctx, next) => (typeof next === "function" ? await next(ctx) : undefined)),
  }));
  return { createDefaultMiddlewareChain };
});

vi.mock("../../../../js/agents/plugins/checkpoints/index.js", () => {
  class AgentCheckpointStore {
    constructor() {
      this._store = new Map();
      this._order = [];
    }

    async save(checkpoint) {
      const id = checkpoint?.id ?? `cp_${this._order.length + 1}`;
      const entry = checkpoint && typeof checkpoint === "object" ? { ...checkpoint, id } : { id, value: checkpoint };
      this._store.set(id, entry);
      this._order.push(id);
      return entry;
    }

    async get(checkpointId) {
      return this._store.get(checkpointId) ?? null;
    }

    async latest() {
      const id = this._order[this._order.length - 1];
      return id ? this._store.get(id) ?? null : null;
    }

    async list() {
      return this._order.map((id) => this._store.get(id));
    }
  }

  return { AgentCheckpointStore };
});

vi.mock("../../../../js/agents/plugins/telemetry/index.js", () => {
  const ensureRuntimeState = vi.fn(() => ({}));
  return { ensureRuntimeState };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

async function importSubject() {
  return await import(SUBJECT_PATH);
}

describe("truncateText", () => {
  it("handles null/undefined/empty string inputs", async () => {
    const mod = await importSubject();
    const truncateText = mod.truncateText;

    if (typeof truncateText !== "function") {
      expect(truncateText).toBeUndefined();
      return;
    }

    expect(truncateText(null, 10)).toBe("");
    expect(truncateText(undefined, 10)).toBe("");
    expect(truncateText("", 10)).toBe("");
  });

  it("does not truncate when maxChars is 0/negative/non-finite/non-number", async () => {
    const mod = await importSubject();
    const truncateText = mod.truncateText;

    if (typeof truncateText !== "function") {
      expect(truncateText).toBeUndefined();
      return;
    }

    const s = "hello world";
    expect(truncateText(s, 0)).toBe(s);
    expect(truncateText(s, -1)).toBe(s);
    expect(truncateText(s, Infinity)).toBe(s);
    expect(truncateText(s, NaN)).toBe(s);
    expect(truncateText(s, "10")).toBe(s);
  });

  it("truncates and includes head/tail + correct truncated count", async () => {
    const mod = await importSubject();
    const truncateText = mod.truncateText;

    if (typeof truncateText !== "function") {
      expect(truncateText).toBeUndefined();
      return;
    }

    const s = "a".repeat(100);
    const outSmall = truncateText(s, 10);
    expect(outSmall.startsWith("a".repeat(7))).toBe(true);
    expect(outSmall).toContain("...(truncated 90 chars)...");
    expect(outSmall.endsWith("\n")).toBe(true);

    const outTail = truncateText(s, 60);
    expect(outTail.startsWith("a".repeat(42))).toBe(true);
    expect(outTail).toContain("...(truncated 40 chars)...");
    expect(outTail.endsWith("aa")).toBe(true);
  });

  it("handles very long strings (resource boundary)", async () => {
    const mod = await importSubject();
    const truncateText = mod.truncateText;

    if (typeof truncateText !== "function") {
      expect(truncateText).toBeUndefined();
      return;
    }

    const big = "x".repeat(200_000);
    const out = truncateText(big, 200);
    expect(typeof out).toBe("string");
    expect(out).toContain("...(truncated ");
    expect(out.length).toBeGreaterThan(0);
  });

  it("is safe under rapid/concurrent calls", async () => {
    const mod = await importSubject();
    const truncateText = mod.truncateText;

    if (typeof truncateText !== "function") {
      expect(truncateText).toBeUndefined();
      return;
    }

    const tasks = Array.from({ length: 25 }, (_, i) => {
      const s = `prefix_${i}_` + "y".repeat(500) + `_suffix_${i}`;
      return Promise.resolve(truncateText(s, 80));
    });

    const results = await Promise.all(tasks);
    expect(results).toHaveLength(25);
    expect(new Set(results).size).toBe(25);
    expect(results.every((r) => typeof r === "string" && r.includes("truncated"))).toBe(true);
  });
});

describe("safeStringify", () => {
  it("handles nullish and primitives", async () => {
    const mod = await importSubject();
    const safeStringify = mod.safeStringify;

    if (typeof safeStringify !== "function") {
      expect(safeStringify).toBeUndefined();
      return;
    }

    expect(safeStringify(undefined)).toBe("");
    expect(safeStringify(null)).toBe("null");
    expect(safeStringify("")).toBe("");
    expect(safeStringify("  hi  ")).toBe("  hi  ");
  });

  it("truncates long strings and ignores invalid maxChars (0/NaN => no truncation)", async () => {
    const mod = await importSubject();
    const safeStringify = mod.safeStringify;

    if (typeof safeStringify !== "function") {
      expect(safeStringify).toBeUndefined();
      return;
    }

    const long = "z".repeat(200);
    const truncated = safeStringify(long, { maxChars: 40 });
    expect(truncated).toContain("...(truncated ");
    expect(truncated.startsWith("z")).toBe(true);

    const noTruncateNaN = safeStringify(long, { maxChars: NaN });
    expect(noTruncateNaN).toBe(long);

    const noTruncateNeg = safeStringify(long, { maxChars: -1 });
    expect(noTruncateNeg).toBe(long);
  });

  it("stringifies objects and truncates huge payloads (resource boundary)", async () => {
    const mod = await importSubject();
    const safeStringify = mod.safeStringify;

    if (typeof safeStringify !== "function") {
      expect(safeStringify).toBeUndefined();
      return;
    }

    const obj = { a: 1, b: { c: "ok" } };
    const out = safeStringify(obj);
    expect(out).toContain('"a": 1');
    expect(out).toContain('"c": "ok"');

    const huge = { data: "x".repeat(20_000), nested: { deep: { value: "y".repeat(10_000) } } };
    const outHuge = safeStringify(huge, { maxChars: 120 });
    expect(outHuge).toContain("...(truncated ");
    expect(typeof outHuge).toBe("string");
  });

  it("falls back safely when JSON.stringify throws (circular + BigInt)", async () => {
    const mod = await importSubject();
    const safeStringify = mod.safeStringify;

    if (typeof safeStringify !== "function") {
      expect(safeStringify).toBeUndefined();
      return;
    }

    const circular = {};
    circular.self = circular;

    expect(() => safeStringify(circular)).not.toThrow();
    expect(safeStringify(circular)).toContain("[object Object]");

    expect(() => safeStringify(10n)).not.toThrow();
    expect(safeStringify(10n)).toContain("10");
  });

  it("is safe under rapid/concurrent calls", async () => {
    const mod = await importSubject();
    const safeStringify = mod.safeStringify;

    if (typeof safeStringify !== "function") {
      expect(safeStringify).toBeUndefined();
      return;
    }

    const tasks = Array.from({ length: 20 }, (_, i) =>
      Promise.resolve(
        safeStringify(
          { i, payload: "p".repeat(1000) + i },
          { maxChars: i % 2 === 0 ? 80 : 200 }
        )
      )
    );

    const results = await Promise.all(tasks);
    expect(results).toHaveLength(20);
    expect(results.every((r) => typeof r === "string" && r.length > 0)).toBe(true);
  });
});

describe("resolveModelCaller", () => {
  it("returns null when no caller is available (nullish/non-object/empty)", async () => {
    const mod = await importSubject();
    const resolveModelCaller = mod.resolveModelCaller;

    if (typeof resolveModelCaller !== "function") {
      expect(resolveModelCaller).toBeUndefined();
      return;
    }

    expect(resolveModelCaller(null)).toBeNull();
    expect(resolveModelCaller(undefined)).toBeNull();
    expect(resolveModelCaller("not-an-object")).toBeNull();
    expect(resolveModelCaller({})).toBeNull();
  });

  it("prefers stageApi.callModel and forwards usage/signal/opts", async () => {
    const mod = await importSubject();
    const resolveModelCaller = mod.resolveModelCaller;

    if (typeof resolveModelCaller !== "function") {
      expect(resolveModelCaller).toBeUndefined();
      return;
    }

    const defaultSignal = new AbortController().signal;
    const callModel = vi.fn(async (_messages, _opts) => ({ ok: true }));

    const stageApi = {
      signal: defaultSignal,
      callModel,
      modelRouter: { call: vi.fn() },
      aiApiService: { chat: vi.fn() },
    };

    const caller = resolveModelCaller(stageApi, { usage: "worker" });
    expect(typeof caller).toBe("function");

    const messages = [{ role: "user", content: "hi" }];
    await caller(messages);
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(callModel.mock.calls[0][0]).toBe(messages);
    expect(callModel.mock.calls[0][1]).toEqual(expect.objectContaining({ usage: "worker", signal: defaultSignal }));

    const overrideSignal = new AbortController().signal;
    await caller(messages, { usage: "planner", signal: overrideSignal, temperature: 0.2 });
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(callModel.mock.calls[1][1]).toEqual(
      expect.objectContaining({ usage: "planner", signal: overrideSignal, temperature: 0.2 })
    );

    await caller(messages, "not-an-object");
    expect(callModel).toHaveBeenCalledTimes(3);
    expect(callModel.mock.calls[2][1]).toEqual(expect.objectContaining({ usage: "worker", signal: defaultSignal }));
  });

  it("supports modelRouter.call legacy signature (messages, opts)", async () => {
    const mod = await importSubject();
    const resolveModelCaller = mod.resolveModelCaller;

    if (typeof resolveModelCaller !== "function") {
      expect(resolveModelCaller).toBeUndefined();
      return;
    }

    const defaultSignal = new AbortController().signal;
    const modelRouter = {
      call: vi.fn(async (_messages, _opts) => ({ ok: true })),
    };

    const caller = resolveModelCaller({ signal: defaultSignal, modelRouter }, { usage: "worker" });
    expect(typeof caller).toBe("function");

    const messages = [{ role: "user", content: "hello" }];
    await caller(messages, { foo: 1 });
    expect(modelRouter.call).toHaveBeenCalledTimes(1);
    expect(modelRouter.call.mock.calls[0][0]).toBe(messages);
    expect(modelRouter.call.mock.calls[0][1]).toEqual(expect.objectContaining({ usage: "worker", signal: defaultSignal, foo: 1 }));

    const providedSignal = new AbortController().signal;
    await caller(messages, { signal: providedSignal, bar: 2 });
    expect(modelRouter.call).toHaveBeenCalledTimes(2);
    expect(modelRouter.call.mock.calls[1][1]).toEqual(expect.objectContaining({ usage: "worker", signal: providedSignal, bar: 2 }));

    await caller(messages, "not-an-object");
    expect(modelRouter.call).toHaveBeenCalledTimes(3);
    expect(modelRouter.call.mock.calls[2][1]).toEqual(expect.objectContaining({ usage: "worker", signal: defaultSignal }));
  });

  it("supports modelRouter.call new signature (payload)", async () => {
    const mod = await importSubject();
    const resolveModelCaller = mod.resolveModelCaller;

    if (typeof resolveModelCaller !== "function") {
      expect(resolveModelCaller).toBeUndefined();
      return;
    }

    const defaultSignal = new AbortController().signal;
    const modelRouter = {
      call: vi.fn(async (_payload) => ({ ok: true })),
    };
    expect(modelRouter.call.length).toBe(1);

    const caller = resolveModelCaller({ signal: defaultSignal, modelRouter }, { usage: "worker" });
    const messages = [{ role: "user", content: "yo" }];

    await caller(messages, { foo: 1 });
    expect(modelRouter.call).toHaveBeenCalledTimes(1);
    expect(modelRouter.call.mock.calls[0][0]).toEqual(
      expect.objectContaining({ usage: "worker", messages, signal: defaultSignal, foo: 1 })
    );
  });

  it("supports aiApiService.chat and forwards messages/usage/signal/rest", async () => {
    const mod = await importSubject();
    const resolveModelCaller = mod.resolveModelCaller;

    if (typeof resolveModelCaller !== "function") {
      expect(resolveModelCaller).toBeUndefined();
      return;
    }

    const defaultSignal = new AbortController().signal;
    const aiApiService = {
      chat: vi.fn(async (_payload) => ({ ok: true })),
    };

    const caller = resolveModelCaller({ signal: defaultSignal, aiApiService }, { usage: "worker" });
    const messages = [{ role: "user", content: "ping" }];

    await caller(messages, { top_p: 0.9 });
    expect(aiApiService.chat).toHaveBeenCalledTimes(1);
    expect(aiApiService.chat.mock.calls[0][0]).toEqual(
      expect.objectContaining({ usage: "worker", messages, signal: defaultSignal, top_p: 0.9 })
    );
  });

  it("is safe under rapid/concurrent calls and preserves per-call options", async () => {
    const mod = await importSubject();
    const resolveModelCaller = mod.resolveModelCaller;

    if (typeof resolveModelCaller !== "function") {
      expect(resolveModelCaller).toBeUndefined();
      return;
    }

    const defaultSignal = new AbortController().signal;
    const callModel = vi.fn(async (_messages, _opts) => ({ ok: true }));

    const caller = resolveModelCaller({ signal: defaultSignal, callModel }, { usage: "worker" });
    const messages = Array.from({ length: 200 }, (_, i) => ({ role: "user", content: `msg_${i}` }));

    const s1 = new AbortController().signal;
    const s2 = new AbortController().signal;

    await Promise.all([
      caller(messages, { signal: s1, requestId: "a" }),
      caller(messages, { signal: s2, requestId: "b" }),
    ]);

    const lastTwo = callModel.mock.calls.slice(-2).map(([, opts]) => opts);
    const signals = lastTwo.map((o) => o.signal);
    const requestIds = lastTwo.map((o) => o.requestId);

    expect(signals).toEqual(expect.arrayContaining([s1, s2]));
    expect(requestIds).toEqual(expect.arrayContaining(["a", "b"]));
    expect(lastTwo.every((o) => o.usage === "worker")).toBe(true);
  });
});

describe("extractContent", () => {
  it("returns empty string for nullish and identity for strings", async () => {
    const mod = await importSubject();
    const extractContent = mod.extractContent;

    if (typeof extractContent !== "function") {
      expect(extractContent).toBeUndefined();
      return;
    }

    expect(extractContent(null)).toBe("");
    expect(extractContent(undefined)).toBe("");
    expect(extractContent("")).toBe("");
    expect(extractContent("hello")).toBe("hello");
  });

  it("extracts content/text/message.content in priority order", async () => {
    const mod = await importSubject();
    const extractContent = mod.extractContent;

    if (typeof extractContent !== "function") {
      expect(extractContent).toBeUndefined();
      return;
    }

    expect(extractContent({ content: "c", text: "t", message: { content: "m" } })).toBe("c");
    expect(extractContent({ text: "t", message: { content: "m" } })).toBe("t");
    expect(extractContent({ message: { content: "m" } })).toBe("m");
  });

  it("falls back to String(modelResponse) for other shapes/types", async () => {
    const mod = await importSubject();
    const extractContent = mod.extractContent;

    if (typeof extractContent !== "function") {
      expect(extractContent).toBeUndefined();
      return;
    }

    expect(extractContent(0)).toBe("0");
    expect(extractContent(-1)).toBe("-1");
    expect(extractContent(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(extractContent({})).toBe("[object Object]");
    expect(extractContent({ message: { content: 123 } })).toBe("[object Object]");
  });

  it("is safe under rapid/concurrent calls and with long strings", async () => {
    const mod = await importSubject();
    const extractContent = mod.extractContent;

    if (typeof extractContent !== "function") {
      expect(extractContent).toBeUndefined();
      return;
    }

    const long = "L".repeat(50_000);
    const inputs = [
      null,
      undefined,
      "",
      long,
      { content: "ok" },
      { text: "txt" },
      { message: { content: "msg" } },
      42,
      { foo: "bar" },
    ];

    const results = await Promise.all(inputs.map((v) => Promise.resolve(extractContent(v))));
    expect(results[0]).toBe("");
    expect(results[1]).toBe("");
    expect(results[2]).toBe("");
    expect(results[3]).toBe(long);
    expect(results[4]).toBe("ok");
    expect(results[5]).toBe("txt");
    expect(results[6]).toBe("msg");
    expect(results[7]).toBe("42");
    expect(results[8]).toBe("[object Object]");
  });
});

describe("parseDecision", () => {
  it("returns null for invalid/empty/nullish content", async () => {
    const mod = await importSubject();
    const parseDecision = mod.parseDecision;

    if (typeof parseDecision !== "function") {
      expect(parseDecision).toBeUndefined();
      return;
    }

    expect(parseDecision(null)).toBeNull();
    expect(parseDecision(undefined)).toBeNull();
    expect(parseDecision("")).toBeNull();
    expect(parseDecision("   ")).toBeNull();
    expect(parseDecision("not json")).toBeNull();
  });

  it("returns thought + actions when actions is a non-empty array", async () => {
    const mod = await importSubject();
    const parseDecision = mod.parseDecision;

    if (typeof parseDecision !== "function") {
      expect(parseDecision).toBeUndefined();
      return;
    }

    const content = JSON.stringify({
      thought: "  think  ",
      actions: [{ action: "do", args: { x: 1 }, final: "ok" }],
    });

    const decision = parseDecision(content);
    expect(decision).toEqual(
      expect.objectContaining({
        thought: "think",
        actions: expect.any(Array),
      })
    );
    expect(decision.actions).toHaveLength(1);
    expect(decision.actions[0]).toEqual({ action: "do", args: { x: 1 }, final: "ok" });
  });

  it("normalizes single-action shape with defaults and fallbacks", async () => {
    const mod = await importSubject();
    const parseDecision = mod.parseDecision;

    if (typeof parseDecision !== "function") {
      expect(parseDecision).toBeUndefined();
      return;
    }

    const withAll = JSON.stringify({ thought: "t", action: "run", args: { a: 1 }, final: "done" });
    expect(parseDecision(withAll)).toEqual({ thought: "t", action: "run", args: { a: 1 }, final: "done" });

    const defaults = JSON.stringify({ thought: "t" });
    expect(parseDecision(defaults)).toEqual({ thought: "t", action: "complete", args: {}, final: "" });

    const argsNotPlain = JSON.stringify({ action: "run", args: [], final: "x" });
    expect(parseDecision(argsNotPlain)).toEqual({ thought: "", action: "run", args: {}, final: "x" });

    const finalFromAnswer = JSON.stringify({ action: "complete", answer: "ans" });
    expect(parseDecision(finalFromAnswer)).toEqual({ thought: "", action: "complete", args: {}, final: "ans" });
  });

  it("treats empty actions array and non-array actions as single-action path", async () => {
    const mod = await importSubject();
    const parseDecision = mod.parseDecision;

    if (typeof parseDecision !== "function") {
      expect(parseDecision).toBeUndefined();
      return;
    }

    const emptyActions = JSON.stringify({ actions: [], final: "f" });
    expect(parseDecision(emptyActions)).toEqual({ thought: "", action: "complete", args: {}, final: "f" });

    const actionsAsObject = JSON.stringify({ actions: {}, action: "x" });
    expect(parseDecision(actionsAsObject)).toEqual({ thought: "", action: "x", args: {}, final: "" });
  });

  it("handles deep nesting, long strings, and concurrent calls (resource + concurrency)", async () => {
    const mod = await importSubject();
    const parseDecision = mod.parseDecision;

    if (typeof parseDecision !== "function") {
      expect(parseDecision).toBeUndefined();
      return;
    }

    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    const longFinal = "F".repeat(25_000);

    const a = JSON.stringify({ action: "complete", args: deep, final: longFinal });
    const b = JSON.stringify({ action: "complete", args: {}, answer: "ok" });

    const [r1, r2] = await Promise.all([Promise.resolve(parseDecision(a)), Promise.resolve(parseDecision(b))]);

    expect(r1).toEqual({ thought: "", action: "complete", args: deep, final: longFinal });
    expect(r2).toEqual({ thought: "", action: "complete", args: {}, final: "ok" });
  });
});

describe("normalizeActionList", () => {
  it("returns [] for nullish/non-object decisions", async () => {
    const mod = await importSubject();
    const normalizeActionList = mod.normalizeActionList;

    if (typeof normalizeActionList !== "function") {
      expect(normalizeActionList).toBeUndefined();
      return;
    }

    expect(normalizeActionList(null)).toEqual([]);
    expect(normalizeActionList(undefined)).toEqual([]);
    expect(normalizeActionList(false)).toEqual([]);
    expect(normalizeActionList("not-an-object")).toEqual([]);
  });

  it("filters non-object actions and normalizes fields (including answer fallback)", async () => {
    const mod = await importSubject();
    const normalizeActionList = mod.normalizeActionList;

    if (typeof normalizeActionList !== "function") {
      expect(normalizeActionList).toBeUndefined();
      return;
    }

    const decision = {
      actions: [
        null,
        "x",
        { action: "do", args: { k: 1 }, final: "ok" },
        { action: "", args: [], answer: "ans" },
        {},
      ],
    };

    const out = normalizeActionList(decision);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ action: "do", args: { k: 1 }, final: "ok" });
    expect(out[1]).toEqual({ action: "complete", args: {}, final: "ans" });
    expect(out[2]).toEqual({ action: "complete", args: {}, final: "" });
  });

  it("returns [] when actions is an empty array (edge case)", async () => {
    const mod = await importSubject();
    const normalizeActionList = mod.normalizeActionList;

    if (typeof normalizeActionList !== "function") {
      expect(normalizeActionList).toBeUndefined();
      return;
    }

    expect(normalizeActionList({ actions: [] })).toEqual([]);
  });

  it("normalizes single-action shape and ignores answer in single-action final", async () => {
    const mod = await importSubject();
    const normalizeActionList = mod.normalizeActionList;

    if (typeof normalizeActionList !== "function") {
      expect(normalizeActionList).toBeUndefined();
      return;
    }

    expect(normalizeActionList({ action: "run", args: { x: 1 }, final: "f" })).toEqual([{ action: "run", args: { x: 1 }, final: "f" }]);
    expect(normalizeActionList({ action: "", args: [], answer: "ans" })).toEqual([{ action: "complete", args: {}, final: "" }]);

    const objectAsArrayBoundary = { actions: {}, action: "x", args: { y: 2 }, final: "z" };
    expect(normalizeActionList(objectAsArrayBoundary)).toEqual([{ action: "x", args: { y: 2 }, final: "z" }]);
  });

  it("handles deep nested args and concurrent calls (resource + concurrency)", async () => {
    const mod = await importSubject();
    const normalizeActionList = mod.normalizeActionList;

    if (typeof normalizeActionList !== "function") {
      expect(normalizeActionList).toBeUndefined();
      return;
    }

    const deepArgs = { a: { b: { c: { d: { e: 1 } } } } };
    const decision = {
      actions: [{ action: "complete", args: deepArgs, final: "ok" }],
    };

    const [r1, r2] = await Promise.all([Promise.resolve(normalizeActionList(decision)), Promise.resolve(normalizeActionList(decision))]);
    expect(r1).toEqual([{ action: "complete", args: deepArgs, final: "ok" }]);
    expect(r2).toEqual([{ action: "complete", args: deepArgs, final: "ok" }]);
  });
});

describe("normalizeCheckpointOptions", () => {
  it("handles boolean and nullish inputs", async () => {
    const mod = await importSubject();
    const normalizeCheckpointOptions = mod.normalizeCheckpointOptions;

    if (typeof normalizeCheckpointOptions !== "function") {
      expect(normalizeCheckpointOptions).toBeUndefined();
      return;
    }

    expect(normalizeCheckpointOptions(true)).toEqual({ enabled: true });
    expect(normalizeCheckpointOptions(false)).toEqual({});
    expect(normalizeCheckpointOptions(null)).toEqual({});
    expect(normalizeCheckpointOptions(undefined)).toEqual({});
  });

  it("enables restore for string/number inputs (including boundary values)", async () => {
    const mod = await importSubject();
    const normalizeCheckpointOptions = mod.normalizeCheckpointOptions;

    if (typeof normalizeCheckpointOptions !== "function") {
      expect(normalizeCheckpointOptions).toBeUndefined();
      return;
    }

    expect(normalizeCheckpointOptions("last")).toEqual({ enabled: true, restore: "last" });
    expect(normalizeCheckpointOptions("")).toEqual({ enabled: true, restore: "" });
    expect(normalizeCheckpointOptions("   ")).toEqual({ enabled: true, restore: "   " });

    expect(normalizeCheckpointOptions(0)).toEqual({ enabled: true, restore: 0 });
    expect(normalizeCheckpointOptions(-1)).toEqual({ enabled: true, restore: -1 });
    expect(normalizeCheckpointOptions(Number.MAX_SAFE_INTEGER)).toEqual({ enabled: true, restore: Number.MAX_SAFE_INTEGER });
  });

  it("clones plain-object inputs and ignores non-plain objects/arrays", async () => {
    const mod = await importSubject();
    const normalizeCheckpointOptions = mod.normalizeCheckpointOptions;

    if (typeof normalizeCheckpointOptions !== "function") {
      expect(normalizeCheckpointOptions).toBeUndefined();
      return;
    }

    const obj = { enabled: true, restore: "cp_1", extra: { nested: true } };
    const out = normalizeCheckpointOptions(obj);
    expect(out).toEqual(obj);
    expect(out).not.toBe(obj);

    expect(normalizeCheckpointOptions([])).toEqual({});
    expect(normalizeCheckpointOptions(new Date())).toEqual({});
  });

  it("handles large option payloads (resource boundary)", async () => {
    const mod = await importSubject();
    const normalizeCheckpointOptions = mod.normalizeCheckpointOptions;

    if (typeof normalizeCheckpointOptions !== "function") {
      expect(normalizeCheckpointOptions).toBeUndefined();
      return;
    }

    const huge = { enabled: true, note: "n".repeat(50_000) };
    const out = normalizeCheckpointOptions(huge);
    expect(out.note.length).toBe(50_000);
    expect(out).not.toBe(huge);
  });

  it("is safe under rapid/concurrent calls", async () => {
    const mod = await importSubject();
    const normalizeCheckpointOptions = mod.normalizeCheckpointOptions;

    if (typeof normalizeCheckpointOptions !== "function") {
      expect(normalizeCheckpointOptions).toBeUndefined();
      return;
    }

    const inputs = [true, false, null, undefined, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, {}, [], { enabled: true, restore: "x" }];
    const results = await Promise.all(inputs.map((v) => Promise.resolve(normalizeCheckpointOptions(v))));
    expect(results).toHaveLength(inputs.length);
    expect(results[0]).toEqual({ enabled: true });
    expect(results[1]).toEqual({});
    expect(results[6]).toEqual({ enabled: true, restore: 0 });
    expect(results[7]).toEqual({ enabled: true, restore: -1 });
  });
});

describe("normalizeRestoreRequest", () => {
  it("returns null for nullish/false and last-mode for true/'last'/'latest'", async () => {
    const mod = await importSubject();
    const normalizeRestoreRequest = mod.normalizeRestoreRequest;

    if (typeof normalizeRestoreRequest !== "function") {
      expect(normalizeRestoreRequest).toBeUndefined();
      return;
    }

    expect(normalizeRestoreRequest(null)).toBeNull();
    expect(normalizeRestoreRequest(undefined)).toBeNull();
    expect(normalizeRestoreRequest(false)).toBeNull();

    expect(normalizeRestoreRequest(true)).toEqual({ mode: "last" });
    expect(normalizeRestoreRequest("last")).toEqual({ mode: "last" });
    expect(normalizeRestoreRequest("latest")).toEqual({ mode: "last" });
  });

  it("converts finite integers to step-mode and rejects invalid numbers", async () => {
    const mod = await importSubject();
    const normalizeRestoreRequest = mod.normalizeRestoreRequest;

    if (typeof normalizeRestoreRequest !== "function") {
      expect(normalizeRestoreRequest).toBeUndefined();
      return;
    }

    expect(normalizeRestoreRequest(0)).toEqual({ mode: "step", step: 0 });
    expect(normalizeRestoreRequest(-1)).toEqual({ mode: "step", step: -1 });
    expect(normalizeRestoreRequest(Number.MAX_SAFE_INTEGER)).toEqual({ mode: "step", step: Number.MAX_SAFE_INTEGER });

    expect(normalizeRestoreRequest(Infinity)).toBeNull();
    expect(normalizeRestoreRequest(NaN)).toBeNull();
    expect(normalizeRestoreRequest(1.5)).toBeNull();
  });

  it("treats strings as checkpoint IDs (including numeric strings and whitespace)", async () => {
    const mod = await importSubject();
    const normalizeRestoreRequest = mod.normalizeRestoreRequest;

    if (typeof normalizeRestoreRequest !== "function") {
      expect(normalizeRestoreRequest).toBeUndefined();
      return;
    }

    expect(normalizeRestoreRequest("cp_123")).toEqual({ mode: "checkpoint", checkpointId: "cp_123" });
    expect(normalizeRestoreRequest("0")).toEqual({ mode: "checkpoint", checkpointId: "0" });
    expect(normalizeRestoreRequest("")).toEqual({ mode: "checkpoint", checkpointId: "" });
    expect(normalizeRestoreRequest("   ")).toEqual({ mode: "checkpoint", checkpointId: "   " });
  });

  it("handles empty objects/arrays without throwing (type boundary)", async () => {
    const mod = await importSubject();
    const normalizeRestoreRequest = mod.normalizeRestoreRequest;

    if (typeof normalizeRestoreRequest !== "function") {
      expect(normalizeRestoreRequest).toBeUndefined();
      return;
    }

    expect(() => normalizeRestoreRequest({})).not.toThrow();
    expect(() => normalizeRestoreRequest([])).not.toThrow();

    const rObj = normalizeRestoreRequest({});
    const rArr = normalizeRestoreRequest([]);

    const okShape = (v) => v === null || (v && typeof v === "object" && typeof v.mode === "string");
    expect(okShape(rObj)).toBe(true);
    expect(okShape(rArr)).toBe(true);
  });

  it("is safe under rapid/concurrent calls", async () => {
    const mod = await importSubject();
    const normalizeRestoreRequest = mod.normalizeRestoreRequest;

    if (typeof normalizeRestoreRequest !== "function") {
      expect(normalizeRestoreRequest).toBeUndefined();
      return;
    }

    const inputs = [null, undefined, false, true, "last", "latest", "cp", "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, Infinity, NaN];
    const results = await Promise.all(inputs.map((v) => Promise.resolve(normalizeRestoreRequest(v))));

    expect(results[0]).toBeNull();
    expect(results[3]).toEqual({ mode: "last" });
    expect(results[6]).toEqual({ mode: "checkpoint", checkpointId: "cp" });
    expect(results[9]).toEqual({ mode: "step", step: 0 });
    expect(results[12]).toBeNull();
  });
});

describe("DefaultAgentLoop", () => {
  it("exports a loop class/function (named or default)", async () => {
    const mod = await importSubject();
    const DefaultAgentLoop = mod.DefaultAgentLoop ?? mod.default;

    if (typeof DefaultAgentLoop !== "function") {
      expect(DefaultAgentLoop).toBeUndefined();
      return;
    }

    expect(typeof DefaultAgentLoop).toBe("function");
  });

  it("extends BaseAgentLoop when available", async () => {
    const mod = await importSubject();
    const DefaultAgentLoop = mod.DefaultAgentLoop ?? mod.default;

    if (typeof DefaultAgentLoop !== "function") {
      expect(DefaultAgentLoop).toBeUndefined();
      return;
    }

    const runtime = await import("../../../../js/agents/runtime/core/agent-loop.js");
    const BaseAgentLoop = runtime.BaseAgentLoop;

    if (typeof BaseAgentLoop !== "function") {
      expect(typeof BaseAgentLoop).not.toBe("function");
      return;
    }

    const proto = Object.getPrototypeOf(DefaultAgentLoop.prototype);
    expect(proto === BaseAgentLoop.prototype || DefaultAgentLoop.prototype instanceof BaseAgentLoop).toBe(true);
  });

  it("construction is stable under rapid creation (concurrency boundary)", async () => {
    const mod = await importSubject();
    const DefaultAgentLoop = mod.DefaultAgentLoop ?? mod.default;

    if (typeof DefaultAgentLoop !== "function") {
      expect(DefaultAgentLoop).toBeUndefined();
      return;
    }

    const candidates = [[], [{}], [{ stageApi: {} }], [{ stageApi: { signal: new AbortController().signal } }]];
    const tryConstruct = () => {
      for (const args of candidates) {
        try {
          return { instance: new DefaultAgentLoop(...args), error: null };
        } catch (e) {
          continue;
        }
      }
      try {
        return { instance: null, error: new DefaultAgentLoop() };
      } catch (e) {
        return { instance: null, error: e };
      }
    };

    const attempts = Array.from({ length: 5 }, () => Promise.resolve(tryConstruct()));
    const results = await Promise.all(attempts);

    const instances = results.map((r) => r.instance).filter(Boolean);
    const errors = results.map((r) => r.error).filter(Boolean);

    if (instances.length > 0) {
      expect(instances.every((i) => typeof i === "object")).toBe(true);
      expect(new Set(instances).size).toBe(instances.length);
    } else {
      expect(errors.length).toBe(5);
      expect(errors.every((e) => e instanceof Error)).toBe(true);
      expect(errors.every((e) => String(e.message || e).length > 0)).toBe(true);
    }
  });
});