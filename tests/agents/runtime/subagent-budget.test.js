
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  SubagentBudgetManager,
  createSubagentBudgetManager,
  MODE_ALLOCATION_RATIOS,
  MODE_PRIORITY,
} from "../../../js/agents/runtime/context/subagent-budget.js";

describe("SubagentBudgetManager", () => {
  describe("constructor", () => {
    it("should create with default options", () => {
      const mgr = new SubagentBudgetManager();
      const stats = mgr.getStats();

      expect(stats.parentBudget).toBe(100000);
      expect(stats.reserveRatio).toBe(0.2);
      expect(stats.distributableBudget).toBe(80000);
      expect(stats.available).toBe(80000);
    });

    it("should accept custom parentBudget", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 50000 });
      expect(mgr.getStats().parentBudget).toBe(50000);
      expect(mgr.getStats().distributableBudget).toBe(40000);
    });

    it("should accept custom reserveRatio", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000, reserveRatio: 0.3 });
      expect(mgr.getStats().reserveRatio).toBe(0.3);
      expect(mgr.getStats().distributableBudget).toBe(70000);
    });

    it("should clamp reserveRatio to valid range", () => {
      const mgrLow = new SubagentBudgetManager({ reserveRatio: 0.05 });
      expect(mgrLow.getStats().reserveRatio).toBe(0.1);

      const mgrHigh = new SubagentBudgetManager({ reserveRatio: 0.9 });
      expect(mgrHigh.getStats().reserveRatio).toBe(0.5);
    });
  });

  describe("allocate", () => {
    it("should allocate budget for isolated mode", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.allocate("sub1", { mode: "isolated" });

      expect(!("error" in result).toBeTruthy());
      expect(result.mode).toBe("isolated");
      expect(result.budget).toBe(12000); // 80000 * 0.15
      expect(result.priority).toBe(3);
    });

    it("should allocate budget for shared mode", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.allocate("sub1", { mode: "shared" });

      expect(!("error" in result).toBeTruthy());
      expect(result.mode).toBe("shared");
      expect(result.budget).toBe(20000); // 80000 * 0.25
      expect(result.priority).toBe(2);
    });

    it("should allocate budget for handoff mode", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.allocate("sub1", { mode: "handoff" });

      expect(!("error" in result).toBeTruthy());
      expect(result.mode).toBe("handoff");
      expect(result.budget).toBe(28000); // 80000 * 0.35
      expect(result.priority).toBe(1);
    });

    it("should respect requestedBudget when smaller than mode limit", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.allocate("sub1", { mode: "handoff", requestedBudget: 5000 });

      expect(!("error" in result).toBeTruthy());
      expect(result.budget).toBe(5000);
    });

    it("should cap at mode limit when requestedBudget is larger", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.allocate("sub1", { mode: "isolated", requestedBudget: 50000 });

      expect(!("error" in result).toBeTruthy());
      expect(result.budget).toBe(12000); // capped at 80000 * 0.15
    });

    it("should track allocation and reduce available budget", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const beforeAvailable = mgr.getAvailable();

      mgr.allocate("sub1", { mode: "isolated" });

      expect(mgr.getAvailable()).toBe(beforeAvailable - 12000);
      expect(mgr.getActiveCount()).toBe(1);
    });

    it("should prevent allocation to already active subagent", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" });
      const result = mgr.allocate("sub1", { mode: "shared" });

      expect("error" in result).toBeTruthy();
      expect(result.error.includes("already has active allocation")).toBeTruthy();
    });

    it("should respect maxConcurrent limit", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000, maxConcurrent: 2 });
      mgr.allocate("sub1", { mode: "isolated" });
      mgr.allocate("sub2", { mode: "isolated" });
      const result = mgr.allocate("sub3", { mode: "isolated" });

      expect("error" in result).toBeTruthy();
      expect(result.error.includes("Max concurrent limit")).toBeTruthy();
    });

    it("should error when budget exhausted", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 5000, maxConcurrent: 10 });
      mgr.allocate("sub1", { mode: "handoff" }); // 4000 * 0.35 = 1400
      mgr.allocate("sub2", { mode: "handoff" }); // 4000 - 1400 = 2600 available, gets 1400
      mgr.allocate("sub3", { mode: "handoff" }); // 1200 available, gets 1200

      const result = mgr.allocate("sub4", { mode: "handoff" });
      // Should fail due to insufficient budget
      expect("error" in result).toBeTruthy();
    });

    it("should normalize mode to lowercase", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.allocate("sub1", { mode: "SHARED" });

      expect(!("error" in result).toBeTruthy());
      expect(result.mode).toBe("shared");
    });

    it("should default unknown mode to isolated", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.allocate("sub1", { mode: "unknown" });

      expect(!("error" in result).toBeTruthy());
      expect(result.mode).toBe("isolated");
    });
  });

  describe("recordUsage", () => {
    it("should record token usage", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" });

      const result = mgr.recordUsage("sub1", 1000);

      expect(result.ok).toBe(true);
      expect(result.remaining).toBe(11000);
      expect(result.exceeded).toBe(false);
    });

    it("should detect exceeded budget", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" }); // 12000 budget

      const result = mgr.recordUsage("sub1", 15000);

      expect(result.ok).toBe(true);
      expect(result.remaining).toBe(0);
      expect(result.exceeded).toBe(true);
    });

    it("should error for unknown subagent", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.recordUsage("unknown", 1000);

      expect(result.ok).toBe(false);
      expect(result.error.includes("No allocation found")).toBeTruthy();
    });

    it("should accumulate usage over multiple calls", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" }); // 12000 budget

      mgr.recordUsage("sub1", 3000);
      mgr.recordUsage("sub1", 4000);
      const result = mgr.recordUsage("sub1", 2000);

      expect(result.remaining).toBe(3000);
    });
  });

  describe("release", () => {
    it("should release and refund unused budget", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" }); // 12000 budget
      mgr.recordUsage("sub1", 5000);

      const beforeRelease = mgr.getAvailable();
      const result = mgr.release("sub1");

      expect(result.ok).toBe(true);
      expect(result.refunded).toBe(7000);
      expect(mgr.getAvailable()).toBe(beforeRelease + 7000);
      expect(mgr.getActiveCount()).toBe(0);
    });

    it("should update usage with actualUsed parameter", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" }); // 12000 budget
      mgr.recordUsage("sub1", 5000);

      const result = mgr.release("sub1", 8000); // actualUsed is more than recorded

      expect(result.ok).toBe(true);
      expect(result.refunded).toBe(4000); // 12000 - 8000
    });

    it("should mark allocation as completed", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" });
      mgr.release("sub1");

      const allocation = mgr.getAllocation("sub1");
      expect(allocation.status).toBe("completed");
      expect(allocation.endTime > 0).toBeTruthy();
    });

    it("should allow new allocation after release", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" });
      mgr.release("sub1");

      // Same ID can be reused after release
      const result = mgr.allocate("sub1", { mode: "shared" });
      expect(!("error" in result).toBeTruthy());
    });
  });

  describe("abort", () => {
    it("should abort and release unused budget", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" }); // 12000 budget
      mgr.recordUsage("sub1", 3000);

      const beforeAbort = mgr.getAvailable();
      const result = mgr.abort("sub1");

      expect(result.ok).toBe(true);
      expect(mgr.getAvailable()).toBe(beforeAbort + 9000); // 12000 - 3000 unused
    });

    it("should mark allocation as aborted", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" });
      mgr.abort("sub1");

      const allocation = mgr.getAllocation("sub1");
      expect(allocation.status).toBe("aborted");
    });
  });

  describe("getActiveAllocations", () => {
    it("should return all active allocations", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" });
      mgr.allocate("sub2", { mode: "shared" });
      mgr.allocate("sub3", { mode: "handoff" });
      mgr.release("sub2");

      const active = mgr.getActiveAllocations();

      expect(active.length).toBe(2);
      const ids = active.map((a) => a.subagentId);
      expect(ids.includes("sub1")).toBeTruthy();
      expect(ids.includes("sub3")).toBeTruthy();
      expect(!ids.includes("sub2")).toBeTruthy();
    });
  });

  describe("getStats", () => {
    it("should return comprehensive statistics", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" }); // 12000
      mgr.recordUsage("sub1", 5000);
      mgr.allocate("sub2", { mode: "shared" }); // 20000
      mgr.release("sub2", 10000); // refunds 10000 (20000 - 10000)

      const stats = mgr.getStats();

      expect(stats.parentBudget).toBe(100000);
      expect(stats.distributableBudget).toBe(80000);
      // totalAllocated = 12000 (sub1 active) + 20000 (sub2) - 10000 (refunded) = 22000
      expect(stats.totalAllocated).toBe(22000);
      expect(stats.totalUsed).toBe(15000); // 5000 + 10000
      expect(stats.activeCount).toBe(1);
      expect(stats.completedCount).toBe(1);
    });
  });

  describe("reset", () => {
    it("should clear all allocations", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" });
      mgr.allocate("sub2", { mode: "shared" });

      mgr.reset();

      expect(mgr.getActiveCount()).toBe(0);
      expect(mgr.getAvailable()).toBe(80000);
      expect(mgr.getStats().totalAllocated).toBe(0);
      expect(mgr.getStats().totalUsed).toBe(0);
    });
  });

  describe("adjustParentBudget", () => {
    it("should adjust budget dynamically", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" }); // 12000

      const result = mgr.adjustParentBudget(50000);

      expect(result.oldBudget).toBe(100000);
      expect(result.newBudget).toBe(50000);
      expect(result.distributableBudget).toBe(40000);
    });
  });

  describe("canAllocate", () => {
    it("should return true when allocation is possible", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.canAllocate();

      expect(result.canAllocate).toBe(true);
      expect(result.reason).toBe(undefined);
    });

    it("should return false when max concurrent reached", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000, maxConcurrent: 1 });
      mgr.allocate("sub1", { mode: "isolated" });

      const result = mgr.canAllocate();

      expect(result.canAllocate).toBe(false);
      expect(result.reason.includes("Max concurrent")).toBeTruthy();
    });
  });
});

describe("createSubagentBudgetManager", () => {
  it("should create manager with factory function", () => {
    const mgr = createSubagentBudgetManager({ parentBudget: 50000 });

    expect(mgr instanceof SubagentBudgetManager).toBeTruthy();
    expect(mgr.getStats().parentBudget).toBe(50000);
  });
});

describe("MODE_ALLOCATION_RATIOS", () => {
  it("should have expected values", () => {
    expect(MODE_ALLOCATION_RATIOS.isolated).toBe(0.15);
    expect(MODE_ALLOCATION_RATIOS.shared).toBe(0.25);
    expect(MODE_ALLOCATION_RATIOS.handoff).toBe(0.35);
  });
});

describe("MODE_PRIORITY", () => {
  it("should have expected values", () => {
    expect(MODE_PRIORITY.isolated).toBe(3);
    expect(MODE_PRIORITY.shared).toBe(2);
    expect(MODE_PRIORITY.handoff).toBe(1);
  });
});
