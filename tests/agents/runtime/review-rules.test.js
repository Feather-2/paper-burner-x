const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");

test("ReviewRules: pass returns { pass: true, severity: info }", async () => {
  const { ReviewRules } = await import("../../../js/agents/runtime/review-rules.js");
  const rules = new ReviewRules();

  const cases = [
    ["deepsearch.scan", { tocNodes: [{}], documentInfo: { title: "x" } }],
    ["deepsearch.retrieve", { retrievedChunks: [{}], relevanceScore: 0.99 }],
    ["deepsearch.understand", { concepts: ["c1"] }],
    ["design.layout", { slides: [{}] }],
  ];

  for (const [stage, result] of cases) {
    assert.deepEqual(rules.check(stage, result), {
      pass: true,
      severity: "info",
      reason: "",
      suggestions: [],
    });
  }
});

test("ReviewRules: failing error rule returns { pass: false, severity: error }", async () => {
  const { ReviewRules } = await import("../../../js/agents/runtime/review-rules.js");
  const rules = new ReviewRules();

  const out = rules.check("deepsearch.scan", { tocNodes: [{}] });
  assert.equal(out.pass, false);
  assert.equal(out.severity, "error");
  assert.equal(out.reason, "Missing document info");
  assert.ok(out.suggestions.includes("Missing document info"));
});

test("ReviewRules: failing warning rule returns { pass: false, severity: warning }", async () => {
  const { ReviewRules } = await import("../../../js/agents/runtime/review-rules.js");
  const rules = new ReviewRules();

  const out = rules.check("deepsearch.scan", { tocNodes: [], documentInfo: { title: "x" } });
  assert.equal(out.pass, false);
  assert.equal(out.severity, "warning");
  assert.equal(out.reason, "No TOC extracted");
  assert.ok(out.suggestions.includes("No TOC extracted"));
});

test("ReviewRules: multiple failures returns highest severity", async () => {
  const { ReviewRules } = await import("../../../js/agents/runtime/review-rules.js");
  const rules = new ReviewRules();

  const out = rules.check("deepsearch.scan", { tocNodes: [] });
  assert.equal(out.pass, false);
  assert.equal(out.severity, "error");
  assert.equal(out.reason, "Missing document info");
  assert.deepEqual(out.suggestions.sort(), ["Missing document info", "No TOC extracted"].sort());
});

test("ReviewRules: custom rules override defaultRules", async () => {
  const { ReviewRules } = await import("../../../js/agents/runtime/review-rules.js");

  const custom = new ReviewRules({
    "deepsearch.scan": [
      { check: () => true, severity: "error", message: "custom-always-pass" },
    ],
  });

  // Overridden stage: defaults should NOT run.
  assert.deepEqual(custom.check("deepsearch.scan", {}), {
    pass: true,
    severity: "info",
    reason: "",
    suggestions: [],
  });

  // Non-overridden stage: defaults still apply.
  const out = custom.check("deepsearch.retrieve", { retrievedChunks: [] });
  assert.equal(out.pass, false);
  assert.equal(out.severity, "error");
  assert.equal(out.reason, "No chunks retrieved");
});

test("ReviewRules: 1000 checks < 1000ms", async () => {
  const { ReviewRules } = await import("../../../js/agents/runtime/review-rules.js");
  const rules = new ReviewRules();
  const input = { retrievedChunks: [{}], relevanceScore: 0.9 };

  const startedAt = performance.now();
  for (let i = 0; i < 1000; i++) {
    rules.check("deepsearch.retrieve", input);
  }
  const elapsedMs = performance.now() - startedAt;
  assert.ok(elapsedMs < 1000);
});

test("ReviewRules: unknown stage returns { pass: true }", async () => {
  const { ReviewRules } = await import("../../../js/agents/runtime/review-rules.js");
  const rules = new ReviewRules();

  assert.deepEqual(rules.check("unknown.stage", { any: true }), {
    pass: true,
    severity: "info",
    reason: "",
    suggestions: [],
  });
});

test("ReviewRules: invalid rules are ignored, thrown checks fail", async () => {
  const { ReviewRules } = await import("../../../js/agents/runtime/review-rules.js");

  const rules = new ReviewRules({
    "custom.stage": [
      null,
      { notCheck: () => false },
      { check: () => { throw new Error("boom"); }, severity: "wat", message: "thrown" },
      { check: () => false, severity: "info", message: "dup", suggestions: ["dup", "dup", ""] },
      { check: () => false, severity: "info", message: "", suggestion: "single" },
    ],
  });

  const out = rules.check("custom.stage", {});
  assert.equal(out.pass, false);
  assert.equal(out.severity, "warning"); // invalid severity => warning
  assert.equal(out.reason, "thrown");
  assert.deepEqual(out.suggestions, ["thrown", "dup", "single"]);
});

