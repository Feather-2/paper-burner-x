import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedMakeSecureTimestampedId = vi.hoisted(() => vi.fn(() => "plan_mock_id"));
const mockedStepStatus = vi.hoisted(() => ({
  PENDING: "pending",
  DONE: "done",
}));
const mockedIsValidStepStatus = vi.hoisted(() =>
  vi.fn((value) => value === mockedStepStatus.PENDING || value === mockedStepStatus.DONE)
);

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    makeSecureTimestampedId: mockedMakeSecureTimestampedId,
  };
});

vi.mock(
  "../../../../../js/agents/runtime/core/agent-status.js",
  () => ({
    StepStatus: mockedStepStatus,
    isValidStepStatus: mockedIsValidStepStatus,
  }),
  { virtual: true }
);

import {
  PLAN_SCHEMA_VERSION,
  PLAN_ARTIFACT_TYPE,
  PlanLifecycleStatus,
  isValidPlanLifecycleStatus,
  canTransitionPlanLifecycle,
  setPlanLifecycleStatus,
} from "../../../../../js/agents/plugins/plan/plan-store.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

const createBasePlan = (overrides = {}) => ({
  lifecycleStatus: PlanLifecycleStatus.DRAFT,
  title: "Plan",
  ...overrides,
});

const createDeepMeta = (depth = 5) => {
  const root = { level: 0 };
  let node = root;
  for (let i = 1; i < depth; i += 1) {
    node.next = { level: i };
    node = node.next;
  }
  return root;
};

describe("PLAN_SCHEMA_VERSION", () => {
  it("matches the expected schema version", () => {
    expect(PLAN_SCHEMA_VERSION).toBe("0.1");
  });
});

describe("PLAN_ARTIFACT_TYPE", () => {
  it("matches the expected artifact type", () => {
    expect(PLAN_ARTIFACT_TYPE).toBe("plan.json");
  });
});

describe("PlanLifecycleStatus", () => {
  it("contains the full set of lifecycle values", () => {
    const values = Object.values(PlanLifecycleStatus).slice().sort();
    expect(values).toEqual(
      [
        "draft",
        "approved",
        "in_progress",
        "completed",
        "failed",
        "cancelled",
      ]
        .slice()
        .sort()
    );
  });

  it("is frozen to prevent mutation", () => {
    expect(Object.isFrozen(PlanLifecycleStatus)).toBe(true);
  });
});

describe("isValidPlanLifecycleStatus", () => {
  it("accepts all known lifecycle statuses", () => {
    Object.values(PlanLifecycleStatus).forEach((status) => {
      expect(isValidPlanLifecycleStatus(status)).toBe(true);
    });
  });

  it("rejects empty, whitespace, and non-matching values", () => {
    const invalidValues = [
      null,
      undefined,
      "",
      "   ",
      "draft ",
      "unknown",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "0",
      [],
      {},
      ["draft"],
      { 0: "draft", length: 1 },
    ];

    invalidValues.forEach((value) => {
      expect(isValidPlanLifecycleStatus(value)).toBe(false);
    });
  });

  it("returns false for very long strings", () => {
    const longValue = "x".repeat(10000);
    expect(isValidPlanLifecycleStatus(longValue)).toBe(false);
  });
});

describe("canTransitionPlanLifecycle", () => {
  it("allows valid transitions and same-state moves", () => {
    const validTransitions = [
      [PlanLifecycleStatus.DRAFT, PlanLifecycleStatus.APPROVED],
      [PlanLifecycleStatus.DRAFT, PlanLifecycleStatus.CANCELLED],
      [PlanLifecycleStatus.APPROVED, PlanLifecycleStatus.IN_PROGRESS],
      [PlanLifecycleStatus.IN_PROGRESS, PlanLifecycleStatus.COMPLETED],
      [PlanLifecycleStatus.IN_PROGRESS, PlanLifecycleStatus.FAILED],
      [PlanLifecycleStatus.IN_PROGRESS, PlanLifecycleStatus.CANCELLED],
    ];

    validTransitions.forEach(([from, to]) => {
      expect(canTransitionPlanLifecycle(from, to)).toBe(true);
    });

    expect(
      canTransitionPlanLifecycle(
        PlanLifecycleStatus.COMPLETED,
        PlanLifecycleStatus.COMPLETED
      )
    ).toBe(true);
  });

  it("rejects invalid transitions", () => {
    const invalidTransitions = [
      [PlanLifecycleStatus.COMPLETED, PlanLifecycleStatus.APPROVED],
      [PlanLifecycleStatus.FAILED, PlanLifecycleStatus.DRAFT],
      [PlanLifecycleStatus.APPROVED, PlanLifecycleStatus.COMPLETED],
      [PlanLifecycleStatus.CANCELLED, PlanLifecycleStatus.IN_PROGRESS],
    ];

    invalidTransitions.forEach(([from, to]) => {
      expect(canTransitionPlanLifecycle(from, to)).toBe(false);
    });
  });

  it("normalizes blank and invalid inputs with fallbacks", () => {
    expect(canTransitionPlanLifecycle(null, PlanLifecycleStatus.APPROVED)).toBe(true);
    expect(canTransitionPlanLifecycle("   ", PlanLifecycleStatus.CANCELLED)).toBe(true);
    expect(canTransitionPlanLifecycle("unknown", PlanLifecycleStatus.APPROVED)).toBe(true);
    expect(canTransitionPlanLifecycle(PlanLifecycleStatus.DRAFT, "")).toBe(false);
    expect(canTransitionPlanLifecycle(PlanLifecycleStatus.DRAFT, "   ")).toBe(false);
    expect(canTransitionPlanLifecycle(PlanLifecycleStatus.DRAFT, "unknown")).toBe(false);
  });

  it("handles numeric and object inputs safely", () => {
    expect(canTransitionPlanLifecycle(0, PlanLifecycleStatus.APPROVED)).toBe(true);
    expect(canTransitionPlanLifecycle(PlanLifecycleStatus.DRAFT, 0)).toBe(false);
    expect(
      canTransitionPlanLifecycle(PlanLifecycleStatus.DRAFT, Number.MAX_SAFE_INTEGER)
    ).toBe(false);
    expect(canTransitionPlanLifecycle(PlanLifecycleStatus.DRAFT, {})).toBe(false);
  });

  it("supports concurrent checks with mixed inputs", async () => {
    const [draftApproved, inProgressCompleted, invalidTarget] = await Promise.all([
      Promise.resolve().then(() =>
        canTransitionPlanLifecycle(PlanLifecycleStatus.DRAFT, PlanLifecycleStatus.APPROVED)
      ),
      Promise.resolve().then(() =>
        canTransitionPlanLifecycle(
          PlanLifecycleStatus.IN_PROGRESS,
          PlanLifecycleStatus.COMPLETED
        )
      ),
      Promise.resolve().then(() =>
        canTransitionPlanLifecycle(PlanLifecycleStatus.APPROVED, "unknown")
      ),
    ]);

    expect(draftApproved).toBe(true);
    expect(inProgressCompleted).toBe(true);
    expect(invalidTarget).toBe(false);
  });
});

describe("setPlanLifecycleStatus", () => {
  it("throws when plan is not an object", () => {
    const invalidPlans = [null, undefined, 0, "plan"];

    invalidPlans.forEach((plan) => {
      expect(() => setPlanLifecycleStatus(plan, PlanLifecycleStatus.DRAFT)).toThrow(TypeError);
    });
  });

  it("updates lifecycleStatus and updatedAt using numeric timestamps", () => {
    const plan = createBasePlan({ updatedAt: "old" });
    const result = setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED, { updatedAt: 0 });

    expect(result.lifecycleStatus).toBe(PlanLifecycleStatus.APPROVED);
    expect(result.updatedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(result.title).toBe(plan.title);
    expect(plan.lifecycleStatus).toBe(PlanLifecycleStatus.DRAFT);
  });

  it("uses legacy status when lifecycleStatus is missing", () => {
    const plan = { status: PlanLifecycleStatus.APPROVED };
    const result = setPlanLifecycleStatus(plan, PlanLifecycleStatus.IN_PROGRESS, { updatedAt: 1 });

    expect(result.lifecycleStatus).toBe(PlanLifecycleStatus.IN_PROGRESS);
    expect(result.status).toBe(PlanLifecycleStatus.APPROVED);
    expect(result.updatedAt).toBe("1970-01-01T00:00:00.001Z");
  });

  it("rejects invalid lifecycle status values", () => {
    const invalidStatuses = ["", "   ", "unknown", null, undefined, {}, []];

    invalidStatuses.forEach((status) => {
      expect(() => setPlanLifecycleStatus(createBasePlan(), status)).toThrow(/invalid status/i);
    });
  });

  it("rejects invalid transitions unless forced", () => {
    const plan = createBasePlan({ lifecycleStatus: PlanLifecycleStatus.COMPLETED });

    expect(() =>
      setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED, { updatedAt: 0 })
    ).toThrow(/invalid transition/i);

    const forced = setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED, {
      updatedAt: 0,
      force: true,
    });

    expect(forced.lifecycleStatus).toBe(PlanLifecycleStatus.APPROVED);
  });

  it("accepts numeric strings and negative timestamps for updatedAt", () => {
    const plan = createBasePlan();

    const numericStringResult = setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED, {
      updatedAt: "0",
    });

    expect(numericStringResult.updatedAt).toBe("0");

    const negativeResult = setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED, {
      updatedAt: -1,
    });

    expect(negativeResult.updatedAt).toBe("1969-12-31T23:59:59.999Z");
  });

  it("preserves large payloads and deep metadata", () => {
    const largePayload = "x".repeat(100000);
    const deepMeta = createDeepMeta(40);
    const plan = createBasePlan({ meta: deepMeta, blob: largePayload });

    const result = setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED, { updatedAt: 0 });

    expect(result.meta).toBe(deepMeta);
    expect(result.blob).toBe(largePayload);
    expect(result.blob.length).toBe(100000);
  });

  it("handles empty objects and array inputs as plans", () => {
    const emptyPlan = {};
    const emptyResult = setPlanLifecycleStatus(emptyPlan, PlanLifecycleStatus.APPROVED, {
      updatedAt: 0,
    });

    expect(emptyResult.lifecycleStatus).toBe(PlanLifecycleStatus.APPROVED);

    const arrayPlan = [];
    const arrayResult = setPlanLifecycleStatus(arrayPlan, PlanLifecycleStatus.APPROVED, {
      updatedAt: 0,
    });

    expect(arrayResult.lifecycleStatus).toBe(PlanLifecycleStatus.APPROVED);
    expect(arrayResult[0]).toBeUndefined();
  });

  it("supports concurrent updates without shared state", async () => {
    const base = createBasePlan({ meta: { tag: "x" } });

    const [approved, cancelled] = await Promise.all([
      Promise.resolve().then(() =>
        setPlanLifecycleStatus(base, PlanLifecycleStatus.APPROVED, { updatedAt: 0 })
      ),
      Promise.resolve().then(() =>
        setPlanLifecycleStatus(base, PlanLifecycleStatus.CANCELLED, { updatedAt: 1 })
      ),
    ]);

    expect(approved.lifecycleStatus).toBe(PlanLifecycleStatus.APPROVED);
    expect(cancelled.lifecycleStatus).toBe(PlanLifecycleStatus.CANCELLED);
  });

  it("supports rapid sequential updates", () => {
    const base = createBasePlan();

    const approved = setPlanLifecycleStatus(base, PlanLifecycleStatus.APPROVED, { updatedAt: 0 });
    const inProgress = setPlanLifecycleStatus(approved, PlanLifecycleStatus.IN_PROGRESS, {
      updatedAt: 1,
    });
    const completed = setPlanLifecycleStatus(inProgress, PlanLifecycleStatus.COMPLETED, {
      updatedAt: 2,
    });

    expect(completed.lifecycleStatus).toBe(PlanLifecycleStatus.COMPLETED);
    expect(completed.updatedAt).toBe("1970-01-01T00:00:00.002Z");
  });
});
