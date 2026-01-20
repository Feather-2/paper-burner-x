import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAgentStatus = vi.hoisted(() =>
  Object.freeze({
    IDLE: "idle",
    RUNNING: "running",
    PAUSED: "paused",
    COMPLETED: "completed",
    FAILED: "failed",
  }),
);

const mockStepStatus = vi.hoisted(() =>
  Object.freeze({
    PENDING: "pending",
    IN_PROGRESS: "in_progress",
    COMPLETED: "completed",
    FAILED: "failed",
    CANCELLED: "cancelled",
  }),
);

const isValidAgentStatusMock = vi.hoisted(() =>
  vi.fn((value) => Object.values(mockAgentStatus).includes(value)),
);

const isValidStepStatusMock = vi.hoisted(() =>
  vi.fn((value) => Object.values(mockStepStatus).includes(value)),
);

const isAgentActiveMock = vi.hoisted(() =>
  vi.fn((value) => value === mockAgentStatus.RUNNING || value === mockAgentStatus.PAUSED),
);

const isAgentTerminalMock = vi.hoisted(() =>
  vi.fn((value) => value === mockAgentStatus.COMPLETED || value === mockAgentStatus.FAILED),
);

vi.mock("../../../../../js/agents/runtime/index.js", () => ({
  AgentStatus: mockAgentStatus,
  StepStatus: mockStepStatus,
  isValidAgentStatus: isValidAgentStatusMock,
  isValidStepStatus: isValidStepStatusMock,
  isAgentActive: isAgentActiveMock,
  isAgentTerminal: isAgentTerminalMock,
}));

import {
  PhaseStatus,
  GapStatus,
  GapPriority,
  TodoStatus,
  PlanNodeStatus,
  PlanNodeType,
  DecisionOutcome,
  DecisionStage,
  isValidGapPriority,
  isValidGapStatus,
  isValidTodoStatus,
  isValidPlanNodeStatus,
  isValidPlanNodeType,
  isValidDecisionOutcome,
  isValidDecisionStage,
  isValidPhaseStatus,
  AgentLoopStatus,
  isValidAgentLoopStatus,
  AgentStatus,
  StepStatus,
  isValidAgentStatus,
  isValidStepStatus,
  isAgentActive,
  isAgentTerminal,
} from "../../../../../js/agents/stages/deepsearch/states.js";

function makeDeepObject(depth) {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
}

const longString = "x".repeat(100000);
const hugeBuffer = new Uint8Array(1024 * 1024);
const deepObject = makeDeepObject(300);
const arrayLikeObject = { 0: "x", length: 1 };

const invalidValues = [
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
  "UNKNOWN",
  arrayLikeObject,
  longString,
  hugeBuffer,
  deepObject,
];

function runValidatorSuite(validator, validValues) {
  it("returns true for supported values", () => {
    validValues.forEach((value) => {
      expect(validator(value)).toBe(true);
    });
  });

  it("returns false for invalid and boundary values without throwing", () => {
    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = validator(value);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });

  it("handles concurrent calls without shared state", async () => {
    const inputs = [
      validValues[0],
      invalidValues[0],
      validValues[validValues.length - 1],
      invalidValues[1],
      validValues[Math.floor(validValues.length / 2)],
      invalidValues[2],
    ];

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => validator(input))),
    );

    const expected = inputs.map((input) => validValues.includes(input));
    expect(results).toEqual(expected);
  });

  it("handles rapid consecutive calls consistently", () => {
    const inputs = [
      invalidValues[3],
      validValues[0],
      invalidValues[4],
      validValues[validValues.length - 1],
      invalidValues[5],
      validValues[0],
    ];

    const results = inputs.map((input) => validator(input));
    const expected = inputs.map((input) => validValues.includes(input));
    expect(results).toEqual(expected);
  });
}

beforeEach(() => {
  isValidAgentStatusMock.mockReset();
  isValidStepStatusMock.mockReset();
  isAgentActiveMock.mockReset();
  isAgentTerminalMock.mockReset();

  isValidAgentStatusMock.mockImplementation((value) => Object.values(mockAgentStatus).includes(value));
  isValidStepStatusMock.mockImplementation((value) => Object.values(mockStepStatus).includes(value));
  isAgentActiveMock.mockImplementation(
    (value) => value === mockAgentStatus.RUNNING || value === mockAgentStatus.PAUSED,
  );
  isAgentTerminalMock.mockImplementation(
    (value) => value === mockAgentStatus.COMPLETED || value === mockAgentStatus.FAILED,
  );
});

describe("PhaseStatus", () => {
  it("exposes expected keys and values", () => {
    const expectedKeys = ["SCAN", "GAPS", "ROUND", "WRITE", "CONDENSE", "COMPLETED"];
    const expectedValues = ["scan", "gaps", "round", "write", "condense", "completed"];

    expect(Object.keys(PhaseStatus).sort()).toEqual([...expectedKeys].sort());
    expect(Object.values(PhaseStatus).sort()).toEqual([...expectedValues].sort());
  });

  it("is frozen and immutable", () => {
    expect(Object.isFrozen(PhaseStatus)).toBe(true);
    expect(PhaseStatus.UNKNOWN).toBeUndefined();
  });
});

describe("GapStatus", () => {
  it("exposes expected keys and values", () => {
    const expectedKeys = ["OPEN", "SEARCHING", "UNDERSTANDING", "FILLED", "BLOCKED", "STALE"];
    const expectedValues = [
      "open",
      "searching",
      "understanding",
      "filled",
      "blocked",
      "stale",
    ];

    expect(Object.keys(GapStatus).sort()).toEqual([...expectedKeys].sort());
    expect(Object.values(GapStatus).sort()).toEqual([...expectedValues].sort());
  });

  it("is frozen and immutable", () => {
    expect(Object.isFrozen(GapStatus)).toBe(true);
    expect(GapStatus.UNKNOWN).toBeUndefined();
  });
});

describe("GapPriority", () => {
  it("exposes expected keys and values", () => {
    const expectedKeys = ["HIGH", "MEDIUM", "LOW"];
    const expectedValues = ["high", "medium", "low"];

    expect(Object.keys(GapPriority).sort()).toEqual([...expectedKeys].sort());
    expect(Object.values(GapPriority).sort()).toEqual([...expectedValues].sort());
  });

  it("is frozen and immutable", () => {
    expect(Object.isFrozen(GapPriority)).toBe(true);
    expect(GapPriority.UNKNOWN).toBeUndefined();
  });
});

describe("TodoStatus", () => {
  it("exposes expected keys and values", () => {
    const expectedKeys = ["OPEN", "PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
    const expectedValues = ["open", "pending", "in_progress", "completed", "cancelled"];

    expect(Object.keys(TodoStatus).sort()).toEqual([...expectedKeys].sort());
    expect(Object.values(TodoStatus).sort()).toEqual([...expectedValues].sort());
  });

  it("is frozen and immutable", () => {
    expect(Object.isFrozen(TodoStatus)).toBe(true);
    expect(TodoStatus.UNKNOWN).toBeUndefined();
  });
});

describe("PlanNodeStatus", () => {
  it("exposes expected keys and values", () => {
    const expectedKeys = ["PENDING", "ACTIVE", "COMPLETED", "FAILED", "BLOCKED"];
    const expectedValues = ["pending", "active", "completed", "failed", "blocked"];

    expect(Object.keys(PlanNodeStatus).sort()).toEqual([...expectedKeys].sort());
    expect(Object.values(PlanNodeStatus).sort()).toEqual([...expectedValues].sort());
  });

  it("is frozen and immutable", () => {
    expect(Object.isFrozen(PlanNodeStatus)).toBe(true);
    expect(PlanNodeStatus.UNKNOWN).toBeUndefined();
  });
});

describe("PlanNodeType", () => {
  it("exposes expected keys and values", () => {
    const expectedKeys = ["GOAL", "SUBGOAL", "QUERY"];
    const expectedValues = ["goal", "subgoal", "query"];

    expect(Object.keys(PlanNodeType).sort()).toEqual([...expectedKeys].sort());
    expect(Object.values(PlanNodeType).sort()).toEqual([...expectedValues].sort());
  });

  it("is frozen and immutable", () => {
    expect(Object.isFrozen(PlanNodeType)).toBe(true);
    expect(PlanNodeType.UNKNOWN).toBeUndefined();
  });
});

describe("DecisionOutcome", () => {
  it("exposes expected keys and values", () => {
    const expectedKeys = ["SUCCESS", "FAIL", "PARTIAL", "UNKNOWN"];
    const expectedValues = ["success", "fail", "partial", "unknown"];

    expect(Object.keys(DecisionOutcome).sort()).toEqual([...expectedKeys].sort());
    expect(Object.values(DecisionOutcome).sort()).toEqual([...expectedValues].sort());
  });

  it("is frozen and immutable", () => {
    expect(Object.isFrozen(DecisionOutcome)).toBe(true);
    expect(DecisionOutcome.BAD).toBeUndefined();
  });
});

describe("DecisionStage", () => {
  it("exposes expected keys and values", () => {
    const expectedKeys = ["SCAN", "GAPS", "RETRIEVE", "UNDERSTAND", "WRITE", "CONDENSE", "UNKNOWN"];
    const expectedValues = [
      "scan",
      "gaps",
      "retrieve",
      "understand",
      "write",
      "condense",
      "unknown",
    ];

    expect(Object.keys(DecisionStage).sort()).toEqual([...expectedKeys].sort());
    expect(Object.values(DecisionStage).sort()).toEqual([...expectedValues].sort());
  });

  it("is frozen and immutable", () => {
    expect(Object.isFrozen(DecisionStage)).toBe(true);
    expect(DecisionStage.BAD).toBeUndefined();
  });
});

describe("AgentStatus", () => {
  it("re-exports runtime AgentStatus", () => {
    expect(AgentStatus).toBe(mockAgentStatus);
  });

  it("exposes expected keys and values", () => {
    const expectedKeys = ["IDLE", "RUNNING", "PAUSED", "COMPLETED", "FAILED"];
    const expectedValues = ["idle", "running", "paused", "completed", "failed"];

    expect(Object.keys(AgentStatus).sort()).toEqual([...expectedKeys].sort());
    expect(Object.values(AgentStatus).sort()).toEqual([...expectedValues].sort());
    expect(Object.isFrozen(AgentStatus)).toBe(true);
  });
});

describe("StepStatus", () => {
  it("re-exports runtime StepStatus", () => {
    expect(StepStatus).toBe(mockStepStatus);
  });

  it("exposes expected keys and values", () => {
    const expectedKeys = ["PENDING", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED"];
    const expectedValues = ["pending", "in_progress", "completed", "failed", "cancelled"];

    expect(Object.keys(StepStatus).sort()).toEqual([...expectedKeys].sort());
    expect(Object.values(StepStatus).sort()).toEqual([...expectedValues].sort());
    expect(Object.isFrozen(StepStatus)).toBe(true);
  });
});

describe("AgentLoopStatus", () => {
  it("aliases AgentStatus for backward compatibility", () => {
    expect(AgentLoopStatus).toBe(AgentStatus);
    expect(Object.isFrozen(AgentLoopStatus)).toBe(true);
  });
});

describe("isValidGapPriority", () => {
  runValidatorSuite(isValidGapPriority, Object.values(GapPriority));
});

describe("isValidGapStatus", () => {
  runValidatorSuite(isValidGapStatus, Object.values(GapStatus));
});

describe("isValidTodoStatus", () => {
  runValidatorSuite(isValidTodoStatus, Object.values(TodoStatus));
});

describe("isValidPlanNodeStatus", () => {
  runValidatorSuite(isValidPlanNodeStatus, Object.values(PlanNodeStatus));
});

describe("isValidPlanNodeType", () => {
  runValidatorSuite(isValidPlanNodeType, Object.values(PlanNodeType));
});

describe("isValidDecisionOutcome", () => {
  runValidatorSuite(isValidDecisionOutcome, Object.values(DecisionOutcome));
});

describe("isValidDecisionStage", () => {
  runValidatorSuite(isValidDecisionStage, Object.values(DecisionStage));
});

describe("isValidPhaseStatus", () => {
  runValidatorSuite(isValidPhaseStatus, Object.values(PhaseStatus));
});

describe("isValidAgentStatus", () => {
  it("re-exports runtime validator", () => {
    expect(isValidAgentStatus).toBe(isValidAgentStatusMock);
  });

  runValidatorSuite(isValidAgentStatus, Object.values(mockAgentStatus));
});

describe("isValidStepStatus", () => {
  it("re-exports runtime validator", () => {
    expect(isValidStepStatus).toBe(isValidStepStatusMock);
  });

  runValidatorSuite(isValidStepStatus, Object.values(mockStepStatus));
});

describe("isValidAgentLoopStatus", () => {
  it("delegates to isValidAgentStatus", () => {
    isValidAgentStatusMock.mockReturnValueOnce(true);
    const value = mockAgentStatus.IDLE;
    const result = isValidAgentLoopStatus(value);

    expect(result).toBe(true);
    expect(isValidAgentStatusMock).toHaveBeenCalledWith(value);
  });

  runValidatorSuite(isValidAgentLoopStatus, Object.values(mockAgentStatus));
});

describe("isAgentActive", () => {
  it("re-exports runtime helper", () => {
    expect(isAgentActive).toBe(isAgentActiveMock);
  });

  it("returns true for active agent states", () => {
    expect(isAgentActive(mockAgentStatus.RUNNING)).toBe(true);
    expect(isAgentActive(mockAgentStatus.PAUSED)).toBe(true);
  });

  it("returns false for inactive and boundary values without throwing", () => {
    const values = [
      mockAgentStatus.IDLE,
      mockAgentStatus.COMPLETED,
      mockAgentStatus.FAILED,
      ...invalidValues,
    ];

    values.forEach((value) => {
      let result;
      expect(() => {
        result = isAgentActive(value);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });

  it("handles concurrent calls without shared state", async () => {
    const inputs = [
      mockAgentStatus.RUNNING,
      mockAgentStatus.PAUSED,
      mockAgentStatus.IDLE,
      null,
      mockAgentStatus.COMPLETED,
    ];

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => isAgentActive(input))),
    );

    expect(results).toEqual([true, true, false, false, false]);
  });

  it("handles rapid consecutive calls consistently", () => {
    const inputs = [
      mockAgentStatus.RUNNING,
      invalidValues[0],
      mockAgentStatus.PAUSED,
      mockAgentStatus.FAILED,
      invalidValues[1],
    ];

    const results = inputs.map((input) => isAgentActive(input));
    expect(results).toEqual([true, false, true, false, false]);
  });
});

describe("isAgentTerminal", () => {
  it("re-exports runtime helper", () => {
    expect(isAgentTerminal).toBe(isAgentTerminalMock);
  });

  it("returns true for terminal agent states", () => {
    expect(isAgentTerminal(mockAgentStatus.COMPLETED)).toBe(true);
    expect(isAgentTerminal(mockAgentStatus.FAILED)).toBe(true);
  });

  it("returns false for non-terminal and boundary values without throwing", () => {
    const values = [
      mockAgentStatus.IDLE,
      mockAgentStatus.RUNNING,
      mockAgentStatus.PAUSED,
      ...invalidValues,
    ];

    values.forEach((value) => {
      let result;
      expect(() => {
        result = isAgentTerminal(value);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });

  it("handles concurrent calls without shared state", async () => {
    const inputs = [
      mockAgentStatus.COMPLETED,
      mockAgentStatus.FAILED,
      mockAgentStatus.RUNNING,
      undefined,
      mockAgentStatus.IDLE,
    ];

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => isAgentTerminal(input))),
    );

    expect(results).toEqual([true, true, false, false, false]);
  });

  it("handles rapid consecutive calls consistently", () => {
    const inputs = [
      mockAgentStatus.COMPLETED,
      invalidValues[0],
      mockAgentStatus.RUNNING,
      mockAgentStatus.FAILED,
      invalidValues[1],
    ];

    const results = inputs.map((input) => isAgentTerminal(input));
    expect(results).toEqual([true, false, false, true, false]);
  });
});
