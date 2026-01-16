
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  TokenTracker,
  getGlobalTokenTracker,
  trackTokenUsage,
  getTokenUsageSummary,
  exportTokenUsageJson,
  exportTokenUsageCsv,
} from "../../../../js/agents/runtime/telemetry/token-tracker.js";
import { setGlobalContainer } from "../../../../js/agents/runtime/di/global-container.js";

/**
 * Helper to create a sample record params object.
 * @param {Partial<Parameters<TokenTracker['record']>[0]>} [overrides]
 */
function sampleRecordParams(overrides = {}) {
  return {
    model: "gpt-4o",
    provider: "openai",
    usage: "worker",
    promptTokens: 100,
    completionTokens: 50,
    latencyMs: 200,
    success: true,
    ...overrides,
  };
}

describe("TokenTracker", () => {
  describe("constructor", () => {
    it("initializes with default maxRecords", () => {
      const tracker = new TokenTracker();
      expect(tracker.maxRecords).toBe(500);
      expect(tracker._size).toBe(0);
    });

    it("respects custom maxRecords (clamped to MAX_RECORDS)", () => {
      const tracker = new TokenTracker({ maxRecords: 100 });
      expect(tracker.maxRecords).toBe(100);

      // Should clamp to 500
      const tracker2 = new TokenTracker({ maxRecords: 1000 });
      expect(tracker2.maxRecords).toBe(500);
    });

    it("handles zero maxRecords", () => {
      const tracker = new TokenTracker({ maxRecords: 0 });
      expect(tracker.maxRecords).toBe(0);
      // Records should still work but not be stored
      tracker.record(sampleRecordParams());
      expect(tracker._size).toBe(0);
    });

    it("accepts onRecord callback", () => {
      const records = [];
      const tracker = new TokenTracker({ onRecord: (r) => records.push(r) });
      tracker.record(sampleRecordParams());
      expect(records.length).toBe(1);
      expect(records[0].model).toBe("gpt-4o");
    });

    it("ignores non-function onRecord", () => {
      const tracker = new TokenTracker({ onRecord: "invalid" });
      expect(tracker.onRecord).toBe(null);
    });
  });

  describe("record()", () => {
    it("creates record with correct structure", () => {
      const tracker = new TokenTracker();
      const record = tracker.record(sampleRecordParams());

      expect(record.id.startsWith("tok_")).toBeTruthy();
      expect(typeof record.timestamp === "number").toBeTruthy();
      expect(record.model).toBe("gpt-4o");
      expect(record.provider).toBe("openai");
      expect(record.usage).toBe("worker");
      expect(record.promptTokens).toBe(100);
      expect(record.completionTokens).toBe(50);
      expect(record.totalTokens).toBe(150);
      expect(record.latencyMs).toBe(200);
      expect(record.success).toBe(true);
      expect(record.error).toBe(undefined);
    });

    it("handles failure with error message", () => {
      const tracker = new TokenTracker();
      const record = tracker.record(
        sampleRecordParams({
          success: false,
          error: "Rate limit exceeded",
        })
      );

      expect(record.success).toBe(false);
      expect(record.error).toBe("Rate limit exceeded");
    });

    it("normalizes invalid token values to zero", () => {
      const tracker = new TokenTracker();
      const record = tracker.record({
        model: "test",
        provider: "test",
        usage: "test",
        promptTokens: -10,
        completionTokens: "invalid",
        latencyMs: NaN,
      });

      expect(record.promptTokens).toBe(0);
      expect(record.completionTokens).toBe(0);
      expect(record.totalTokens).toBe(0);
      expect(record.latencyMs).toBe(0);
    });

    it("defaults model/provider/usage to 'unknown'", () => {
      const tracker = new TokenTracker();
      const record = tracker.record({
        promptTokens: 10,
        completionTokens: 5,
        latencyMs: 100,
      });

      expect(record.model).toBe("unknown");
      expect(record.provider).toBe("unknown");
      expect(record.usage).toBe("unknown");
    });

    it("triggers onRecord callback", () => {
      let captured = null;
      const tracker = new TokenTracker({ onRecord: (r) => (captured = r) });
      const record = tracker.record(sampleRecordParams());

      expect(captured).toEqual(record);
    });
  });

  describe("ring buffer behavior", () => {
    it("stores records up to maxRecords", () => {
      const tracker = new TokenTracker({ maxRecords: 3 });

      tracker.record(sampleRecordParams({ model: "m1" }));
      tracker.record(sampleRecordParams({ model: "m2" }));
      tracker.record(sampleRecordParams({ model: "m3" }));

      expect(tracker._size).toBe(3);
      const records = tracker.getAllRecords();
      expect(records.length).toBe(3);
      expect(records.map((r) => r.model)).toEqual(["m1", "m2", "m3"]
      );
    });

    it("overwrites oldest when full", () => {
      const tracker = new TokenTracker({ maxRecords: 3 });

      tracker.record(sampleRecordParams({ model: "m1" }));
      tracker.record(sampleRecordParams({ model: "m2" }));
      tracker.record(sampleRecordParams({ model: "m3" }));
      tracker.record(sampleRecordParams({ model: "m4" }));

      expect(tracker._size).toBe(3);
      const records = tracker.getAllRecords();
      expect(records.map((r) => r.model)).toEqual(["m2", "m3", "m4"]
      );
    });

    it("handles wrap-around correctly", () => {
      const tracker = new TokenTracker({ maxRecords: 3 });

      for (let i = 1; i <= 5; i++) {
        tracker.record(sampleRecordParams({ model: `m${i}` }));
      }

      const records = tracker.getAllRecords();
      expect(records.map((r) => r.model)).toEqual(["m3", "m4", "m5"]
      );
    });
  });

  describe("_updateStats()", () => {
    it("aggregates total counts", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ promptTokens: 100, completionTokens: 50, latencyMs: 200 }));
      tracker.record(sampleRecordParams({ promptTokens: 200, completionTokens: 100, latencyMs: 300 }));

      const stats = tracker._stats;
      expect(stats.totalCalls).toBe(2);
      expect(stats.successCalls).toBe(2);
      expect(stats.failedCalls).toBe(0);
      expect(stats.totalPromptTokens).toBe(300);
      expect(stats.totalCompletionTokens).toBe(150);
      expect(stats.totalTokens).toBe(450);
      expect(stats.totalLatencyMs).toBe(500);
    });

    it("tracks failed calls", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ success: true }));
      tracker.record(sampleRecordParams({ success: false }));

      expect(tracker._stats.successCalls).toBe(1);
      expect(tracker._stats.failedCalls).toBe(1);
    });

    it("aggregates by model", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ model: "gpt-4o", promptTokens: 100 }));
      tracker.record(sampleRecordParams({ model: "gpt-4o", promptTokens: 200 }));
      tracker.record(sampleRecordParams({ model: "claude-3", promptTokens: 150 }));

      const byModel = tracker._stats.byModel;
      expect(byModel.get("gpt-4o").calls).toBe(2);
      expect(byModel.get("gpt-4o").promptTokens).toBe(300);
      expect(byModel.get("claude-3").calls).toBe(1);
      expect(byModel.get("claude-3").promptTokens).toBe(150);
    });

    it("aggregates by usage", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ usage: "worker" }));
      tracker.record(sampleRecordParams({ usage: "worker" }));
      tracker.record(sampleRecordParams({ usage: "planner" }));

      const byUsage = tracker._stats.byUsage;
      expect(byUsage.get("worker").calls).toBe(2);
      expect(byUsage.get("planner").calls).toBe(1);
    });

    it("aggregates by provider", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ provider: "openai" }));
      tracker.record(sampleRecordParams({ provider: "anthropic" }));

      const byProvider = tracker._stats.byProvider;
      expect(byProvider.get("openai").calls).toBe(1);
      expect(byProvider.get("anthropic").calls).toBe(1);
    });
  });

  describe("getSummary()", () => {
    it("returns correct summary structure", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ promptTokens: 100, completionTokens: 50, latencyMs: 200 }));
      tracker.record(sampleRecordParams({ promptTokens: 200, completionTokens: 100, latencyMs: 300, success: false }));

      const summary = tracker.getSummary();

      expect(summary.totalCalls).toBe(2);
      expect(summary.successCalls).toBe(1);
      expect(summary.failedCalls).toBe(1);
      expect(summary.successRate).toBe(0.5);
      expect(summary.totalPromptTokens).toBe(300);
      expect(summary.totalCompletionTokens).toBe(150);
      expect(summary.totalTokens).toBe(450);
      expect(summary.totalLatencyMs).toBe(500);
      expect(summary.avgLatencyMs).toBe(250);
      expect(summary.avgTokensPerCall).toBe(225);
      expect(typeof summary.byModel === "object").toBeTruthy();
      expect(typeof summary.byUsage === "object").toBeTruthy();
      expect(typeof summary.byProvider === "object").toBeTruthy();
    });

    it("handles zero calls gracefully", () => {
      const tracker = new TokenTracker();
      const summary = tracker.getSummary();

      expect(summary.totalCalls).toBe(0);
      expect(summary.successRate).toBe(0);
      expect(summary.avgLatencyMs).toBe(0);
      expect(summary.avgTokensPerCall).toBe(0);
    });
  });

  describe("getRecentRecords()", () => {
    it("returns recent records in order", () => {
      const tracker = new TokenTracker({ maxRecords: 10 });

      for (let i = 1; i <= 5; i++) {
        tracker.record(sampleRecordParams({ model: `m${i}` }));
      }

      const recent = tracker.getRecentRecords(3);
      expect(recent.length).toBe(3);
      expect(recent.map((r) => r.model)).toEqual(["m3", "m4", "m5"]
      );
    });

    it("returns all records if limit exceeds size", () => {
      const tracker = new TokenTracker({ maxRecords: 10 });

      tracker.record(sampleRecordParams({ model: "m1" }));
      tracker.record(sampleRecordParams({ model: "m2" }));

      const recent = tracker.getRecentRecords(100);
      expect(recent.length).toBe(2);
    });

    it("handles empty tracker", () => {
      const tracker = new TokenTracker();
      expect(tracker.getRecentRecords(10)).toEqual([]);
    });

    it("handles zero maxRecords", () => {
      const tracker = new TokenTracker({ maxRecords: 0 });
      tracker.record(sampleRecordParams());
      expect(tracker.getRecentRecords(10)).toEqual([]);
    });
  });

  describe("getAllRecords() / getRecords()", () => {
    it("returns all stored records", () => {
      const tracker = new TokenTracker({ maxRecords: 10 });

      for (let i = 1; i <= 5; i++) {
        tracker.record(sampleRecordParams({ model: `m${i}` }));
      }

      const all = tracker.getAllRecords();
      expect(all.length).toBe(5);
      expect(all.map((r) => r.model)).toEqual(["m1", "m2", "m3", "m4", "m5"]
      );
    });

    it("getRecords() is alias for getAllRecords()", () => {
      const tracker = new TokenTracker({ maxRecords: 10 });
      tracker.record(sampleRecordParams());

      expect(tracker.getRecords()).toEqual(tracker.getAllRecords());
    });
  });

  describe("getTotalTokens()", () => {
    it("returns cumulative total tokens", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ promptTokens: 100, completionTokens: 50 }));
      tracker.record(sampleRecordParams({ promptTokens: 200, completionTokens: 100 }));

      expect(tracker.getTotalTokens()).toBe(450);
    });
  });

  describe("exportJson()", () => {
    it("returns valid JSON string", () => {
      const tracker = new TokenTracker();
      tracker.record(sampleRecordParams());

      const json = tracker.exportJson();
      const parsed = JSON.parse(json);

      expect(parsed.exportedAt).toBeTruthy();
      expect(parsed.summary).toBeTruthy();
      expect(Array.isArray(parsed.records)).toBeTruthy();
      expect(parsed.records.length).toBe(1);
    });

    it("includes all records and summary", () => {
      const tracker = new TokenTracker();
      tracker.record(sampleRecordParams({ model: "gpt-4o" }));
      tracker.record(sampleRecordParams({ model: "claude-3" }));

      const parsed = JSON.parse(tracker.exportJson());

      expect(parsed.records.length).toBe(2);
      expect(parsed.summary.totalCalls).toBe(2);
    });
  });

  describe("exportCsv()", () => {
    it("returns valid CSV with headers", () => {
      const tracker = new TokenTracker();
      tracker.record(sampleRecordParams());

      const csv = tracker.exportCsv();
      const lines = csv.split("\n");

      expect(lines[0]).toBe("id,timestamp,model,provider,usage,promptTokens,completionTokens,totalTokens,latencyMs,success,error");
      expect(lines.length).toBe(2);
    });

    it("escapes quotes in error messages", () => {
      const tracker = new TokenTracker();
      tracker.record(
        sampleRecordParams({
          success: false,
          error: 'Error with "quotes"',
        })
      );

      const csv = tracker.exportCsv();
      expect(csv.includes('"""')).toBeTruthy();
    });

    it("handles empty records", () => {
      const tracker = new TokenTracker();
      const csv = tracker.exportCsv();
      const lines = csv.split("\n");

      expect(lines.length).toBe(1); // Only headers
    });
  });

  describe("clear()", () => {
    it("resets all records and stats", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams());
      tracker.record(sampleRecordParams());

      expect(tracker._size).toBe(2);
      expect(tracker._stats.totalCalls).toBe(2);

      tracker.clear();

      expect(tracker._size).toBe(0);
      expect(tracker._head).toBe(0);
      expect(tracker._stats.totalCalls).toBe(0);
      expect(tracker._stats.byModel.size).toBe(0);
      expect(tracker.getAllRecords()).toEqual([]);
    });
  });

  describe("getRecordsInRange()", () => {
    it("filters records by timestamp range", () => {
      const tracker = new TokenTracker();

      const now = Date.now();
      tracker.record(sampleRecordParams({ model: "m1" }));

      // Simulate some time passing (records have their own timestamps)
      const records = tracker.getAllRecords();
      const ts = records[0].timestamp;

      const inRange = tracker.getRecordsInRange(ts - 100, ts + 100);
      expect(inRange.length).toBe(1);

      const outOfRange = tracker.getRecordsInRange(ts + 1000, ts + 2000);
      expect(outOfRange.length).toBe(0);
    });
  });

  describe("getRecordsByModel()", () => {
    it("filters records by model (case-insensitive)", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ model: "GPT-4o" }));
      tracker.record(sampleRecordParams({ model: "gpt-4o" }));
      tracker.record(sampleRecordParams({ model: "claude-3" }));

      const gptRecords = tracker.getRecordsByModel("gpt-4o");
      expect(gptRecords.length).toBe(2);
    });
  });

  describe("getRecordsByUsage()", () => {
    it("filters records by usage (case-insensitive)", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ usage: "Worker" }));
      tracker.record(sampleRecordParams({ usage: "worker" }));
      tracker.record(sampleRecordParams({ usage: "planner" }));

      const workerRecords = tracker.getRecordsByUsage("worker");
      expect(workerRecords.length).toBe(2);
    });
  });
});

describe("Global TokenTracker utilities", () => {
  beforeEach(() => {
    // Reset global container before each test
    setGlobalContainer(null);
  });

  afterEach(() => {
    setGlobalContainer(null);
  });

  describe("getGlobalTokenTracker()", () => {
    it("returns singleton TokenTracker instance", () => {
      const tracker1 = getGlobalTokenTracker();
      const tracker2 = getGlobalTokenTracker();

      expect(tracker1 instanceof TokenTracker).toBeTruthy();
      expect(tracker1).toBe(tracker2);
    });
  });

  describe("trackTokenUsage()", () => {
    it("records to global tracker", () => {
      const record = trackTokenUsage(sampleRecordParams());

      expect(record.id.startsWith("tok_")).toBeTruthy();
      expect(record.model).toBe("gpt-4o");

      const tracker = getGlobalTokenTracker();
      expect(tracker.getTotalTokens()).toBe(150);
    });
  });

  describe("getTokenUsageSummary()", () => {
    it("returns summary from global tracker", () => {
      trackTokenUsage(sampleRecordParams());
      const summary = getTokenUsageSummary();

      expect(summary.totalCalls).toBe(1);
      expect(summary.totalTokens).toBe(150);
    });
  });

  describe("exportTokenUsageJson()", () => {
    it("exports JSON from global tracker", () => {
      trackTokenUsage(sampleRecordParams());
      const json = exportTokenUsageJson();

      const parsed = JSON.parse(json);
      expect(parsed.records.length).toBe(1);
    });
  });

  describe("exportTokenUsageCsv()", () => {
    it("exports CSV from global tracker", () => {
      trackTokenUsage(sampleRecordParams());
      const csv = exportTokenUsageCsv();

      const lines = csv.split("\n");
      expect(lines.length).toBe(2);
    });
  });
});
