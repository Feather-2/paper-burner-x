import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  toNonEmptyString: vi.fn((value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  }),
}));

import {
  LoopRuntimeStatuses,
  LOOP_RUNTIME_TRANSITIONS,
  LoopRuntimeState,
  getRuntimeState,
  setRuntimeState,
  ensureRuntimeState,
  clearRuntimeState,
} from "../../../../../js/agents/plugins/telemetry/loop-runtime-state.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LoopRuntimeStatuses", () => {
  it("exposes the expected frozen status map", () => {
    expect(Object.isFrozen(LoopRuntimeStatuses)).toBe(true);
    expect(LoopRuntimeStatuses).toEqual({
      IDLE: "idle",
      RUNNING: "running",
      PAUSED: "paused",
      COMPLETED: "completed",
      FAILED: "failed",
      CANCELLED: "cancelled",
    });
  });
});

describe("LOOP_RUNTIME_TRANSITIONS", () => {
  it("defines valid transitions and is frozen", () => {
    expect(Object.isFrozen(LOOP_RUNTIME_TRANSITIONS)).toBe(true);
    expect(Object.keys(LOOP_RUNTIME_TRANSITIONS).sort()).toEqual(
      Object.values(LoopRuntimeStatuses).sort(),
    );
    expect(LOOP_RUNTIME_TRANSITIONS[LoopRuntimeStatuses.IDLE]).toEqual([
      LoopRuntimeStatuses.RUNNING,
      LoopRuntimeStatuses.CANCELLED,
    ]);
    expect(LOOP_RUNTIME_TRANSITIONS[LoopRuntimeStatuses.RUNNING]).toEqual([
      LoopRuntimeStatuses.PAUSED,
      LoopRuntimeStatuses.COMPLETED,
      LoopRuntimeStatuses.FAILED,
      LoopRuntimeStatuses.CANCELLED,
    ]);
    expect(LOOP_RUNTIME_TRANSITIONS[LoopRuntimeStatuses.PAUSED]).toEqual([
      LoopRuntimeStatuses.RUNNING,
      LoopRuntimeStatuses.CANCELLED,
    ]);
    expect(LOOP_RUNTIME_TRANSITIONS[LoopRuntimeStatuses.COMPLETED]).toEqual([]);
    expect(LOOP_RUNTIME_TRANSITIONS[LoopRuntimeStatuses.FAILED]).toEqual([]);
    expect(LOOP_RUNTIME_TRANSITIONS[LoopRuntimeStatuses.CANCELLED]).toEqual([]);
  });
});

describe("LoopRuntimeState", () => {
  it("normalizes empty values in constructor", () => {
    const state = new LoopRuntimeState({
      status: null,
      cursor: undefined,
      pausedReason: "",
      lastCheckpointId: undefined,
      statusHistory: null,
    });

    expect(state.status).toBe(LoopRuntimeStatuses.IDLE);
    expect(state.cursor).toBeNull();
    expect(state.pausedReason).toBeNull();
    expect(state.lastCheckpointId).toBeNull();
    expect(state.statusHistory).toEqual([]);
  });

  it("normalizes cursor values and clones arrays/objects", () => {
    const emptyArray = [];
    const stateArray = new LoopRuntimeState({ cursor: emptyArray });
    expect(stateArray.cursor).toEqual([]);
    expect(stateArray.cursor).not.toBe(emptyArray);

    const emptyObject = {};
    const stateObject = new LoopRuntimeState({ cursor: emptyObject });
    expect(stateObject.cursor).toEqual({});
    expect(stateObject.cursor).not.toBe(emptyObject);

    const arrayLike = { 0: "zero", length: 1 };
    const stateArrayLike = new LoopRuntimeState({ cursor: arrayLike });
    expect(stateArrayLike.cursor).toEqual(arrayLike);
    expect(stateArrayLike.cursor).not.toBe(arrayLike);
  });

  it("handles large inputs and deep nesting", () => {
    const deepNested = { level1: { level2: { value: 42 } } };
    const largeArray = Array.from({ length: 10000 }, (_, i) => i);
    const hugeString = "x".repeat(100000);

    const state = new LoopRuntimeState({
      cursor: deepNested,
      pausedReason: hugeString,
    });

    expect(state.cursor).toEqual(deepNested);
    expect(state.cursor).not.toBe(deepNested);
    expect(state.cursor.level1).toBe(deepNested.level1);
    expect(state.pausedReason).toBe(hugeString);

    const arrayState = new LoopRuntimeState({ cursor: largeArray });
    expect(arrayState.cursor).toEqual(largeArray);
    expect(arrayState.cursor).not.toBe(largeArray);
  });

  it("normalizes status and ids with boundary values", () => {
    const whitespaceStatus = new LoopRuntimeState({ status: "   " });
    expect(whitespaceStatus.status).toBe(LoopRuntimeStatuses.IDLE);

    const zeroStatus = new LoopRuntimeState({ status: 0 });
    expect(zeroStatus.status).toBe(LoopRuntimeStatuses.IDLE);

    const negativeStatus = new LoopRuntimeState({ status: -1 });
    expect(negativeStatus.status).toBe(LoopRuntimeStatuses.IDLE);

    const trimmedStatus = new LoopRuntimeState({ status: "  running  " });
    expect(trimmedStatus.status).toBe(LoopRuntimeStatuses.RUNNING);

    const maxIdState = new LoopRuntimeState({
      status: LoopRuntimeStatuses.RUNNING,
      lastCheckpointId: Number.MAX_SAFE_INTEGER,
    });
    expect(maxIdState.lastCheckpointId).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it("normalizes status history timestamps and defaults", () => {
    const fixedNow = new Date("2024-01-02T03:04:05.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    try {
      const state = new LoopRuntimeState({
        statusHistory: [
          { from: 0, to: "running", timestamp: 0 },
          { from: "paused", to: "running", timestamp: -1 },
          { from: "running", to: "paused", timestamp: "   " },
          null,
        ],
      });

      expect(state.statusHistory).toHaveLength(4);
      expect(state.statusHistory[0]).toEqual({
        from: "0",
        to: "running",
        timestamp: new Date(0).toISOString(),
      });
      expect(state.statusHistory[1]).toEqual({
        from: "paused",
        to: "running",
        timestamp: new Date(-1).toISOString(),
      });
      expect(state.statusHistory[2].timestamp).toBe(fixedNow.toISOString());
      expect(state.statusHistory[3]).toEqual({
        from: null,
        to: null,
        timestamp: fixedNow.toISOString(),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("canTransition respects allowed transitions and rejects invalid input", () => {
    const state = new LoopRuntimeState({ status: LoopRuntimeStatuses.IDLE });
    expect(state.canTransition(LoopRuntimeStatuses.RUNNING)).toBe(true);
    expect(state.canTransition(LoopRuntimeStatuses.CANCELLED)).toBe(true);
    expect(state.canTransition(LoopRuntimeStatuses.COMPLETED)).toBe(false);
    expect(state.canTransition(undefined)).toBe(false);
    expect(state.canTransition("unknown")).toBe(false);
  });

  it("transitionTo updates status and records history with numeric timestamp", () => {
    const state = new LoopRuntimeState({ status: LoopRuntimeStatuses.IDLE });

    const result = state.transitionTo(LoopRuntimeStatuses.RUNNING, { timestamp: 0 });

    expect(result).toBe(LoopRuntimeStatuses.RUNNING);
    expect(state.status).toBe(LoopRuntimeStatuses.RUNNING);
    expect(state.statusHistory).toEqual([
      {
        from: "idle",
        to: "running",
        timestamp: new Date(0).toISOString(),
      },
    ]);
  });

  it("transitionTo keeps string timestamps and supports rapid consecutive transitions", () => {
    const state = new LoopRuntimeState({ status: LoopRuntimeStatuses.IDLE });

    state.transitionTo(LoopRuntimeStatuses.RUNNING, { timestamp: "123" });
    state.transitionTo(LoopRuntimeStatuses.PAUSED, { timestamp: "t2" });
    state.transitionTo(LoopRuntimeStatuses.RUNNING, { timestamp: "t3" });

    expect(state.status).toBe(LoopRuntimeStatuses.RUNNING);
    expect(state.statusHistory.map((item) => item.timestamp)).toEqual(["123", "t2", "t3"]);
  });

  it("transitionTo throws for invalid transitions", () => {
    const state = new LoopRuntimeState({ status: LoopRuntimeStatuses.RUNNING });

    expect(() => state.transitionTo(LoopRuntimeStatuses.IDLE)).toThrowError(
      "Invalid runtime transition: running -> idle",
    );
  });

  it("transitionTo uses current time when timestamp is blank", () => {
    const now = new Date("2024-06-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const state = new LoopRuntimeState({ status: LoopRuntimeStatuses.IDLE });
      state.transitionTo(LoopRuntimeStatuses.RUNNING, { timestamp: "   " });

      expect(state.statusHistory[0].timestamp).toBe(now.toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes and deserializes state", () => {
    const originalCursor = { a: 1 };
    const history = [{ from: "idle", to: "running", timestamp: "t1" }];
    const state = new LoopRuntimeState({
      status: LoopRuntimeStatuses.RUNNING,
      cursor: originalCursor,
      pausedReason: "pause",
      lastCheckpointId: "chk-1",
      statusHistory: history,
    });

    const json = state.toJSON();

    expect(json).toEqual({
      status: "running",
      cursor: { a: 1 },
      pausedReason: "pause",
      lastCheckpointId: "chk-1",
      statusHistory: [
        {
          from: "idle",
          to: "running",
          timestamp: "t1",
        },
      ],
    });
    expect(json.cursor).not.toBe(originalCursor);

    const restored = LoopRuntimeState.fromJSON(json);
    expect(restored).toBeInstanceOf(LoopRuntimeState);
    expect(restored.toJSON()).toEqual(json);
  });

  it("fromJSON handles non-object payloads", () => {
    const restored = LoopRuntimeState.fromJSON("not-an-object");
    expect(restored.status).toBe(LoopRuntimeStatuses.IDLE);
    expect(restored.cursor).toBeNull();
    expect(restored.statusHistory).toEqual([]);
  });
});

describe("getRuntimeState", () => {
  it("returns null for invalid signals", () => {
    expect(getRuntimeState(null)).toBeNull();
    expect(getRuntimeState(undefined)).toBeNull();
    expect(getRuntimeState("signal")).toBeNull();
    expect(getRuntimeState(0)).toBeNull();
  });

  it("returns stored state for a signal", () => {
    const signal = {};
    const state = new LoopRuntimeState({ status: LoopRuntimeStatuses.RUNNING });
    setRuntimeState(signal, state);

    expect(getRuntimeState(signal)).toBe(state);
  });
});

describe("setRuntimeState", () => {
  it("throws when signal is not an object", () => {
    expect(() => setRuntimeState(null, {})).toThrowError(
      "setRuntimeState(signal, state): signal must be an object",
    );
  });

  it("stores a new LoopRuntimeState when given plain data", () => {
    const signal = {};
    const result = setRuntimeState(signal, {
      status: "running",
      cursor: "cursor",
      lastCheckpointId: "checkpoint",
    });

    expect(result).toBeInstanceOf(LoopRuntimeState);
    expect(result.status).toBe(LoopRuntimeStatuses.RUNNING);
    expect(getRuntimeState(signal)).toBe(result);
  });

  it("stores the provided LoopRuntimeState instance", () => {
    const signal = {};
    const state = new LoopRuntimeState({ status: LoopRuntimeStatuses.PAUSED });
    const result = setRuntimeState(signal, state);

    expect(result).toBe(state);
    expect(getRuntimeState(signal)).toBe(state);
  });

  it("overwrites runtime state on rapid consecutive calls", () => {
    const signal = {};
    const first = setRuntimeState(signal, { status: "running" });
    const second = setRuntimeState(signal, { status: "paused" });

    expect(first).not.toBe(second);
    expect(getRuntimeState(signal)).toBe(second);
    expect(getRuntimeState(signal).status).toBe(LoopRuntimeStatuses.PAUSED);
  });
});

describe("ensureRuntimeState", () => {
  it("returns existing state when present", () => {
    const signal = {};
    const existing = setRuntimeState(signal, { status: "running" });

    const ensured = ensureRuntimeState(signal, { status: "paused" });

    expect(ensured).toBe(existing);
    expect(ensured.status).toBe(LoopRuntimeStatuses.RUNNING);
  });

  it("creates a new state when none exists", () => {
    const signal = {};
    const ensured = ensureRuntimeState(signal, { status: "paused" });

    expect(ensured).toBeInstanceOf(LoopRuntimeState);
    expect(ensured.status).toBe(LoopRuntimeStatuses.PAUSED);
  });

  it("handles concurrent ensure calls consistently", async () => {
    const signal = {};

    const results = await Promise.all([
      Promise.resolve().then(() => ensureRuntimeState(signal, { status: "running" })),
      Promise.resolve().then(() => ensureRuntimeState(signal, { status: "paused" })),
      Promise.resolve().then(() => ensureRuntimeState(signal, { status: "failed" })),
    ]);

    expect(new Set(results).size).toBe(1);
    expect(results[0].status).toBe(LoopRuntimeStatuses.RUNNING);
  });
});

describe("clearRuntimeState", () => {
  it("ignores invalid signals", () => {
    expect(() => clearRuntimeState(null)).not.toThrow();
    expect(() => clearRuntimeState(undefined)).not.toThrow();
    expect(() => clearRuntimeState("signal")).not.toThrow();
  });

  it("removes stored state for a signal", () => {
    const signal = {};
    setRuntimeState(signal, { status: "running" });

    clearRuntimeState(signal);

    expect(getRuntimeState(signal)).toBeNull();
  });
});
