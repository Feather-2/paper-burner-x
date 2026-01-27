import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:perf_hooks", () => ({
  performance: { now: () => 0 },
}));

import { SubagentBudgetManager } from "../../../../../../js/agents/runtime/core/context/subagent-budget.js";

describe("SubagentBudgetManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("computes distributable budget and initial availability", () => {
    const manager = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.2 });
    expect(manager.getAvailable()).toBe(800);
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
    const manager = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.2, maxConcurrent: 10 });

    manager.allocate("a");
    manager.allocate("b");
    expect(manager.getActiveCount()).toBe(2);

    const recordA = manager._allocations.get("a");
    recordA.status = "completed";
    expect(manager.getActiveCount()).toBe(1);
  });

  it("canAllocate returns explicit reasons for concurrency and budget exhaustion", () => {
    const limited = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.2, maxConcurrent: 1 });
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

    const manager = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.2, maxConcurrent: 10 });

    const result = manager.allocate("sub1");
    expect(result).toEqual({ budget: 120, mode: "isolated", priority: 3 });
    expect(manager.getAvailable()).toBe(680);

    const record = manager._allocations.get("sub1");
    expect(record).toEqual({
      subagentId: "sub1",
      allocated: 120,
      used: 0,
      mode: "isolated",
      startTime: 123456789,
      endTime: 0,
      status: "active",
    });
  });

  it("honors requestedBudget when valid and positive; caps by mode max and available", () => {
    const manager = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.2, maxConcurrent: 10 });

    expect(manager.allocate("a", { requestedBudget: 50 })).toEqual({
      budget: 50,
      mode: "isolated",
      priority: 3,
    });

    expect(manager.allocate("b", { requestedBudget: 999 })).toEqual({
      budget: 120,
      mode: "isolated",
      priority: 3,
    });

    expect(manager.allocate("c", { requestedBudget: Number.MAX_SAFE_INTEGER })).toEqual({
      budget: 120,
      mode: "isolated",
      priority: 3,
    });
  });

  it("falls back to default mode budget when requestedBudget is non-positive or non-finite (type boundaries)", () => {
    const manager = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.2, maxConcurrent: 10 });

    expect(manager.allocate("a", { requestedBudget: 0 })).toEqual({ budget: 120, mode: "isolated", priority: 3 });
    expect(manager.allocate("b", { requestedBudget: -1 })).toEqual({ budget: 120, mode: "isolated", priority: 3 });
    expect(manager.allocate("c", { requestedBudget: NaN })).toEqual({ budget: 120, mode: "isolated", priority: 3 });
    expect(manager.allocate("d", { requestedBudget: "100" })).toEqual({ budget: 120, mode: "isolated", priority: 3 });
    expect(manager.allocate("e", { requestedBudget: {} })).toEqual({ budget: 120, mode: "isolated", priority: 3 });
    expect(manager.allocate("f", [])).toEqual({ budget: 120, mode: "isolated", priority: 3 });
  });

  it("allocates by mode ratios and uses default priority per mode; supports explicit priority override", () => {
    const manager = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.2, maxConcurrent: 10 });

    expect(manager.allocate("a", { mode: "shared" })).toEqual({ budget: 200, mode: "shared", priority: 2 });
    expect(manager.allocate("b", { mode: "handoff" })).toEqual({ budget: 280, mode: "handoff", priority: 1 });

    expect(manager.allocate("c", { mode: "handoff", priority: 99 })).toEqual({
      budget: 280,
      mode: "handoff",
      priority: 99,
    });
  });

  it("normalizes unknown/invalid modes to isolated (null/whitespace/unknown)", () => {
    const manager = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.2, maxConcurrent: 10 });

    expect(manager.allocate("a", { mode: "weird-mode" })).toMatchObject({ mode: "isolated", priority: 3 });
    expect(manager.allocate("b", { mode: "   " })).toMatchObject({ mode: "isolated", priority: 3 });
    expect(manager.allocate("c", { mode: null })).toMatchObject({ mode: "isolated", priority: 3 });
    expect(manager.allocate("d", { mode: undefined })).toMatchObject({ mode: "isolated", priority: 3 });
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
    const manager = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.2, maxConcurrent: 10 });

    expect(manager.allocate("a", { mode: "handoff" })).toEqual({ budget: 280, mode: "handoff", priority: 1 });
    expect(manager.allocate("b", { mode: "handoff" })).toEqual({ budget: 280, mode: "handoff", priority: 1 });
    expect(manager.allocate("c", { mode: "handoff" })).toEqual({ budget: 240, mode: "handoff", priority: 1 });
    expect(manager.getAvailable()).toBe(0);
  });

  it("handles rapid consecutive calls until budget exhaustion (no order dependence)", () => {
    const manager = new SubagentBudgetManager({
      parentBudget: 20,
      reserveRatio: 0.1, // distributable = 18
      maxConcurrent: 50,
      modeRatios: { isolated: 1 },
    });

    const results = [];
    for (let i = 0; i < 18; i++) results.push(manager.allocate(`s${i}`, { requestedBudget: 1 }));

    expect(results.every((r) => !("error" in r) && r.budget === 1)).toBe(true);
    expect(manager.getAvailable()).toBe(0);
    expect(manager.canAllocate()).toEqual({ canAllocate: false, reason: "No budget available" });

    const exhausted = manager.allocate("s18", { requestedBudget: 1 });
    expect(exhausted).toEqual({ error: "No budget available" });
  });

  it("treats options=null as an error (destructuring safety)", () => {
    const manager = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.2, maxConcurrent: 10 });
    expect(() => manager.allocate("a", null)).toThrow();
  });

  it("accepts very long subagentId strings and deep-nested options objects", () => {
    const manager = new SubagentBudgetManager({ parentBudget: 1000, reserveRatio: 0.2, maxConcurrent: 10 });
    const longId = "x".repeat(10_000);

    const result = manager.allocate(longId, {
      mode: "shared",
      requestedBudget: 50,
      priority: 7,
      extra: { nested: { value: { deeper: [{ a: 1 }, { b: 2 }] } } },
    });

    expect(result).toEqual({ budget: 50, mode: "shared", priority: 7 });
    expect(manager._allocations.get(longId)).toMatchObject({ subagentId: longId, allocated: 50, used: 0 });
  });

  it("handles extremely large parentBudget without producing non-finite availability", () => {
    const manager = new SubagentBudgetManager({ parentBudget: Number.MAX_SAFE_INTEGER, reserveRatio: 0.2 });
    expect(Number.isFinite(manager.getAvailable())).toBe(true);
    expect(manager.getAvailable()).toBeGreaterThan(0);
  });
});