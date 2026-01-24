import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SubagentBudgetManagerDefault, {
  SubagentBudgetManager,
  createSubagentBudgetManager,
  MODE_ALLOCATION_RATIOS,
  MODE_PRIORITY,
} from '../../../../../js/agents/runtime/core/context/subagent-budget.js';

const FIXED_NOW = 1_700_000_000_000;

const BASE_PARENT_BUDGET = 100000;
const BASE_RESERVE_RATIO = 0.2;
const BASE_DISTRIBUTABLE = Math.floor(BASE_PARENT_BUDGET * (1 - BASE_RESERVE_RATIO));

const ISOLATED_BUDGET = Math.floor(BASE_DISTRIBUTABLE * MODE_ALLOCATION_RATIOS.isolated);
const SHARED_BUDGET = Math.floor(BASE_DISTRIBUTABLE * MODE_ALLOCATION_RATIOS.shared);
const HANDOFF_BUDGET = Math.floor(BASE_DISTRIBUTABLE * MODE_ALLOCATION_RATIOS.handoff);

const createManager = (options = {}) =>
  new SubagentBudgetManager({
    parentBudget: BASE_PARENT_BUDGET,
    reserveRatio: BASE_RESERVE_RATIO,
    maxConcurrent: 3,
    ...options,
  });

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exports", () => {
  it("should_return_SubagentBudgetManager_when_importing_default_export", () => {
    expect(SubagentBudgetManagerDefault).toBe(SubagentBudgetManager);
  });

  it("should_return_true_when_checking_MODE_ALLOCATION_RATIOS_is_frozen", () => {
    expect(Object.isFrozen(MODE_ALLOCATION_RATIOS)).toBe(true);
  });

  it("should_return_true_when_checking_MODE_PRIORITY_is_frozen", () => {
    expect(Object.isFrozen(MODE_PRIORITY)).toBe(true);
  });

  it("should_return_expected_isolated_ratio_when_accessing_MODE_ALLOCATION_RATIOS", () => {
    expect(MODE_ALLOCATION_RATIOS.isolated).toBe(0.15);
  });

  it("should_return_expected_shared_ratio_when_accessing_MODE_ALLOCATION_RATIOS", () => {
    expect(MODE_ALLOCATION_RATIOS.shared).toBe(0.25);
  });

  it("should_return_expected_handoff_ratio_when_accessing_MODE_ALLOCATION_RATIOS", () => {
    expect(MODE_ALLOCATION_RATIOS.handoff).toBe(0.35);
  });

  it("should_return_expected_isolated_priority_when_accessing_MODE_PRIORITY", () => {
    expect(MODE_PRIORITY.isolated).toBe(3);
  });

  it("should_return_expected_shared_priority_when_accessing_MODE_PRIORITY", () => {
    expect(MODE_PRIORITY.shared).toBe(2);
  });

  it("should_return_expected_handoff_priority_when_accessing_MODE_PRIORITY", () => {
    expect(MODE_PRIORITY.handoff).toBe(1);
  });
});

describe("SubagentBudgetManager", () => {
  describe("constructor / getStats", () => {
    it("should_return_default_parentBudget_when_constructed_with_no_options", () => {
      const manager = new SubagentBudgetManager();

      expect(manager.getStats().parentBudget).toBe(100000);
    });

    it("should_return_default_reserveRatio_when_constructed_with_no_options", () => {
      const manager = new SubagentBudgetManager();

      expect(manager.getStats().reserveRatio).toBe(0.2);
    });

    it("should_return_default_distributableBudget_when_constructed_with_no_options", () => {
      const manager = new SubagentBudgetManager();

      expect(manager.getStats().distributableBudget).toBe(80000);
    });

    it("should_return_default_available_when_constructed_with_no_allocations", () => {
      const manager = new SubagentBudgetManager();

      expect(manager.getStats().available).toBe(80000);
    });

    it("should_return_parentBudget_50000_when_parentBudget_is_provided", () => {
      const manager = new SubagentBudgetManager({ parentBudget: 50000 });

      expect(manager.getStats().parentBudget).toBe(50000);
    });

    it("should_return_distributableBudget_40000_when_parentBudget_is_50000_and_reserveRatio_is_default", () => {
      const manager = new SubagentBudgetManager({ parentBudget: 50000 });

      expect(manager.getStats().distributableBudget).toBe(40000);
    });

    it("should_return_reserveRatio_0_3_when_reserveRatio_is_provided", () => {
      const manager = new SubagentBudgetManager({ parentBudget: 100000, reserveRatio: 0.3 });

      expect(manager.getStats().reserveRatio).toBe(0.3);
    });

    it("should_return_distributableBudget_70000_when_parentBudget_is_100000_and_reserveRatio_is_0_3", () => {
      const manager = new SubagentBudgetManager({ parentBudget: 100000, reserveRatio: 0.3 });

      expect(manager.getStats().distributableBudget).toBe(70000);
    });

    it("should_return_reserveRatio_0_1_when_reserveRatio_is_below_minimum", () => {
      const manager = new SubagentBudgetManager({ reserveRatio: 0.05 });

      expect(manager.getStats().reserveRatio).toBe(0.1);
    });

    it("should_return_reserveRatio_0_5_when_reserveRatio_is_above_maximum", () => {
      const manager = new SubagentBudgetManager({ reserveRatio: 0.9 });

      expect(manager.getStats().reserveRatio).toBe(0.5);
    });

    it("should_return_parentBudget_1_when_parentBudget_is_non_positive", () => {
      const manager = new SubagentBudgetManager({ parentBudget: 0 });

      expect(manager.getStats().parentBudget).toBe(1);
    });

    it("should_return_canAllocate_true_when_maxConcurrent_is_below_1", () => {
      const manager = new SubagentBudgetManager({ maxConcurrent: 0 });

      expect(manager.canAllocate()).toEqual({ canAllocate: true });
    });
  });

  describe("getAvailable", () => {
    it("should_return_distributable_budget_when_no_allocations_exist", () => {
      const manager = createManager();

      expect(manager.getAvailable()).toBe(BASE_DISTRIBUTABLE);
    });

    it("should_return_0_when_distributable_budget_is_lower_than_totalAllocated", () => {
      const manager = createManager({ maxConcurrent: 10 });

      manager.allocate("sub1", { mode: "handoff" });
      manager.adjustParentBudget(1000);

      expect(manager.getAvailable()).toBe(0);
    });
  });

  describe("getActiveCount", () => {
    it("should_return_0_when_no_allocations_exist", () => {
      const manager = createManager();

      expect(manager.getActiveCount()).toBe(0);
    });

    it("should_return_1_when_one_allocation_is_active", () => {
      const manager = createManager();

      manager.allocate("sub1");

      expect(manager.getActiveCount()).toBe(1);
    });

    it("should_return_0_when_allocation_is_released", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.release("sub1");

      expect(manager.getActiveCount()).toBe(0);
    });

    it("should_return_0_when_allocation_is_aborted", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.abort("sub1");

      expect(manager.getActiveCount()).toBe(0);
    });
  });

  describe("canAllocate", () => {
    it("should_return_canAllocate_true_when_under_concurrency_limit_and_budget_available", () => {
      const manager = createManager();

      expect(manager.canAllocate()).toEqual({ canAllocate: true });
    });

    it("should_return_error_reason_when_maxConcurrent_limit_is_reached", () => {
      const manager = createManager({ maxConcurrent: 1 });

      manager.allocate("sub1");

      expect(manager.canAllocate()).toEqual({
        canAllocate: false,
        reason: "Max concurrent limit reached (1)",
      });
    });

    it("should_return_error_reason_when_no_budget_available", () => {
      const manager = new SubagentBudgetManager({ parentBudget: 1, reserveRatio: 0.1 });

      expect(manager.canAllocate()).toEqual({ canAllocate: false, reason: "No budget available" });
    });
  });

  describe("allocate", () => {
    it("should_return_isolated_budget_when_mode_is_isolated", () => {
      const manager = createManager();

      expect(manager.allocate("sub1", { mode: "isolated" }).budget).toBe(ISOLATED_BUDGET);
    });

    it("should_return_shared_budget_when_mode_is_shared", () => {
      const manager = createManager();

      expect(manager.allocate("sub1", { mode: "shared" }).budget).toBe(SHARED_BUDGET);
    });

    it("should_return_handoff_budget_when_mode_is_handoff", () => {
      const manager = createManager();

      expect(manager.allocate("sub1", { mode: "handoff" }).budget).toBe(HANDOFF_BUDGET);
    });

    it("should_return_priority_from_mode_when_priority_is_not_provided", () => {
      const manager = createManager();

      expect(manager.allocate("sub1", { mode: "handoff" }).priority).toBe(MODE_PRIORITY.handoff);
    });

    it("should_return_custom_priority_when_priority_is_provided", () => {
      const manager = createManager();

      expect(manager.allocate("sub1", { mode: "shared", priority: 9 }).priority).toBe(9);
    });

    it("should_return_lowercase_mode_when_mode_is_uppercase", () => {
      const manager = createManager();

      expect(manager.allocate("sub1", { mode: "SHARED" }).mode).toBe("shared");
    });

    it("should_return_isolated_mode_when_mode_is_unknown", () => {
      const manager = createManager();

      expect(manager.allocate("sub1", { mode: "unknown" }).mode).toBe("isolated");
    });

    it("should_return_isolated_mode_when_mode_is_minimal", () => {
      const manager = createManager();

      expect(manager.allocate("sub1", { mode: "minimal" }).mode).toBe("isolated");
    });

    it("should_return_requestedBudget_when_requestedBudget_is_within_mode_limit", () => {
      const manager = createManager();

      expect(manager.allocate("sub1", { mode: "handoff", requestedBudget: 5000 }).budget).toBe(5000);
    });

    it("should_return_mode_limit_budget_when_requestedBudget_exceeds_mode_limit", () => {
      const manager = createManager();

      expect(manager.allocate("sub1", { mode: "isolated", requestedBudget: 50000 }).budget).toBe(ISOLATED_BUDGET);
    });

    it("should_return_default_budget_when_requestedBudget_is_negative", () => {
      const manager = createManager();

      expect(manager.allocate("sub1", { mode: "isolated", requestedBudget: -1 }).budget).toBe(ISOLATED_BUDGET);
    });

    it("should_return_default_budget_when_requestedBudget_is_non_finite", () => {
      const manager = createManager();

      expect(manager.allocate("sub1", { mode: "isolated", requestedBudget: Infinity }).budget).toBe(ISOLATED_BUDGET);
    });

    it("should_return_available_distributable_minus_allocated_when_allocation_succeeds", () => {
      const manager = createManager();

      manager.allocate("sub1", { mode: "isolated" });

      expect(manager.getAvailable()).toBe(BASE_DISTRIBUTABLE - ISOLATED_BUDGET);
    });

    it("should_return_error_when_subagent_already_has_active_allocation", () => {
      const manager = createManager();

      manager.allocate("sub1", { mode: "isolated" });

      expect(manager.allocate("sub1", { mode: "shared" })).toEqual({
        error: "Subagent sub1 already has active allocation",
      });
    });

    it("should_return_successful_allocation_when_previous_allocation_is_completed", () => {
      const manager = createManager();

      manager.allocate("sub1", { mode: "isolated" });
      manager.release("sub1");

      expect(manager.allocate("sub1", { mode: "shared" })).not.toHaveProperty("error");
    });

    it("should_return_error_when_maxConcurrent_limit_is_reached", () => {
      const manager = createManager({ maxConcurrent: 2 });

      manager.allocate("sub1");
      manager.allocate("sub2");

      expect(manager.allocate("sub3")).toEqual({ error: "Max concurrent limit reached (2)" });
    });

    it("should_return_error_when_no_budget_available", () => {
      const manager = new SubagentBudgetManager({ parentBudget: 1, reserveRatio: 0.1 });

      expect(manager.allocate("sub1")).toEqual({ error: "No budget available" });
    });

    it("should_return_error_when_budget_is_below_minimum", () => {
      const manager = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.1 });

      expect(manager.allocate("tiny")).toEqual({ error: "Insufficient budget: need 1000, available 900" });
    });

    it("should_return_null_allocation_when_budget_is_below_minimum", () => {
      const manager = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.1 });

      manager.allocate("tiny");

      expect(manager.getAllocation("tiny")).toBeNull();
    });

    it("should_return_onBudgetExhausted_called_when_budget_is_below_minimum", () => {
      const onBudgetExhausted = vi.fn();
      const manager = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.1, onBudgetExhausted });

      manager.allocate("tiny");

      expect(onBudgetExhausted).toHaveBeenCalledWith({
        subagentId: "tiny",
        mode: "isolated",
        available: 900,
      });
    });

    it("should_return_custom_ratio_budget_when_modeRatios_override_isolated", () => {
      const manager = createManager({ modeRatios: { isolated: 0.5 } });

      expect(manager.allocate("sub1", { mode: "isolated" }).budget).toBe(40000);
    });

    it("should_return_default_ratio_budget_when_modeRatios_value_is_undefined", () => {
      const manager = createManager({ modeRatios: { isolated: undefined } });

      expect(manager.allocate("sub1", { mode: "isolated" }).budget).toBe(ISOLATED_BUDGET);
    });

    it("should_return_error_when_budget_is_exhausted_by_previous_allocations", () => {
      const manager = new SubagentBudgetManager({ parentBudget: 5000, reserveRatio: 0.2, maxConcurrent: 10 });

      manager.allocate("sub1", { mode: "handoff" });
      manager.allocate("sub2", { mode: "handoff" });
      manager.allocate("sub3", { mode: "handoff" });

      expect(manager.allocate("sub4", { mode: "handoff" })).toEqual({ error: "No budget available" });
    });

    it.each([
      ["blank string", "   ", "isolated"],
      ["null", null, "isolated"],
      ["object", { value: "handoff" }, "isolated"],
    ])("should_return_expected_mode_when_mode_input_is_edge_value (%s)", (_label, mode, expectedMode) => {
      const manager = createManager({ maxConcurrent: 10 });

      expect(manager.allocate("sub1", { mode }).mode).toBe(expectedMode);
    });
  });

  describe("recordUsage", () => {
    it("should_return_error_when_allocation_does_not_exist", () => {
      const manager = createManager();

      expect(manager.recordUsage("missing", 10)).toEqual({
        ok: false,
        error: "No allocation found for missing",
      });
    });

    it("should_return_error_when_allocation_is_not_active", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.release("sub1");

      expect(manager.recordUsage("sub1", 10)).toEqual({
        ok: false,
        error: "Allocation for sub1 is not active",
      });
    });

    it.each([
      ["null", null],
      ["undefined", undefined],
      ["string", "100"],
      ["object", {}],
      ["negative", -1],
      ["infinity", Infinity],
    ])("should_treat_tokensUsed_as_0_when_tokensUsed_is_invalid (%s)", (_label, tokensUsed) => {
      const manager = createManager();

      const allocation = manager.allocate("sub1");

      expect(manager.recordUsage("sub1", tokensUsed)).toEqual({
        ok: true,
        remaining: allocation.budget,
        exceeded: false,
      });
    });

    it("should_return_exceeded_true_when_tokensUsed_exceeds_allocation", () => {
      const manager = createManager();

      const allocation = manager.allocate("sub1");

      expect(manager.recordUsage("sub1", allocation.budget + 1).exceeded).toBe(true);
    });

    it("should_return_remaining_0_when_tokensUsed_exceeds_allocation", () => {
      const manager = createManager();

      const allocation = manager.allocate("sub1");

      expect(manager.recordUsage("sub1", allocation.budget + 1).remaining).toBe(0);
    });

    it("should_return_remaining_budget_when_usage_is_recorded_multiple_times", () => {
      const manager = createManager();

      const allocation = manager.allocate("sub1");

      manager.recordUsage("sub1", 3000);
      manager.recordUsage("sub1", 4000);

      expect(manager.recordUsage("sub1", 2000).remaining).toBe(allocation.budget - 9000);
    });
  });

  describe("release", () => {
    it("should_return_error_when_allocation_does_not_exist", () => {
      const manager = createManager();

      expect(manager.release("missing")).toEqual({
        ok: false,
        error: "No allocation found for missing",
      });
    });

    it("should_return_error_when_allocation_is_not_active", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.abort("sub1");

      expect(manager.release("sub1")).toEqual({
        ok: false,
        error: "Allocation for sub1 is not active",
      });
    });

    it("should_return_completed_status_when_release_succeeds", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.release("sub1");

      expect(manager.getAllocation("sub1").status).toBe("completed");
    });

    it("should_return_endTime_now_when_release_succeeds", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.release("sub1");

      expect(manager.getAllocation("sub1").endTime).toBe(FIXED_NOW);
    });

    it("should_return_refunded_budget_when_actualUsed_is_not_provided", () => {
      const manager = createManager();

      const allocation = manager.allocate("sub1");

      manager.recordUsage("sub1", 200);

      expect(manager.release("sub1").refunded).toBe(allocation.budget - 200);
    });

    it("should_return_totalUsed_adjusted_when_actualUsed_is_provided", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.recordUsage("sub1", 500);
      manager.release("sub1", 200);

      expect(manager.getStats().totalUsed).toBe(200);
    });

    it("should_return_totalUsed_unchanged_when_actualUsed_is_negative", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.recordUsage("sub1", 500);
      manager.release("sub1", -1);

      expect(manager.getStats().totalUsed).toBe(500);
    });

    it("should_return_available_equal_distributable_minus_used_when_release_refunds_budget", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.recordUsage("sub1", 200);
      manager.release("sub1");

      expect(manager.getAvailable()).toBe(BASE_DISTRIBUTABLE - 200);
    });
  });

  describe("abort", () => {
    it("should_return_error_when_allocation_does_not_exist", () => {
      const manager = createManager();

      expect(manager.abort("missing")).toEqual({
        ok: false,
        error: "No allocation found for missing",
      });
    });

    it("should_return_error_when_allocation_is_not_active", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.release("sub1");

      expect(manager.abort("sub1")).toEqual({
        ok: false,
        error: "Allocation for sub1 is not active",
      });
    });

    it("should_return_aborted_status_when_abort_succeeds", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.abort("sub1");

      expect(manager.getAllocation("sub1").status).toBe("aborted");
    });

    it("should_return_endTime_now_when_abort_succeeds", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.abort("sub1");

      expect(manager.getAllocation("sub1").endTime).toBe(FIXED_NOW);
    });

    it("should_return_available_equal_distributable_minus_used_when_abort_frees_unused_budget", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.recordUsage("sub1", 300);
      manager.abort("sub1");

      expect(manager.getAvailable()).toBe(BASE_DISTRIBUTABLE - 300);
    });

    it("should_return_available_distributable_minus_allocated_when_abort_is_called_after_overuse", () => {
      const manager = createManager();

      const allocation = manager.allocate("sub1");

      manager.recordUsage("sub1", allocation.budget + 1);
      manager.abort("sub1");

      expect(manager.getAvailable()).toBe(BASE_DISTRIBUTABLE - allocation.budget);
    });
  });

  describe("getAllocation", () => {
    it("should_return_null_when_allocation_does_not_exist", () => {
      const manager = createManager();

      expect(manager.getAllocation("missing")).toBeNull();
    });

    it("should_return_allocation_record_when_allocation_exists", () => {
      const manager = createManager();

      manager.allocate("sub1");

      expect(manager.getAllocation("sub1").subagentId).toBe("sub1");
    });
  });

  describe("getActiveAllocations", () => {
    it("should_return_empty_array_when_no_active_allocations_exist", () => {
      const manager = createManager();

      expect(manager.getActiveAllocations()).toEqual([]);
    });

    it("should_return_only_active_allocations_when_some_allocations_are_completed", () => {
      const manager = createManager({ maxConcurrent: 10 });

      manager.allocate("sub1");
      manager.release("sub1");
      manager.allocate("sub2");

      expect(manager.getActiveAllocations()).toHaveLength(1);
    });

    it("should_return_copies_when_getActiveAllocations_returns_records", () => {
      const manager = createManager();

      manager.allocate("sub1");

      const [record] = manager.getActiveAllocations();
      record.used = 999;

      expect(manager.getAllocation("sub1").used).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should_return_totalAllocated_including_spent_tokens_after_release", () => {
      const manager = createManager({ maxConcurrent: 10 });

      manager.allocate("sub1", { mode: "isolated" });
      manager.recordUsage("sub1", 5000);
      manager.allocate("sub2", { mode: "shared" });
      manager.release("sub2", 10000);

      expect(manager.getStats().totalAllocated).toBe(22000);
    });

    it("should_return_totalUsed_when_multiple_subagents_consume_tokens", () => {
      const manager = createManager({ maxConcurrent: 10 });

      manager.allocate("sub1", { mode: "isolated" });
      manager.recordUsage("sub1", 5000);
      manager.allocate("sub2", { mode: "shared" });
      manager.release("sub2", 10000);

      expect(manager.getStats().totalUsed).toBe(15000);
    });

    it("should_return_completedCount_when_allocation_is_released", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.release("sub1");

      expect(manager.getStats().completedCount).toBe(1);
    });

    it("should_return_activeCount_when_allocation_is_active", () => {
      const manager = createManager();

      manager.allocate("sub1");

      expect(manager.getStats().activeCount).toBe(1);
    });

    it("should_return_utilizationRatio_when_tokens_are_used", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.recordUsage("sub1", 4000);

      expect(manager.getStats().utilizationRatio).toBeCloseTo(4000 / BASE_DISTRIBUTABLE, 10);
    });
  });

  describe("reset", () => {
    it("should_return_activeCount_0_when_reset_is_called", () => {
      const manager = createManager({ maxConcurrent: 10 });

      manager.allocate("sub1");
      manager.allocate("sub2");
      manager.reset();

      expect(manager.getActiveCount()).toBe(0);
    });

    it("should_return_totalAllocated_0_when_reset_is_called", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.reset();

      expect(manager.getStats().totalAllocated).toBe(0);
    });

    it("should_return_totalUsed_0_when_reset_is_called", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.recordUsage("sub1", 200);
      manager.reset();

      expect(manager.getStats().totalUsed).toBe(0);
    });

    it("should_return_available_distributable_when_reset_is_called", () => {
      const manager = createManager();

      manager.allocate("sub1");
      manager.reset();

      expect(manager.getAvailable()).toBe(BASE_DISTRIBUTABLE);
    });
  });

  describe("adjustParentBudget", () => {
    it("should_return_updated_distributableBudget_when_parent_budget_is_adjusted", () => {
      const manager = createManager();

      expect(manager.adjustParentBudget(50000).distributableBudget).toBe(40000);
    });

    it.each([
      ["string", "50000"],
      ["null", null],
      ["undefined", undefined],
    ])("should_keep_existing_parent_budget_when_newBudget_is_non_finite (%s)", (_label, newBudget) => {
      const manager = createManager();

      const before = manager.getStats().parentBudget;

      expect(manager.adjustParentBudget(newBudget).newBudget).toBe(before);
    });

    it("should_return_newBudget_1_when_newBudget_is_negative", () => {
      const manager = createManager();

      expect(manager.adjustParentBudget(-1).newBudget).toBe(1);
    });

    it("should_return_available_0_when_new_budget_is_below_totalAllocated", () => {
      const manager = createManager({ maxConcurrent: 10 });

      manager.allocate("sub1");
      manager.adjustParentBudget(1000);

      expect(manager.getAvailable()).toBe(0);
    });

    it("should_return_MAX_SAFE_INTEGER_when_newBudget_is_MAX_SAFE_INTEGER", () => {
      const manager = createManager();

      expect(manager.adjustParentBudget(Number.MAX_SAFE_INTEGER).newBudget).toBe(Number.MAX_SAFE_INTEGER);
    });
  });
});

describe("createSubagentBudgetManager", () => {
  it("should_return_SubagentBudgetManager_instance_when_called", () => {
    expect(createSubagentBudgetManager({ parentBudget: 50000 })).toBeInstanceOf(SubagentBudgetManager);
  });

  it("should_return_parentBudget_when_parentBudget_is_provided", () => {
    const manager = createSubagentBudgetManager({ parentBudget: 50000 });

    expect(manager.getStats().parentBudget).toBe(50000);
  });

  it("should_return_SubagentBudgetManager_instance_when_config_is_array_like", () => {
    expect(createSubagentBudgetManager([])).toBeInstanceOf(SubagentBudgetManager);
  });
});
