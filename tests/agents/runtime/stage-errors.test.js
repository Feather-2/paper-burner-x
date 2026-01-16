import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("StagePausedError serializes and restores", async () => {
  const { StagePausedError } = await import("../../../js/agents/runtime/core/stage-errors.js");

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
  expect(restored instanceof StagePausedError).toBeTruthy();
  expect(restored.message).toBe("Paused");
  expect(restored.checkpointId).toBe("ckpt_1");
  expect(restored.reason).toBe("need_input");
  expect(restored.timestamp).toBe("2020-01-01T00:00:00.000Z");
  expect(restored.runId).toBe("run_1");
});

it("StagePausedError.fromJSON normalizes values", async () => {
  const { StagePausedError } = await import("../../../js/agents/runtime/core/stage-errors.js");

  const restored = StagePausedError.fromJSON({
    message: "",
    checkpointId: " ",
    reason: "\n",
    runId: " run_2 ",
    timestamp: 0,
  });

  expect(restored.name).toBe("StagePausedError");
  expect(restored.message).toBe("Run paused");
  expect(restored.checkpointId).toBe(null);
  expect(restored.reason).toBe(null);
  expect(restored.runId).toBe("run_2");
  expect(typeof restored.timestamp).toBe("string");
  expect(restored.timestamp.includes("T")).toBeTruthy();
});

it("toErrorPayload includes pause metadata", async () => {
  const { StagePausedError, toErrorPayload } = await import("../../../js/agents/runtime/core/stage-errors.js");

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
});

it("StagePausedError constructor normalizes timestamp and strings", async () => {
  const { StagePausedError } = await import("../../../js/agents/runtime/core/stage-errors.js");

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
});

it("StagePausedError constructor falls back to ISO timestamp", async () => {
  const { StagePausedError } = await import("../../../js/agents/runtime/core/stage-errors.js");

  const err = new StagePausedError("Paused", { timestamp: "  " });
  expect(typeof err.timestamp).toBe("string");
  expect(err.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

it("StagePausedError.fromJSON accepts non-object payloads", async () => {
  const { StagePausedError } = await import("../../../js/agents/runtime/core/stage-errors.js");

  const err = StagePausedError.fromJSON(null);
  expect(err.name).toBe("StagePausedError");
  expect(err.message).toBe("Run paused");
  expect(err.runId).toBe(null);
  expect(err.checkpointId).toBe(null);
});

it("toErrorPayload falls back for empty message/name and non-empty-string conversion", async () => {
  const { toErrorPayload } = await import("../../../js/agents/runtime/core/stage-errors.js");

  const err = new Error("");
  err.name = "";
  expect(toErrorPayload(err, { includeStack: false })).toEqual({ message: "Error", name: "Error" });

  expect(toErrorPayload("   ")).toEqual({ message: "   ", name: "Error" });
});

it("StageTimeoutError/StageCancelledError carry metadata", async () => {
  const { StageTimeoutError, StageCancelledError } = await import("../../../js/agents/runtime/core/stage-errors.js");

  const timeout = new StageTimeoutError("Timeout", { stageName: "unit", timeoutMs: 123 });
  expect(timeout.name).toBe("StageTimeoutError");
  expect(timeout.message).toBe("Timeout");
  expect(timeout.stageName).toBe("unit");
  expect(timeout.timeoutMs).toBe(123);

  const cancelled = new StageCancelledError("Cancelled", { stageName: "unit" });
  expect(cancelled.name).toBe("StageCancelledError");
  expect(cancelled.message).toBe("Cancelled");
  expect(cancelled.stageName).toBe("unit");
});

it("abortReasonToMessage handles strings, errors, and fallback", async () => {
  const { abortReasonToMessage } = await import("../../../js/agents/runtime/core/stage-errors.js");

  expect(abortReasonToMessage("stop")).toBe("stop");
  expect(abortReasonToMessage("  ", "fallback")).toBe("fallback");
  expect(abortReasonToMessage(new Error("boom"))).toBe("boom");
  expect(abortReasonToMessage(new Error(""), "fallback")).toBe("fallback");
});

it("cancelledErrorFromSignal returns StageCancelledError", async () => {
  const { cancelledErrorFromSignal } = await import("../../../js/agents/runtime/core/stage-errors.js");

  const controller = new AbortController();
  controller.abort("stop");

  const err = cancelledErrorFromSignal(controller.signal, "unit");
  expect(err.name).toBe("StageCancelledError");
  expect(err.message).toBe("stop");
  expect(err.stageName).toBe("unit");
});

it("toErrorPayload formats common error shapes", async () => {
  const { StageTimeoutError, StageCancelledError, toErrorPayload } = await import("../../../js/agents/runtime/core/stage-errors.js");

  expect(toErrorPayload()).toEqual({ message: "Unknown error", name: "Error" });
  expect(toErrorPayload("bad")).toEqual({ message: "bad", name: "Error" });

  const timeout = new StageTimeoutError("Timeout", { stageName: "unit", timeoutMs: 123 });
  expect(toErrorPayload(timeout, { includeStack: false })).toEqual({
    message: "Timeout",
    name: "StageTimeoutError",
    stageName: "unit",
    timeoutMs: 123,
  });

  const cancelled = new StageCancelledError("Cancelled", { stageName: "unit" });
  expect(toErrorPayload(cancelled, { includeStack: false })).toEqual({
    message: "Cancelled",
    name: "StageCancelledError",
    stageName: "unit",
  });
});
