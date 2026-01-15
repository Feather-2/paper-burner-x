import { describe, it } from "node:test";
import assert from "node:assert/strict";

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

      assert.equal(stats.parentBudget, 100000);
      assert.equal(stats.reserveRatio, 0.2);
      assert.equal(stats.distributableBudget, 80000);
      assert.equal(stats.available, 80000);
    });

    it("should accept custom parentBudget", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 50000 });
      assert.equal(mgr.getStats().parentBudget, 50000);
      assert.equal(mgr.getStats().distributableBudget, 40000);
    });

    it("should accept custom reserveRatio", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000, reserveRatio: 0.3 });
      assert.equal(mgr.getStats().reserveRatio, 0.3);
      assert.equal(mgr.getStats().distributableBudget, 70000);
    });

    it("should clamp reserveRatio to valid range", () => {
      const mgrLow = new SubagentBudgetManager({ reserveRatio: 0.05 });
      assert.equal(mgrLow.getStats().reserveRatio, 0.1);

      const mgrHigh = new SubagentBudgetManager({ reserveRatio: 0.9 });
      assert.equal(mgrHigh.getStats().reserveRatio, 0.5);
    });
  });

  describe("allocate", () => {
    it("should allocate budget for isolated mode", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.allocate("sub1", { mode: "isolated" });

      assert.ok(!("error" in result));
      assert.equal(result.mode, "isolated");
      assert.equal(result.budget, 12000); // 80000 * 0.15
      assert.equal(result.priority, 3);
    });

    it("should allocate budget for shared mode", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.allocate("sub1", { mode: "shared" });

      assert.ok(!("error" in result));
      assert.equal(result.mode, "shared");
      assert.equal(result.budget, 20000); // 80000 * 0.25
      assert.equal(result.priority, 2);
    });

    it("should allocate budget for handoff mode", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.allocate("sub1", { mode: "handoff" });

      assert.ok(!("error" in result));
      assert.equal(result.mode, "handoff");
      assert.equal(result.budget, 28000); // 80000 * 0.35
      assert.equal(result.priority, 1);
    });

    it("should respect requestedBudget when smaller than mode limit", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.allocate("sub1", { mode: "handoff", requestedBudget: 5000 });

      assert.ok(!("error" in result));
      assert.equal(result.budget, 5000);
    });

    it("should cap at mode limit when requestedBudget is larger", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.allocate("sub1", { mode: "isolated", requestedBudget: 50000 });

      assert.ok(!("error" in result));
      assert.equal(result.budget, 12000); // capped at 80000 * 0.15
    });

    it("should track allocation and reduce available budget", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const beforeAvailable = mgr.getAvailable();

      mgr.allocate("sub1", { mode: "isolated" });

      assert.equal(mgr.getAvailable(), beforeAvailable - 12000);
      assert.equal(mgr.getActiveCount(), 1);
    });

    it("should prevent allocation to already active subagent", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" });
      const result = mgr.allocate("sub1", { mode: "shared" });

      assert.ok("error" in result);
      assert.ok(result.error.includes("already has active allocation"));
    });

    it("should respect maxConcurrent limit", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000, maxConcurrent: 2 });
      mgr.allocate("sub1", { mode: "isolated" });
      mgr.allocate("sub2", { mode: "isolated" });
      const result = mgr.allocate("sub3", { mode: "isolated" });

      assert.ok("error" in result);
      assert.ok(result.error.includes("Max concurrent limit"));
    });

    it("should error when budget exhausted", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 5000, maxConcurrent: 10 });
      mgr.allocate("sub1", { mode: "handoff" }); // 4000 * 0.35 = 1400
      mgr.allocate("sub2", { mode: "handoff" }); // 4000 - 1400 = 2600 available, gets 1400
      mgr.allocate("sub3", { mode: "handoff" }); // 1200 available, gets 1200

      const result = mgr.allocate("sub4", { mode: "handoff" });
      // Should fail due to insufficient budget
      assert.ok("error" in result);
    });

    it("should normalize mode to lowercase", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.allocate("sub1", { mode: "SHARED" });

      assert.ok(!("error" in result));
      assert.equal(result.mode, "shared");
    });

    it("should default unknown mode to isolated", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.allocate("sub1", { mode: "unknown" });

      assert.ok(!("error" in result));
      assert.equal(result.mode, "isolated");
    });
  });

  describe("recordUsage", () => {
    it("should record token usage", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" });

      const result = mgr.recordUsage("sub1", 1000);

      assert.equal(result.ok, true);
      assert.equal(result.remaining, 11000);
      assert.equal(result.exceeded, false);
    });

    it("should detect exceeded budget", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" }); // 12000 budget

      const result = mgr.recordUsage("sub1", 15000);

      assert.equal(result.ok, true);
      assert.equal(result.remaining, 0);
      assert.equal(result.exceeded, true);
    });

    it("should error for unknown subagent", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.recordUsage("unknown", 1000);

      assert.equal(result.ok, false);
      assert.ok(result.error.includes("No allocation found"));
    });

    it("should accumulate usage over multiple calls", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" }); // 12000 budget

      mgr.recordUsage("sub1", 3000);
      mgr.recordUsage("sub1", 4000);
      const result = mgr.recordUsage("sub1", 2000);

      assert.equal(result.remaining, 3000);
    });
  });

  describe("release", () => {
    it("should release and refund unused budget", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" }); // 12000 budget
      mgr.recordUsage("sub1", 5000);

      const beforeRelease = mgr.getAvailable();
      const result = mgr.release("sub1");

      assert.equal(result.ok, true);
      assert.equal(result.refunded, 7000);
      assert.equal(mgr.getAvailable(), beforeRelease + 7000);
      assert.equal(mgr.getActiveCount(), 0);
    });

    it("should update usage with actualUsed parameter", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" }); // 12000 budget
      mgr.recordUsage("sub1", 5000);

      const result = mgr.release("sub1", 8000); // actualUsed is more than recorded

      assert.equal(result.ok, true);
      assert.equal(result.refunded, 4000); // 12000 - 8000
    });

    it("should mark allocation as completed", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" });
      mgr.release("sub1");

      const allocation = mgr.getAllocation("sub1");
      assert.equal(allocation.status, "completed");
      assert.ok(allocation.endTime > 0);
    });

    it("should allow new allocation after release", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" });
      mgr.release("sub1");

      // Same ID can be reused after release
      const result = mgr.allocate("sub1", { mode: "shared" });
      assert.ok(!("error" in result));
    });
  });

  describe("abort", () => {
    it("should abort and release unused budget", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" }); // 12000 budget
      mgr.recordUsage("sub1", 3000);

      const beforeAbort = mgr.getAvailable();
      const result = mgr.abort("sub1");

      assert.equal(result.ok, true);
      assert.equal(mgr.getAvailable(), beforeAbort + 9000); // 12000 - 3000 unused
    });

    it("should mark allocation as aborted", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" });
      mgr.abort("sub1");

      const allocation = mgr.getAllocation("sub1");
      assert.equal(allocation.status, "aborted");
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

      assert.equal(active.length, 2);
      const ids = active.map((a) => a.subagentId);
      assert.ok(ids.includes("sub1"));
      assert.ok(ids.includes("sub3"));
      assert.ok(!ids.includes("sub2"));
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

      assert.equal(stats.parentBudget, 100000);
      assert.equal(stats.distributableBudget, 80000);
      // totalAllocated = 12000 (sub1 active) + 20000 (sub2) - 10000 (refunded) = 22000
      assert.equal(stats.totalAllocated, 22000);
      assert.equal(stats.totalUsed, 15000); // 5000 + 10000
      assert.equal(stats.activeCount, 1);
      assert.equal(stats.completedCount, 1);
    });
  });

  describe("reset", () => {
    it("should clear all allocations", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" });
      mgr.allocate("sub2", { mode: "shared" });

      mgr.reset();

      assert.equal(mgr.getActiveCount(), 0);
      assert.equal(mgr.getAvailable(), 80000);
      assert.equal(mgr.getStats().totalAllocated, 0);
      assert.equal(mgr.getStats().totalUsed, 0);
    });
  });

  describe("adjustParentBudget", () => {
    it("should adjust budget dynamically", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      mgr.allocate("sub1", { mode: "isolated" }); // 12000

      const result = mgr.adjustParentBudget(50000);

      assert.equal(result.oldBudget, 100000);
      assert.equal(result.newBudget, 50000);
      assert.equal(result.distributableBudget, 40000);
    });
  });

  describe("canAllocate", () => {
    it("should return true when allocation is possible", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000 });
      const result = mgr.canAllocate();

      assert.equal(result.canAllocate, true);
      assert.equal(result.reason, undefined);
    });

    it("should return false when max concurrent reached", () => {
      const mgr = new SubagentBudgetManager({ parentBudget: 100000, maxConcurrent: 1 });
      mgr.allocate("sub1", { mode: "isolated" });

      const result = mgr.canAllocate();

      assert.equal(result.canAllocate, false);
      assert.ok(result.reason.includes("Max concurrent"));
    });
  });
});

describe("createSubagentBudgetManager", () => {
  it("should create manager with factory function", () => {
    const mgr = createSubagentBudgetManager({ parentBudget: 50000 });

    assert.ok(mgr instanceof SubagentBudgetManager);
    assert.equal(mgr.getStats().parentBudget, 50000);
  });
});

describe("MODE_ALLOCATION_RATIOS", () => {
  it("should have expected values", () => {
    assert.equal(MODE_ALLOCATION_RATIOS.isolated, 0.15);
    assert.equal(MODE_ALLOCATION_RATIOS.shared, 0.25);
    assert.equal(MODE_ALLOCATION_RATIOS.handoff, 0.35);
  });
});

describe("MODE_PRIORITY", () => {
  it("should have expected values", () => {
    assert.equal(MODE_PRIORITY.isolated, 3);
    assert.equal(MODE_PRIORITY.shared, 2);
    assert.equal(MODE_PRIORITY.handoff, 1);
  });
});
