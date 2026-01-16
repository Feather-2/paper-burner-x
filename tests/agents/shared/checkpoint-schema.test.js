import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

async function loadModule() {
  return import("../../../js/agents/shared/archive/checkpoint-schema.js");
}

it("createCheckpoint: builds schema with defaults", async () => {
  const { createCheckpoint, CHECKPOINT_SCHEMA_VERSION, CheckpointType } = await loadModule();
  const originalNow = Date.now;

  try {
    Date.now = () => 123456;
    const checkpoint = createCheckpoint({ ok: true }, { runId: "run_1", iteration: 2 });

    expect(checkpoint.schemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
    expect(checkpoint.nodeStates).toEqual({ ok: true });
    expect(checkpoint.timestamp).toBe(123456);
    expect(checkpoint.metadata.type).toBe(CheckpointType.PRE_ACTION);
    expect(checkpoint.metadata.runId).toBe("run_1");
    expect(checkpoint.metadata.iteration).toBe(2);
  } finally {
    Date.now = originalNow;
  }
});

it("validateCheckpoint: accepts valid payloads and rejects invalid ones", async () => {
  const { createCheckpoint, validateCheckpoint } = await loadModule();

  const checkpoint = createCheckpoint({ ok: true }, { runId: "run_ok" });
  expect(validateCheckpoint(checkpoint)).toBe(true);

  expect(validateCheckpoint(null)).toBe(false);
  expect(validateCheckpoint(undefined)).toBe(false);
  expect(validateCheckpoint({})).toBe(false);
  expect(validateCheckpoint({ schemaVersion: "1.0" })).toBe(false);
  expect(validateCheckpoint({ nodeStates: {} })).toBe(false);
});

it("migrateCheckpoint: upgrades legacy snapshots without schemaVersion", async () => {
  const { migrateCheckpoint, CHECKPOINT_SCHEMA_VERSION, CheckpointType } = await loadModule();
  const originalNow = Date.now;

  try {
    Date.now = () => 654321;
    const legacy = { nodeStates: { a: 1 } };
    const migrated = migrateCheckpoint(legacy);

    expect(migrated.schemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
    expect(migrated.nodeStates).toEqual({ a: 1 });
    expect(migrated.timestamp).toBe(654321);
    expect(migrated.metadata).toEqual({ type: CheckpointType.ARCHIVE });
  } finally {
    Date.now = originalNow;
  }
});
