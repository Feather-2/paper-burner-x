const test = require("node:test");
const assert = require("node:assert/strict");

async function loadModule() {
  return import("../../../js/agents/shared/checkpoint-schema.js");
}

test("createCheckpoint: builds schema with defaults", async () => {
  const { createCheckpoint, CHECKPOINT_SCHEMA_VERSION, CheckpointType } = await loadModule();
  const originalNow = Date.now;

  try {
    Date.now = () => 123456;
    const checkpoint = createCheckpoint({ ok: true }, { runId: "run_1", iteration: 2 });

    assert.equal(checkpoint.schemaVersion, CHECKPOINT_SCHEMA_VERSION);
    assert.deepEqual(checkpoint.nodeStates, { ok: true });
    assert.equal(checkpoint.timestamp, 123456);
    assert.equal(checkpoint.metadata.type, CheckpointType.PRE_ACTION);
    assert.equal(checkpoint.metadata.runId, "run_1");
    assert.equal(checkpoint.metadata.iteration, 2);
  } finally {
    Date.now = originalNow;
  }
});

test("validateCheckpoint: accepts valid payloads and rejects invalid ones", async () => {
  const { createCheckpoint, validateCheckpoint } = await loadModule();

  const checkpoint = createCheckpoint({ ok: true }, { runId: "run_ok" });
  assert.equal(validateCheckpoint(checkpoint), true);

  assert.equal(validateCheckpoint(null), false);
  assert.equal(validateCheckpoint(undefined), false);
  assert.equal(validateCheckpoint({}), false);
  assert.equal(validateCheckpoint({ schemaVersion: "1.0" }), false);
  assert.equal(validateCheckpoint({ nodeStates: {} }), false);
});

test("migrateCheckpoint: upgrades legacy snapshots without schemaVersion", async () => {
  const { migrateCheckpoint, CHECKPOINT_SCHEMA_VERSION, CheckpointType } = await loadModule();
  const originalNow = Date.now;

  try {
    Date.now = () => 654321;
    const legacy = { nodeStates: { a: 1 } };
    const migrated = migrateCheckpoint(legacy);

    assert.equal(migrated.schemaVersion, CHECKPOINT_SCHEMA_VERSION);
    assert.deepEqual(migrated.nodeStates, { a: 1 });
    assert.equal(migrated.timestamp, 654321);
    assert.deepEqual(migrated.metadata, { type: CheckpointType.ARCHIVE });
  } finally {
    Date.now = originalNow;
  }
});
