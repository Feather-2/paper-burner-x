import { describe, it, expect, vi, beforeEach } from "vitest";

const WRAPPER_ID = "../../../../../js/agents/runtime/events/event-bus.js";
const CORE_ID = "../../../../../js/agents/core/event-bus.js";

const eventBusCtorSpy = vi.fn();
const lamportClockCtorSpy = vi.fn();
const runStoreAdapterCtorSpy = vi.fn();

class MockEventBus {
  constructor(options) {
    eventBusCtorSpy(options);
    if (options && typeof options === "object" && options.throwOnConstruct) {
      throw new Error("EventBus ctor error");
    }
    this.options = options;
  }
}

class MockLamportClock {
  constructor(options) {
    lamportClockCtorSpy(options);
    if (options && typeof options === "object" && options.throwOnConstruct) {
      throw new Error("LamportClock ctor error");
    }
    this.options = options;
  }
}

class MockRunStoreAdapter {
  constructor(options) {
    runStoreAdapterCtorSpy(options);
    if (options && typeof options === "object" && options.throwOnConstruct) {
      throw new Error("RunStoreAdapter ctor error");
    }
    this.options = options;
  }
}

let recordId = 0;

const createEventRecordMock = vi.fn();
const isValidEventNameMock = vi.fn();
const matchPatternMock = vi.fn();

function wildcardMatch(pattern, value) {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return pattern === value;

  const parts = pattern.split("*");
  const startsWithStar = pattern.startsWith("*");
  const endsWithStar = pattern.endsWith("*");

  let index = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "") continue;

    const found = value.indexOf(part, index);
    if (found === -1) return false;
    if (i === 0 && !startsWithStar && found !== 0) return false;

    index = found + part.length;
  }

  if (!endsWithStar) {
    const lastPart = parts[parts.length - 1];
    if (lastPart !== "" && !value.endsWith(lastPart)) return false;
  }

  return true;
}

function resetDefaultImplementations() {
  recordId = 0;

  createEventRecordMock.mockImplementation((options) => ({
    id: ++recordId,
    options,
  }));

  isValidEventNameMock.mockImplementation((name) => {
    if (typeof name !== "string") return false;
    const trimmed = name.trim();
    if (trimmed.length === 0) return false;
    if (/\s/.test(name)) return false;
    return true;
  });

  matchPatternMock.mockImplementation((pattern, eventName) => {
    if (typeof pattern !== "string" || typeof eventName !== "string") {
      throw new TypeError("pattern and eventName must be strings");
    }
    return wildcardMatch(pattern, eventName);
  });
}

vi.mock("../../../../../js/agents/core/event-bus.js", () => ({
  EventBus: MockEventBus,
  LamportClock: MockLamportClock,
  RunStoreAdapter: MockRunStoreAdapter,
  createEventRecord: createEventRecordMock,
  isValidEventName: isValidEventNameMock,
  matchPattern: matchPatternMock,
}));

beforeEach(() => {
  vi.resetModules();

  eventBusCtorSpy.mockReset();
  lamportClockCtorSpy.mockReset();
  runStoreAdapterCtorSpy.mockReset();

  createEventRecordMock.mockReset();
  isValidEventNameMock.mockReset();
  matchPatternMock.mockReset();

  resetDefaultImplementations();
});

async function importCompat() {
  return import(WRAPPER_ID);
}
async function importCore() {
  return import(CORE_ID);
}

describe("EventBus", () => {
  it("re-exports core EventBus class", async () => {
    const compat = await importCompat();
    const core = await importCore();
    expect(compat.EventBus).toBe(core.EventBus);
  });

  it("constructs and forwards options (normal + boundary values)", async () => {
    const { EventBus } = await importCompat();

    const deep = { level: 0 };
    let cursor = deep;
    for (let i = 1; i <= 30; i++) {
      cursor.next = { level: i };
      cursor = cursor.next;
    }

    const bigBinary = new Uint8Array(1024 * 1024);
    const longString = "x".repeat(200_000);

    const options = {
      limit: 0,
      min: -1,
      max: Number.MAX_SAFE_INTEGER,
      blank: "   ",
      emptyArr: [],
      emptyObj: {},
      deep,
      bigBinary,
      longString,
      numericAsString: "123",
    };

    const bus = new EventBus(options);
    expect(bus).toBeInstanceOf(EventBus);
    expect(bus.options).toBe(options);
    expect(eventBusCtorSpy).toHaveBeenCalledTimes(1);
    expect(eventBusCtorSpy).toHaveBeenCalledWith(options);
  });

  it("accepts undefined/null options", async () => {
    const { EventBus } = await importCompat();

    new EventBus();
    new EventBus(undefined);
    new EventBus(null);

    expect(eventBusCtorSpy).toHaveBeenCalledTimes(3);
    expect(eventBusCtorSpy).toHaveBeenCalledWith(undefined);
    expect(eventBusCtorSpy).toHaveBeenCalledWith(null);
  });

  it("surfaces constructor errors", async () => {
    const { EventBus } = await importCompat();
    expect(() => new EventBus({ throwOnConstruct: true })).toThrow("EventBus ctor error");
    expect(eventBusCtorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("LamportClock", () => {
  it("re-exports core LamportClock class", async () => {
    const compat = await importCompat();
    const core = await importCore();
    expect(compat.LamportClock).toBe(core.LamportClock);
  });

  it("constructs and forwards options (including numeric boundaries)", async () => {
    const { LamportClock } = await importCompat();

    const options = { seed: 0, offset: -1, cap: Number.MAX_SAFE_INTEGER, emptyObj: {}, emptyArr: [] };
    const clock = new LamportClock(options);

    expect(clock).toBeInstanceOf(LamportClock);
    expect(clock.options).toBe(options);
    expect(lamportClockCtorSpy).toHaveBeenCalledTimes(1);
    expect(lamportClockCtorSpy).toHaveBeenCalledWith(options);
  });

  it("surfaces constructor errors", async () => {
    const { LamportClock } = await importCompat();
    expect(() => new LamportClock({ throwOnConstruct: true })).toThrow("LamportClock ctor error");
    expect(lamportClockCtorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("RunStoreAdapter", () => {
  it("re-exports core RunStoreAdapter class", async () => {
    const compat = await importCompat();
    const core = await importCore();
    expect(compat.RunStoreAdapter).toBe(core.RunStoreAdapter);
  });

  it("constructs and forwards options (including null/empty)", async () => {
    const { RunStoreAdapter } = await importCompat();

    const a = new RunStoreAdapter({});
    const b = new RunStoreAdapter([]);
    const c = new RunStoreAdapter(null);

    expect(a).toBeInstanceOf(RunStoreAdapter);
    expect(b).toBeInstanceOf(RunStoreAdapter);
    expect(c).toBeInstanceOf(RunStoreAdapter);

    expect(runStoreAdapterCtorSpy).toHaveBeenCalledTimes(3);
    expect(runStoreAdapterCtorSpy).toHaveBeenCalledWith({});
    expect(runStoreAdapterCtorSpy).toHaveBeenCalledWith([]);
    expect(runStoreAdapterCtorSpy).toHaveBeenCalledWith(null);
  });

  it("surfaces constructor errors", async () => {
    const { RunStoreAdapter } = await importCompat();
    expect(() => new RunStoreAdapter({ throwOnConstruct: true })).toThrow("RunStoreAdapter ctor error");
    expect(runStoreAdapterCtorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createEventRecord", () => {
  it("re-exports core createEventRecord", async () => {
    const compat = await importCompat();
    const core = await importCore();
    expect(compat.createEventRecord).toBe(core.createEventRecord);
  });

  it("returns value from core and forwards options", async () => {
    const { createEventRecord } = await importCompat();

    const options = { name: "event.created", payload: { a: 1 } };
    const record = createEventRecord(options);

    expect(record).toEqual({ id: 1, options });
    expect(createEventRecordMock).toHaveBeenCalledTimes(1);
    expect(createEventRecordMock).toHaveBeenCalledWith(options);
  });

  it("handles null/undefined/empty and type-boundary options", async () => {
    const { createEventRecord } = await importCompat();

    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const longString = "y".repeat(100_000);

    const inputs = [
      undefined,
      null,
      "",
      "   ",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      deep,
      longString,
      "123",
    ];

    const results = inputs.map((value) => createEventRecord(value));

    expect(results).toHaveLength(inputs.length);
    expect(createEventRecordMock).toHaveBeenCalledTimes(inputs.length);

    for (let i = 0; i < inputs.length; i++) {
      expect(results[i].options).toBe(inputs[i]);
    }
  });

  it("surfaces errors from core createEventRecord", async () => {
    const { createEventRecord } = await importCompat();

    createEventRecordMock.mockImplementationOnce(() => {
      throw new TypeError("bad options");
    });

    let err;
    try {
      createEventRecord({});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TypeError);
    expect(err?.message).toBe("bad options");
    expect(createEventRecordMock).toHaveBeenCalledTimes(1);
  });

  it("supports fast concurrent calls without cross-talk", async () => {
    const { createEventRecord } = await importCompat();

    const tasks = Array.from({ length: 25 }, (_, i) =>
      Promise.resolve().then(() => createEventRecord({ seq: i }))
    );

    const records = await Promise.all(tasks);

    expect(records).toHaveLength(25);
    expect(createEventRecordMock).toHaveBeenCalledTimes(25);

    const ids = new Set(records.map((r) => r.id));
    expect(ids.size).toBe(25);
    for (let i = 0; i < 25; i++) {
      expect(records[i].options).toEqual({ seq: i });
    }
  });
});

describe("isValidEventName", () => {
  it("re-exports core isValidEventName", async () => {
    const compat = await importCompat();
    const core = await importCore();
    expect(compat.isValidEventName).toBe(core.isValidEventName);
  });

  it("returns booleans for normal + boundary + type-edge inputs", async () => {
    const { isValidEventName } = await importCompat();

    const cases = [
      ["event.created", true],
      ["foo.bar", true],
      ["a", true],
      ["0", true],
      ["", false],
      ["   ", false],
      ["has space", false],
      [null, false],
      [undefined, false],
      [[], false],
      [{}, false],
      [0, false],
      [-1, false],
      [Number.MAX_SAFE_INTEGER, false],
    ];

    for (const [input, expected] of cases) {
      expect(isValidEventName(input)).toBe(expected);
      expect(isValidEventNameMock).toHaveBeenCalledWith(input);
    }

    expect(isValidEventNameMock).toHaveBeenCalledTimes(cases.length);
  });

  it("surfaces errors from core isValidEventName", async () => {
    const { isValidEventName } = await importCompat();

    isValidEventNameMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    expect(() => isValidEventName("event.created")).toThrow("boom");
    expect(isValidEventNameMock).toHaveBeenCalledTimes(1);
  });

  it("handles rapid consecutive calls deterministically", async () => {
    const { isValidEventName } = await importCompat();

    const inputs = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? "ok" : "bad name"));
    const results = inputs.map((v) => isValidEventName(v));

    expect(results.filter(Boolean)).toHaveLength(25);
    expect(isValidEventNameMock).toHaveBeenCalledTimes(50);
  });
});

describe("matchPattern", () => {
  it("re-exports core matchPattern", async () => {
    const compat = await importCompat();
    const core = await importCore();
    expect(compat.matchPattern).toBe(core.matchPattern);
  });

  it("matches exact and wildcard patterns (normal path)", async () => {
    const { matchPattern } = await importCompat();

    expect(matchPattern("foo", "foo")).toBe(true);
    expect(matchPattern("foo", "bar")).toBe(false);
    expect(matchPattern("*", "anything.really")).toBe(true);
    expect(matchPattern("foo.*", "foo.bar")).toBe(true);
    expect(matchPattern("foo.*", "foobar")).toBe(false);
    expect(matchPattern("foo*bar", "foo123bar")).toBe(true);

    expect(matchPatternMock).toHaveBeenCalledTimes(6);
  });

  it("handles empty/whitespace and very long strings (resource boundary)", async () => {
    const { matchPattern } = await importCompat();

    expect(matchPattern("", "")).toBe(true);
    expect(matchPattern("", "x")).toBe(false);
    expect(matchPattern("   ", "   ")).toBe(true);

    const longA = "a".repeat(80_000);
    const longB = `${longA}SUFFIX`;
    expect(matchPattern(`${longA}*`, longB)).toBe(true);
    expect(matchPattern(`${longA}*TAIL`, longB)).toBe(false);

    expect(matchPatternMock).toHaveBeenCalledTimes(5);
  });

  it("throws on non-string inputs (type boundary + error handling)", async () => {
    const { matchPattern } = await importCompat();

    expect(() => matchPattern(123, "event")).toThrow(TypeError);
    expect(() => matchPattern("event.*", 456)).toThrow(TypeError);
    expect(() => matchPattern({}, [])).toThrow(TypeError);

    expect(matchPatternMock).toHaveBeenCalledTimes(3);
  });

  it("supports concurrent matching calls", async () => {
    const { matchPattern } = await importCompat();

    const tasks = Array.from({ length: 20 }, (_, i) =>
      Promise.resolve().then(() => matchPattern(i % 2 === 0 ? "x*" : "*y", i % 2 === 0 ? "xyz" : "qwy"))
    );

    const results = await Promise.all(tasks);

    expect(results).toHaveLength(20);
    expect(results.filter(Boolean)).toHaveLength(20);
    expect(matchPatternMock).toHaveBeenCalledTimes(20);
  });
});

describe("default", () => {
  it("exports EventBus as default", async () => {
    const compat = await importCompat();
    const core = await importCore();

    expect(compat.default).toBe(compat.EventBus);
    expect(compat.default).toBe(core.EventBus);
  });

  it("default export is constructable and forwards options", async () => {
    const compat = await importCompat();

    const bus = new compat.default({ fromDefault: true, n: 0 });
    expect(bus).toBeInstanceOf(compat.EventBus);
    expect(eventBusCtorSpy).toHaveBeenCalledTimes(1);
    expect(eventBusCtorSpy).toHaveBeenCalledWith({ fromDefault: true, n: 0 });
  });
});
