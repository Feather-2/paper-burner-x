import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
  };
});

import {
  StageTimeoutError,
  StageCancelledError,
  StagePausedError,
  abortReasonToMessage,
  cancelledErrorFromSignal,
  toErrorPayload,
} from "../../../../../js/agents/runtime/core/stage-errors.js";
import { toNonEmptyString } from "../../../../../js/agents/shared/index.js";

const mockedToNonEmptyString = vi.mocked(toNonEmptyString);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("StageTimeoutError", () => {
  it("sets name and metadata", () => {
    const err = new StageTimeoutError("Timeout", { stageName: "stage-a", timeoutMs: 1500 });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("StageTimeoutError");
    expect(err.message).toBe("Timeout");
    expect(err.stageName).toBe("stage-a");
    expect(err.timeoutMs).toBe(1500);
  });

  it("accepts boundary timeoutMs values", () => {
    const values = [0, -1, Number.MAX_SAFE_INTEGER];
    const errors = values.map((timeoutMs) => new StageTimeoutError("Timeout", { timeoutMs }));

    expect(errors.map((err) => err.timeoutMs)).toEqual(values);
  });
});

describe("StageCancelledError", () => {
  it("sets name and stageName", () => {
    const err = new StageCancelledError("Cancelled", { stageName: "stage-b" });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("StageCancelledError");
    expect(err.message).toBe("Cancelled");
    expect(err.stageName).toBe("stage-b");
  });

  it("accepts null and undefined stageName", () => {
    const withNull = new StageCancelledError("Cancelled", { stageName: null });
    const withUndefined = new StageCancelledError("Cancelled", {});

    expect(withNull.stageName).toBeNull();
    expect(withUndefined.stageName).toBeUndefined();
  });
});

describe("StagePausedError", () => {
  it("serializes and restores explicit values", () => {
    const err = new StagePausedError("Paused", {
      checkpointId: "ckpt_1",
      reason: "need_input",
      timestamp: "2020-01-01T00:00:00.000Z",
      runId: "run_1",
    });

    expect(err.name).toBe("StagePausedError");
    expect(err.message).toBe("Paused");
    expect(err.checkpointId).toBe("ckpt_1");
    expect(err.reason).toBe("need_input");
    expect(err.timestamp).toBe("2020-01-01T00:00:00.000Z");
    expect(err.runId).toBe("run_1");

    const json = err.toJSON();
    expect(json).toEqual({
      name: "StagePausedError",
      message: "Paused",
      checkpointId: "ckpt_1",
      reason: "need_input",
      timestamp: "2020-01-01T00:00:00.000Z",
      runId: "run_1",
    });

    const restored = StagePausedError.fromJSON(json);
    expect(restored).toBeInstanceOf(StagePausedError);
    expect(restored.message).toBe("Paused");
    expect(restored.checkpointId).toBe("ckpt_1");
    expect(restored.reason).toBe("need_input");
    expect(restored.timestamp).toBe("2020-01-01T00:00:00.000Z");
    expect(restored.runId).toBe("run_1");
  });

  it("normalizes fields and numeric timestamp via toNonEmptyString", () => {
    const err = new StagePausedError("Paused", {
      checkpointId: " ckpt_3 ",
      reason: " user ",
      timestamp: 0,
      runId: " run_4 ",
    });

    expect(err.checkpointId).toBe("ckpt_3");
    expect(err.reason).toBe("user");
    expect(err.timestamp).toBe("1970-01-01T00:00:00.000Z");
    expect(err.runId).toBe("run_4");

    expect(mockedToNonEmptyString).toHaveBeenCalledWith(" ckpt_3 ");
    expect(mockedToNonEmptyString).toHaveBeenCalledWith(" user ");
    expect(mockedToNonEmptyString).toHaveBeenCalledWith("1970-01-01T00:00:00.000Z");
    expect(mockedToNonEmptyString).toHaveBeenCalledWith(" run_4 ");
  });

  it("falls back to defaults for empty inputs", () => {
    vi.useFakeTimers();
    const now = new Date("2024-01-01T00:00:00.000Z");
    vi.setSystemTime(now);

    const err = new StagePausedError(undefined, {
      checkpointId: "",
      reason: "   ",
      timestamp: "  ",
      runId: undefined,
    });

    expect(err.message).toBe("Run paused");
    expect(err.checkpointId).toBeNull();
    expect(err.reason).toBeNull();
    expect(err.timestamp).toBe(now.toISOString());
    expect(err.runId).toBeNull();
  });

  it("fromJSON handles non-object payloads and string timestamps", () => {
    vi.useFakeTimers();
    const now = new Date("2024-02-02T00:00:00.000Z");
    vi.setSystemTime(now);

    const fallback = StagePausedError.fromJSON(null);
    expect(fallback.message).toBe("Run paused");
    expect(fallback.checkpointId).toBeNull();
    expect(fallback.reason).toBeNull();
    expect(fallback.runId).toBeNull();
    expect(fallback.timestamp).toBe(now.toISOString());

    const normalized = StagePausedError.fromJSON({
      message: " ",
      runId: " run_2 ",
      timestamp: 0,
    });
    expect(normalized.message).toBe("Run paused");
    expect(normalized.runId).toBe("run_2");
    expect(normalized.timestamp).toBe("1970-01-01T00:00:00.000Z");

    const numericString = StagePausedError.fromJSON({
      timestamp: "123",
    });
    expect(numericString.timestamp).toBe("123");
  });

  it("creates independent instances under concurrent creation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-03T00:00:00.000Z"));

    const tasks = Array.from({ length: 5 }, (_, index) =>
      Promise.resolve(new StagePausedError(`Paused ${index}`, { checkpointId: `ckpt_${index}` }))
    );
    const results = await Promise.all(tasks);

    expect(new Set(results).size).toBe(results.length);
    results.forEach((err, index) => {
      expect(err.message).toBe(`Paused ${index}`);
      expect(err.checkpointId).toBe(`ckpt_${index}`);
      expect(err.timestamp).toBe("2024-03-03T00:00:00.000Z");
    });
  });
});

describe("abortReasonToMessage", () => {
  it("prefers non-empty strings and error messages", () => {
    expect(abortReasonToMessage("stop")).toBe("stop");
    expect(abortReasonToMessage(new Error("boom"))).toBe("boom");
  });

  it("falls back for empty values and non-string reasons", () => {
    const fallback = "fallback";

    expect(abortReasonToMessage("   ", fallback)).toBe(fallback);
    expect(abortReasonToMessage(new Error(""), fallback)).toBe(fallback);
    expect(abortReasonToMessage(null, fallback)).toBe(fallback);
    expect(abortReasonToMessage(undefined, fallback)).toBe(fallback);
    expect(abortReasonToMessage([], fallback)).toBe(fallback);
    expect(abortReasonToMessage({}, fallback)).toBe(fallback);
  });
});

describe("cancelledErrorFromSignal", () => {
  it("uses signal reason and stageName", () => {
    const controller = new AbortController();
    controller.abort("stop");

    const err = cancelledErrorFromSignal(controller.signal, "stage-c");

    expect(err).toBeInstanceOf(StageCancelledError);
    expect(err.name).toBe("StageCancelledError");
    expect(err.message).toBe("stop");
    expect(err.stageName).toBe("stage-c");
  });

  it("uses error reason messages", () => {
    const controller = new AbortController();
    controller.abort(new Error("boom"));

    const err = cancelledErrorFromSignal(controller.signal, null);

    expect(err.message).toBe("boom");
    expect(err.stageName).toBeNull();
  });

  it("falls back when signal is missing or reason is blank", () => {
    const missing = cancelledErrorFromSignal(null, undefined);
    expect(missing.message).toBe("Run cancelled");
    expect(missing.stageName).toBeUndefined();

    const controller = new AbortController();
    controller.abort("  ");

    const blank = cancelledErrorFromSignal(controller.signal, "stage-d");
    expect(blank.message).toBe("Run cancelled");
    expect(blank.stageName).toBe("stage-d");
  });
});

describe("toErrorPayload", () => {
  it("handles null/undefined and primitive values", () => {
    expect(toErrorPayload()).toEqual({ message: "Unknown error", name: "Error" });
    expect(toErrorPayload(null)).toEqual({ message: "Unknown error", name: "Error" });
    expect(toErrorPayload("")).toEqual({ message: "Unknown error", name: "Error" });
    expect(toErrorPayload("   ")).toEqual({ message: "   ", name: "Error" });
    expect(toErrorPayload(0)).toEqual({ message: "Unknown error", name: "Error" });
  });

  it("handles empty arrays and objects", () => {
    expect(toErrorPayload([])).toEqual({ message: "", name: "Error" });
    expect(toErrorPayload({})).toEqual({ message: "[object Object]", name: "Error" });
  });

  it("includes stage metadata and boundary timeoutMs values", () => {
    const cases = [0, -1, Number.MAX_SAFE_INTEGER];

    cases.forEach((timeoutMs) => {
      const err = new StageTimeoutError("Timeout", { stageName: "stage-e", timeoutMs });
      const payload = toErrorPayload(err, { includeStack: false });

      expect(payload).toMatchObject({
        message: "Timeout",
        name: "StageTimeoutError",
        stageName: "stage-e",
        timeoutMs,
      });
    });

    const invalid = new StageTimeoutError("Timeout", {
      stageName: { invalid: true },
      timeoutMs: "123",
    });
    const invalidPayload = toErrorPayload(invalid, { includeStack: false });

    expect(invalidPayload.stageName).toBeUndefined();
    expect(invalidPayload.timeoutMs).toBeUndefined();
  });

  it("includes StagePausedError metadata and omits empty values", () => {
    const err = new StagePausedError("Paused", {
      checkpointId: "ckpt_2",
      reason: "user",
      timestamp: "2023-05-05T00:00:00.000Z",
      runId: "run_3",
    });

    expect(toErrorPayload(err, { includeStack: false })).toEqual({
      message: "Paused",
      name: "StagePausedError",
      checkpointId: "ckpt_2",
      reason: "user",
      timestamp: "2023-05-05T00:00:00.000Z",
      runId: "run_3",
    });

    const empty = new StagePausedError("Paused", {
      checkpointId: "",
      reason: " ",
      timestamp: "2023-05-05T00:00:00.000Z",
      runId: "",
    });
    const emptyPayload = toErrorPayload(empty, { includeStack: false });

    expect(emptyPayload).not.toHaveProperty("checkpointId");
    expect(emptyPayload).not.toHaveProperty("reason");
    expect(emptyPayload).not.toHaveProperty("runId");
  });

  it("includes stack when requested and truncates large stack values", () => {
    const err = new Error("stacked");
    const longStack = "s".repeat(5005);
    err.stack = longStack;

    const withStack = toErrorPayload(err, { includeStack: true });
    const expectedStack = `${longStack.slice(0, 4000)}...`;

    expect(withStack.stack).toBe(expectedStack);

    const withoutStack = toErrorPayload(err, { includeStack: false });
    expect(withoutStack.stack).toBeUndefined();
  });

  it("handles deep cause chains and long messages", () => {
    const hugeMessage = "m".repeat(10000);
    let current = hugeMessage;

    for (let index = 0; index < 15; index += 1) {
      const err = new Error(`level-${index}`);
      err.cause = current;
      current = err;
    }

    const payload = toErrorPayload(current, { includeStack: false });
    let node = payload;
    for (let index = 0; index < 15; index += 1) {
      node = node.cause;
    }

    expect(node).toEqual({ message: hugeMessage, name: "Error" });
  });

  it("handles concurrent and rapid calls", async () => {
    const errors = Array.from({ length: 8 }, (_, index) =>
      new StageTimeoutError(`Timeout ${index}`, { stageName: `stage_${index}`, timeoutMs: index })
    );

    const concurrent = await Promise.all(
      errors.map((err) => Promise.resolve(toErrorPayload(err, { includeStack: false })))
    );

    expect(concurrent).toHaveLength(errors.length);
    concurrent.forEach((payload, index) => {
      expect(payload.message).toBe(`Timeout ${index}`);
      expect(payload.stageName).toBe(`stage_${index}`);
      expect(payload.timeoutMs).toBe(index);
    });

    const rapid = [];
    for (let index = 0; index < 3; index += 1) {
      rapid.push(toErrorPayload(errors[index], { includeStack: false }));
    }

    expect(rapid.map((payload) => payload.stageName)).toEqual(["stage_0", "stage_1", "stage_2"]);
  });

  it("falls back when error name or message is empty", () => {
    const err = new Error("");
    err.name = "";

    expect(toErrorPayload(err, { includeStack: false })).toEqual({ message: "Error", name: "Error" });
  });
});
