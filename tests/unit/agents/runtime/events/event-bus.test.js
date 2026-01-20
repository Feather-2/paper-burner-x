import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedCore = vi.hoisted(() => {
  const EventBus = vi.fn(function EventBus(options) {
    this.options = options;
  });

  const LamportClock = vi.fn(function LamportClock(state) {
    this.state = state;
  });

  const RunStoreAdapter = vi.fn(function RunStoreAdapter(runStore) {
    this.runStore = runStore;
  });

  const createEventRecord = vi.fn((options) => ({ record: options }));
  const isValidEventName = vi.fn((name) => Boolean(name));
  const matchPattern = vi.fn((pattern, eventName) => pattern === eventName);

  return {
    EventBus,
    LamportClock,
    RunStoreAdapter,
    createEventRecord,
    isValidEventName,
    matchPattern,
  };
});

vi.mock("../../../../../js/agents/core/event-bus.js", () => mockedCore);

import EventBusDefault, {
  EventBus,
  LamportClock,
  RunStoreAdapter,
  createEventRecord,
  isValidEventName,
  matchPattern,
} from "../../../../../js/agents/runtime/events/event-bus.js";

const largeFileContent = "x".repeat(1024 * 1024);
const longPattern = "y".repeat(10000);
const deepNested = {
  level1: {
    level2: {
      level3: {
        level4: {
          level5: {
            value: "deep",
          },
        },
      },
    },
  },
};
const objectAsArray = { 0: "chunk", length: 1 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EventBus", () => {
  it("constructs with options and returns instance", () => {
    const options = { runId: "run-1" };
    const instance = new EventBus(options);

    expect(EventBus).toBe(mockedCore.EventBus);
    expect(mockedCore.EventBus).toHaveBeenCalledTimes(1);
    expect(mockedCore.EventBus).toHaveBeenCalledWith(options);
    expect(instance).toBeInstanceOf(mockedCore.EventBus);
  });

  it("forwards boundary constructor values", () => {
    const emptyOptions = {};
    new EventBus();
    new EventBus(null);
    new EventBus(emptyOptions);

    expect(mockedCore.EventBus.mock.calls.map((call) => call[0])).toEqual([
      undefined,
      null,
      emptyOptions,
    ]);
  });

  it("propagates constructor errors", () => {
    mockedCore.EventBus.mockImplementationOnce(function EventBusError() {
      throw new Error("EventBus ctor failed");
    });

    expect(() => new EventBus({ runId: "bad" })).toThrow("EventBus ctor failed");
  });
});

describe("LamportClock", () => {
  it("constructs with initial state", () => {
    const state = { id: "node-1" };
    const instance = new LamportClock(state);

    expect(LamportClock).toBe(mockedCore.LamportClock);
    expect(mockedCore.LamportClock).toHaveBeenCalledWith(state);
    expect(instance).toBeInstanceOf(mockedCore.LamportClock);
  });

  it("forwards numeric boundary states", () => {
    const states = [
      { seq: 0 },
      { seq: -1 },
      { seq: Number.MAX_SAFE_INTEGER },
    ];

    states.forEach((state) => new LamportClock(state));

    expect(mockedCore.LamportClock.mock.calls.map((call) => call[0])).toEqual(states);
  });

  it("propagates constructor errors", () => {
    mockedCore.LamportClock.mockImplementationOnce(function LamportClockError() {
      throw new Error("LamportClock ctor failed");
    });

    expect(() => new LamportClock({ seq: 1 })).toThrow("LamportClock ctor failed");
  });
});

describe("RunStoreAdapter", () => {
  it("constructs with a run store", () => {
    const runStore = { getEvents: vi.fn(), appendEvents: vi.fn() };
    const instance = new RunStoreAdapter(runStore);

    expect(RunStoreAdapter).toBe(mockedCore.RunStoreAdapter);
    expect(mockedCore.RunStoreAdapter).toHaveBeenCalledWith(runStore);
    expect(instance).toBeInstanceOf(mockedCore.RunStoreAdapter);
  });

  it("forwards boundary runStore values", () => {
    const emptyArray = [];
    new RunStoreAdapter(emptyArray);

    expect(mockedCore.RunStoreAdapter).toHaveBeenCalledWith(emptyArray);
  });

  it("propagates constructor errors", () => {
    mockedCore.RunStoreAdapter.mockImplementationOnce(function RunStoreAdapterError() {
      throw new Error("RunStoreAdapter ctor failed");
    });

    expect(() => new RunStoreAdapter({})).toThrow("RunStoreAdapter ctor failed");
  });
});

describe("createEventRecord", () => {
  it("returns record from core for typical options", () => {
    const options = { name: "event.normal", payload: { ok: true } };
    const expected = { ok: true };
    mockedCore.createEventRecord.mockReturnValueOnce(expected);

    const result = createEventRecord(options);

    expect(mockedCore.createEventRecord).toHaveBeenCalledWith(options);
    expect(result).toBe(expected);
  });

  it("forwards boundary and resource inputs", () => {
    const cases = [
      { name: "" },
      { durationMs: "123" },
      { payload: objectAsArray },
      { payload: largeFileContent },
      { meta: deepNested },
    ];

    const results = cases.map((options) => createEventRecord(options));

    expect(mockedCore.createEventRecord.mock.calls.map((call) => call[0])).toEqual(cases);
    results.forEach((result, index) => {
      expect(result).toEqual({ record: cases[index] });
    });
  });

  it("propagates errors from core", () => {
    mockedCore.createEventRecord.mockImplementationOnce(() => {
      throw new Error("createEventRecord failed");
    });

    expect(() => createEventRecord({ name: "boom" })).toThrow("createEventRecord failed");
  });

  it("supports concurrent calls", async () => {
    const optionsList = [
      { name: "evt.1" },
      { name: "evt.2" },
      { name: "evt.3" },
    ];

    const results = await Promise.all(
      optionsList.map((options) => Promise.resolve(createEventRecord(options)))
    );

    expect(mockedCore.createEventRecord).toHaveBeenCalledTimes(optionsList.length);
    results.forEach((result, index) => {
      expect(result).toEqual({ record: optionsList[index] });
    });
  });

  it("supports rapid consecutive calls", () => {
    for (let i = 0; i < 20; i += 1) {
      createEventRecord({ name: `evt.${i}` });
    }

    expect(mockedCore.createEventRecord).toHaveBeenCalledTimes(20);
  });
});

describe("isValidEventName", () => {
  it("returns value from core for a valid name", () => {
    mockedCore.isValidEventName.mockReturnValueOnce(true);

    const result = isValidEventName("user.login");

    expect(mockedCore.isValidEventName).toHaveBeenCalledWith("user.login");
    expect(result).toBe(true);
  });

  it("forwards boundary name inputs", () => {
    const whitespace = "   ";
    const result = isValidEventName(whitespace);

    expect(mockedCore.isValidEventName).toHaveBeenCalledWith(whitespace);
    expect(result).toBe(true);
  });

  it("propagates errors from core", () => {
    mockedCore.isValidEventName.mockImplementationOnce(() => {
      throw new Error("isValidEventName failed");
    });

    expect(() => isValidEventName("bad")).toThrow("isValidEventName failed");
  });
});

describe("matchPattern", () => {
  it("returns value from core for a typical pattern", () => {
    mockedCore.matchPattern.mockReturnValueOnce(false);

    const result = matchPattern("user.*", "user.login");

    expect(mockedCore.matchPattern).toHaveBeenCalledWith("user.*", "user.login");
    expect(result).toBe(false);
  });

  it("forwards long boundary patterns", () => {
    const result = matchPattern(longPattern, longPattern);

    expect(mockedCore.matchPattern).toHaveBeenCalledWith(longPattern, longPattern);
    expect(result).toBe(true);
  });

  it("propagates errors from core", () => {
    mockedCore.matchPattern.mockImplementationOnce(() => {
      throw new Error("matchPattern failed");
    });

    expect(() => matchPattern("x", "y")).toThrow("matchPattern failed");
  });
});

describe("default", () => {
  it("aliases EventBus and constructs normally", () => {
    const options = { runId: "default-run" };
    const instance = new EventBusDefault(options);

    expect(EventBusDefault).toBe(EventBus);
    expect(mockedCore.EventBus).toHaveBeenCalledWith(options);
    expect(instance).toBeInstanceOf(mockedCore.EventBus);
  });

  it("forwards boundary constructor input", () => {
    const emptyArray = [];
    const instance = new EventBusDefault(emptyArray);

    expect(mockedCore.EventBus).toHaveBeenCalledWith(emptyArray);
    expect(instance).toBeInstanceOf(mockedCore.EventBus);
  });

  it("propagates constructor errors", () => {
    mockedCore.EventBus.mockImplementationOnce(function EventBusDefaultError() {
      throw new Error("default ctor failed");
    });

    expect(() => new EventBusDefault({ runId: "bad" })).toThrow("default ctor failed");
  });
});
