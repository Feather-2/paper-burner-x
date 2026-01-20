/**
 * @file tests/unit/agents/stages/design/internal/phases/index.test.js
 * @description Design phase index re-exports unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const phaseMocks = vi.hoisted(() => ({
  runPreparationPhase: vi.fn(),
  runPlanningPhase: vi.fn(),
  runLayoutPhase: vi.fn(),
  runGeneratingPhase: vi.fn(),
  runBatchRepairPhase: vi.fn(),
  runVisualPhase: vi.fn(),
  runReviewPhase: vi.fn(),
}));

vi.mock(
  "../../../../../../../js/agents/stages/design/internal/phases/preparation-phase.js",
  () => ({
    runPreparationPhase: phaseMocks.runPreparationPhase,
  }),
);

vi.mock(
  "../../../../../../../js/agents/stages/design/internal/phases/planning-phase.js",
  () => ({
    runPlanningPhase: phaseMocks.runPlanningPhase,
  }),
);

vi.mock(
  "../../../../../../../js/agents/stages/design/internal/phases/layout-phase.js",
  () => ({
    runLayoutPhase: phaseMocks.runLayoutPhase,
  }),
);

vi.mock(
  "../../../../../../../js/agents/stages/design/internal/phases/generating-phase.js",
  () => ({
    runGeneratingPhase: phaseMocks.runGeneratingPhase,
  }),
);

vi.mock(
  "../../../../../../../js/agents/stages/design/internal/phases/repair-phase.js",
  () => ({
    runBatchRepairPhase: phaseMocks.runBatchRepairPhase,
  }),
);

vi.mock(
  "../../../../../../../js/agents/stages/design/internal/phases/visual-phase.js",
  () => ({
    runVisualPhase: phaseMocks.runVisualPhase,
  }),
);

vi.mock(
  "../../../../../../../js/agents/stages/design/internal/phases/review-phase.js",
  () => ({
    runReviewPhase: phaseMocks.runReviewPhase,
  }),
);

import {
  runPreparationPhase,
  runPlanningPhase,
  runLayoutPhase,
  runGeneratingPhase,
  runBatchRepairPhase,
  runVisualPhase,
  runReviewPhase,
} from "../../../../../../../js/agents/stages/design/internal/phases/index.js";

const buildDeepObject = (depth) => {
  const root = { level: 0 };
  let current = root;

  for (let i = 1; i <= depth; i += 1) {
    current.child = { level: i };
    current = current.child;
  }

  return root;
};

const longString = "x".repeat(200000);
const largeArray = Array.from({ length: 50000 }, (_, index) => index);
const deepNestedObject = buildDeepObject(64);
const largeFileLike = {
  name: "big.txt",
  content: longString,
  size: longString.length,
  chunks: largeArray,
};

const edgeCases = [
  { label: "null", value: null },
  { label: "undefined", value: undefined },
  { label: "empty string", value: "" },
  { label: "whitespace string", value: "   " },
  { label: "empty array", value: [] },
  { label: "empty object", value: {} },
  { label: "zero", value: 0 },
  { label: "negative one", value: -1 },
  { label: "max safe integer", value: Number.MAX_SAFE_INTEGER },
  { label: "numeric string", value: "42" },
  { label: "array-like object", value: { 0: "a", length: 1 } },
];

const resourceCases = [
  { label: "long string", value: longString },
  { label: "large file-like object", value: largeFileLike },
  { label: "deep nested object", value: deepNestedObject },
  { label: "large array payload", value: largeArray },
];

beforeEach(() => {
  Object.values(phaseMocks).forEach((mockFn) => {
    mockFn.mockReset();
  });
});

function definePhaseTests(phaseName, exportedFn, mockFn) {
  describe(phaseName, () => {
    it("re-exports the phase function", () => {
      expect(exportedFn).toBe(mockFn);
    });

    it.each(edgeCases)("forwards boundary input: $label", ({ value }) => {
      mockFn.mockImplementation((arg) => ({ arg }));

      const result = exportedFn(value);

      expect(result).toEqual({ arg: value });
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith(value);
    });

    it.each(resourceCases)("forwards resource boundary input: $label", ({ value }) => {
      mockFn.mockImplementation((arg) => ({ arg }));

      const result = exportedFn(value);

      expect(result).toEqual({ arg: value });
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith(value);
    });

    it("propagates errors from the underlying phase", () => {
      const error = new Error("boom");
      mockFn.mockImplementation((arg) => {
        if (arg === "throw") {
          throw error;
        }
        return "ok";
      });

      expect(() => exportedFn("throw")).toThrow(error);
      expect(mockFn).toHaveBeenCalledWith("throw");
    });

    it("supports concurrent calls", async () => {
      mockFn.mockImplementation((value) => Promise.resolve(`ok:${value}`));

      const results = await Promise.all([
        exportedFn("a"),
        exportedFn("b"),
        exportedFn("c"),
      ]);

      expect(results).toEqual(["ok:a", "ok:b", "ok:c"]);
      expect(mockFn).toHaveBeenCalledTimes(3);
      expect(mockFn).toHaveBeenNthCalledWith(1, "a");
      expect(mockFn).toHaveBeenNthCalledWith(2, "b");
      expect(mockFn).toHaveBeenNthCalledWith(3, "c");
    });

    it("supports rapid consecutive calls", () => {
      mockFn.mockImplementation((value) => `ok:${value}`);

      for (let i = 0; i < 25; i += 1) {
        exportedFn(i);
      }

      expect(mockFn).toHaveBeenCalledTimes(25);
      expect(mockFn).toHaveBeenLastCalledWith(24);
    });
  });
}

definePhaseTests("runPreparationPhase", runPreparationPhase, phaseMocks.runPreparationPhase);
definePhaseTests("runPlanningPhase", runPlanningPhase, phaseMocks.runPlanningPhase);
definePhaseTests("runLayoutPhase", runLayoutPhase, phaseMocks.runLayoutPhase);
definePhaseTests("runGeneratingPhase", runGeneratingPhase, phaseMocks.runGeneratingPhase);
definePhaseTests("runBatchRepairPhase", runBatchRepairPhase, phaseMocks.runBatchRepairPhase);
definePhaseTests("runVisualPhase", runVisualPhase, phaseMocks.runVisualPhase);
definePhaseTests("runReviewPhase", runReviewPhase, phaseMocks.runReviewPhase);
