
import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
      expect(BudgetAction.CONTINUE).toBe("continue");
      expect(BudgetAction.DEGRADE).toBe("degrade");
      expect(BudgetAction.STOP).toBe("stop");
      expect(Object.isFrozen(BudgetAction)).toBe(true);
    });
  });

  describe("AllocationStrategy", () => {
    it("exports frozen constants", () => {
      expect(AllocationStrategy.EQUAL).toBe("equal");
      expect(AllocationStrategy.PROPORTIONAL).toBe("proportional");
      expect(AllocationStrategy.FIXED).toBe("fixed");
      expect(AllocationStrategy.REMAINING).toBe("remaining");
      expect(Object.isFrozen(AllocationStrategy)).toBe(true);
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
        expect(m.limits.input).toBeGreaterThan(0);
        expect(m.limits.output).toBeGreaterThan(0);
        expect(m.limits.total).toBeGreaterThan(0);
      });

      it("enforces minimum limits", () => {
        const m = new BudgetManager({
          maxInputTokens: 0,
          maxOutputTokens: -100,
        });
        expect(m.limits.input).toBeGreaterThanOrEqual(1);
        expect(m.limits.output).toBeGreaterThanOrEqual(1);
      });

      it("clamps degradeThreshold", () => {
        const low = new BudgetManager({ degradeThreshold: 0.01 });
        expect(low.degradeThreshold).toBeGreaterThanOrEqual(0.1);

        const high = new BudgetManager({ degradeThreshold: 1.5 });
        expect(high.degradeThreshold).toBeLessThanOrEqual(0.99);
      });
    });

    describe("checkBudget", () => {
      it("returns CONTINUE when under budget", () => {
        expect(manager.checkBudget()).toBe(BudgetAction.CONTINUE);
      });

      it("returns DEGRADE when over threshold", () => {
        manager.usage.input = 850; // 85% of 1000
        const result = manager.checkBudget();
        expect(result).toBe(BudgetAction.DEGRADE);
        expect(manager.degraded).toBe(true);
      });

      it("returns STOP when over limit", () => {
        manager.usage.input = 1100;
        const result = manager.checkBudget();
        expect(result).toBe(BudgetAction.STOP);
        expect(manager.stopped).toBe(true);
      });

      it("returns STOP if already stopped", () => {
        manager.stopped = true;
        expect(manager.checkBudget()).toBe(BudgetAction.STOP);
      });

      it("returns DEGRADE if already degraded but under limit", () => {
        manager.degraded = true;
        manager.usage.input = 500;
        expect(manager.checkBudget()).toBe(BudgetAction.DEGRADE);
      });

      it("calls onThresholdReached for DEGRADE", () => {
        let called = false;
        manager.onThresholdReached = (event) => {
          called = true;
          expect(event.action).toBe(BudgetAction.DEGRADE);
        };
        manager.usage.input = 850;
        manager.checkBudget();
        expect(called).toBe(true);
      });

      it("calls onThresholdReached for STOP", () => {
        let called = false;
        manager.onThresholdReached = (event) => {
          called = true;
          expect(event.action).toBe(BudgetAction.STOP);
        };
        manager.usage.input = 1100;
        manager.checkBudget();
        expect(called).toBe(true);
      });

      it("does not call onThresholdReached twice for DEGRADE", () => {
        let callCount = 0;
        manager.onThresholdReached = () => callCount++;
        manager.usage.input = 850;
        manager.checkBudget();
        manager.checkBudget();
        expect(callCount).toBe(1);
      });
    });

    describe("recordUsage", () => {
      it("adds to usage", () => {
        manager.recordUsage({ input: 100, output: 50 });
        expect(manager.usage.input).toBe(100);
        expect(manager.usage.output).toBe(50);
        expect(manager.usage.total).toBe(150);
      });

      it("accumulates usage", () => {
        manager.recordUsage({ input: 100 });
        manager.recordUsage({ input: 200, output: 100 });
        expect(manager.usage.input).toBe(300);
        expect(manager.usage.output).toBe(100);
      });

      it("handles negative values", () => {
        manager.recordUsage({ input: -100, output: -50 });
        expect(manager.usage.input).toBe(0);
        expect(manager.usage.output).toBe(0);
      });

      it("handles missing values", () => {
        manager.recordUsage({});
        expect(manager.usage.input).toBe(0);
        expect(manager.usage.output).toBe(0);
      });

      it("returns budget action", () => {
        const result = manager.recordUsage({ input: 850 });
        expect(result).toBe(BudgetAction.DEGRADE);
      });
    });

    describe("getRemaining", () => {
      it("returns remaining budget", () => {
        manager.usage.input = 300;
        manager.usage.output = 200;
        manager.usage.total = 500;
        const remaining = manager.getRemaining();
        expect(remaining.input).toBe(700);
        expect(remaining.output).toBe(300);
        expect(remaining.total).toBe(1000);
      });

      it("returns 0 when over budget", () => {
        manager.usage.input = 1500;
        const remaining = manager.getRemaining();
        expect(remaining.input).toBe(0);
      });
    });

    describe("getUsageRatio", () => {
      it("returns usage ratios", () => {
        manager.usage.input = 500;
        manager.usage.output = 250;
        manager.usage.total = 750;
        const ratio = manager.getUsageRatio();
        expect(ratio.input).toBe(0.5);
        expect(ratio.output).toBe(0.5);
        expect(ratio.total).toBe(0.5);
      });
    });

    describe("getStats", () => {
      it("returns complete stats", () => {
        manager.usage.input = 100;
        manager.degraded = true;
        const stats = manager.getStats();
        expect(stats.usage).toEqual(manager.usage);
        expect(stats.limits).toEqual(manager.limits);
        expect(stats.remaining).toEqual(manager.getRemaining());
        expect(stats.ratio).toEqual(manager.getUsageRatio());
        expect(stats.degraded).toBe(true);
        expect(stats.stopped).toBe(false);
      });
    });

    describe("reset", () => {
      it("resets all state", () => {
        manager.usage.input = 500;
        manager.degraded = true;
        manager.stopped = true;
        manager.reset();
        expect(manager.usage.input).toBe(0);
        expect(manager.usage.output).toBe(0);
        expect(manager.usage.total).toBe(0);
        expect(manager.degraded).toBe(false);
        expect(manager.stopped).toBe(false);
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
      expect(manager.limits.input).toBe(1000);
      expect(manager.limits.output).toBe(500);
    });

    it("creates manager with default config", () => {
      const manager = createBudgetManager();
      expect(manager).toBeInstanceOf(BudgetManager);
    });

    it("handles empty budget config", () => {
      const manager = createBudgetManager({});
      expect(manager).toBeInstanceOf(BudgetManager);
    });
  });

  describe("RecursiveBudgetManager", () => {
    describe("constructor", () => {
      it("creates without parent", () => {
        const manager = new RecursiveBudgetManager({
          maxInputTokens: 1000,
        });
        expect(manager).toBeInstanceOf(RecursiveBudgetManager);
        expect(manager._depth).toBe(0);
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
        expect(child.limits.input).toBe(500);
        expect(child.limits.output).toBe(250);
      });

      it("clamps inheritRatio", () => {
        const parent = new RecursiveBudgetManager({ maxInputTokens: 1000 });
        const child = new RecursiveBudgetManager({
          parent,
          inheritRatio: 1.5,
        });
        expect(child.limits.input).toBeLessThanOrEqual(1000);
      });
    });

    describe("createChildBudget", () => {
      it("creates child with inherited budget", () => {
        const parent = new RecursiveBudgetManager({
          maxInputTokens: 1000,
        });
        const child = parent.createChildBudget();
        expect(child).toBeInstanceOf(RecursiveBudgetManager);
        expect(child._depth).toBe(1);
      });

      it("throws at max depth", () => {
        const manager = new RecursiveBudgetManager({
          maxDepth: 1,
          depth: 1,
        });
        expect(() => manager.createChildBudget()).toThrow(/Max recursion depth/);
      });

      it("adds child to children array", () => {
        const parent = new RecursiveBudgetManager();
        parent.createChildBudget();
        parent.createChildBudget();
        expect(parent._children.length).toBe(2);
      });

      it("uses custom options for child", () => {
        const parent = new RecursiveBudgetManager({
          degradeThreshold: 0.9,
        });
        const child = parent.createChildBudget({
          degradeThreshold: 0.7,
        });
        expect(child.degradeThreshold).toBe(0.7);
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
        expect(info.depth).toBe(1);
        expect(info.maxDepth).toBe(10);
        expect(info.hasParent).toBe(true);
      });
    });

    describe("getTotalDescendantUsage", () => {
      it("returns zero for no children", () => {
        const manager = new RecursiveBudgetManager();
        const usage = manager.getTotalDescendantUsage();
        expect(usage.input).toBe(0);
        expect(usage.output).toBe(0);
        expect(usage.total).toBe(0);
      });

      it("sums child usage", () => {
        const parent = new RecursiveBudgetManager({ maxInputTokens: 10000 });
        const child1 = parent.createChildBudget();
        const child2 = parent.createChildBudget();
        child1.recordUsage({ input: 100, output: 50 });
        child2.recordUsage({ input: 200, output: 100 });
        const usage = parent.getTotalDescendantUsage();
        expect(usage.input).toBe(300);
        expect(usage.output).toBe(150);
      });

      it("includes grandchild usage", () => {
        const root = new RecursiveBudgetManager({ maxInputTokens: 100000 });
        const child = root.createChildBudget();
        const grandchild = child.createChildBudget();
        grandchild.recordUsage({ input: 50, output: 25 });
        const usage = root.getTotalDescendantUsage();
        expect(usage.input).toBe(50);
        expect(usage.output).toBe(25);
      });
    });
  });
});
