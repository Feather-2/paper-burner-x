import { afterEach, describe, expect, it, vi } from "vitest";

import { Container } from "../../../js/agents/runtime/di/container.js";
import { setGlobalContainer } from "../../../js/agents/runtime/di/global-container.js";
import {
  TokenTracker,
  exportTokenUsageCsv,
  exportTokenUsageJson,
  getGlobalTokenTracker,
  getTokenUsageSummary,
  trackTokenUsage,
} from "../../../js/agents/runtime/telemetry/token-tracker.js";

afterEach(() => {
  setGlobalContainer(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runtime/telemetry/token-tracker", () => {
  it("records usage and aggregates summary stats", () => {
    const tracker = new TokenTracker({ maxRecords: 10 });

    tracker.record({
      model: "gpt-test",
      provider: "openai",
      usage: "worker",
      promptTokens: 3,
      completionTokens: 2,
      latencyMs: 50,
      success: true,
    });

    tracker.record({
      model: "gpt-test",
      provider: "openai",
      usage: "worker",
      promptTokens: -1, // coerced to 0
      completionTokens: 1,
      latencyMs: -10, // coerced to 0
      success: false,
      error: "bad",
    });

    const summary = tracker.getSummary();
    expect(summary.totalCalls).toBe(2);
    expect(summary.successCalls).toBe(1);
    expect(summary.failedCalls).toBe(1);
    expect(summary.totalPromptTokens).toBe(3);
    expect(summary.totalCompletionTokens).toBe(3);
    expect(summary.totalTokens).toBe(6);
    expect(summary.totalLatencyMs).toBe(50);
    expect(summary.byModel["gpt-test"]).toMatchObject({ calls: 2, totalTokens: 6 });
    expect(summary.byUsage["worker"]).toMatchObject({ calls: 2, totalTokens: 6 });
    expect(summary.byProvider["openai"]).toMatchObject({ calls: 2, totalTokens: 6 });
  });

  it("caps retained records to maxRecords", () => {
    const tracker = new TokenTracker({ maxRecords: 2 });

    tracker.record({ model: "m", provider: "p", usage: "u", promptTokens: 1, completionTokens: 0, latencyMs: 1 });
    tracker.record({ model: "m", provider: "p", usage: "u", promptTokens: 1, completionTokens: 0, latencyMs: 1 });
    tracker.record({ model: "m", provider: "p", usage: "u", promptTokens: 1, completionTokens: 0, latencyMs: 1 });

    expect(tracker.getAllRecords()).toHaveLength(2);
    expect(tracker.getRecentRecords(100)).toHaveLength(2);
  });

  it("exports JSON and CSV", () => {
    const tracker = new TokenTracker();
    tracker.record({
      model: "m",
      provider: "p",
      usage: "u",
      promptTokens: 1,
      completionTokens: 2,
      latencyMs: 3,
      success: false,
      error: 'quote " test',
    });

    const json = tracker.exportJson();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty("exportedAt");
    expect(parsed.summary.totalCalls).toBe(1);
    expect(parsed.records).toHaveLength(1);

    const csv = tracker.exportCsv();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("promptTokens");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"quote "" test"');
  });

  it("filters records by time range/model/usage and clears", () => {
    vi.useFakeTimers();

    const tracker = new TokenTracker();

    vi.setSystemTime(new Date(0));
    tracker.record({ model: "A", provider: "p", usage: "worker", promptTokens: 1, completionTokens: 0, latencyMs: 1 });

    vi.setSystemTime(new Date(1000));
    tracker.record({ model: "B", provider: "p", usage: "planner", promptTokens: 2, completionTokens: 0, latencyMs: 2 });

    const ranged = tracker.getRecordsInRange(500, 1500);
    expect(ranged).toHaveLength(1);
    expect(ranged[0].model).toBe("B");

    expect(tracker.getRecordsByModel("b")).toHaveLength(1);
    expect(tracker.getRecordsByUsage("PLANNER")).toHaveLength(1);

    tracker.clear();
    expect(tracker.getAllRecords()).toHaveLength(0);
    expect(tracker.getSummary().totalCalls).toBe(0);
  });

  it("exposes DI-backed global helpers", () => {
    const container = new Container();
    setGlobalContainer(container);

    const tracker = getGlobalTokenTracker();
    expect(tracker).toBe(container.get("tokenTracker"));

    trackTokenUsage({
      model: "m",
      provider: "p",
      usage: "worker",
      promptTokens: 1,
      completionTokens: 1,
      latencyMs: 10,
    });

    expect(getTokenUsageSummary()).toMatchObject({ totalCalls: 1, totalTokens: 2 });
    expect(exportTokenUsageJson()).toContain('"totalCalls": 1');
    expect(exportTokenUsageCsv().split("\n")[0]).toContain("timestamp");
  });

  it("invokes onRecord callback when recording", () => {
    const callbackRecords = [];
    const tracker = new TokenTracker({
      maxRecords: 5,
      onRecord: (rec) => callbackRecords.push(rec),
    });

    tracker.record({
      model: "test-model",
      provider: "test-provider",
      usage: "worker",
      promptTokens: 10,
      completionTokens: 5,
      latencyMs: 100,
    });

    expect(callbackRecords).toHaveLength(1);
    expect(callbackRecords[0].model).toBe("test-model");
    expect(callbackRecords[0].totalTokens).toBe(15);
  });

  it("handles maxRecords <= 0 gracefully (no storage)", () => {
    const tracker = new TokenTracker({ maxRecords: 0 });

    tracker.record({
      model: "m",
      provider: "p",
      usage: "u",
      promptTokens: 5,
      completionTokens: 5,
      latencyMs: 10,
    });

    // Stats still accumulated even when records not stored
    expect(tracker.getSummary().totalCalls).toBe(1);
    expect(tracker.getSummary().totalTokens).toBe(10);

    // No records stored
    expect(tracker.getAllRecords()).toHaveLength(0);
    expect(tracker.getRecentRecords(10)).toHaveLength(0);

    // Clear with maxRecords=0 should not throw
    tracker.clear();
    expect(tracker.getSummary().totalCalls).toBe(0);
  });

  it("getRecords and getTotalTokens aliases work correctly", () => {
    const tracker = new TokenTracker({ maxRecords: 10 });

    tracker.record({
      model: "m",
      provider: "p",
      usage: "u",
      promptTokens: 100,
      completionTokens: 50,
      latencyMs: 20,
    });

    // getRecords is alias for getAllRecords
    expect(tracker.getRecords()).toEqual(tracker.getAllRecords());
    expect(tracker.getRecords()).toHaveLength(1);

    // getTotalTokens returns cumulative total
    expect(tracker.getTotalTokens()).toBe(150);
  });

  it("getRecentRecords returns empty array when limit coerced to 0", () => {
    const tracker = new TokenTracker({ maxRecords: 10 });

    tracker.record({
      model: "m",
      provider: "p",
      usage: "u",
      promptTokens: 1,
      completionTokens: 1,
      latencyMs: 1,
    });

    // Negative limit coerced to default 100, but requesting 0 returns empty
    expect(tracker.getRecentRecords(0)).toHaveLength(0);
    // Negative coerced to 100 default then clamped to _size
    expect(tracker.getRecentRecords(-5)).toHaveLength(1);
  });

  it("defaults null/undefined model, provider, usage to 'unknown'", () => {
    const tracker = new TokenTracker({ maxRecords: 5 });

    const rec = tracker.record({
      model: null,
      provider: undefined,
      usage: "",
      promptTokens: 1,
      completionTokens: 1,
      latencyMs: 10,
    });

    // falsy values are replaced with "unknown"
    expect(rec.model).toBe("unknown");
    expect(rec.provider).toBe("unknown");
    expect(rec.usage).toBe("unknown");
  });

  it("getSummary returns zeros when there are no calls", () => {
    const tracker = new TokenTracker({ maxRecords: 5 });
    const summary = tracker.getSummary();

    expect(summary.totalCalls).toBe(0);
    expect(summary.successRate).toBe(0);
    expect(summary.avgLatencyMs).toBe(0);
    expect(summary.avgTokensPerCall).toBe(0);
  });

  it("getRecentRecords returns correct order after ring buffer wrap-around", () => {
    const tracker = new TokenTracker({ maxRecords: 3 });

    for (let i = 1; i <= 5; i++) {
      tracker.record({
        model: `m${i}`,
        provider: "p",
        usage: "u",
        promptTokens: i,
        completionTokens: 0,
        latencyMs: 1,
      });
    }

    const recent = tracker.getRecentRecords(3);
    expect(recent.map((rec) => rec.promptTokens)).toEqual([3, 4, 5]);
  });

  it("defaults options when constructed without args", () => {
    const tracker = new TokenTracker();

    expect(tracker.maxRecords).toBe(500);
    expect(tracker.onRecord).toBeNull();

    tracker.record({
      model: "m",
      provider: "p",
      usage: "u",
      promptTokens: 1,
      completionTokens: 1,
      latencyMs: 1,
    });

    expect(tracker.getAllRecords()).toHaveLength(1);
  });

  it("clamps maxRecords to MAX_RECORDS when provided value is too large", () => {
    const tracker = new TokenTracker({ maxRecords: 900 });

    expect(tracker.maxRecords).toBe(500);

    for (let i = 0; i < 510; i++) {
      tracker.record({
        model: "m",
        provider: "p",
        usage: "u",
        promptTokens: i,
        completionTokens: 0,
        latencyMs: 1,
      });
    }

    expect(tracker.getAllRecords()).toHaveLength(500);
    expect(tracker.getRecentRecords(5).map((rec) => rec.promptTokens)).toEqual([505, 506, 507, 508, 509]);
  });
});
