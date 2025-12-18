const test = require("node:test");
const assert = require("node:assert/strict");

test("BudgetManager.estimateIteration: scales with gapCount and toggles", async () => {
  const { BudgetManager } = await import("../../../js/agents/stages/deepsearch/budget.js");

  const bm = new BudgetManager();
  const est = bm.estimateIteration({ maxIterations: 2, gapCount: 10, enableRerank: true, enableShadow: true, enableExternal: true });

  assert.deepEqual(est.perIteration, { input: 66500, output: 23800 });
  assert.equal(est.input, 133000);
  assert.equal(est.output, 47600);
  assert.equal(est.total, 180600);
  assert.equal(est.iterations, 2);
});

test("BudgetManager.checkBudget: triggers degrade then stop (single fire callbacks)", async () => {
  const { BudgetManager, BudgetAction } = await import("../../../js/agents/stages/deepsearch/budget.js");

  const events = [];
  const bm = new BudgetManager({
    maxInputTokens: 100,
    maxOutputTokens: 100,
    maxTotalTokens: 200,
    degradeThreshold: 0.5,
    onThresholdReached: (evt) => events.push(evt),
  });

  const a1 = bm.recordUsage({ input: 60, output: 0 });
  assert.equal(a1, BudgetAction.DEGRADE);
  assert.equal(bm.degraded, true);
  assert.equal(bm.stopped, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, BudgetAction.DEGRADE);

  const a2 = bm.recordUsage({ input: 50, output: 0 });
  assert.equal(a2, BudgetAction.STOP);
  assert.equal(bm.stopped, true);
  assert.equal(events.length, 2);
  assert.equal(events[1].action, BudgetAction.STOP);

  // Idempotent once stopped
  assert.equal(bm.checkBudget(), BudgetAction.STOP);
  assert.equal(events.length, 2);
});

test("BudgetManager.canExecute: stops if would exceed while degraded; unknown op uses defaults", async () => {
  const { BudgetManager, BudgetAction } = await import("../../../js/agents/stages/deepsearch/budget.js");

  const bm = new BudgetManager({ maxInputTokens: 1000, maxOutputTokens: 1000, maxTotalTokens: 1000, degradeThreshold: 0.9 });
  bm.degraded = true;
  bm.recordUsage({ input: 900, output: 0 });

  const writeProbe = bm.canExecute("write");
  assert.equal(writeProbe.canExecute, false);
  assert.equal(writeProbe.action, BudgetAction.STOP);
  assert.deepEqual(writeProbe.estimated, { input: 5000, output: 3000 });

  const unknownProbe = bm.canExecute("nonexistent");
  assert.deepEqual(unknownProbe.estimated, { input: 1000, output: 500 });
});

test("BudgetManager.getRemaining/getUsageRatio/getStats/reset + createBudgetManager", async () => {
  const { createBudgetManager, BudgetAction } = await import("../../../js/agents/stages/deepsearch/budget.js");

  const bm = createBudgetManager({
    budget: { maxInputTokens: 10, maxOutputTokens: 20, maxTotalTokens: 25, degradeThreshold: 0.7 },
  });

  assert.deepEqual(bm.limits, { input: 10, output: 20, total: 25 });

  const act = bm.recordUsage({ input: 2, output: 3 });
  assert.equal(act, BudgetAction.CONTINUE);

  assert.deepEqual(bm.getRemaining(), { input: 8, output: 17, total: 20 });
  assert.deepEqual(bm.getUsageRatio(), { input: 0.2, output: 0.15, total: 0.2 });

  const stats = bm.getStats();
  assert.equal(stats.degraded, false);
  assert.equal(stats.stopped, false);
  assert.deepEqual(stats.usage, { input: 2, output: 3, total: 5 });

  bm.reset();
  assert.deepEqual(bm.getStats().usage, { input: 0, output: 0, total: 0 });
  assert.equal(bm.getStats().degraded, false);
  assert.equal(bm.getStats().stopped, false);
});

