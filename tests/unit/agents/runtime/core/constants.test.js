/**
 * @file tests/unit/agents/runtime/core/constants.test.js
 * @description Unit tests for runtime/core/constants.js
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => ""),
}));

import {
  ActorType,
  OrchestratorState,
  isValidActorType,
  isValidOrchestratorState,
  WorkflowTodoStatus,
  ReportLength,
  ReportTone,
  ReportAudience,
  ReportLanguage,
  QualityMode,
  EventBusItemKind,
  isValidReportLength,
  isValidReportTone,
  isValidReportAudience,
  isValidReportLanguage,
  isValidQualityMode,
  normalizeQualityMode,
  normalizeReportLength,
  normalizeReportTone,
  normalizeReportAudience,
  normalizeReportLanguage,
} from "../../../../../js/agents/runtime/core/constants.js";

const mockedReadFileSync = vi.mocked(readFileSync);

const createDeepObject = (depth = 80) => {
  const root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node.child = {};
    node = node.child;
  }
  return root;
};

const buildInvalidValues = (extra = []) => [
  null,
  undefined,
  "",
  "   ",
  [],
  {},
  0,
  -1,
  Number.MAX_SAFE_INTEGER,
  "0",
  "123",
  Number.NaN,
  { 0: "x", length: 1 },
  Symbol("invalid"),
  ...extra,
];

const expectFrozenEnum = (enumObj, expectedKeys, expectedValues) => {
  expect(Object.isFrozen(enumObj)).toBe(true);
  expect(Object.keys(enumObj).sort()).toEqual([...expectedKeys].sort());
  expect(Object.values(enumObj).sort()).toEqual([...expectedValues].sort());
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedReadFileSync.mockReturnValue("");
});

describe("ActorType", () => {
  it("exposes expected keys/values and is frozen", () => {
    expectFrozenEnum(
      ActorType,
      ["SYSTEM", "TEXTPREP", "DEEPSEARCH", "DESIGN", "EVALUATE", "CODESEARCH"],
      ["system", "textprep", "deepsearch", "design", "evaluate", "codesearch"],
    );
    expect(ActorType.UNKNOWN).toBeUndefined();
  });

  it("rejects mutation attempts", () => {
    expect(() => {
      ActorType.SYSTEM = "mutated";
    }).toThrow(TypeError);
    expect(ActorType.SYSTEM).toBe("system");
  });
});

describe("OrchestratorState", () => {
  it("exposes expected keys/values and is frozen", () => {
    expectFrozenEnum(
      OrchestratorState,
      ["IDLE", "RUNNING", "ENDED", "FAILED", "CANCELLED"],
      ["idle", "running", "ended", "failed", "cancelled"],
    );
  });
});

describe("WorkflowTodoStatus", () => {
  it("exposes expected keys/values and is frozen", () => {
    expectFrozenEnum(
      WorkflowTodoStatus,
      ["PENDING", "ACTIVE", "COMPLETED", "FAILED", "SKIPPED"],
      ["pending", "active", "completed", "failed", "skipped"],
    );
  });
});

describe("ReportLength", () => {
  it("exposes expected keys/values and is frozen", () => {
    expectFrozenEnum(
      ReportLength,
      ["BRIEF", "STANDARD", "DETAILED", "COMPREHENSIVE"],
      ["brief", "standard", "detailed", "comprehensive"],
    );
  });
});

describe("ReportTone", () => {
  it("exposes expected keys/values and is frozen", () => {
    expectFrozenEnum(
      ReportTone,
      ["ACADEMIC", "BUSINESS", "CASUAL"],
      ["academic", "business", "casual"],
    );
  });
});

describe("ReportAudience", () => {
  it("exposes expected keys/values and is frozen", () => {
    expectFrozenEnum(
      ReportAudience,
      ["GENERAL", "EXPERT", "EXECUTIVE"],
      ["general", "expert", "executive"],
    );
  });
});

describe("ReportLanguage", () => {
  it("exposes expected keys/values and is frozen", () => {
    expectFrozenEnum(
      ReportLanguage,
      ["AUTO", "ZH", "EN"],
      ["auto", "zh", "en"],
    );
  });
});

describe("QualityMode", () => {
  it("exposes expected keys/values and is frozen", () => {
    expectFrozenEnum(QualityMode, ["LOW", "STANDARD", "HIGH"], ["low", "standard", "high"]);
  });
});

describe("EventBusItemKind", () => {
  it("exposes expected keys/values and is frozen", () => {
    expectFrozenEnum(EventBusItemKind, ["EVENT", "COALESCE"], ["event", "coalesce"]);
  });
});

describe("isValidActorType", () => {
  it("returns true for valid actor types", () => {
    Object.values(ActorType).forEach((value) => {
      expect(isValidActorType(value)).toBe(true);
    });
  });

  it("returns false for invalid and boundary values without throwing", () => {
    const invalidValues = buildInvalidValues(["SYSTEM", "system ", "unknown", { type: "system" }]);

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = isValidActorType(value);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });

  it("handles concurrent calls without shared state", async () => {
    const inputs = [ActorType.SYSTEM, "invalid", null, ActorType.DESIGN, "SYSTEM"];
    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => isValidActorType(input)))
    );

    expect(results).toEqual([true, false, false, true, false]);
  });
});

describe("isValidOrchestratorState", () => {
  it("returns true for valid orchestrator states", () => {
    Object.values(OrchestratorState).forEach((value) => {
      expect(isValidOrchestratorState(value)).toBe(true);
    });
  });

  it("returns false for invalid and boundary values without throwing", () => {
    const invalidValues = buildInvalidValues(["RUNNING", "running ", "unknown", { state: "idle" }]);

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = isValidOrchestratorState(value);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });

  it("handles rapid consecutive calls consistently", () => {
    const inputs = ["idle", "IDLE", OrchestratorState.RUNNING, "ended ", null];
    const results = inputs.map((input) => isValidOrchestratorState(input));

    expect(results).toEqual([true, false, true, false, false]);
  });
});

describe("isValidReportLength", () => {
  it("returns true for valid report lengths", () => {
    Object.values(ReportLength).forEach((value) => {
      expect(isValidReportLength(value)).toBe(true);
    });
  });

  it("returns false for invalid and boundary values without throwing", () => {
    const invalidValues = buildInvalidValues(["BRIEF", "brief ", "unknown", { length: "brief" }]);

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = isValidReportLength(value);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });

  it("returns false for resource-heavy inputs", () => {
    mockedReadFileSync.mockReturnValueOnce("x".repeat(2 * 1024 * 1024));
    const hugeContent = readFileSync("/tmp/huge.txt", "utf8");
    const hugeFile = { name: "huge.txt", content: hugeContent };
    const longString = "y".repeat(200_000);
    const deepObject = createDeepObject(120);

    expect(hugeContent.length).toBeGreaterThan(1024 * 1024);
    expect(isValidReportLength(hugeContent)).toBe(false);
    expect(isValidReportLength(hugeFile)).toBe(false);
    expect(isValidReportLength(longString)).toBe(false);
    expect(isValidReportLength(deepObject)).toBe(false);
    expect(readFileSync).toHaveBeenCalledWith("/tmp/huge.txt", "utf8");
  });
});

describe("isValidReportTone", () => {
  it("returns true for valid report tones", () => {
    Object.values(ReportTone).forEach((value) => {
      expect(isValidReportTone(value)).toBe(true);
    });
  });

  it("returns false for invalid and boundary values without throwing", () => {
    const invalidValues = buildInvalidValues(["ACADEMIC", "academic ", "unknown", { tone: "casual" }]);

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = isValidReportTone(value);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });
});

describe("isValidReportAudience", () => {
  it("returns true for valid report audiences", () => {
    Object.values(ReportAudience).forEach((value) => {
      expect(isValidReportAudience(value)).toBe(true);
    });
  });

  it("returns false for invalid and boundary values without throwing", () => {
    const invalidValues = buildInvalidValues([
      "GENERAL",
      "general ",
      "unknown",
      { audience: "expert" },
    ]);

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = isValidReportAudience(value);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });
});

describe("isValidReportLanguage", () => {
  it("returns true for valid report languages", () => {
    Object.values(ReportLanguage).forEach((value) => {
      expect(isValidReportLanguage(value)).toBe(true);
    });
  });

  it("returns false for invalid and boundary values without throwing", () => {
    const invalidValues = buildInvalidValues(["AUTO", "auto ", "unknown", { lang: "en" }]);

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = isValidReportLanguage(value);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });
});

describe("isValidQualityMode", () => {
  it("returns true for valid quality modes", () => {
    Object.values(QualityMode).forEach((value) => {
      expect(isValidQualityMode(value)).toBe(true);
    });
  });

  it("returns false for invalid and boundary values without throwing", () => {
    const invalidValues = buildInvalidValues(["LOW", "low ", "unknown", { mode: "high" }]);

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = isValidQualityMode(value);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });
});

describe("normalizeQualityMode", () => {
  it("normalizes case and whitespace for valid values", () => {
    expect(normalizeQualityMode(" LOW ")).toBe("low");
    expect(normalizeQualityMode("standard")).toBe("standard");
    expect(normalizeQualityMode("High")).toBe("high");
  });

  it("returns undefined for invalid and boundary values without throwing", () => {
    const invalidValues = buildInvalidValues(["invalid", "medium", { mode: "low" }]);

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = normalizeQualityMode(value);
      }).not.toThrow();
      expect(result).toBeUndefined();
    });
  });
});

describe("normalizeReportLength", () => {
  it("normalizes case and whitespace for valid values", () => {
    expect(normalizeReportLength(" brief ")).toBe("brief");
    expect(normalizeReportLength("STANDARD")).toBe("standard");
    expect(normalizeReportLength("Detailed")).toBe("detailed");
  });

  it("returns undefined for invalid and boundary values without throwing", () => {
    const invalidValues = buildInvalidValues(["invalid", "LONG", { length: "brief" }]);

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = normalizeReportLength(value);
      }).not.toThrow();
      expect(result).toBeUndefined();
    });
  });

  it("handles rapid consecutive calls consistently", () => {
    const inputs = ["brief", " BRIEF ", "unknown", "", " detailed "];
    const results = inputs.map((input) => normalizeReportLength(input));

    expect(results).toEqual(["brief", "brief", undefined, undefined, "detailed"]);
  });
});

describe("normalizeReportTone", () => {
  it("normalizes case and whitespace for valid values", () => {
    expect(normalizeReportTone(" Academic ")).toBe("academic");
    expect(normalizeReportTone("business")).toBe("business");
    expect(normalizeReportTone("CASUAL")).toBe("casual");
  });

  it("returns undefined for invalid and boundary values without throwing", () => {
    const invalidValues = buildInvalidValues(["invalid", "formal", { tone: "casual" }]);

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = normalizeReportTone(value);
      }).not.toThrow();
      expect(result).toBeUndefined();
    });
  });
});

describe("normalizeReportAudience", () => {
  it("normalizes case and whitespace for valid values", () => {
    expect(normalizeReportAudience(" general ")).toBe("general");
    expect(normalizeReportAudience("EXPERT")).toBe("expert");
    expect(normalizeReportAudience("Executive")).toBe("executive");
  });

  it("returns undefined for invalid and boundary values without throwing", () => {
    const invalidValues = buildInvalidValues(["invalid", "public", { audience: "general" }]);

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = normalizeReportAudience(value);
      }).not.toThrow();
      expect(result).toBeUndefined();
    });
  });
});

describe("normalizeReportLanguage", () => {
  it("normalizes case and whitespace for valid values", () => {
    expect(normalizeReportLanguage(" AUTO ")).toBe("auto");
    expect(normalizeReportLanguage("ZH")).toBe("zh");
    expect(normalizeReportLanguage("en")).toBe("en");
  });

  it("returns undefined for invalid and boundary values without throwing", () => {
    const invalidValues = buildInvalidValues(["invalid", "fr", { lang: "en" }]);

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = normalizeReportLanguage(value);
      }).not.toThrow();
      expect(result).toBeUndefined();
    });
  });
});
