import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

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
      assert.equal(tracker.maxRecords, 500);
      assert.equal(tracker._size, 0);
    });

    it("respects custom maxRecords (clamped to MAX_RECORDS)", () => {
      const tracker = new TokenTracker({ maxRecords: 100 });
      assert.equal(tracker.maxRecords, 100);

      // Should clamp to 500
      const tracker2 = new TokenTracker({ maxRecords: 1000 });
      assert.equal(tracker2.maxRecords, 500);
    });

    it("handles zero maxRecords", () => {
      const tracker = new TokenTracker({ maxRecords: 0 });
      assert.equal(tracker.maxRecords, 0);
      // Records should still work but not be stored
      tracker.record(sampleRecordParams());
      assert.equal(tracker._size, 0);
    });

    it("accepts onRecord callback", () => {
      const records = [];
      const tracker = new TokenTracker({ onRecord: (r) => records.push(r) });
      tracker.record(sampleRecordParams());
      assert.equal(records.length, 1);
      assert.equal(records[0].model, "gpt-4o");
    });

    it("ignores non-function onRecord", () => {
      const tracker = new TokenTracker({ onRecord: "invalid" });
      assert.equal(tracker.onRecord, null);
    });
  });

  describe("record()", () => {
    it("creates record with correct structure", () => {
      const tracker = new TokenTracker();
      const record = tracker.record(sampleRecordParams());

      assert.ok(record.id.startsWith("tok_"));
      assert.ok(typeof record.timestamp === "number");
      assert.equal(record.model, "gpt-4o");
      assert.equal(record.provider, "openai");
      assert.equal(record.usage, "worker");
      assert.equal(record.promptTokens, 100);
      assert.equal(record.completionTokens, 50);
      assert.equal(record.totalTokens, 150);
      assert.equal(record.latencyMs, 200);
      assert.equal(record.success, true);
      assert.equal(record.error, undefined);
    });

    it("handles failure with error message", () => {
      const tracker = new TokenTracker();
      const record = tracker.record(
        sampleRecordParams({
          success: false,
          error: "Rate limit exceeded",
        })
      );

      assert.equal(record.success, false);
      assert.equal(record.error, "Rate limit exceeded");
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

      assert.equal(record.promptTokens, 0);
      assert.equal(record.completionTokens, 0);
      assert.equal(record.totalTokens, 0);
      assert.equal(record.latencyMs, 0);
    });

    it("defaults model/provider/usage to 'unknown'", () => {
      const tracker = new TokenTracker();
      const record = tracker.record({
        promptTokens: 10,
        completionTokens: 5,
        latencyMs: 100,
      });

      assert.equal(record.model, "unknown");
      assert.equal(record.provider, "unknown");
      assert.equal(record.usage, "unknown");
    });

    it("triggers onRecord callback", () => {
      let captured = null;
      const tracker = new TokenTracker({ onRecord: (r) => (captured = r) });
      const record = tracker.record(sampleRecordParams());

      assert.deepEqual(captured, record);
    });
  });

  describe("ring buffer behavior", () => {
    it("stores records up to maxRecords", () => {
      const tracker = new TokenTracker({ maxRecords: 3 });

      tracker.record(sampleRecordParams({ model: "m1" }));
      tracker.record(sampleRecordParams({ model: "m2" }));
      tracker.record(sampleRecordParams({ model: "m3" }));

      assert.equal(tracker._size, 3);
      const records = tracker.getAllRecords();
      assert.equal(records.length, 3);
      assert.deepEqual(
        records.map((r) => r.model),
        ["m1", "m2", "m3"]
      );
    });

    it("overwrites oldest when full", () => {
      const tracker = new TokenTracker({ maxRecords: 3 });

      tracker.record(sampleRecordParams({ model: "m1" }));
      tracker.record(sampleRecordParams({ model: "m2" }));
      tracker.record(sampleRecordParams({ model: "m3" }));
      tracker.record(sampleRecordParams({ model: "m4" }));

      assert.equal(tracker._size, 3);
      const records = tracker.getAllRecords();
      assert.deepEqual(
        records.map((r) => r.model),
        ["m2", "m3", "m4"]
      );
    });

    it("handles wrap-around correctly", () => {
      const tracker = new TokenTracker({ maxRecords: 3 });

      for (let i = 1; i <= 5; i++) {
        tracker.record(sampleRecordParams({ model: `m${i}` }));
      }

      const records = tracker.getAllRecords();
      assert.deepEqual(
        records.map((r) => r.model),
        ["m3", "m4", "m5"]
      );
    });
  });

  describe("_updateStats()", () => {
    it("aggregates total counts", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ promptTokens: 100, completionTokens: 50, latencyMs: 200 }));
      tracker.record(sampleRecordParams({ promptTokens: 200, completionTokens: 100, latencyMs: 300 }));

      const stats = tracker._stats;
      assert.equal(stats.totalCalls, 2);
      assert.equal(stats.successCalls, 2);
      assert.equal(stats.failedCalls, 0);
      assert.equal(stats.totalPromptTokens, 300);
      assert.equal(stats.totalCompletionTokens, 150);
      assert.equal(stats.totalTokens, 450);
      assert.equal(stats.totalLatencyMs, 500);
    });

    it("tracks failed calls", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ success: true }));
      tracker.record(sampleRecordParams({ success: false }));

      assert.equal(tracker._stats.successCalls, 1);
      assert.equal(tracker._stats.failedCalls, 1);
    });

    it("aggregates by model", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ model: "gpt-4o", promptTokens: 100 }));
      tracker.record(sampleRecordParams({ model: "gpt-4o", promptTokens: 200 }));
      tracker.record(sampleRecordParams({ model: "claude-3", promptTokens: 150 }));

      const byModel = tracker._stats.byModel;
      assert.equal(byModel.get("gpt-4o").calls, 2);
      assert.equal(byModel.get("gpt-4o").promptTokens, 300);
      assert.equal(byModel.get("claude-3").calls, 1);
      assert.equal(byModel.get("claude-3").promptTokens, 150);
    });

    it("aggregates by usage", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ usage: "worker" }));
      tracker.record(sampleRecordParams({ usage: "worker" }));
      tracker.record(sampleRecordParams({ usage: "planner" }));

      const byUsage = tracker._stats.byUsage;
      assert.equal(byUsage.get("worker").calls, 2);
      assert.equal(byUsage.get("planner").calls, 1);
    });

    it("aggregates by provider", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ provider: "openai" }));
      tracker.record(sampleRecordParams({ provider: "anthropic" }));

      const byProvider = tracker._stats.byProvider;
      assert.equal(byProvider.get("openai").calls, 1);
      assert.equal(byProvider.get("anthropic").calls, 1);
    });
  });

  describe("getSummary()", () => {
    it("returns correct summary structure", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ promptTokens: 100, completionTokens: 50, latencyMs: 200 }));
      tracker.record(sampleRecordParams({ promptTokens: 200, completionTokens: 100, latencyMs: 300, success: false }));

      const summary = tracker.getSummary();

      assert.equal(summary.totalCalls, 2);
      assert.equal(summary.successCalls, 1);
      assert.equal(summary.failedCalls, 1);
      assert.equal(summary.successRate, 0.5);
      assert.equal(summary.totalPromptTokens, 300);
      assert.equal(summary.totalCompletionTokens, 150);
      assert.equal(summary.totalTokens, 450);
      assert.equal(summary.totalLatencyMs, 500);
      assert.equal(summary.avgLatencyMs, 250);
      assert.equal(summary.avgTokensPerCall, 225);
      assert.ok(typeof summary.byModel === "object");
      assert.ok(typeof summary.byUsage === "object");
      assert.ok(typeof summary.byProvider === "object");
    });

    it("handles zero calls gracefully", () => {
      const tracker = new TokenTracker();
      const summary = tracker.getSummary();

      assert.equal(summary.totalCalls, 0);
      assert.equal(summary.successRate, 0);
      assert.equal(summary.avgLatencyMs, 0);
      assert.equal(summary.avgTokensPerCall, 0);
    });
  });

  describe("getRecentRecords()", () => {
    it("returns recent records in order", () => {
      const tracker = new TokenTracker({ maxRecords: 10 });

      for (let i = 1; i <= 5; i++) {
        tracker.record(sampleRecordParams({ model: `m${i}` }));
      }

      const recent = tracker.getRecentRecords(3);
      assert.equal(recent.length, 3);
      assert.deepEqual(
        recent.map((r) => r.model),
        ["m3", "m4", "m5"]
      );
    });

    it("returns all records if limit exceeds size", () => {
      const tracker = new TokenTracker({ maxRecords: 10 });

      tracker.record(sampleRecordParams({ model: "m1" }));
      tracker.record(sampleRecordParams({ model: "m2" }));

      const recent = tracker.getRecentRecords(100);
      assert.equal(recent.length, 2);
    });

    it("handles empty tracker", () => {
      const tracker = new TokenTracker();
      assert.deepEqual(tracker.getRecentRecords(10), []);
    });

    it("handles zero maxRecords", () => {
      const tracker = new TokenTracker({ maxRecords: 0 });
      tracker.record(sampleRecordParams());
      assert.deepEqual(tracker.getRecentRecords(10), []);
    });
  });

  describe("getAllRecords() / getRecords()", () => {
    it("returns all stored records", () => {
      const tracker = new TokenTracker({ maxRecords: 10 });

      for (let i = 1; i <= 5; i++) {
        tracker.record(sampleRecordParams({ model: `m${i}` }));
      }

      const all = tracker.getAllRecords();
      assert.equal(all.length, 5);
      assert.deepEqual(
        all.map((r) => r.model),
        ["m1", "m2", "m3", "m4", "m5"]
      );
    });

    it("getRecords() is alias for getAllRecords()", () => {
      const tracker = new TokenTracker({ maxRecords: 10 });
      tracker.record(sampleRecordParams());

      assert.deepEqual(tracker.getRecords(), tracker.getAllRecords());
    });
  });

  describe("getTotalTokens()", () => {
    it("returns cumulative total tokens", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ promptTokens: 100, completionTokens: 50 }));
      tracker.record(sampleRecordParams({ promptTokens: 200, completionTokens: 100 }));

      assert.equal(tracker.getTotalTokens(), 450);
    });
  });

  describe("exportJson()", () => {
    it("returns valid JSON string", () => {
      const tracker = new TokenTracker();
      tracker.record(sampleRecordParams());

      const json = tracker.exportJson();
      const parsed = JSON.parse(json);

      assert.ok(parsed.exportedAt);
      assert.ok(parsed.summary);
      assert.ok(Array.isArray(parsed.records));
      assert.equal(parsed.records.length, 1);
    });

    it("includes all records and summary", () => {
      const tracker = new TokenTracker();
      tracker.record(sampleRecordParams({ model: "gpt-4o" }));
      tracker.record(sampleRecordParams({ model: "claude-3" }));

      const parsed = JSON.parse(tracker.exportJson());

      assert.equal(parsed.records.length, 2);
      assert.equal(parsed.summary.totalCalls, 2);
    });
  });

  describe("exportCsv()", () => {
    it("returns valid CSV with headers", () => {
      const tracker = new TokenTracker();
      tracker.record(sampleRecordParams());

      const csv = tracker.exportCsv();
      const lines = csv.split("\n");

      assert.equal(lines[0], "id,timestamp,model,provider,usage,promptTokens,completionTokens,totalTokens,latencyMs,success,error");
      assert.equal(lines.length, 2);
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
      assert.ok(csv.includes('"""'));
    });

    it("handles empty records", () => {
      const tracker = new TokenTracker();
      const csv = tracker.exportCsv();
      const lines = csv.split("\n");

      assert.equal(lines.length, 1); // Only headers
    });
  });

  describe("clear()", () => {
    it("resets all records and stats", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams());
      tracker.record(sampleRecordParams());

      assert.equal(tracker._size, 2);
      assert.equal(tracker._stats.totalCalls, 2);

      tracker.clear();

      assert.equal(tracker._size, 0);
      assert.equal(tracker._head, 0);
      assert.equal(tracker._stats.totalCalls, 0);
      assert.equal(tracker._stats.byModel.size, 0);
      assert.deepEqual(tracker.getAllRecords(), []);
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
      assert.equal(inRange.length, 1);

      const outOfRange = tracker.getRecordsInRange(ts + 1000, ts + 2000);
      assert.equal(outOfRange.length, 0);
    });
  });

  describe("getRecordsByModel()", () => {
    it("filters records by model (case-insensitive)", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ model: "GPT-4o" }));
      tracker.record(sampleRecordParams({ model: "gpt-4o" }));
      tracker.record(sampleRecordParams({ model: "claude-3" }));

      const gptRecords = tracker.getRecordsByModel("gpt-4o");
      assert.equal(gptRecords.length, 2);
    });
  });

  describe("getRecordsByUsage()", () => {
    it("filters records by usage (case-insensitive)", () => {
      const tracker = new TokenTracker();

      tracker.record(sampleRecordParams({ usage: "Worker" }));
      tracker.record(sampleRecordParams({ usage: "worker" }));
      tracker.record(sampleRecordParams({ usage: "planner" }));

      const workerRecords = tracker.getRecordsByUsage("worker");
      assert.equal(workerRecords.length, 2);
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

      assert.ok(tracker1 instanceof TokenTracker);
      assert.strictEqual(tracker1, tracker2);
    });
  });

  describe("trackTokenUsage()", () => {
    it("records to global tracker", () => {
      const record = trackTokenUsage(sampleRecordParams());

      assert.ok(record.id.startsWith("tok_"));
      assert.equal(record.model, "gpt-4o");

      const tracker = getGlobalTokenTracker();
      assert.equal(tracker.getTotalTokens(), 150);
    });
  });

  describe("getTokenUsageSummary()", () => {
    it("returns summary from global tracker", () => {
      trackTokenUsage(sampleRecordParams());
      const summary = getTokenUsageSummary();

      assert.equal(summary.totalCalls, 1);
      assert.equal(summary.totalTokens, 150);
    });
  });

  describe("exportTokenUsageJson()", () => {
    it("exports JSON from global tracker", () => {
      trackTokenUsage(sampleRecordParams());
      const json = exportTokenUsageJson();

      const parsed = JSON.parse(json);
      assert.equal(parsed.records.length, 1);
    });
  });

  describe("exportTokenUsageCsv()", () => {
    it("exports CSV from global tracker", () => {
      trackTokenUsage(sampleRecordParams());
      const csv = exportTokenUsageCsv();

      const lines = csv.split("\n");
      assert.equal(lines.length, 2);
    });
  });
});
