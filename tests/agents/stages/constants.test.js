const test = require("node:test");
const assert = require("node:assert/strict");

test("DeepSearch constants: AGENT_LOOP_CONFIG exports all fields with correct types", async () => {
  const { AGENT_LOOP_CONFIG } = await import("../../../js/agents/stages/deepsearch/constants.js");

  const expectedTypes = {
    COMPRESS_FILL_RATIO: "number",
    CRITICAL_FILL_RATIO: "number",
    HEAD_TRUNCATE_RATIO: "number",
    COMPRESS_INTERVAL_LOOPS: "number",
    MIN_EVIDENCE_FOR_TRUNCATE: "number",
    MIN_CLAIMS_FOR_TRUNCATE: "number",
    MAX_BACKTRACKS: "number",
  };

  for (const [key, type] of Object.entries(expectedTypes)) {
    assert.ok(Object.prototype.hasOwnProperty.call(AGENT_LOOP_CONFIG, key));
    assert.equal(typeof AGENT_LOOP_CONFIG[key], type);
  }
});

test("DeepSearch constants: AGENT_LOOP_CONFIG is frozen", async () => {
  const { AGENT_LOOP_CONFIG } = await import("../../../js/agents/stages/deepsearch/constants.js");

  assert.equal(Object.isFrozen(AGENT_LOOP_CONFIG), true);
});

test("DeepSearch constants: AGENT_LOOP_CONFIG thresholds are in valid ranges", async () => {
  const { AGENT_LOOP_CONFIG } = await import("../../../js/agents/stages/deepsearch/constants.js");

  const ratios = [
    AGENT_LOOP_CONFIG.COMPRESS_FILL_RATIO,
    AGENT_LOOP_CONFIG.CRITICAL_FILL_RATIO,
    AGENT_LOOP_CONFIG.HEAD_TRUNCATE_RATIO,
  ];
  const counts = [
    AGENT_LOOP_CONFIG.COMPRESS_INTERVAL_LOOPS,
    AGENT_LOOP_CONFIG.MIN_EVIDENCE_FOR_TRUNCATE,
    AGENT_LOOP_CONFIG.MIN_CLAIMS_FOR_TRUNCATE,
    AGENT_LOOP_CONFIG.MAX_BACKTRACKS,
  ];

  for (const ratio of ratios) {
    assert.ok(Number.isFinite(ratio));
    assert.ok(ratio > 0 && ratio < 1);
  }

  for (const count of counts) {
    assert.ok(Number.isFinite(count));
    assert.ok(count > 0);
  }
});
