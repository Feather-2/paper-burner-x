import { describe, it, expect, vi, beforeEach } from "vitest";

const fingerprintMock = vi.hoisted(() => vi.fn(() => "fp"));
const classifyMock = vi.hoisted(() => vi.fn(() => ({ taxonomy: "runtime.error", retryable: false })));

vi.mock("../../../../../../../js/agents/runtime/core/errors/error-fingerprint.js", () => ({
  computeErrorFingerprint: fingerprintMock,
}));

vi.mock("../../../../../../../js/agents/runtime/core/errors/error-taxonomy.js", () => ({
  classifyError: classifyMock,
}));

import { ErrorAggregator } from "../../../../../../../js/agents/runtime/core/errors/error-aggregator.js";

describe("ErrorAggregator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  it("keeps frequency1h aligned to rolling window and prunes stale timestamps", () => {
    const agg = new ErrorAggregator();

    agg.record(new Error("boom"));
    vi.setSystemTime(new Date("2026-01-01T00:30:00.000Z"));
    agg.record(new Error("boom"));
    vi.setSystemTime(new Date("2026-01-01T02:00:00.000Z"));
    agg.record(new Error("boom"));

    const stats = agg.getStats();
    expect(stats).toHaveLength(1);
    expect(stats[0].frequency1h).toBe(1);

    const entry = Array.from(agg._entries.values())[0];
    expect(entry.timestamps).toHaveLength(1);
  });

  it("prunes stale timestamps even without new records", () => {
    const agg = new ErrorAggregator();
    agg.record(new Error("once"));

    vi.setSystemTime(new Date("2026-01-01T03:30:00.000Z"));
    const stats = agg.getStats();
    expect(stats[0].frequency1h).toBe(0);

    const entry = Array.from(agg._entries.values())[0];
    expect(entry.timestamps).toEqual([]);
  });
});
