const test = require("node:test");
const assert = require("node:assert/strict");

test("LLM Constants: ModelUsage, MessageRole, ModelHealth validation", async () => {
  const {
    ModelUsage,
    MessageRole,
    ModelHealth,
    RouterStrategy,
    isValidModelUsage,
    isValidMessageRole,
    isValidModelHealth,
    normalizeRouterStrategy,
  } = await import("../../../js/agents/llm/constants.js");

  assert.equal(isValidModelUsage(ModelUsage.ANALYST), true);
  assert.equal(isValidModelUsage("bogus"), false);

  assert.equal(isValidMessageRole(MessageRole.SYSTEM), true);
  assert.equal(isValidMessageRole("tool"), false);

  assert.equal(isValidModelHealth(ModelHealth.HEALTHY), true);
  assert.equal(isValidModelHealth("offline"), false);

  assert.equal(normalizeRouterStrategy("PRIORITY", ""), RouterStrategy.PRIORITY);
  assert.equal(normalizeRouterStrategy("unknown", RouterStrategy.PRIORITY), RouterStrategy.PRIORITY);
});
