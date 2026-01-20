import { beforeEach, describe, expect, it, vi } from "vitest";

import EvaluateStageDefault, { EvaluateStage, contentGrader } from "../../../../../js/agents/eval/graders/content.js";

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "mock-uuid"),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("eval/graders/content.js", () => {
  describe("EvaluateStage", () => {
    it("initializes with builtin evaluators", () => {
      const stage = new EvaluateStage();
      const names = stage.getEvaluatorNames();

      expect(names).toEqual(
        expect.arrayContaining(["completeness", "accuracy", "clarity", "relevance"])
      );
    });

    it("registers/unregisters evaluators and merges config", async () => {
      const stage = new EvaluateStage({
        dimensions: ["custom"],
        dimensionConfig: {
          custom: { weight: 2, options: { a: 1 } },
        },
      });

      const evaluator = vi.fn(() => ({ score: 0.5, issues: [] }));
      stage.registerEvaluator("custom", evaluator, { options: { b: 2 } });

      expect(stage.dimensionConfig.custom).toEqual({ weight: 2, options: { b: 2 } });

      const result = await stage.run(null, { content: "x".repeat(80) });
      expect(evaluator).toHaveBeenCalledTimes(1);
      expect(result.dimensions.custom).toBe(0.5);

      stage.unregisterEvaluator("custom");
      expect(stage.getEvaluatorNames()).not.toContain("custom");
    });

    it("returns error for missing or invalid content values", async () => {
      const stage = new EvaluateStage();
      const cases = [
        { label: "undefined input", input: undefined },
        { label: "empty input object", input: {} },
        { label: "null content", input: { content: null } },
        { label: "undefined content", input: { content: undefined } },
        { label: "empty string", input: { content: "" } },
        { label: "empty array", input: { content: [] } },
        { label: "empty object", input: { content: {} } },
      ];

      for (const testCase of cases) {
        const result = await stage.run(null, testCase.input);
        expect(result.passed, testCase.label).toBe(false);
        expect(result.score, testCase.label).toBe(0);
        expect(result.issues[0]?.type, testCase.label).toBe("missing_content");
        expect(result.dimensions, testCase.label).toEqual({});
      }
    });

    it("treats whitespace string as content but flags it as too short", async () => {
      const stage = new EvaluateStage({ dimensions: ["completeness"] });
      const result = await stage.run(null, { content: "   " });

      expect(result.passed).toBe(true);
      expect(result.issues.some((issue) => issue.type === "too_short")).toBe(true);
    });

    it("filters non-string dimension names and ignores unknown", async () => {
      const stage = new EvaluateStage({ dimensions: ["accuracy", 123, null, "missing"] });
      const result = await stage.run(null, { content: "This has [TODO] placeholder." });

      expect(Object.keys(result.dimensions)).toEqual(["accuracy"]);
      expect(result.issues.some((issue) => issue.type === "placeholder_found")).toBe(true);
    });

    it("uses all evaluators when dimensions is not an array", async () => {
      const stage = new EvaluateStage({ dimensions: { 0: "accuracy" } });
      const result = await stage.run(null, { content: "Short but valid text." });

      expect(result.dimensions).toMatchObject({
        completeness: expect.any(Number),
        accuracy: expect.any(Number),
        clarity: expect.any(Number),
        relevance: expect.any(Number),
      });
    });

    it("fails in strict mode when any error issue is present", async () => {
      const stage = new EvaluateStage({ strict: true, dimensions: ["custom"] });
      stage.registerEvaluator("custom", () => ({
        score: 1,
        issues: [{ type: "bad", severity: "error", message: "boom" }],
      }));

      const result = await stage.run(null, { content: "x".repeat(80) });
      expect(result.passed).toBe(false);
      expect(result.issues.some((issue) => issue.severity === "error")).toBe(true);
    });

    it("adds evaluator_error issue when evaluator throws", async () => {
      const stage = new EvaluateStage({ dimensions: ["custom"] });
      stage.registerEvaluator("custom", () => {
        throw new Error("kaput");
      });

      const result = await stage.run(null, { content: "x".repeat(80) });

      expect(result.score).toBe(1);
      expect(result.issues.some((issue) => issue.type === "evaluator_error")).toBe(true);
    });

    it("weights scores and rounds to two decimals", async () => {
      const stage = new EvaluateStage({
        dimensions: ["a", "b"],
        dimensionConfig: {
          a: { weight: 2 },
          b: { weight: 1 },
        },
      });

      stage.registerEvaluator("a", () => ({ score: 1, issues: [] }));
      stage.registerEvaluator("b", () => ({ score: 1 / 3, issues: [] }));

      const result = await stage.run(null, { content: "x".repeat(80) });
      expect(result.score).toBe(0.78);
    });

    it("coerces string passThreshold for numeric comparisons", async () => {
      const stage = new EvaluateStage({ passThreshold: "0.95", dimensions: ["custom"] });
      stage.registerEvaluator("custom", () => ({ score: 0.9, issues: [] }));

      const result = await stage.run(null, { content: "x".repeat(80) });
      expect(result.passed).toBe(false);
    });

    it("handles long content and deep metadata", async () => {
      const stage = new EvaluateStage();
      const longContent = "word ".repeat(20000);
      const deepMetadata = { level: { index: 0 } };
      let cursor = deepMetadata.level;
      for (let i = 1; i < 12; i += 1) {
        cursor.next = { index: i };
        cursor = cursor.next;
      }

      const result = await stage.run(null, {
        content: longContent,
        context: { type: "text", metadata: deepMetadata },
      });

      expect(result.score).toBeGreaterThan(0);
      expect(result.issues.some((issue) => issue.type === "long_paragraphs")).toBe(true);
    });

    it("supports simultaneous runs without cross-talk", async () => {
      const stage = new EvaluateStage({ dimensions: ["accuracy"] });
      const longBase = "This sentence is long enough to pass the length checks.";

      const [withPlaceholder, withIncomplete] = await Promise.all([
        stage.run(null, { content: `${longBase} [TODO]` }),
        stage.run(null, { content: `${longBase} Ends with...` }),
      ]);

      expect(withPlaceholder.issues.some((issue) => issue.type === "placeholder_found")).toBe(true);
      expect(withIncomplete.issues.some((issue) => issue.type === "incomplete_sentence")).toBe(true);
    });

    it("handles rapid consecutive runs consistently", async () => {
      const stage = new EvaluateStage({ dimensions: ["accuracy"] });
      const content = "This sentence is long enough to avoid short content warnings.";

      const results = [];
      for (let i = 0; i < 5; i += 1) {
        results.push(await stage.run(null, { content }));
      }

      const firstScore = results[0].score;
      expect(results.every((result) => result.score === firstScore)).toBe(true);
      expect(results.every((result) => result.passed)).toBe(true);
    });

    it("runs custom evaluator that uses a mocked external dependency", async () => {
      const { randomUUID } = await import("node:crypto");
      const stage = new EvaluateStage({ dimensions: ["custom"] });

      stage.registerEvaluator("custom", () => ({
        score: randomUUID() === "mock-uuid" ? 1 : 0,
        issues: [],
      }));

      const result = await stage.run(null, { content: "x".repeat(80) });

      expect(randomUUID).toHaveBeenCalledTimes(1);
      expect(result.score).toBe(1);
    });
  });

  describe("contentGrader", () => {
    it("grades output using stage options and merged input", async () => {
      const config = {
        options: {
          stage: { dimensions: ["relevance"], passThreshold: 0.4 },
          input: { original: "alpha beta gamma" },
        },
      };

      const result = await contentGrader.grade("delta epsilon", config);

      expect(result.graderType).toBe("content");
      expect(result.passed).toBe(false);
      expect(result.issues.some((issue) => issue.type === "low_relevance")).toBe(true);
    });

    it("returns missing_content for null/undefined/empty array output", async () => {
      const cases = [null, undefined, []];

      for (const output of cases) {
        const result = await contentGrader.grade(output, {});
        expect(result.passed).toBe(false);
        expect(result.issues.some((issue) => issue.type === "missing_content")).toBe(true);
      }
    });

    it("stringifies numeric boundaries and whitespace output", async () => {
      const outputs = [0, -1, Number.MAX_SAFE_INTEGER, "   "];

      for (const output of outputs) {
        const result = await contentGrader.grade(output, {});
        expect(result.issues.some((issue) => issue.type === "missing_content")).toBe(false);
      }
    });

    it("supports simultaneous grade calls", async () => {
      const config = { options: { stage: { dimensions: ["accuracy"] } } };
      const longBase = "This sentence is long enough to avoid short content warnings.";

      const [placeholder, incomplete] = await Promise.all([
        contentGrader.grade(`${longBase} [TODO]`, config),
        contentGrader.grade(`${longBase} Ends with...`, config),
      ]);

      expect(placeholder.issues.some((issue) => issue.type === "placeholder_found")).toBe(true);
      expect(incomplete.issues.some((issue) => issue.type === "incomplete_sentence")).toBe(true);
    });

    it("handles rapid consecutive grade calls", async () => {
      const config = { options: { stage: { dimensions: ["accuracy"] } } };
      const content = "This sentence is long enough to avoid short content warnings.";

      const results = [];
      for (let i = 0; i < 4; i += 1) {
        results.push(await contentGrader.grade(content, config));
      }

      expect(results.every((result) => result.passed)).toBe(true);
    });

    it("normalizes non-finite scores and non-array issues from stage", async () => {
      const runSpy = vi
        .spyOn(EvaluateStage.prototype, "run")
        .mockResolvedValue({ passed: true, score: Number.NaN, issues: null });

      const result = await contentGrader.grade("ok", {});

      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(result.score).toBe(0);
      expect(result.issues).toEqual([]);
      expect(result.reason).toBe("Content quality passed");
    });

    it("propagates errors from stage.run", async () => {
      const runSpy = vi
        .spyOn(EvaluateStage.prototype, "run")
        .mockRejectedValue(new Error("boom"));

      await expect(contentGrader.grade("ok", {})).rejects.toThrow("boom");
      expect(runSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("default export", () => {
    it("exports EvaluateStage as default", () => {
      expect(EvaluateStageDefault).toBe(EvaluateStage);
    });
  });
});
