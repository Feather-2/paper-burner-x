import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => "x".repeat(1024 * 1024)),
}));

import { readFileSync } from "node:fs";

import AgentStatusDefault, {
  AgentStatus,
  StepStatus,
  isValidAgentStatus,
  isValidStepStatus,
  isAgentActive,
  isAgentTerminal,
} from "../../../../../js/agents/runtime/core/agent-status.js";

const buildDeepObject = (depth) => {
  let current = {};
  for (let i = 0; i < depth; i += 1) {
    current = { child: current };
  }
  return current;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AgentStatus", () => {
  it("exposes a frozen enum with expected values", () => {
    expect(Object.isFrozen(AgentStatus)).toBe(true);
    expect(AgentStatus).toEqual({
      IDLE: "idle",
      RUNNING: "running",
      PAUSED: "paused",
      COMPLETED: "completed",
      FAILED: "failed",
    });
  });

  it("rejects mutation attempts", () => {
    const mutated = Reflect.set(AgentStatus, "NEW", "new");
    expect(mutated).toBe(false);
    expect(AgentStatus.NEW).toBeUndefined();
  });
});

describe("StepStatus", () => {
  it("exposes a frozen enum with expected values", () => {
    expect(Object.isFrozen(StepStatus)).toBe(true);
    expect(StepStatus).toEqual({
      PENDING: "pending",
      IN_PROGRESS: "in_progress",
      COMPLETED: "completed",
      FAILED: "failed",
      CANCELLED: "cancelled",
    });
  });

  it("rejects mutation attempts", () => {
    const mutated = Reflect.set(StepStatus, "NEW", "new");
    expect(mutated).toBe(false);
    expect(StepStatus.NEW).toBeUndefined();
  });
});

describe("isValidAgentStatus", () => {
  it("accepts valid agent statuses", () => {
    const values = Object.values(AgentStatus);
    for (const value of values) {
      expect(isValidAgentStatus(value)).toBe(true);
    }
  });

  it("rejects step-only statuses", () => {
    expect(isValidAgentStatus(StepStatus.PENDING)).toBe(false);
    expect(isValidAgentStatus(StepStatus.IN_PROGRESS)).toBe(false);
    expect(isValidAgentStatus(StepStatus.CANCELLED)).toBe(false);
  });

  it("returns false for boundary and type edge values", () => {
    const arrayLike = { 0: "idle", length: 1 };
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
      arrayLike,
    ];

    for (const value of invalidValues) {
      expect(isValidAgentStatus(value)).toBe(false);
    }
  });

  it("handles large and deep inputs", () => {
    const hugeFile = readFileSync("huge.bin", "utf8");
    const longString = "x".repeat(200000);
    const deepObject = buildDeepObject(600);

    expect(isValidAgentStatus(hugeFile)).toBe(false);
    expect(isValidAgentStatus(longString)).toBe(false);
    expect(isValidAgentStatus(deepObject)).toBe(false);
    expect(readFileSync).toHaveBeenCalledWith("huge.bin", "utf8");
  });

  it("handles concurrent calls safely", async () => {
    const inputs = [
      AgentStatus.IDLE,
      AgentStatus.RUNNING,
      StepStatus.PENDING,
      null,
      "not-a-status",
    ];

    const results = await Promise.all(inputs.map((value) => Promise.resolve(isValidAgentStatus(value))));
    expect(results).toEqual([true, true, false, false, false]);
  });
});

describe("isValidStepStatus", () => {
  it("accepts valid step statuses", () => {
    const values = Object.values(StepStatus);
    for (const value of values) {
      expect(isValidStepStatus(value)).toBe(true);
    }
  });

  it("rejects agent-only statuses", () => {
    expect(isValidStepStatus(AgentStatus.IDLE)).toBe(false);
    expect(isValidStepStatus(AgentStatus.RUNNING)).toBe(false);
    expect(isValidStepStatus(AgentStatus.PAUSED)).toBe(false);
  });

  it("returns false for empty and mismatched inputs", () => {
    expect(isValidStepStatus(null)).toBe(false);
    expect(isValidStepStatus(undefined)).toBe(false);
    expect(isValidStepStatus("")).toBe(false);
    expect(isValidStepStatus(" ")).toBe(false);
    expect(isValidStepStatus(0)).toBe(false);
    expect(isValidStepStatus("0")).toBe(false);
  });

  it("handles rapid consecutive calls", () => {
    let trueCount = 0;
    let falseCount = 0;

    for (let i = 0; i < 200; i += 1) {
      const value = i % 2 === 0 ? StepStatus.COMPLETED : "missing";
      if (isValidStepStatus(value)) {
        trueCount += 1;
      } else {
        falseCount += 1;
      }
    }

    expect(trueCount).toBe(100);
    expect(falseCount).toBe(100);
  });
});

describe("isAgentActive", () => {
  it("returns true only for running or paused", () => {
    expect(isAgentActive(AgentStatus.RUNNING)).toBe(true);
    expect(isAgentActive(AgentStatus.PAUSED)).toBe(true);
    expect(isAgentActive(AgentStatus.IDLE)).toBe(false);
    expect(isAgentActive(AgentStatus.COMPLETED)).toBe(false);
    expect(isAgentActive(AgentStatus.FAILED)).toBe(false);
  });

  it("returns false for invalid inputs", () => {
    expect(isAgentActive(null)).toBe(false);
    expect(isAgentActive(undefined)).toBe(false);
    expect(isAgentActive(" ")).toBe(false);
    expect(isAgentActive(0)).toBe(false);
    expect(isAgentActive(StepStatus.PENDING)).toBe(false);
  });
});

describe("isAgentTerminal", () => {
  it("returns true only for completed or failed", () => {
    expect(isAgentTerminal(AgentStatus.COMPLETED)).toBe(true);
    expect(isAgentTerminal(AgentStatus.FAILED)).toBe(true);
    expect(isAgentTerminal(AgentStatus.IDLE)).toBe(false);
    expect(isAgentTerminal(AgentStatus.RUNNING)).toBe(false);
    expect(isAgentTerminal(AgentStatus.PAUSED)).toBe(false);
  });

  it("returns false for invalid inputs", () => {
    expect(isAgentTerminal(undefined)).toBe(false);
    expect(isAgentTerminal(null)).toBe(false);
    expect(isAgentTerminal([])).toBe(false);
    expect(isAgentTerminal({})).toBe(false);
    expect(isAgentTerminal("completed ")).toBe(false);
  });
});

describe("default", () => {
  it("exports AgentStatus as the default export", () => {
    expect(AgentStatusDefault).toBe(AgentStatus);
  });

  it("preserves the frozen enum behavior", () => {
    const mutated = Reflect.set(AgentStatusDefault, "TEMP", "temp");
    expect(mutated).toBe(false);
    expect(AgentStatusDefault.TEMP).toBeUndefined();
  });
});
