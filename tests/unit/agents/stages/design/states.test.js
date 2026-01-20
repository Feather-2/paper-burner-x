import { describe, it, expect, vi, beforeEach } from "vitest";

const runtimeMocks = vi.hoisted(() => {
  const AgentStatus = Object.freeze({
    IDLE: "idle",
    RUNNING: "running",
    COMPLETED: "completed",
    FAILED: "failed",
  });
  const StepStatus = Object.freeze({
    PENDING: "pending",
    ACTIVE: "active",
    DONE: "done",
  });
  const isValidAgentStatus = vi.fn((value) =>
    Object.values(AgentStatus).includes(value)
  );
  const isValidStepStatus = vi.fn((value) =>
    Object.values(StepStatus).includes(value)
  );
  return {
    AgentStatus,
    StepStatus,
    isValidAgentStatus,
    isValidStepStatus,
  };
});

vi.mock("../../../../../js/agents/runtime/index.js", () => runtimeMocks);

let DesignPhase;
let SlideStatus;
let VisualSlotStatus;
let EditSessionStatus;
let SubAgentStatus;
let ReviewStatus;
let isValidDesignPhase;
let isValidSlideStatus;
let isValidVisualSlotStatus;
let isValidEditSessionStatus;
let isValidSubAgentStatus;
let isValidReviewStatus;
let DesignLoopStatus;
let AgentStatus;
let StepStatus;
let isValidAgentStatus;
let isValidStepStatus;

const INVALID_VALUES = [
  null,
  undefined,
  "",
  "   ",
  [],
  {},
  0,
  -1,
  Number.MAX_SAFE_INTEGER,
  "123",
  "not-a-type",
  "PENDING",
  { 0: "value", length: 1 },
  Symbol("status"),
];

const LARGE_CONTENT = "x".repeat(200000);

function makeDeepObject(depth) {
  let node = {};
  for (let i = 0; i < depth; i += 1) {
    node = { next: node };
  }
  return node;
}

function runEnumTests(getEnum, expectedKeys, expectedValues) {
  it("exposes expected keys and values", () => {
    const enumObj = getEnum();
    expect(Object.keys(enumObj).sort()).toEqual([...expectedKeys].sort());
    expect(Object.values(enumObj).sort()).toEqual([...expectedValues].sort());
  });

  it("is frozen and does not expose unknown types", () => {
    const enumObj = getEnum();
    expect(Object.isFrozen(enumObj)).toBe(true);
    expect(enumObj.UNKNOWN).toBeUndefined();
    expect(new Set(Object.values(enumObj)).size).toBe(
      Object.values(enumObj).length
    );
  });
}

function runValidatorTests(getValidator, getValues) {
  it("returns true for allowed values", () => {
    const validator = getValidator();
    const values = Object.values(getValues());
    values.forEach((value) => {
      expect(validator(value)).toBe(true);
    });
  });

  it("returns false for invalid and boundary values without throwing", () => {
    const validator = getValidator();
    INVALID_VALUES.forEach((value) => {
      let result;
      expect(() => {
        result = validator(value);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });

  it("handles resource boundary inputs", () => {
    const validator = getValidator();
    const values = Object.values(getValues());
    const sample = values[0];
    const longString = `${" ".repeat(5000)}${sample}${" ".repeat(5000)}`;
    const deep = makeDeepObject(250);

    expect(validator(LARGE_CONTENT)).toBe(false);
    expect(validator(longString)).toBe(false);

    let deepResult;
    expect(() => {
      deepResult = validator(deep);
    }).not.toThrow();
    expect(deepResult).toBe(false);
  });

  it("handles concurrent calls without shared state", async () => {
    const validator = getValidator();
    const values = Object.values(getValues());
    const firstValue = values[0];
    const secondValue = values[1] ?? values[0];
    const inputs = [firstValue, "unknown", null, secondValue, "   "];
    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => validator(input)))
    );

    expect(results).toEqual([true, false, false, true, false]);
  });

  it("handles rapid consecutive calls consistently", () => {
    const validator = getValidator();
    const values = Object.values(getValues());
    const firstValue = values[0];
    const secondValue = values[1] ?? values[0];
    const inputs = [firstValue, secondValue, "unknown", "", undefined];
    const results = inputs.map((input) => validator(input));

    expect(results).toEqual([true, true, false, false, false]);
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  const mod = await import(
    "../../../../../js/agents/stages/design/states.js"
  );
  ({
    DesignPhase,
    SlideStatus,
    VisualSlotStatus,
    EditSessionStatus,
    SubAgentStatus,
    ReviewStatus,
    isValidDesignPhase,
    isValidSlideStatus,
    isValidVisualSlotStatus,
    isValidEditSessionStatus,
    isValidSubAgentStatus,
    isValidReviewStatus,
    DesignLoopStatus,
    AgentStatus,
    StepStatus,
    isValidAgentStatus,
    isValidStepStatus,
  } = mod);
});

describe("DesignPhase", () => {
  runEnumTests(
    () => DesignPhase,
    [
      "IDLE",
      "OUTLINE_PARSING",
      "OUTLINE_CONFIRMING",
      "STYLE_EXTRACTING",
      "STYLE_CONFIRMING",
      "DECK_PLANNING",
      "PLAN_CONFIRMING",
      "LAYOUT_ANALYZING",
      "LAYOUT_GENERATING",
      "LAYOUT_DEVELOPING",
      "LAYOUT_CONFIRMING",
      "GENERATING",
      "GENERATING_PAUSED",
      "REVIEWING",
      "FIXING",
      "REPAIR",
      "VISUAL_FILLING",
      "COMPLETED",
      "FAILED",
      "EDITING",
    ],
    [
      "idle",
      "outline_parsing",
      "outline_confirming",
      "style_extracting",
      "style_confirming",
      "deck_planning",
      "plan_confirming",
      "layout_analyzing",
      "layout_generating",
      "layout_developing",
      "layout_confirming",
      "generating",
      "generating_paused",
      "reviewing",
      "fixing",
      "repair",
      "visual_filling",
      "completed",
      "failed",
      "editing",
    ]
  );
});

describe("SlideStatus", () => {
  runEnumTests(
    () => SlideStatus,
    [
      "PENDING",
      "ASSIGNED",
      "GENERATING",
      "GENERATED",
      "REVIEWING",
      "REVIEW_PASSED",
      "REVIEW_FAILED",
      "FIXING",
      "FIXED",
      "VISUAL_PENDING",
      "VISUAL_FILLING",
      "COMPLETED",
      "FAILED",
      "SKIPPED",
    ],
    [
      "pending",
      "assigned",
      "generating",
      "generated",
      "reviewing",
      "review_passed",
      "review_failed",
      "fixing",
      "fixed",
      "visual_pending",
      "visual_filling",
      "completed",
      "failed",
      "skipped",
    ]
  );
});

describe("VisualSlotStatus", () => {
  runEnumTests(
    () => VisualSlotStatus,
    [
      "PENDING",
      "QUEUED",
      "GENERATING",
      "FILLED",
      "FAILED",
      "SKIPPED",
      "PLACEHOLDER",
    ],
    [
      "pending",
      "queued",
      "generating",
      "filled",
      "failed",
      "skipped",
      "placeholder",
    ]
  );
});

describe("EditSessionStatus", () => {
  runEnumTests(
    () => EditSessionStatus,
    [
      "IDLE",
      "AWAITING_INPUT",
      "PROCESSING",
      "AWAITING_CONFIRM",
      "EXECUTING",
      "PAUSED",
    ],
    [
      "idle",
      "awaiting_input",
      "processing",
      "awaiting_confirm",
      "executing",
      "paused",
    ]
  );
});

describe("SubAgentStatus", () => {
  runEnumTests(
    () => SubAgentStatus,
    [
      "IDLE",
      "CREATED",
      "RUNNING",
      "AWAITING_MERGE",
      "MERGED",
      "FAILED",
      "CANCELLED",
    ],
    [
      "idle",
      "created",
      "running",
      "awaiting_merge",
      "merged",
      "failed",
      "cancelled",
    ]
  );
});

describe("ReviewStatus", () => {
  runEnumTests(
    () => ReviewStatus,
    [
      "PENDING",
      "CAPTURING",
      "ANALYZING",
      "AWAITING_DECISION",
      "PASSED",
      "FAILED",
      "SKIPPED",
    ],
    [
      "pending",
      "capturing",
      "analyzing",
      "awaiting_decision",
      "passed",
      "failed",
      "skipped",
    ]
  );
});

describe("isValidDesignPhase", () => {
  runValidatorTests(() => isValidDesignPhase, () => DesignPhase);
});

describe("isValidSlideStatus", () => {
  runValidatorTests(() => isValidSlideStatus, () => SlideStatus);
});

describe("isValidVisualSlotStatus", () => {
  runValidatorTests(() => isValidVisualSlotStatus, () => VisualSlotStatus);
});

describe("isValidEditSessionStatus", () => {
  runValidatorTests(() => isValidEditSessionStatus, () => EditSessionStatus);
});

describe("isValidSubAgentStatus", () => {
  runValidatorTests(() => isValidSubAgentStatus, () => SubAgentStatus);
});

describe("isValidReviewStatus", () => {
  runValidatorTests(() => isValidReviewStatus, () => ReviewStatus);
});

describe("DesignLoopStatus", () => {
  it("aliases AgentStatus from runtime", () => {
    expect(DesignLoopStatus).toBe(AgentStatus);
    expect(DesignLoopStatus).toBe(runtimeMocks.AgentStatus);
  });
});

describe("AgentStatus", () => {
  it("re-exports runtime AgentStatus", () => {
    expect(AgentStatus).toBe(runtimeMocks.AgentStatus);
    expect(Object.values(AgentStatus)).toEqual(
      Object.values(runtimeMocks.AgentStatus)
    );
  });
});

describe("StepStatus", () => {
  it("re-exports runtime StepStatus", () => {
    expect(StepStatus).toBe(runtimeMocks.StepStatus);
    expect(Object.values(StepStatus)).toEqual(
      Object.values(runtimeMocks.StepStatus)
    );
  });
});

describe("isValidAgentStatus", () => {
  it("re-exports runtime validator", () => {
    expect(isValidAgentStatus).toBe(runtimeMocks.isValidAgentStatus);
  });

  runValidatorTests(() => isValidAgentStatus, () => AgentStatus);
});

describe("isValidStepStatus", () => {
  it("re-exports runtime validator", () => {
    expect(isValidStepStatus).toBe(runtimeMocks.isValidStepStatus);
  });

  runValidatorTests(() => isValidStepStatus, () => StepStatus);
});
