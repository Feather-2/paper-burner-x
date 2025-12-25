import { describe, it, test } from "node:test";
import assert from "node:assert/strict";

import { collectMetrics, formatMetricsReport, validateMetrics } from "../../../js/agents/stages/deepsearch/metrics.js";

test("collectMetrics returns zero values for empty state", () => {
  const metrics = collectMetrics({});
  assert.equal(metrics.claimCoverage, 0);
  assert.equal(metrics.evidenceTraceability, 0);
  assert.equal(metrics.gapFillRate, 0);
  assert.equal(metrics.backtrackCount, 0);
  assert.equal(metrics.tokenEfficiency, 0);
  assert.equal(metrics.iteration, 0);
});

test("collectMetrics returns zero values for null state", () => {
  const metrics = collectMetrics(null);
  assert.equal(metrics.claimCoverage, 0);
  assert.equal(metrics.evidenceTraceability, 0);
  assert.equal(metrics.gapFillRate, 0);
  assert.equal(metrics.backtrackCount, 0);
  assert.equal(metrics.tokenEfficiency, 0);
  assert.equal(metrics.iteration, 0);
});

test("collectMetrics calculates claimCoverage correctly", () => {
  const state = {
    L1: {
      claims: [
        { id: "c1", verified: true },
        { id: "c2", verified: false },
        { id: "c3", verified: true },
        { id: "c4" }, // no verified field
      ],
      evidenceLedger: [],
      gaps: [],
    },
    L2: { tokenUsage: { total: 0 } },
    iteration: 1,
  };
  const metrics = collectMetrics(state);
  assert.equal(metrics.claimCoverage, 0.5); // 2/4 verified
});

test("collectMetrics calculates evidenceTraceability correctly", () => {
  const state = {
    L1: {
      claims: [],
      evidenceLedger: [
        { id: "e1", sourceId: "src1" },
        { id: "e2", chunkId: "chunk1" },
        { id: "e3" }, // no source
        { id: "e4", sourceId: "src2", chunkId: "chunk2" },
      ],
      gaps: [],
    },
    L2: { tokenUsage: { total: 0 } },
    iteration: 2,
  };
  const metrics = collectMetrics(state);
  assert.equal(metrics.evidenceTraceability, 0.75); // 3/4 traced
});

test("collectMetrics calculates gapFillRate correctly", () => {
  const state = {
    L1: {
      claims: [],
      evidenceLedger: [],
      gaps: [
        { gapId: "g1", status: "filled" },
        { gapId: "g2", status: "open" },
        { gapId: "g3", status: "filled" },
        { gapId: "g4", status: "blocked" },
        { gapId: "g5", status: "filled" },
      ],
    },
    L2: { tokenUsage: { total: 0 } },
    iteration: 3,
  };
  const metrics = collectMetrics(state);
  assert.equal(metrics.gapFillRate, 0.6); // 3/5 filled
});

test("collectMetrics reads backtrackCount from backtrackManager", () => {
  const state = { L1: {}, L2: {}, iteration: 1 };
  const backtrackManager = { backtrackCount: 2 };
  const metrics = collectMetrics(state, backtrackManager);
  assert.equal(metrics.backtrackCount, 2);
});

test("collectMetrics calculates tokenEfficiency correctly", () => {
  const state = {
    L1: {
      claims: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
      evidenceLedger: [],
      gaps: [],
    },
    L2: { tokenUsage: { total: 1500 } }, // 1.5k tokens
    iteration: 1,
  };
  const metrics = collectMetrics(state);
  assert.equal(metrics.tokenEfficiency, 2); // 3 claims / 1.5k tokens = 2 claims/k-tokens
});

test("collectMetrics reads iteration from state", () => {
  const state = { L1: {}, L2: {}, iteration: 5 };
  const metrics = collectMetrics(state);
  assert.equal(metrics.iteration, 5);
});

test("collectMetrics handles undefined L1/L2 gracefully", () => {
  const state = { iteration: 1 };
  const metrics = collectMetrics(state);
  assert.equal(metrics.claimCoverage, 0);
  assert.equal(metrics.evidenceTraceability, 0);
  assert.equal(metrics.gapFillRate, 0);
});

test("formatMetricsReport produces expected format", () => {
  const metrics = {
    claimCoverage: 0.8,
    evidenceTraceability: 0.75,
    gapFillRate: 0.6,
    backtrackCount: 1,
    tokenEfficiency: 2.5,
    iteration: 3,
  };
  const report = formatMetricsReport(metrics);
  assert.ok(report.includes("Claim Coverage: 80.0%"));
  assert.ok(report.includes("Evidence Traceability: 75.0%"));
  assert.ok(report.includes("Gap Fill Rate: 60.0%"));
  assert.ok(report.includes("Backtracks: 1"));
  assert.ok(report.includes("Token Efficiency: 2.50 claims/k-tokens"));
});

test("formatMetricsReport handles null/undefined metrics", () => {
  const report = formatMetricsReport(null);
  assert.ok(report.includes("Claim Coverage: 0.0%"));
  assert.ok(report.includes("Backtracks: 0"));
});

test("formatMetricsReport handles partial metrics", () => {
  const report = formatMetricsReport({ claimCoverage: 0.5 });
  assert.ok(report.includes("Claim Coverage: 50.0%"));
  assert.ok(report.includes("Evidence Traceability: 0.0%"));
});

test("validateMetrics passes when all thresholds met", () => {
  const metrics = {
    claimCoverage: 0.7,
    evidenceTraceability: 0.8,
    gapFillRate: 0.65,
    backtrackCount: 2,
  };
  const result = validateMetrics(metrics);
  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
});

test("validateMetrics fails when claimCoverage below threshold", () => {
  const metrics = {
    claimCoverage: 0.3,
    evidenceTraceability: 0.8,
    gapFillRate: 0.65,
    backtrackCount: 2,
  };
  const result = validateMetrics(metrics);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.includes("claimCoverage")));
});

test("validateMetrics fails when backtrackCount exceeds threshold", () => {
  const metrics = {
    claimCoverage: 0.7,
    evidenceTraceability: 0.8,
    gapFillRate: 0.65,
    backtrackCount: 5,
  };
  const result = validateMetrics(metrics);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.includes("backtrackCount")));
});

test("validateMetrics uses custom thresholds", () => {
  const metrics = {
    claimCoverage: 0.4,
    evidenceTraceability: 0.5,
    gapFillRate: 0.4,
    backtrackCount: 5,
  };
  const result = validateMetrics(metrics, {
    minClaimCoverage: 0.3,
    minEvidenceTraceability: 0.4,
    minGapFillRate: 0.3,
    maxBacktracks: 10,
  });
  assert.equal(result.passed, true);
});

test("validateMetrics handles null metrics", () => {
  const result = validateMetrics(null);
  assert.equal(result.passed, false);
  assert.ok(result.failures.length > 0);
});
