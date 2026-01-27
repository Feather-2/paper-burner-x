import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual("node:crypto");
  return actual;
});

import * as contentModule from "../../../../../js/agents/eval/graders/content.js";

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isIssue(value) {
  return (
    isPlainObject(value)
    && typeof value.type === "string"
    && typeof value.severity === "string"
    && typeof value.message === "string"
  );
}

function isEvaluationResult(value) {
  return (
    isPlainObject(value)
    && typeof value.passed === "boolean"
    && typeof value.score === "number"
    && Array.isArray(value.issues)
    && value.issues.every(isIssue)
  );
}

function issueTypes(result) {
  return Array.isArray(result?.issues) ? result.issues.map(i => i.type) : [];
}

function assertScoreInRange(score) {
  expect(score).toBeGreaterThanOrEqual(0);
  expect(score).toBeLessThanOrEqual(1);
}

function getEvaluateStageExport() {
  const direct = contentModule?.EvaluateStage;
  if (typeof direct === "function" || isPlainObject(direct)) return direct;

  const def = contentModule?.default;
  if (typeof def === "function" || isPlainObject(def)) return def;

  const defProp = contentModule?.default?.EvaluateStage;
  if (typeof defProp === "function" || isPlainObject(defProp)) return defProp;

  return undefined;
}

function getContentGraderExport() {
  const direct = contentModule?.contentGrader;
  if (direct) return direct;

  const defProp = contentModule?.default?.contentGrader;
  if (defProp) return defProp;

  return undefined;
}

function createStage(options) {
  const EvaluateStage = getEvaluateStageExport();
  expect(EvaluateStage, "Missing export: EvaluateStage").toBeTruthy();

  if (typeof EvaluateStage === "function") {
    try {
      return new EvaluateStage(options);
    } catch {
      const maybeStage = EvaluateStage(options);
      if (maybeStage && (typeof maybeStage === "object" || typeof maybeStage === "function")) return maybeStage;
      return EvaluateStage;
    }
  }

  if (EvaluateStage && typeof EvaluateStage === "object") return EvaluateStage;

  throw new Error("Unsupported EvaluateStage export shape");
}

function getStageEvaluateFn(stage) {
  if (typeof stage === "function") return stage;
  const fn = stage?.evaluate ?? stage?.run ?? stage?.grade;
  if (typeof fn !== "function") throw new Error("EvaluateStage instance lacks evaluate/run/grade");
  return fn.bind(stage);
}

function scoreProbeResult(result) {
  if (!isEvaluationResult(result)) return -1;
  const types = new Set(issueTypes(result));
  const expected = ["too_short", "placeholder_found", "incomplete_sentence"];
  return expected.reduce((acc, t) => acc + (types.has(t) ? 1 : 0), 0);
}

async function buildStageInvoker(stage) {
  const fn = getStageEvaluateFn(stage);

  const probeInput = {
    content: "Hi [TODO]...",
    original: "Hi",
    context: { type: "text", metadata: { probe: true } },
  };

  const candidates = [
    { name: "inputObject", invoke: input => fn(input) },
    { name: "contentOnly", invoke: input => fn(input.content) },
    { name: "contentOriginal", invoke: input => fn(input.content, input.original) },
    { name: "contentOriginalContext", invoke: input => fn(input.content, input.original, input.context) },
    { name: "contentAndInput", invoke: input => fn(input.content, input) },
  ];

  let best = null;
  let bestScore = -1;
  let lastError;

  for (const c of candidates) {
    try {
      const result = await c.invoke(probeInput);
      const s = scoreProbeResult(result);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (!best) {
    throw new Error(`Unable to detect EvaluateStage invocation (${lastError?.message ?? "unknown error"})`);
  }

  return async input => {
    const result = await best.invoke(input);
    expect(isEvaluationResult(result), `EvaluateStage returned unexpected result via ${best.name}`).toBe(true);
    assertScoreInRange(result.score);
    return result;
  };
}

function isGraderResult(value) {
  return isEvaluationResult(value);
}

function scoreProbeGraderResult(result) {
  if (!isGraderResult(result)) return -1;
  const types = new Set(issueTypes(result));
  const expected = ["too_short", "placeholder_found", "incomplete_sentence"];
  return expected.reduce((acc, t) => acc + (types.has(t) ? 1 : 0), 0);
}

async function buildGraderInvoker(contentGraderExport) {
  const probeInput = {
    content: "Hi [TODO]...",
    original: "Hi",
    context: { type: "text", metadata: { probe: true } },
  };
  const probeConfig = { passThreshold: 0.6, strict: false };

  const candidates = [];

  if (typeof contentGraderExport === "function") {
    candidates.push({
      name: "fn(input, config)",
      invoke: (input, config) => contentGraderExport(input, config),
    });

    candidates.push({
      name: "fn(config) -> (input)",
      invoke: async (input, config) => {
        const produced = contentGraderExport(config);
        if (typeof produced === "function") return produced(input);
        if (produced && typeof produced.grade === "function") return produced.grade(input, config);
        if (produced && typeof produced.run === "function") return produced.run(input, config);
        return produced;
      },
    });

    candidates.push({
      name: "fn({ input, config })",
      invoke: (input, config) => contentGraderExport({ input, config }),
    });
  }

  if (contentGraderExport && typeof contentGraderExport === "object") {
    if (typeof contentGraderExport.grade === "function") {
      candidates.push({
        name: "obj.grade(input, config)",
        invoke: (input, config) => contentGraderExport.grade(input, config),
      });
      candidates.push({
        name: "obj.grade({ input, config })",
        invoke: (input, config) => contentGraderExport.grade({ input, config }),
      });
    }
    if (typeof contentGraderExport.run === "function") {
      candidates.push({
        name: "obj.run(input, config)",
        invoke: (input, config) => contentGraderExport.run(input, config),
      });
    }
  }

  let best = null;
  let bestScore = -1;
  let lastError;

  for (const c of candidates) {
    try {
      const result = await c.invoke(probeInput, probeConfig);
      const s = scoreProbeGraderResult(result);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (!best) {
    throw new Error(`Unable to detect contentGrader invocation (${lastError?.message ?? "unknown error"})`);
  }

  return async (input, config = {}) => {
    const result = await best.invoke(input, config);
    expect(isGraderResult(result), `contentGrader returned unexpected result via ${best.name}`).toBe(true);
    assertScoreInRange(result.score);
    return result;
  };
}

describe("EvaluateStage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scores short content lower and reports too_short", async () => {
    const stage = createStage({});
    const invoke = await buildStageInvoker(stage);

    const shortInput = { content: "Hi", context: { type: "text" } };
    const longInput = { content: "a".repeat(200), context: { type: "text" } };

    const shortResult = await invoke(shortInput);
    const longResult = await invoke(longInput);

    expect(shortResult.score).toBeLessThan(longResult.score);
    expect(issueTypes(shortResult)).toContain("too_short");
  });

  it("penalizes report content missing heading structure", async () => {
    const stage = createStage({});
    const invoke = await buildStageInvoker(stage);

    const reportBody = "a".repeat(240);
    const noHeading = { content: reportBody, context: { type: "report" } };
    const withHeading = { content: `# Title\n\n${reportBody}`, context: { type: "report" } };

    const noHeadingResult = await invoke(noHeading);
    const withHeadingResult = await invoke(withHeading);

    expect(issueTypes(noHeadingResult)).toContain("missing_structure");
    expect(noHeadingResult.score).toBeLessThan(withHeadingResult.score);
    expect(issueTypes(withHeadingResult)).not.toContain("missing_structure");
  });

  it("penalizes placeholders and reports placeholder_found", async () => {
    const stage = createStage({});
    const invoke = await buildStageInvoker(stage);

    const base = "b".repeat(220);
    const clean = { content: base, context: { type: "text" } };
    const withPlaceholders = {
      content: `b`.repeat(60) + " [TODO] " + "b".repeat(60) + " [TBD] " + "b".repeat(60) + " {{x}}",
      context: { type: "text" },
    };

    const cleanResult = await invoke(clean);
    const placeholderResult = await invoke(withPlaceholders);

    expect(issueTypes(placeholderResult)).toContain("placeholder_found");
    expect(placeholderResult.score).toBeLessThan(cleanResult.score);
  });

  it("flags incomplete sentences ending with ellipsis", async () => {
    const stage = createStage({});
    const invoke = await buildStageInvoker(stage);

    const base = "c".repeat(120);
    const complete = { content: `${base}.`, context: { type: "text" } };
    const incomplete = { content: `${base}...`, context: { type: "text" } };

    const completeResult = await invoke(complete);
    const incompleteResult = await invoke(incomplete);

    expect(issueTypes(incompleteResult)).toContain("incomplete_sentence");
    expect(incompleteResult.score).toBeLessThan(completeResult.score);
  });

  it("penalizes overly long paragraphs (clarity)", async () => {
    const stage = createStage({});
    const invoke = await buildStageInvoker(stage);

    const baseline = { content: "d".repeat(300) + "\n\n" + "e".repeat(300), context: { type: "text" } };
    const longParagraph = { content: "d".repeat(1200), context: { type: "text" } };

    const baselineResult = await invoke(baseline);
    const longResult = await invoke(longParagraph);

    expect(longResult.score).toBeLessThan(baselineResult.score);
    expect(longResult.issues.length).toBeGreaterThanOrEqual(baselineResult.issues.length);
  });

  it("handles passThreshold boundary values (-1, 0, MAX_SAFE_INTEGER) safely", async () => {
    const input = { content: "Hi [TODO]...", context: { type: "text" } };

    const stageLow = createStage({ passThreshold: -1 });
    const invokeLow = await buildStageInvoker(stageLow);
    const resultLow = await invokeLow(input);
    expect(resultLow.passed).toBe(true);

    const stageZero = createStage({ passThreshold: 0 });
    const invokeZero = await buildStageInvoker(stageZero);
    const resultZero = await invokeZero(input);
    expect(resultZero.passed).toBe(true);

    const stageHigh = createStage({ passThreshold: MAX_SAFE_INTEGER });
    const invokeHigh = await buildStageInvoker(stageHigh);
    const resultHigh = await invokeHigh(input);
    expect(resultHigh.passed).toBe(false);
  });

  it("handles empty/whitespace content and reports issues deterministically", async () => {
    const stage = createStage({});
    const invoke = await buildStageInvoker(stage);

    const empty = await invoke({ content: "", context: { type: "text" } });
    expect(issueTypes(empty)).toContain("too_short");

    const whitespace = await invoke({ content: " \n\t ", context: { type: "text" } });
    expect(issueTypes(whitespace)).toContain("too_short");
  });

  it("handles null/undefined and type-boundary inputs via explicit failure", async () => {
    const stage = createStage({});
    const invoke = await buildStageInvoker(stage);

    const inputs = [
      { name: "null", input: { content: null, context: { type: "text" } } },
      { name: "undefined", input: { content: undefined, context: { type: "text" } } },
      { name: "0", input: { content: 0, context: { type: "text" } } },
      { name: "-1", input: { content: -1, context: { type: "text" } } },
      { name: "MAX_SAFE_INTEGER", input: { content: MAX_SAFE_INTEGER, context: { type: "text" } } },
      { name: "empty array", input: { content: [], context: { type: "text" } } },
      { name: "empty object", input: { content: {}, context: { type: "text" } } },
      { name: "object as array", input: { content: { 0: "a", length: 1 }, context: { type: "text" } } },
      { name: "string as number", input: { content: "123", context: { type: "text" } } },
    ];

    for (const { name, input } of inputs) {
      let result;
      let thrown;
      try {
        result = await invoke(input);
      } catch (err) {
        thrown = err;
      }

      if (thrown) {
        expect(thrown, name).toBeInstanceOf(Error);
      } else {
        expect(isEvaluationResult(result), name).toBe(true);
        assertScoreInRange(result.score);
      }
    }
  });

  it("is safe under concurrent evaluations and does not share issue arrays", async () => {
    const stage = createStage({});
    const invoke = await buildStageInvoker(stage);

    const input = { content: "Hi [TODO]...", context: { type: "text" } };
    const results = await Promise.all(Array.from({ length: 25 }, () => invoke(input)));

    const first = results[0];
    for (const r of results) {
      expect(r.score).toBe(first.score);
      expect(r.passed).toBe(first.passed);
      expect(issueTypes(r)).toEqual(issueTypes(first));
    }

    expect(results[0].issues).not.toBe(results[1].issues);
  });

  it("handles very large content strings (resource boundary)", async () => {
    const stage = createStage({});
    const invoke = await buildStageInvoker(stage);

    const huge = "x".repeat(1_000_000);
    const result = await invoke({ content: huge, context: { type: "text" } });

    expect(result.issues.length).toBeGreaterThanOrEqual(0);
    assertScoreInRange(result.score);
  });

  it("handles deep nested metadata (resource boundary) without crashing", async () => {
    const stage = createStage({});
    const invoke = await buildStageInvoker(stage);

    const deep = { level: 0 };
    let cursor = deep;
    for (let i = 1; i <= 200; i++) {
      cursor.child = { level: i };
      cursor = cursor.child;
    }

    const result = await invoke({
      content: "y".repeat(120),
      context: { type: "text", metadata: deep },
    });

    assertScoreInRange(result.score);
  });
});

describe("contentGrader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a GraderResult shape and scores good content higher than bad content", async () => {
    const contentGrader = getContentGraderExport();
    expect(contentGrader, "Missing export: contentGrader").toBeTruthy();

    const grade = await buildGraderInvoker(contentGrader);

    const good = { content: "z".repeat(250), context: { type: "text" } };
    const bad = { content: "Hi [TODO]...", context: { type: "text" } };

    const goodResult = await grade(good, {});
    const badResult = await grade(bad, {});

    expect(goodResult.score).toBeGreaterThan(badResult.score);
    expect(badResult.issues.length).toBeGreaterThan(0);
  });

  it("handles config boundary values (0, -1, MAX_SAFE_INTEGER) without crashing", async () => {
    const contentGrader = getContentGraderExport();
    expect(contentGrader, "Missing export: contentGrader").toBeTruthy();

    const grade = await buildGraderInvoker(contentGrader);
    const input = { content: "Hi [TODO]...", context: { type: "text" } };

    const r0 = await grade(input, { passThreshold: 0 });
    expect(isGraderResult(r0)).toBe(true);

    const rNeg = await grade(input, { passThreshold: -1 });
    expect(isGraderResult(rNeg)).toBe(true);

    const rMax = await grade(input, { passThreshold: MAX_SAFE_INTEGER });
    expect(isGraderResult(rMax)).toBe(true);
  });

  it("is safe under concurrent calls (concurrency boundary)", async () => {
    const contentGrader = getContentGraderExport();
    expect(contentGrader, "Missing export: contentGrader").toBeTruthy();

    const grade = await buildGraderInvoker(contentGrader);
    const input = { content: "Hi [TODO]...", context: { type: "text" } };

    const results = await Promise.all(Array.from({ length: 20 }, () => grade(input, {})));
    const first = results[0];

    for (const r of results) {
      expect(r.score).toBe(first.score);
      expect(r.passed).toBe(first.passed);
      expect(issueTypes(r)).toEqual(issueTypes(first));
    }
  });

  it("handles huge content strings (resource boundary)", async () => {
    const contentGrader = getContentGraderExport();
    expect(contentGrader, "Missing export: contentGrader").toBeTruthy();

    const grade = await buildGraderInvoker(contentGrader);
    const huge = "w".repeat(1_000_000);

    const result = await grade({ content: huge, context: { type: "text" } }, {});
    assertScoreInRange(result.score);
  });

  it("handles null/undefined and type boundaries via explicit failure", async () => {
    const contentGrader = getContentGraderExport();
    expect(contentGrader, "Missing export: contentGrader").toBeTruthy();

    const grade = await buildGraderInvoker(contentGrader);

    const inputs = [
      { name: "null", input: { content: null, context: { type: "text" } } },
      { name: "undefined", input: { content: undefined, context: { type: "text" } } },
      { name: "0", input: { content: 0, context: { type: "text" } } },
      { name: "empty array", input: { content: [], context: { type: "text" } } },
      { name: "empty object", input: { content: {}, context: { type: "text" } } },
      { name: "object as array", input: { content: { 0: "a", length: 1 }, context: { type: "text" } } },
    ];

    for (const { name, input } of inputs) {
      let result;
      let thrown;
      try {
        result = await grade(input, {});
      } catch (err) {
        thrown = err;
      }

      if (thrown) {
        expect(thrown, name).toBeInstanceOf(Error);
      } else {
        expect(isGraderResult(result), name).toBe(true);
        assertScoreInRange(result.score);
      }
    }
  });
});