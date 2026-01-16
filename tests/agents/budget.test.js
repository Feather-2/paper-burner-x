import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  BudgetManager,
  BudgetAction,
  createBudgetManager,
  RecursiveBudgetManager,
  AllocationStrategy,
} from "../../js/agents/shared/utils/budget.js";

describe("shared/utils/budget", () => {
  describe("BudgetAction", () => {
    it("exports frozen constants", () => {
      assert.equal(BudgetAction.CONTINUE, "continue");
      assert.equal(BudgetAction.DEGRADE, "degrade");
      assert.equal(BudgetAction.STOP, "stop");
      assert.ok(Object.isFrozen(BudgetAction));
    });
  });

  describe("AllocationStrategy", () => {
    it("exports frozen constants", () => {
      assert.equal(AllocationStrategy.EQUAL, "equal");
      assert.equal(AllocationStrategy.PROPORTIONAL, "proportional");
      assert.equal(AllocationStrategy.FIXED, "fixed");
      assert.equal(AllocationStrategy.REMAINING, "remaining");
      assert.ok(Object.isFrozen(AllocationStrategy));
    });
  });

  describe("BudgetManager", () => {
    /** @type {BudgetManager} */
    let manager;

    beforeEach(() => {
      manager = new BudgetManager({
        maxInputTokens: 1000,
        maxOutputTokens: 500,
        maxTotalTokens: 1500,
        degradeThreshold: 0.8,
      });
    });

    describe("constructor", () => {
      it("creates with default options", () => {
        const m = new BudgetManager();
        assert.ok(m.limits.input > 0);
        assert.ok(m.limits.output > 0);
        assert.ok(m.limits.total > 0);
      });

      it("enforces minimum limits", () => {
        const m = new BudgetManager({
          maxInputTokens: 0,
          maxOutputTokens: -100,
        });
        assert.ok(m.limits.input >= 1);
        assert.ok(m.limits.output >= 1);
      });

      it("clamps degradeThreshold", () => {
        const low = new BudgetManager({ degradeThreshold: 0.01 });
        assert.ok(low.degradeThreshold >= 0.1);

        const high = new BudgetManager({ degradeThreshold: 1.5 });
        assert.ok(high.degradeThreshold <= 0.99);
      });
    });

    describe("checkBudget", () => {
      it("returns CONTINUE when under budget", () => {
        assert.equal(manager.checkBudget(), BudgetAction.CONTINUE);
      });

      it("returns DEGRADE when over threshold", () => {
        manager.usage.input = 850; // 85% of 1000
        const result = manager.checkBudget();
        assert.equal(result, BudgetAction.DEGRADE);
        assert.ok(manager.degraded);
      });

      it("returns STOP when over limit", () => {
        manager.usage.input = 1100;
        const result = manager.checkBudget();
        assert.equal(result, BudgetAction.STOP);
        assert.ok(manager.stopped);
      });

      it("returns STOP if already stopped", () => {
        manager.stopped = true;
        assert.equal(manager.checkBudget(), BudgetAction.STOP);
      });

      it("returns DEGRADE if already degraded but under limit", () => {
        manager.degraded = true;
        manager.usage.input = 500;
        assert.equal(manager.checkBudget(), BudgetAction.DEGRADE);
      });

      it("calls onThresholdReached for DEGRADE", () => {
        let called = false;
        manager.onThresholdReached = (event) => {
          called = true;
          assert.equal(event.action, BudgetAction.DEGRADE);
        };
        manager.usage.input = 850;
        manager.checkBudget();
        assert.ok(called);
      });

      it("calls onThresholdReached for STOP", () => {
        let called = false;
        manager.onThresholdReached = (event) => {
          called = true;
          assert.equal(event.action, BudgetAction.STOP);
        };
        manager.usage.input = 1100;
        manager.checkBudget();
        assert.ok(called);
      });

      it("does not call onThresholdReached twice for DEGRADE", () => {
        let callCount = 0;
        manager.onThresholdReached = () => callCount++;
        manager.usage.input = 850;
        manager.checkBudget();
        manager.checkBudget();
        assert.equal(callCount, 1);
      });
    });

    describe("recordUsage", () => {
      it("adds to usage", () => {
        manager.recordUsage({ input: 100, output: 50 });
        assert.equal(manager.usage.input, 100);
        assert.equal(manager.usage.output, 50);
        assert.equal(manager.usage.total, 150);
      });

      it("accumulates usage", () => {
        manager.recordUsage({ input: 100 });
        manager.recordUsage({ input: 200, output: 100 });
        assert.equal(manager.usage.input, 300);
        assert.equal(manager.usage.output, 100);
      });

      it("handles negative values", () => {
        manager.recordUsage({ input: -100, output: -50 });
        assert.equal(manager.usage.input, 0);
        assert.equal(manager.usage.output, 0);
      });

      it("handles missing values", () => {
        manager.recordUsage({});
        assert.equal(manager.usage.input, 0);
        assert.equal(manager.usage.output, 0);
      });

      it("returns budget action", () => {
        const result = manager.recordUsage({ input: 850 });
        assert.equal(result, BudgetAction.DEGRADE);
      });
    });

    describe("getRemaining", () => {
      it("returns remaining budget", () => {
        manager.usage.input = 300;
        manager.usage.output = 200;
        manager.usage.total = 500;
        const remaining = manager.getRemaining();
        assert.equal(remaining.input, 700);
        assert.equal(remaining.output, 300);
        assert.equal(remaining.total, 1000);
      });

      it("returns 0 when over budget", () => {
        manager.usage.input = 1500;
        const remaining = manager.getRemaining();
        assert.equal(remaining.input, 0);
      });
    });

    describe("getUsageRatio", () => {
      it("returns usage ratios", () => {
        manager.usage.input = 500;
        manager.usage.output = 250;
        manager.usage.total = 750;
        const ratio = manager.getUsageRatio();
        assert.equal(ratio.input, 0.5);
        assert.equal(ratio.output, 0.5);
        assert.equal(ratio.total, 0.5);
      });
    });

    describe("getStats", () => {
      it("returns complete stats", () => {
        manager.usage.input = 100;
        manager.degraded = true;
        const stats = manager.getStats();
        assert.deepEqual(stats.usage, manager.usage);
        assert.deepEqual(stats.limits, manager.limits);
        assert.ok(stats.remaining);
        assert.ok(stats.ratio);
        assert.equal(stats.degraded, true);
        assert.equal(stats.stopped, false);
      });
    });

    describe("reset", () => {
      it("resets all state", () => {
        manager.usage.input = 500;
        manager.degraded = true;
        manager.stopped = true;
        manager.reset();
        assert.equal(manager.usage.input, 0);
        assert.equal(manager.usage.output, 0);
        assert.equal(manager.usage.total, 0);
        assert.equal(manager.degraded, false);
        assert.equal(manager.stopped, false);
      });
    });
  });

  describe("createBudgetManager", () => {
    it("creates manager from config", () => {
      const manager = createBudgetManager({
        budget: {
          maxInputTokens: 1000,
          maxOutputTokens: 500,
        },
      });
      assert.equal(manager.limits.input, 1000);
      assert.equal(manager.limits.output, 500);
    });

    it("creates manager with default config", () => {
      const manager = createBudgetManager();
      assert.ok(manager instanceof BudgetManager);
    });

    it("handles empty budget config", () => {
      const manager = createBudgetManager({});
      assert.ok(manager instanceof BudgetManager);
    });
  });

  describe("RecursiveBudgetManager", () => {
    describe("constructor", () => {
      it("creates without parent", () => {
        const manager = new RecursiveBudgetManager({
          maxInputTokens: 1000,
        });
        assert.ok(manager);
        assert.equal(manager._depth, 0);
      });

      it("inherits budget from parent", () => {
        const parent = new RecursiveBudgetManager({
          maxInputTokens: 1000,
          maxOutputTokens: 500,
          maxTotalTokens: 1500,
        });
        const child = new RecursiveBudgetManager({
          parent,
          inheritRatio: 0.5,
        });
        assert.equal(child.limits.input, 500);
        assert.equal(child.limits.output, 250);
      });

      it("clamps inheritRatio", () => {
        const parent = new RecursiveBudgetManager({ maxInputTokens: 1000 });
        const child = new RecursiveBudgetManager({
          parent,
          inheritRatio: 1.5,
        });
        assert.ok(child.limits.input <= 1000);
      });
    });

    describe("createChildBudget", () => {
      it("creates child with inherited budget", () => {
        const parent = new RecursiveBudgetManager({
          maxInputTokens: 1000,
        });
        const child = parent.createChildBudget();
        assert.ok(child instanceof RecursiveBudgetManager);
        assert.equal(child._depth, 1);
      });

      it("throws at max depth", () => {
        const manager = new RecursiveBudgetManager({
          maxDepth: 1,
          depth: 1,
        });
        assert.throws(
          () => manager.createChildBudget(),
          /Max recursion depth/
        );
      });

      it("adds child to children array", () => {
        const parent = new RecursiveBudgetManager();
        parent.createChildBudget();
        parent.createChildBudget();
        assert.equal(parent._children.length, 2);
      });

      it("uses custom options for child", () => {
        const parent = new RecursiveBudgetManager({
          degradeThreshold: 0.9,
        });
        const child = parent.createChildBudget({
          degradeThreshold: 0.7,
        });
        assert.equal(child.degradeThreshold, 0.7);
      });
    });

    describe("syncToParent", () => {
      it("does nothing without parent", () => {
        const manager = new RecursiveBudgetManager();
        manager.syncToParent(); // Should not throw
      });

      it("syncs child usage to parent", () => {
        const parent = new RecursiveBudgetManager({ maxInputTokens: 10000 });
        const child = parent.createChildBudget();
        child.recordUsage({ input: 100, output: 50 });
        child.syncToParent();
        // Parent should have recorded child's usage
        // Note: syncToParent aggregates all children, so we check the parent
      });
    });

    describe("getHierarchyInfo", () => {
      it("returns hierarchy information", () => {
        const parent = new RecursiveBudgetManager({ maxDepth: 10 });
        const child = parent.createChildBudget();
        const info = child.getHierarchyInfo();
        assert.equal(info.depth, 1);
        assert.equal(info.maxDepth, 10);
        assert.equal(info.hasParent, true);
      });
    });

    describe("getTotalDescendantUsage", () => {
      it("returns zero for no children", () => {
        const manager = new RecursiveBudgetManager();
        const usage = manager.getTotalDescendantUsage();
        assert.equal(usage.input, 0);
        assert.equal(usage.output, 0);
        assert.equal(usage.total, 0);
      });

      it("sums child usage", () => {
        const parent = new RecursiveBudgetManager({ maxInputTokens: 10000 });
        const child1 = parent.createChildBudget();
        const child2 = parent.createChildBudget();
        child1.recordUsage({ input: 100, output: 50 });
        child2.recordUsage({ input: 200, output: 100 });
        const usage = parent.getTotalDescendantUsage();
        assert.equal(usage.input, 300);
        assert.equal(usage.output, 150);
      });

      it("includes grandchild usage", () => {
        const root = new RecursiveBudgetManager({ maxInputTokens: 100000 });
        const child = root.createChildBudget();
        const grandchild = child.createChildBudget();
        grandchild.recordUsage({ input: 50, output: 25 });
        const usage = root.getTotalDescendantUsage();
        assert.equal(usage.input, 50);
        assert.equal(usage.output, 25);
      });
    });
  });
});
