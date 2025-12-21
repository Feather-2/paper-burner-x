const test = require("node:test");
const assert = require("node:assert/strict");

test("StagePausedError serializes and restores", async () => {
  const { StagePausedError } = await import("../../../js/agents/runtime/stage-errors.js");

  const err = new StagePausedError("Paused", {
    checkpointId: "ckpt_1",
    reason: "need_input",
    timestamp: "2020-01-01T00:00:00.000Z",
    runId: "run_1",
  });

  assert.equal(err.name, "StagePausedError");
  assert.equal(err.message, "Paused");
  assert.equal(err.checkpointId, "ckpt_1");
  assert.equal(err.reason, "need_input");
  assert.equal(err.timestamp, "2020-01-01T00:00:00.000Z");
  assert.equal(err.runId, "run_1");

  const json = err.toJSON();
  assert.deepEqual(json, {
    name: "StagePausedError",
    message: "Paused",
    checkpointId: "ckpt_1",
    reason: "need_input",
    timestamp: "2020-01-01T00:00:00.000Z",
    runId: "run_1",
  });

  const restored = StagePausedError.fromJSON(json);
  assert.ok(restored instanceof StagePausedError);
  assert.equal(restored.message, "Paused");
  assert.equal(restored.checkpointId, "ckpt_1");
  assert.equal(restored.reason, "need_input");
  assert.equal(restored.timestamp, "2020-01-01T00:00:00.000Z");
  assert.equal(restored.runId, "run_1");
});

test("StagePausedError.fromJSON normalizes values", async () => {
  const { StagePausedError } = await import("../../../js/agents/runtime/stage-errors.js");

  const restored = StagePausedError.fromJSON({
    message: "",
    checkpointId: " ",
    reason: "\n",
    runId: " run_2 ",
    timestamp: 0,
  });

  assert.equal(restored.name, "StagePausedError");
  assert.equal(restored.message, "Run paused");
  assert.equal(restored.checkpointId, null);
  assert.equal(restored.reason, null);
  assert.equal(restored.runId, "run_2");
  assert.equal(typeof restored.timestamp, "string");
  assert.ok(restored.timestamp.includes("T"));
});

test("toErrorPayload includes pause metadata", async () => {
  const { StagePausedError, toErrorPayload } = await import("../../../js/agents/runtime/stage-errors.js");

  const err = new StagePausedError("Paused", {
    checkpointId: "ckpt_2",
    reason: "user",
    timestamp: "2023-05-05T00:00:00.000Z",
    runId: "run_3",
  });

  assert.deepEqual(toErrorPayload(err), {
    message: "Paused",
    name: "StagePausedError",
    checkpointId: "ckpt_2",
    reason: "user",
    timestamp: "2023-05-05T00:00:00.000Z",
    runId: "run_3",
  });
});

test("StagePausedError constructor normalizes timestamp and strings", async () => {
  const { StagePausedError } = await import("../../../js/agents/runtime/stage-errors.js");

  const err = new StagePausedError("Paused", {
    checkpointId: " ckpt_3 ",
    reason: " user ",
    timestamp: 0,
    runId: " run_4 ",
  });

  assert.equal(err.checkpointId, "ckpt_3");
  assert.equal(err.reason, "user");
  assert.equal(err.timestamp, "1970-01-01T00:00:00.000Z");
  assert.equal(err.runId, "run_4");
});

test("StagePausedError constructor falls back to ISO timestamp", async () => {
  const { StagePausedError } = await import("../../../js/agents/runtime/stage-errors.js");

  const err = new StagePausedError("Paused", { timestamp: "  " });
  assert.equal(typeof err.timestamp, "string");
  assert.match(err.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("StagePausedError.fromJSON accepts non-object payloads", async () => {
  const { StagePausedError } = await import("../../../js/agents/runtime/stage-errors.js");

  const err = StagePausedError.fromJSON(null);
  assert.equal(err.name, "StagePausedError");
  assert.equal(err.message, "Run paused");
  assert.equal(err.runId, null);
  assert.equal(err.checkpointId, null);
});

test("toErrorPayload falls back for empty message/name and non-empty-string conversion", async () => {
  const { toErrorPayload } = await import("../../../js/agents/runtime/stage-errors.js");

  const err = new Error("");
  err.name = "";
  assert.deepEqual(toErrorPayload(err), { message: "Error", name: "Error" });

  assert.deepEqual(toErrorPayload("   "), { message: "   ", name: "Error" });
});

test("StageTimeoutError/StageCancelledError carry metadata", async () => {
  const { StageTimeoutError, StageCancelledError } = await import("../../../js/agents/runtime/stage-errors.js");

  const timeout = new StageTimeoutError("Timeout", { stageName: "unit", timeoutMs: 123 });
  assert.equal(timeout.name, "StageTimeoutError");
  assert.equal(timeout.message, "Timeout");
  assert.equal(timeout.stageName, "unit");
  assert.equal(timeout.timeoutMs, 123);

  const cancelled = new StageCancelledError("Cancelled", { stageName: "unit" });
  assert.equal(cancelled.name, "StageCancelledError");
  assert.equal(cancelled.message, "Cancelled");
  assert.equal(cancelled.stageName, "unit");
});

test("abortReasonToMessage handles strings, errors, and fallback", async () => {
  const { abortReasonToMessage } = await import("../../../js/agents/runtime/stage-errors.js");

  assert.equal(abortReasonToMessage("stop"), "stop");
  assert.equal(abortReasonToMessage("  ", "fallback"), "fallback");
  assert.equal(abortReasonToMessage(new Error("boom")), "boom");
  assert.equal(abortReasonToMessage(new Error(""), "fallback"), "fallback");
});

test("cancelledErrorFromSignal returns StageCancelledError", async () => {
  const { cancelledErrorFromSignal } = await import("../../../js/agents/runtime/stage-errors.js");

  const controller = new AbortController();
  controller.abort("stop");

  const err = cancelledErrorFromSignal(controller.signal, "unit");
  assert.equal(err.name, "StageCancelledError");
  assert.equal(err.message, "stop");
  assert.equal(err.stageName, "unit");
});

test("toErrorPayload formats common error shapes", async () => {
  const { StageTimeoutError, StageCancelledError, toErrorPayload } = await import("../../../js/agents/runtime/stage-errors.js");

  assert.deepEqual(toErrorPayload(), { message: "Unknown error", name: "Error" });
  assert.deepEqual(toErrorPayload("bad"), { message: "bad", name: "Error" });

  const timeout = new StageTimeoutError("Timeout", { stageName: "unit", timeoutMs: 123 });
  assert.deepEqual(toErrorPayload(timeout), {
    message: "Timeout",
    name: "StageTimeoutError",
    stageName: "unit",
    timeoutMs: 123,
  });

  const cancelled = new StageCancelledError("Cancelled", { stageName: "unit" });
  assert.deepEqual(toErrorPayload(cancelled), {
    message: "Cancelled",
    name: "StageCancelledError",
    stageName: "unit",
  });
});
