const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateReviewPayload(payload) {
  const errors = [];
  if (!isPlainObject(payload)) return ["payload must be an object"];

  if (typeof payload.stageId !== "string" || payload.stageId.trim().length === 0) errors.push("stageId");
  if (typeof payload.pass !== "boolean") errors.push("pass");
  if (!new Set(["error", "warning", "info"]).has(payload.severity)) errors.push("severity");
  if (typeof payload.reason !== "string") errors.push("reason");

  return errors;
}

function validateCompressionPayload(payload) {
  const errors = [];
  if (!isPlainObject(payload)) return ["payload must be an object"];

  if (typeof payload.stageId !== "string" || payload.stageId.trim().length === 0) errors.push("stageId");
  if (!new Set(["scheduled", "applied", "failed"]).has(payload.status)) errors.push("status");
  if (payload.priority !== undefined && (typeof payload.priority !== "number" || !Number.isFinite(payload.priority))) {
    errors.push("priority");
  }

  return errors;
}

function validateArchivePayload(payload) {
  const errors = [];
  if (!isPlainObject(payload)) return ["payload must be an object"];

  if (typeof payload.runId !== "string" || payload.runId.trim().length === 0) errors.push("runId");
  if (typeof payload.checkpointId !== "string" || payload.checkpointId.trim().length === 0) errors.push("checkpointId");
  if (typeof payload.timestamp !== "string" || Number.isNaN(Date.parse(payload.timestamp))) errors.push("timestamp");
  if (payload.nodeStates !== undefined && !isPlainObject(payload.nodeStates)) errors.push("nodeStates");

  return errors;
}

test("Runtime Events: exports new event groups", async () => {
  const { ReviewEvents, CompressionEvents, ArchiveEvents } = await import("../../../js/agents/runtime/events/events.js");

  assert.deepEqual(ReviewEvents, {
    REVIEW_STARTED: "review.started",
    REVIEW_COMPLETED: "review.completed",
    REVIEW_FAILED: "review.failed",
  });

  assert.deepEqual(CompressionEvents, {
    COMPRESSION_SCHEDULED: "compression.scheduled",
    COMPRESSION_APPLIED: "compression.applied",
    COMPRESSION_FAILED: "compression.failed",
    COMPRESSION_ADVISED: "compression.advised",
    COMPRESSION_FORCED: "compression.forced",
  });

  assert.deepEqual(ArchiveEvents, {
    CHECKPOINT_SAVED: "archive.checkpoint.saved",
    CHECKPOINT_RESTORED: "archive.checkpoint.restored",
    CHECKPOINT_DELETED: "archive.checkpoint.deleted",
  });

  assert.ok(Object.isFrozen(ReviewEvents));
  assert.ok(Object.isFrozen(CompressionEvents));
  assert.ok(Object.isFrozen(ArchiveEvents));
});

test("Runtime Events: matchEventPattern matches archive.* and nested patterns", async () => {
  const { ArchiveEvents, ReviewEvents, matchEventPattern } = await import("../../../js/agents/runtime/events/events.js");

  assert.equal(matchEventPattern("archive.*", ArchiveEvents.CHECKPOINT_SAVED), true);
  assert.equal(matchEventPattern("archive.*", ArchiveEvents.CHECKPOINT_RESTORED), true);
  assert.equal(matchEventPattern("archive.*", ArchiveEvents.CHECKPOINT_DELETED), true);

  assert.equal(matchEventPattern("archive.checkpoint.*", ArchiveEvents.CHECKPOINT_SAVED), true);
  assert.equal(matchEventPattern("archive.checkpoint.*", ArchiveEvents.CHECKPOINT_DELETED), true);

  assert.equal(matchEventPattern("archive.*", ReviewEvents.REVIEW_STARTED), false);
  assert.equal(matchEventPattern("archive.*", "archiveX.checkpoint.saved"), false);
  assert.equal(matchEventPattern("*", ArchiveEvents.CHECKPOINT_SAVED), true);
});

test("Runtime Events: EventBus wildcard subscription integrates with archive.*", async () => {
  const { EventBus } = await import("../../../js/agents/core/event-bus.js");
  const { ArchiveEvents } = await import("../../../js/agents/runtime/events/events.js");

  const bus = new EventBus({ runId: "run_events_integration" });
  const seen = [];
  bus.subscribe("archive.*", (evt) => seen.push(evt));

  const payloadSaved = {
    runId: "run_events_integration",
    checkpointId: "run_events_integration:2025-12-12T22:30:01.000Z",
    timestamp: "2025-12-12T22:30:01.000Z",
    nodeStates: { a: { ok: true } },
  };

  const payloadRestored = {
    runId: "run_events_integration",
    checkpointId: "run_events_integration:2025-12-12T22:30:02.000Z",
    timestamp: "2025-12-12T22:30:02.000Z",
  };

  const payloadDeleted = {
    runId: "run_events_integration",
    checkpointId: "run_events_integration:2025-12-12T22:30:03.000Z",
    timestamp: "2025-12-12T22:30:03.000Z",
  };

  bus.emit(ArchiveEvents.CHECKPOINT_SAVED, { actor: "orchestrator", status: "completed", payload: payloadSaved });
  bus.emit(ArchiveEvents.CHECKPOINT_RESTORED, { actor: "orchestrator", status: "completed", payload: payloadRestored });
  bus.emit(ArchiveEvents.CHECKPOINT_DELETED, { actor: "orchestrator", status: "completed", payload: payloadDeleted });

  assert.equal(seen.length, 3);
  assert.deepEqual(
    seen.map((evt) => evt.name),
    [ArchiveEvents.CHECKPOINT_SAVED, ArchiveEvents.CHECKPOINT_RESTORED, ArchiveEvents.CHECKPOINT_DELETED]
  );

  assert.deepEqual(validateArchivePayload(seen[0].payload), []);
  assert.deepEqual(validateArchivePayload(seen[1].payload), []);
  assert.deepEqual(validateArchivePayload(seen[2].payload), []);
});

test("Runtime Events: payload shape validators cover the new typedefs", async () => {
  const validReview = { stageId: "stage_1", pass: true, severity: "info", reason: "ok" };
  const invalidReview = { stageId: 123, pass: "yes", severity: "fatal", reason: null };
  assert.deepEqual(validateReviewPayload(validReview), []);
  assert.notEqual(validateReviewPayload(invalidReview).length, 0);

  const validCompression = { stageId: "stage_1", status: "scheduled", priority: 10 };
  const invalidCompression = { stageId: "", status: "queued", priority: "high" };
  assert.deepEqual(validateCompressionPayload(validCompression), []);
  assert.notEqual(validateCompressionPayload(invalidCompression).length, 0);

  const validArchive = {
    runId: "run_1",
    checkpointId: "run_1:2025-12-12T22:30:01.000Z",
    timestamp: "2025-12-12T22:30:01.000Z",
    nodeStates: { nodeA: { ok: true } },
  };
  const invalidArchive = { runId: null, checkpointId: 1, timestamp: "not-a-date", nodeStates: [] };
  assert.deepEqual(validateArchivePayload(validArchive), []);
  assert.notEqual(validateArchivePayload(invalidArchive).length, 0);
});
