import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:perf_hooks", () => ({
  performance: { now: () => 0 },
}));

import {
  SubagentBudgetManager,
  MODE_ALLOCATION_RATIOS,
  MODE_PRIORITY,
} from "../../../../../../js/agents/runtime/core/context/subagent-budget.js";

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
    maxConcurrent: 10,
    ...options,
  });

describe("SubagentBudgetManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("computes distributable budget and initial availability", () => {
    const manager = createManager({ maxConcurrent: 3 });
    expect(manager.getAvailable()).toBe(BASE_DISTRIBUTABLE);
    expect(manager.getActiveCount()).toBe(0);
  });

  it("clamps reserveRatio into [0.1, 0.5] and enforces minimums", () => {
    const lowReserve = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0 });
    expect(lowReserve.getAvailable()).toBe(900);

    const highReserve = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.9 });
    expect(highReserve.getAvailable()).toBe(500);

    const minParentBudget = new SubagentBudgetManager({ parentBudget: 0 });
    expect(minParentBudget._parentBudget).toBe(1);

    const minConcurrent = new SubagentBudgetManager({ maxConcurrent: 0 });
    expect(minConcurrent._maxConcurrent).toBe(1);
  });

  it("never returns negative availability", () => {
    const manager = new SubagentBudgetManager({ parentBudget: 10, reserveRatio: 0.1 });
    manager._totalAllocated = Number.MAX_SAFE_INTEGER;
    expect(manager.getAvailable()).toBe(0);
  });

  it("counts only active allocations", () => {
    const manager = createManager();

    manager.allocate("a");
    manager.allocate("b");
    expect(manager.getActiveCount()).toBe(2);

    const recordA = manager._allocations.get("a");
    recordA.status = "completed";
    expect(manager.getActiveCount()).toBe(1);
  });

  it("canAllocate returns explicit reasons for concurrency and budget exhaustion", () => {
    const limited = createManager({ maxConcurrent: 1 });
    limited.allocate("a");

    expect(limited.canAllocate()).toEqual({
      canAllocate: false,
      reason: "Max concurrent limit reached (1)",
    });
    expect(limited.allocate("b")).toEqual({ error: "Max concurrent limit reached (1)" });

    const noBudget = new SubagentBudgetManager({ parentBudget: 1, reserveRatio: 0.5, maxConcurrent: 10 });
    expect(noBudget.canAllocate()).toEqual({ canAllocate: false, reason: "No budget available" });
    expect(noBudget.allocate("a")).toEqual({ error: "No budget available" });
  });

  it("allocates default per-mode budget, sets priority, and records allocation details", () => {
    vi.spyOn(Date, "now").mockReturnValue(123456789);

    const manager = createManager();

    const result = manager.allocate("sub1");
    expect(result).toEqual({ budget: ISOLATED_BUDGET, mode: "isolated", priority: MODE_PRIORITY.isolated });
    expect(manager.getAvailable()).toBe(BASE_DISTRIBUTABLE - ISOLATED_BUDGET);

    const record = manager._allocations.get("sub1");
    expect(record).toEqual({
      subagentId: "sub1",
      allocated: ISOLATED_BUDGET,
      used: 0,
      mode: "isolated",
      startTime: 123456789,
      endTime: 0,
      status: "active",
    });
  });

  it("honors requestedBudget when valid and positive; caps by mode max and available", () => {
    const manager = createManager();

    expect(manager.allocate("a", { requestedBudget: 5000 })).toEqual({
      budget: 5000,
      mode: "isolated",
      priority: MODE_PRIORITY.isolated,
    });

    expect(manager.allocate("b", { requestedBudget: 999999 })).toEqual({
      budget: ISOLATED_BUDGET,
      mode: "isolated",
      priority: MODE_PRIORITY.isolated,
    });

    expect(manager.allocate("c", { requestedBudget: Number.MAX_SAFE_INTEGER })).toEqual({
      budget: ISOLATED_BUDGET,
      mode: "isolated",
      priority: MODE_PRIORITY.isolated,
    });
  });

  it("falls back to default mode budget when requestedBudget is non-positive or non-finite (type boundaries)", () => {
    const manager = createManager();

    expect(manager.allocate("a", { requestedBudget: 0 })).toEqual({
      budget: ISOLATED_BUDGET,
      mode: "isolated",
      priority: MODE_PRIORITY.isolated,
    });
    expect(manager.allocate("b", { requestedBudget: -1 })).toEqual({
      budget: ISOLATED_BUDGET,
      mode: "isolated",
      priority: MODE_PRIORITY.isolated,
    });
    expect(manager.allocate("c", { requestedBudget: NaN })).toEqual({
      budget: ISOLATED_BUDGET,
      mode: "isolated",
      priority: MODE_PRIORITY.isolated,
    });
    expect(manager.allocate("d", { requestedBudget: "100" })).toEqual({
      budget: ISOLATED_BUDGET,
      mode: "isolated",
      priority: MODE_PRIORITY.isolated,
    });
    expect(manager.allocate("e", { requestedBudget: {} })).toEqual({
      budget: ISOLATED_BUDGET,
      mode: "isolated",
      priority: MODE_PRIORITY.isolated,
    });
    expect(manager.allocate("f", [])).toEqual({
      budget: ISOLATED_BUDGET,
      mode: "isolated",
      priority: MODE_PRIORITY.isolated,
    });
  });

  it("allocates by mode ratios and uses default priority per mode; supports explicit priority override", () => {
    const manager = createManager();

    expect(manager.allocate("a", { mode: "shared" })).toEqual({
      budget: SHARED_BUDGET,
      mode: "shared",
      priority: MODE_PRIORITY.shared,
    });
    expect(manager.allocate("b", { mode: "handoff" })).toEqual({
      budget: HANDOFF_BUDGET,
      mode: "handoff",
      priority: MODE_PRIORITY.handoff,
    });

    expect(manager.allocate("c", { mode: "handoff", priority: 99 })).toEqual({
      budget: HANDOFF_BUDGET,
      mode: "handoff",
      priority: 99,
    });
  });

  it("normalizes unknown/invalid modes to isolated (null/whitespace/unknown)", () => {
    const manager = createManager();

    expect(manager.allocate("a", { mode: "weird-mode" })).toMatchObject({
      mode: "isolated",
      priority: MODE_PRIORITY.isolated,
    });
    expect(manager.allocate("b", { mode: "   " })).toMatchObject({
      mode: "isolated",
      priority: MODE_PRIORITY.isolated,
    });
    expect(manager.allocate("c", { mode: null })).toMatchObject({
      mode: "isolated",
      priority: MODE_PRIORITY.isolated,
    });
    expect(manager.allocate("d", { mode: undefined })).toMatchObject({
      mode: "isolated",
      priority: MODE_PRIORITY.isolated,
    });
  });

  it("rejects duplicate active allocations for the same subagentId; allows re-allocation when not active", () => {
    const manager = new SubagentBudgetManager({ parentBudget: 100000, reserveRatio: 0.2, maxConcurrent: 10 });

    expect(manager.allocate("dup")).toMatchObject({ mode: "isolated" });

    const second = manager.allocate("dup");
    expect(second).toMatchObject({ error: expect.stringContaining("already has active allocation") });

    manager._allocations.get("dup").status = "completed";
    const third = manager.allocate("dup");
    expect(third).not.toHaveProperty("error");

    const record = manager._allocations.get("dup");
    expect(record.status).toBe("active");
    expect(record.used).toBe(0);
  });

  it("caps budget by current availability even under rapid consecutive allocations (concurrency + budget edge)", () => {
    const manager = createManager();

    expect(manager.allocate("a", { mode: "handoff" })).toEqual({
      budget: HANDOFF_BUDGET,
      mode: "handoff",
      priority: MODE_PRIORITY.handoff,
    });
    expect(manager.allocate("b", { mode: "handoff" })).toEqual({
      budget: HANDOFF_BUDGET,
      mode: "handoff",
      priority: MODE_PRIORITY.handoff,
    });
    expect(manager.allocate("c", { mode: "handoff" })).toEqual({
      budget: BASE_DISTRIBUTABLE - HANDOFF_BUDGET * 2,
      mode: "handoff",
      priority: MODE_PRIORITY.handoff,
    });
    expect(manager.getAvailable()).toBe(0);
  });

  it("handles rapid consecutive calls until budget exhaustion (no order dependence)", () => {
    const manager = new SubagentBudgetManager({
      parentBudget: 20000,
      reserveRatio: 0.1, // distributable = 18000
      maxConcurrent: 50,
      modeRatios: { isolated: 1 },
    });

    const results = [];
    for (let i = 0; i < 18; i++) results.push(manager.allocate(`s${i}`, { requestedBudget: 1000 }));

    expect(results.every((r) => !("error" in r) && r.budget === 1000)).toBe(true);
    expect(manager.getAvailable()).toBe(0);
    expect(manager.canAllocate()).toEqual({ canAllocate: false, reason: "No budget available" });

    const exhausted = manager.allocate("s18", { requestedBudget: 1000 });
    expect(exhausted).toEqual({ error: "No budget available" });
  });

  it("treats options=null as an error (destructuring safety)", () => {
    const manager = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.2, maxConcurrent: 10 });
    expect(() => manager.allocate("a", null)).toThrow();
  });

  it("accepts very long subagentId strings and deep-nested options objects", () => {
    const manager = createManager();
    const longId = "x".repeat(10_000);

    const result = manager.allocate(longId, {
      mode: "shared",
      requestedBudget: 5000,
      priority: 7,
      extra: { nested: { value: { deeper: [{ a: 1 }, { b: 2 }] } } },
    });

    expect(result).toEqual({ budget: 5000, mode: "shared", priority: 7 });
    expect(manager._allocations.get(longId)).toMatchObject({ subagentId: longId, allocated: 5000, used: 0 });
  });

  it("handles extremely large parentBudget without producing non-finite availability", () => {
    const manager = new SubagentBudgetManager({ parentBudget: Number.MAX_SAFE_INTEGER, reserveRatio: 0.2 });
    expect(Number.isFinite(manager.getAvailable())).toBe(true);
    expect(manager.getAvailable()).toBeGreaterThan(0);
  });
});
