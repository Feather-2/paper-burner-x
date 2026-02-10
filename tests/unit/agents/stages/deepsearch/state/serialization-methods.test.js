import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  isPlainObject: vi.fn(),
  protoSafeReviver: (_key, value) => value,
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/state/serializer.js", () => ({
  toSnapshot: vi.fn(),
}));

import { serializationMethods, deserialize } from "../../../../../../js/agents/stages/deepsearch/state/serialization-methods.js";
import { isPlainObject } from "../../../../../../js/agents/shared/index.js";
import { toSnapshot } from "../../../../../../js/agents/stages/deepsearch/state/serializer.js";

const MAX_DESERIALIZE_LENGTH = 1024 * 1024;

const buildSnapshot = (overrides = {}) => ({
  schemaVersion: "v1",
  runId: "run",
  createdAt: "2024-01-01T00:00:00.000Z",
  taskGoal: "",
  userConfig: {},
  planningTree: null,
  trajectoryId: "traj",
  trajectoryConfig: {},
  iteration: 0,
  maxIterations: -1,
  checkpoints: [],
  writeBacktrackCount: Number.MAX_SAFE_INTEGER,
  writeSnapshots: [],
  L0: {},
  L1: {},
  L2: {},
  todos: [],
  timeline: [],
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  isPlainObject.mockImplementation((value) => value !== null && typeof value === "object" && !Array.isArray(value));
});

describe("serializationMethods", () => {
  it("toSnapshot delegates to serializer with default options", () => {
    const ctx = { state: "x" };
    toSnapshot.mockReturnValue({ ok: true });
    const result = serializationMethods.toSnapshot.call(ctx);
    expect(toSnapshot).toHaveBeenCalledTimes(1);
    expect(toSnapshot).toHaveBeenCalledWith(ctx, { includeCheckpoints: true });
    expect(result).toEqual({ ok: true });
  });

  it("toSnapshot forwards includeCheckpoints option", () => {
    const ctx = { state: "y" };
    toSnapshot.mockReturnValue({ ok: false });
    const result = serializationMethods.toSnapshot.call(ctx, { includeCheckpoints: false });
    expect(toSnapshot).toHaveBeenCalledWith(ctx, { includeCheckpoints: false });
    expect(result).toEqual({ ok: false });
  });

  it("serialize stringifies toJSON output without pretty by default", () => {
    const payload = {
      a: null,
      b: undefined,
      c: "",
      d: [],
      e: {},
      f: 0,
      g: -1,
      h: Number.MAX_SAFE_INTEGER,
    };
    const ctx = { toJSON: vi.fn(() => payload) };
    const result = serializationMethods.serialize.call(ctx);
    expect(ctx.toJSON).toHaveBeenCalledTimes(1);
    expect(result).toBe(
      JSON.stringify({
        a: null,
        c: "",
        d: [],
        e: {},
        f: 0,
        g: -1,
        h: Number.MAX_SAFE_INTEGER,
      }),
    );
  });

  it("serialize pretty prints with two spaces when requested", () => {
    const ctx = { toJSON: vi.fn(() => ({ ok: true })) };
    const result = serializationMethods.serialize.call(ctx, { pretty: true });
    expect(result).toBe(JSON.stringify({ ok: true }, null, 2));
  });

  it("clone uses toSnapshot and constructor.fromJSON with default options", () => {
    const snapshot = { runId: "r1" };
    const cloned = { runId: "r1", cloned: true };
    const ctx = {
      toSnapshot: vi.fn(() => snapshot),
      constructor: { fromJSON: vi.fn(() => cloned) },
    };
    const result = serializationMethods.clone.call(ctx);
    expect(ctx.toSnapshot).toHaveBeenCalledWith({ includeCheckpoints: true });
    expect(ctx.constructor.fromJSON).toHaveBeenCalledWith(snapshot);
    expect(result).toBe(cloned);
  });

  it("clone forwards includeCheckpoints option", () => {
    const snapshot = { runId: "r2" };
    const cloned = { runId: "r2", cloned: true };
    const ctx = {
      toSnapshot: vi.fn(() => snapshot),
      constructor: { fromJSON: vi.fn(() => cloned) },
    };
    const result = serializationMethods.clone.call(ctx, { includeCheckpoints: false });
    expect(ctx.toSnapshot).toHaveBeenCalledWith({ includeCheckpoints: false });
    expect(ctx.constructor.fromJSON).toHaveBeenCalledWith(snapshot);
    expect(result).toBe(cloned);
  });
});

describe("deserialize", () => {
  it.each([
    { value: null, label: "null" },
    { value: undefined, label: "undefined" },
    { value: "", label: "empty string" },
  ])("throws for non-string or empty string input ($label)", ({ value }) => {
    const receiver = { fromJSON: vi.fn() };
    expect(() => deserialize.call(receiver, value)).toThrow(TypeError);
    expect(receiver.fromJSON).not.toHaveBeenCalled();
  });

  it("throws when input exceeds the maximum length", () => {
    const receiver = { fromJSON: vi.fn() };
    const tooLong = "a".repeat(MAX_DESERIALIZE_LENGTH + 1);
    expect(() => deserialize.call(receiver, tooLong)).toThrow(TypeError);
    expect(receiver.fromJSON).not.toHaveBeenCalled();
  });

  it("throws SyntaxError for invalid JSON including whitespace-only strings", () => {
    const receiver = { fromJSON: vi.fn() };
    expect(() => deserialize.call(receiver, "   ")).toThrow(/deserialize: invalid JSON/);
    expect(receiver.fromJSON).not.toHaveBeenCalled();
  });

  it("throws when parsed value is not an object", () => {
    const receiver = { fromJSON: vi.fn() };
    expect(() => deserialize.call(receiver, "42")).toThrow(/parsed value must be an object/);
    expect(receiver.fromJSON).not.toHaveBeenCalled();
  });

  it("throws when parsed value is not a plain object", () => {
    const receiver = { fromJSON: vi.fn() };
    expect(() => deserialize.call(receiver, "[]")).toThrow(/parsed value must be a plain object/);
    expect(receiver.fromJSON).not.toHaveBeenCalled();
  });

  it("accepts an empty object snapshot", () => {
    const receiver = { fromJSON: vi.fn((json) => json) };
    const result = deserialize.call(receiver, "{}");
    expect(receiver.fromJSON).toHaveBeenCalledWith({});
    expect(result).toEqual({});
  });

  it("accepts planningTree null and empty collections", () => {
    const receiver = { fromJSON: vi.fn((json) => json) };
    const snapshot = buildSnapshot({
      planningTree: null,
      userConfig: {},
      trajectoryConfig: {},
      checkpoints: [],
      writeSnapshots: [],
      todos: [],
      timeline: [],
      L0: {},
      L1: {},
      L2: {},
    });
    const result = deserialize.call(receiver, JSON.stringify(snapshot));
    expect(result.planningTree).toBeNull();
    expect(result.checkpoints).toEqual([]);
    expect(result.userConfig).toEqual({});
  });

  it("throws when a string field is not a string", () => {
    const receiver = { fromJSON: vi.fn() };
    const text = JSON.stringify({ runId: 123 });
    expect(() => deserialize.call(receiver, text)).toThrow(/runId must be a string/);
    expect(receiver.fromJSON).not.toHaveBeenCalled();
  });

  it("throws when a number field is not a finite number", () => {
    const receiver = { fromJSON: vi.fn() };
    const text = JSON.stringify({ iteration: "1" });
    expect(() => deserialize.call(receiver, text)).toThrow(/iteration must be a finite number/);
    expect(receiver.fromJSON).not.toHaveBeenCalled();
  });

  it("throws when a number field is non-finite", () => {
    const receiver = { fromJSON: vi.fn() };
    const text = '{"maxIterations":1e309}';
    expect(() => deserialize.call(receiver, text)).toThrow(/maxIterations must be a finite number/);
    expect(receiver.fromJSON).not.toHaveBeenCalled();
  });

  it("throws when an array field is not an array", () => {
    const receiver = { fromJSON: vi.fn() };
    const text = JSON.stringify({ checkpoints: {} });
    expect(() => deserialize.call(receiver, text)).toThrow(/checkpoints must be an array/);
    expect(receiver.fromJSON).not.toHaveBeenCalled();
  });

  it("throws when an object field is not a plain object or null when disallowed", () => {
    const receiver = { fromJSON: vi.fn() };
    const text = JSON.stringify({ userConfig: [] });
    expect(() => deserialize.call(receiver, text)).toThrow(/userConfig must be an object/);
    const textNull = JSON.stringify({ trajectoryConfig: null });
    expect(() => deserialize.call(receiver, textNull)).toThrow(/trajectoryConfig must be an object/);
    expect(receiver.fromJSON).not.toHaveBeenCalled();
  });

  it("sanitizes snapshot keys, removes dangerous properties, and preserves boundary values", () => {
    const receiver = { fromJSON: vi.fn((json) => json) };
    const userConfig = JSON.parse(
      '{"safe":"ok","__proto__":{"polluted":true},"nested":{"constructor":"bad","ok":1}}',
    );
    userConfig.deep = JSON.parse(
      '{"level1":{"level2":{"level3":{"level4":{"level5":{"value":"deep","prototype":"drop"}}}}}}',
    );
    const trajectoryConfig = JSON.parse('{"depth":{"level":{"prototype":"drop","ok":2}}}');
    const todos = JSON.parse(
      '[{"id":1,"title":"","constructor":"bad","items":[{"__proto__":{"x":1},"ok":true}]}]',
    );
    const L0 = JSON.parse('{"items":[{"prototype":"bad","value":1}]}');
    const snapshot = buildSnapshot({
      runId: "   ",
      taskGoal: "",
      userConfig,
      trajectoryConfig,
      todos,
      L0,
      extraKey: "drop",
    });
    const result = deserialize.call(receiver, JSON.stringify(snapshot));
    const sanitized = receiver.fromJSON.mock.calls[0][0];
    expect(sanitized).not.toHaveProperty("extraKey");
    expect(Object.prototype.hasOwnProperty.call(sanitized.userConfig, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(sanitized.userConfig.nested, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(sanitized.userConfig.deep.level1.level2.level3.level4.level5, "prototype")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(sanitized.trajectoryConfig.depth.level, "prototype")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(sanitized.todos[0], "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(sanitized.todos[0].items[0], "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(sanitized.L0.items[0], "prototype")).toBe(false);
    expect(sanitized.userConfig.deep.level1.level2.level3.level4.level5.value).toBe("deep");
    expect(sanitized.iteration).toBe(0);
    expect(sanitized.maxIterations).toBe(-1);
    expect(sanitized.writeBacktrackCount).toBe(Number.MAX_SAFE_INTEGER);
    expect(sanitized.runId).toBe("   ");
    expect(sanitized.taskGoal).toBe("");
    expect(result).toEqual(sanitized);
  });

  it("handles concurrent calls without cross-talk", async () => {
    const receiver = { fromJSON: vi.fn((json) => json) };
    const texts = ["r1", "r2", "r3"].map((runId) => JSON.stringify(buildSnapshot({ runId })));
    const results = await Promise.all(texts.map((text) => Promise.resolve().then(() => deserialize.call(receiver, text))));
    const runIds = results.map((result) => result.runId);
    expect(runIds).toEqual(expect.arrayContaining(["r1", "r2", "r3"]));
    expect(receiver.fromJSON).toHaveBeenCalledTimes(3);
    const calledRunIds = receiver.fromJSON.mock.calls.map((call) => call[0].runId);
    expect(calledRunIds).toEqual(expect.arrayContaining(["r1", "r2", "r3"]));
  });

  it("handles rapid sequential calls", () => {
    const receiver = { fromJSON: vi.fn((json) => json) };
    const ids = ["s1", "s2", "s3", "s4"];
    const results = ids.map((runId) => deserialize.call(receiver, JSON.stringify(buildSnapshot({ runId }))));
    expect(results.map((result) => result.runId)).toEqual(expect.arrayContaining(ids));
    expect(receiver.fromJSON).toHaveBeenCalledTimes(ids.length);
  });
});
