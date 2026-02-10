import { describe, it, expect } from "vitest";
import {
  formatTokenCount,
  formatLatency,
  formatCostSummary,
  formatBreakdownTable,
  formatAgentReport,
  calculateCostEstimate,
} from "../../../../../js/agents/plugins/telemetry/cost-formatter.js";
import * as telemetry from "../../../../../js/agents/plugins/telemetry/index.js";

describe("formatTokenCount", () => {
  it("formats token counts across thresholds", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1000)).toMatch(/^1(?:\.0)?K$/);
    expect(formatTokenCount(1234)).toBe("1.2K");
    expect(formatTokenCount(999999)).toMatch(/^(?:1000(?:\.0)?K|1(?:\.0)?M)$/);
    expect(formatTokenCount(1000000)).toMatch(/^1(?:\.0)?M$/);
    expect(formatTokenCount(1234567)).toBe("1.2M");
  });

  it("handles negative and invalid values gracefully", () => {
    expect(formatTokenCount(-1)).toBe("0");
    expect(formatTokenCount(NaN)).toBe("0");
    expect(formatTokenCount(undefined)).toBe("0");
  });
});

describe("formatLatency", () => {
  it("formats latency in ms/s/m", () => {
    expect(formatLatency(0)).toBe("0ms");
    expect(formatLatency(500)).toBe("500ms");
    expect(formatLatency(1000)).toMatch(/^1(?:\.0)?s$/);
    expect(formatLatency(1500)).toBe("1.5s");
    expect(["1m", "1m 0s"]).toContain(formatLatency(60000));
    expect(formatLatency(65000)).toBe("1m 5s");
  });

  it("handles negative and invalid values gracefully", () => {
    expect(formatLatency(-10)).toBe("0ms");
    expect(formatLatency(NaN)).toBe("0ms");
  });
});

describe("formatCostSummary", () => {
  it("returns a readable summary for valid input", () => {
    const summary = formatCostSummary({
      agents: 2,
      calls: 3,
      totalTokens: 1234,
      totalLatencyMs: 1500,
    });

    expect(summary).toContain("2 agents");
    expect(summary).toContain("3 calls");
    expect(summary).toContain("1.2K tokens");
    expect(summary).toContain("1.5s");
  });

  it("handles null/undefined and zero values", () => {
    expect(formatCostSummary(null)).toBe("0 agents | 0 calls | 0 tokens | 0ms");
    expect(formatCostSummary(undefined)).toBe("0 agents | 0 calls | 0 tokens | 0ms");
    expect(formatCostSummary({ agents: 0, calls: 0, totalTokens: 0, totalLatencyMs: 0 })).toBe(
      "0 agents | 0 calls | 0 tokens | 0ms"
    );
  });
});

describe("formatBreakdownTable", () => {
  it("returns empty array for empty input", () => {
    expect(formatBreakdownTable([])).toEqual([]);
  });

  it("formats a single row with expected string fields", () => {
    const [row] = formatBreakdownTable([
      {
        agentId: "  agent-a  ",
        calls: 2,
        promptTokens: 1234,
        completionTokens: 2000,
        totalTokens: 3234,
        totalLatencyMs: 65000,
        models: [{ model: " gpt-4 ", calls: 1, totalTokens: 1234 }],
      },
    ]);

    expect(row).toBeDefined();
    expect(row.agentId).toBe("agent-a");
    expect(row).toHaveProperty("calls");
    expect(row).toHaveProperty("promptTokens");
    expect(row).toHaveProperty("completionTokens");
    expect(row).toHaveProperty("totalTokens");
    expect(row).toHaveProperty("latency");
    expect(row).toHaveProperty("models");
    expect(typeof row.calls).toBe("string");
    expect(typeof row.promptTokens).toBe("string");
    expect(typeof row.completionTokens).toBe("string");
    expect(typeof row.totalTokens).toBe("string");
    expect(typeof row.latency).toBe("string");
    expect(row.promptTokens).toBe("1.2K");
    expect(row.latency).toBe("1m 5s");
    expect(row.models).toEqual([{ model: "gpt-4", calls: "1", totalTokens: "1.2K" }]);
  });
});

describe("formatAgentReport", () => {
  it("returns formatted fields for valid input", () => {
    const report = formatAgentReport(" agent-1 ", {
      calls: 3,
      promptTokens: 1200,
      completionTokens: 300,
      totalTokens: 1500,
      totalLatencyMs: 1000,
    });

    expect(report.agentId).toBe("agent-1");
    expect(report.hasData).toBe(true);
    expect(report.calls).toBe("3");
    expect(report.totalTokens).toBe("1.5K");
    expect(report.latency).toMatch(/^1(?:\.0)?s$/);
    expect(report.summary).toContain("agent-1 | 3 calls | 1.5K tokens");
  });

  it("handles null cost gracefully", () => {
    const report = formatAgentReport("agent-2", null);

    expect(report.hasData).toBe(false);
    expect(report.calls).toBe("0");
    expect(report.totalTokens).toBe("0");
    expect(report.summary).toBe("agent-2 | no usage data");
  });
});

describe("calculateCostEstimate", () => {
  it("supports default and custom pricing", () => {
    expect(calculateCostEstimate(1000000)).toEqual({ estimatedUsd: 9, formatted: "$9.00" });
    expect(calculateCostEstimate(1000000, { inputPer1M: 2, outputPer1M: 4 })).toEqual({
      estimatedUsd: 3,
      formatted: "$3.00",
    });
  });

  it("handles zero and large token counts", () => {
    const zero = calculateCostEstimate(0);
    const large = calculateCostEstimate(50000000);

    expect(zero).toEqual({ estimatedUsd: 0, formatted: "$0.00" });
    expect(large.estimatedUsd).toBeGreaterThan(0);
    expect(large.formatted).toMatch(/^\$/);
  });
});

describe("telemetry/index barrel export", () => {
  it("re-exports all formatter functions", () => {
    expect(telemetry.formatTokenCount).toBe(formatTokenCount);
    expect(telemetry.formatLatency).toBe(formatLatency);
    expect(telemetry.formatCostSummary).toBe(formatCostSummary);
    expect(telemetry.formatBreakdownTable).toBe(formatBreakdownTable);
    expect(telemetry.formatAgentReport).toBe(formatAgentReport);
    expect(telemetry.calculateCostEstimate).toBe(calculateCostEstimate);
  });
});
