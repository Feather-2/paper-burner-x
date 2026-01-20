import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/stages/deepsearch/tools/index.js", () => ({
  getToolCatalogPrompt: vi.fn(() => "MOCK_TOOL_CATALOG"),
}));

vi.mock("../../../../../../js/agents/prompts/prompt-loader.js", () => ({
  loadPrompt: vi.fn(async () => "PROMPT"),
  renderPromptTemplate: vi.fn((template) => template),
}));

vi.mock("../../../../../../js/agents/runtime/index.js", () => ({
  DeepSearchEvents: {},
}));

vi.mock("../../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
    isPlainObject: vi.fn(actual.isPlainObject),
    toNonNegativeInt: vi.fn(actual.toNonNegativeInt),
    toPositiveInt: vi.fn(actual.toPositiveInt),
  };
});

import { getGapConvergencePolicy } from "../../../../../../js/agents/stages/deepsearch/phases/planning-phase.js";
import * as shared from "../../../../../../js/agents/shared/index.js";

const DEFAULT_POLICY = Object.freeze({
  maxFindingGaps: 50,
  gapOnlyStreakLimit: 2,
  noProgressStreakLimit: 3,
});

describe("getGapConvergencePolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns defaults for missing or non-plain gaps", () => {
    const cases = [
      undefined,
      null,
      "",
      0,
      { userConfig: null },
      { userConfig: [] },
      { userConfig: { gaps: null } },
      { userConfig: { gaps: [] } },
      { userConfig: { gaps: "" } },
      { userConfig: { gaps: {} } },
    ];

    for (const state of cases) {
      expect(getGapConvergencePolicy(state)).toEqual(DEFAULT_POLICY);
    }
  });

  it("prefers primary keys when provided", () => {
    const state = {
      userConfig: {
        gaps: {
          maxFindingGaps: 12,
          maxGapFindings: 9,
          maxGaps: 7,
          gapOnlyStreakLimit: 8,
          maxGapOnlyIterations: 4,
          gapOnlyLimit: 6,
          noProgressStreakLimit: 11,
          maxNoProgressIterations: 5,
          stagnationLimit: 9,
        },
      },
    };

    const result = getGapConvergencePolicy(state);

    expect(result).toEqual({
      maxFindingGaps: 12,
      gapOnlyStreakLimit: 8,
      noProgressStreakLimit: 11,
    });
    expect(shared.toNonNegativeInt).toHaveBeenCalledWith(12, 50);
    expect(shared.toPositiveInt).toHaveBeenCalledWith(8, 2);
    expect(shared.toPositiveInt).toHaveBeenCalledWith(11, 3);
  });

  it("falls back to secondary keys and parses numeric strings", () => {
    const state = {
      userConfig: {
        gaps: {
          maxGapFindings: "10px",
          maxGaps: "7",
          maxGapOnlyIterations: "3",
          gapOnlyLimit: "5",
          maxNoProgressIterations: "4",
          stagnationLimit: "9",
        },
      },
    };

    expect(getGapConvergencePolicy(state)).toEqual({
      maxFindingGaps: 10,
      gapOnlyStreakLimit: 3,
      noProgressStreakLimit: 4,
    });
  });

  it("accepts zero only for maxFindingGaps", () => {
    const state = {
      userConfig: {
        gaps: {
          maxFindingGaps: 0,
          gapOnlyStreakLimit: 0,
          noProgressStreakLimit: 0,
        },
      },
    };

    expect(getGapConvergencePolicy(state)).toEqual({
      maxFindingGaps: 0,
      gapOnlyStreakLimit: 2,
      noProgressStreakLimit: 3,
    });
  });

  it("falls back for negative values and invalid types", () => {
    const state = {
      userConfig: {
        gaps: {
          maxFindingGaps: -1,
          gapOnlyStreakLimit: [],
          noProgressStreakLimit: {},
        },
      },
    };

    expect(getGapConvergencePolicy(state)).toEqual(DEFAULT_POLICY);
  });

  it("handles MAX_SAFE_INTEGER cap", () => {
    const state = {
      userConfig: {
        gaps: {
          maxGaps: Number.MAX_SAFE_INTEGER,
        },
      },
    };

    expect(getGapConvergencePolicy(state)).toEqual({
      maxFindingGaps: Number.MAX_SAFE_INTEGER,
      gapOnlyStreakLimit: 2,
      noProgressStreakLimit: 3,
    });
  });

  it("handles empty and whitespace strings", () => {
    const state = {
      userConfig: {
        gaps: {
          maxFindingGaps: "",
          gapOnlyStreakLimit: "   ",
          noProgressStreakLimit: "\n\t",
        },
      },
    };

    expect(getGapConvergencePolicy(state)).toEqual(DEFAULT_POLICY);
  });

  it("handles long strings and deep nested inputs", () => {
    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 100; i += 1) {
      cursor.child = {};
      cursor = cursor.child;
    }
    const hugePayload = Array.from({ length: 5000 }, (_, i) => `line-${i}`);

    const state = {
      userConfig: {
        gaps: {
          maxFindingGaps: " ".repeat(10000),
          gapOnlyStreakLimit: 2,
          noProgressStreakLimit: 3,
          extra: { deep, hugePayload },
        },
        blob: hugePayload,
      },
    };

    expect(getGapConvergencePolicy(state)).toEqual(DEFAULT_POLICY);
  });

  it("is stable under concurrent and rapid calls", async () => {
    const states = [
      { userConfig: { gaps: { maxFindingGaps: 1 } } },
      { userConfig: { gaps: { maxGapFindings: "2" } } },
      { userConfig: { gaps: { maxGaps: 3, gapOnlyStreakLimit: 4, noProgressStreakLimit: 5 } } },
    ];

    const results = await Promise.all(
      states.map((state) => Promise.resolve().then(() => getGapConvergencePolicy(state)))
    );

    expect(results).toEqual([
      { maxFindingGaps: 1, gapOnlyStreakLimit: 2, noProgressStreakLimit: 3 },
      { maxFindingGaps: 2, gapOnlyStreakLimit: 2, noProgressStreakLimit: 3 },
      { maxFindingGaps: 3, gapOnlyStreakLimit: 4, noProgressStreakLimit: 5 },
    ]);

    const baseline = { userConfig: { gaps: { maxFindingGaps: 7, gapOnlyStreakLimit: 2, noProgressStreakLimit: 4 } } };
    for (let i = 0; i < 20; i += 1) {
      expect(getGapConvergencePolicy(baseline)).toEqual({
        maxFindingGaps: 7,
        gapOnlyStreakLimit: 2,
        noProgressStreakLimit: 4,
      });
    }
  });
});
