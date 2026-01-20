import { describe, it, expect, vi, beforeEach } from "vitest";

const sharedMocks = vi.hoisted(() => {
  const state = { idCounter: 0 };

  const defaultToNonEmptyString = (value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  };

  const defaultIsPlainObject = (value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const toNonEmptyString = vi.fn(defaultToNonEmptyString);
  const isPlainObject = vi.fn(defaultIsPlainObject);
  const makeSecureTimestampedId = vi.fn((prefix = "id") => `${prefix}_${++state.idCounter}`);

  return {
    state,
    defaultToNonEmptyString,
    defaultIsPlainObject,
    toNonEmptyString,
    isPlainObject,
    makeSecureTimestampedId,
  };
});

const statusMocks = vi.hoisted(() => {
  const StepStatus = Object.freeze({
    PENDING: "pending",
    IN_PROGRESS: "in_progress",
    COMPLETED: "completed",
    FAILED: "failed",
    CANCELLED: "cancelled",
  });

  const isValidStepStatus = vi.fn((value) => Object.values(StepStatus).includes(value));

  return { StepStatus, isValidStepStatus };
});

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  isPlainObject: sharedMocks.isPlainObject,
  toNonEmptyString: sharedMocks.toNonEmptyString,
  makeSecureTimestampedId: sharedMocks.makeSecureTimestampedId,
}));

vi.mock(
  "../../../../../js/agents/plugins/core/agent-status.js",
  () => ({
    StepStatus: statusMocks.StepStatus,
    isValidStepStatus: statusMocks.isValidStepStatus,
  }),
  { virtual: true },
);

import {
  PLAN_SCHEMA_VERSION,
  PLAN_ARTIFACT_TYPE,
  PlanLifecycleStatus,
  isValidPlanLifecycleStatus,
  canTransitionPlanLifecycle,
  setPlanLifecycleStatus,
  createPlan,
  normalizePlanStep,
  findPlanStepIndex,
  setPlanStepStatus,
  savePlan,
  STRUCTURED_PLAN_SCHEMA_VERSION,
  createRequirementsAnalysis,
  createRequirement,
  createArchitecturalDecision,
  createPlanStep,
  createRisk,
  createCriticalFile,
  createStructuredPlan,
  validateStructuredPlan,
  structuredPlanToMarkdown,
} from "../../../../../js/agents/plugins/plan/index.js";

const ISO_EPOCH = "1970-01-01T00:00:00.000Z";
const FIXED_ISO = "2024-01-01T00:00:00.000Z";

const freezeTime = (iso = FIXED_ISO) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

const buildPlanStep = (overrides = {}) => ({
  stepId: "step_1",
  title: "Step 1",
  status: "pending",
  ...overrides,
});

const buildPlan = (overrides = {}) => ({
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  planId: "plan_1",
  runId: "run_1",
  title: "Plan",
  createdAt: FIXED_ISO,
  updatedAt: FIXED_ISO,
  lifecycleStatus: PlanLifecycleStatus.DRAFT,
  selectedStepIndex: 0,
  steps: [buildPlanStep()],
  ...overrides,
});

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  sharedMocks.state.idCounter = 0;
  sharedMocks.toNonEmptyString.mockImplementation(sharedMocks.defaultToNonEmptyString);
  sharedMocks.isPlainObject.mockImplementation(sharedMocks.defaultIsPlainObject);
  sharedMocks.makeSecureTimestampedId.mockImplementation((prefix = "id") => `${prefix}_${++sharedMocks.state.idCounter}`);
  statusMocks.isValidStepStatus.mockImplementation((value) => Object.values(statusMocks.StepStatus).includes(value));
});

describe("PLAN_SCHEMA_VERSION", () => {
  it("exports the expected schema version", () => {
    expect(PLAN_SCHEMA_VERSION).toBe("0.1");
  });
});

describe("PLAN_ARTIFACT_TYPE", () => {
  it("exports the default artifact type", () => {
    expect(PLAN_ARTIFACT_TYPE).toBe("plan.json");
  });
});

describe("PlanLifecycleStatus", () => {
  it("exposes lifecycle status values", () => {
    expect(PlanLifecycleStatus.DRAFT).toBe("draft");
    expect(PlanLifecycleStatus.APPROVED).toBe("approved");
    expect(PlanLifecycleStatus.IN_PROGRESS).toBe("in_progress");
    expect(PlanLifecycleStatus.COMPLETED).toBe("completed");
    expect(PlanLifecycleStatus.FAILED).toBe("failed");
    expect(PlanLifecycleStatus.CANCELLED).toBe("cancelled");
  });

  it("is frozen to prevent mutation", () => {
    expect(Object.isFrozen(PlanLifecycleStatus)).toBe(true);
  });
});

describe("isValidPlanLifecycleStatus", () => {
  it("returns true for known lifecycle values", () => {
    for (const value of Object.values(PlanLifecycleStatus)) {
      expect(isValidPlanLifecycleStatus(value)).toBe(true);
    }
  });

  it("rejects empty, whitespace, and invalid inputs", () => {
    const values = [null, undefined, "", "   ", "unknown", 0, -1, Number.MAX_SAFE_INTEGER];
    for (const value of values) {
      expect(isValidPlanLifecycleStatus(value)).toBe(false);
    }
  });

  it("handles concurrent checks", async () => {
    const inputs = [PlanLifecycleStatus.DRAFT, "approved", "nope", null];
    const results = await Promise.all(inputs.map((value) => Promise.resolve().then(() => isValidPlanLifecycleStatus(value))));
    expect(results).toEqual([true, true, false, false]);
  });
});

describe("canTransitionPlanLifecycle", () => {
  it("allows valid transitions and idempotent updates", () => {
    expect(canTransitionPlanLifecycle("draft", "approved")).toBe(true);
    expect(canTransitionPlanLifecycle("approved", "in_progress")).toBe(true);
    expect(canTransitionPlanLifecycle("in_progress", "completed")).toBe(true);
    expect(canTransitionPlanLifecycle("draft", "draft")).toBe(true);
    expect(canTransitionPlanLifecycle(null, "approved")).toBe(true);
    expect(canTransitionPlanLifecycle("unknown", "cancelled")).toBe(true);
  });

  it("rejects invalid transitions and targets", () => {
    expect(canTransitionPlanLifecycle("completed", "draft")).toBe(false);
    expect(canTransitionPlanLifecycle("draft", "   ")).toBe(false);
    expect(canTransitionPlanLifecycle("draft", 0)).toBe(false);
  });
});

describe("setPlanLifecycleStatus", () => {
  it("updates lifecycle status and timestamps", () => {
    const plan = buildPlan({ lifecycleStatus: PlanLifecycleStatus.DRAFT });
    const updated = setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED, { updatedAt: 0 });

    expect(updated.lifecycleStatus).toBe(PlanLifecycleStatus.APPROVED);
    expect(updated.updatedAt).toBe(ISO_EPOCH);
    expect(updated.createdAt).toBe(plan.createdAt);
    expect(updated).not.toBe(plan);
    expect(plan.lifecycleStatus).toBe(PlanLifecycleStatus.DRAFT);
  });

  it("uses legacy status and supports forced transitions", () => {
    const plan = buildPlan({ lifecycleStatus: undefined, status: PlanLifecycleStatus.APPROVED });
    const progressed = setPlanLifecycleStatus(plan, PlanLifecycleStatus.IN_PROGRESS, { updatedAt: 0 });

    expect(progressed.lifecycleStatus).toBe(PlanLifecycleStatus.IN_PROGRESS);

    expect(() => setPlanLifecycleStatus(progressed, PlanLifecycleStatus.DRAFT)).toThrow();
    const forced = setPlanLifecycleStatus(progressed, PlanLifecycleStatus.DRAFT, { force: true, updatedAt: 0 });
    expect(forced.lifecycleStatus).toBe(PlanLifecycleStatus.DRAFT);
  });

  it("throws for invalid input", () => {
    expect(() => setPlanLifecycleStatus(null, "draft")).toThrow(TypeError);
    expect(() => setPlanLifecycleStatus(buildPlan(), "   ")).toThrow();
  });
});

describe("createPlan", () => {
  it("creates a normalized plan with defaults", () => {
    freezeTime();
    const plan = createPlan();

    expect(plan.schemaVersion).toBe(PLAN_SCHEMA_VERSION);
    expect(plan.kind).toBe("plan");
    expect(plan.planId).toBe("plan_1");
    expect(sharedMocks.makeSecureTimestampedId).toHaveBeenCalledWith("plan");
    expect(plan.runId).toBe("run_unknown");
    expect(plan.title).toBe("Plan");
    expect(plan.createdAt).toBe(FIXED_ISO);
    expect(plan.updatedAt).toBe(FIXED_ISO);
    expect(plan.lifecycleStatus).toBe(PlanLifecycleStatus.DRAFT);
    expect(plan.selectedStepIndex).toBe(0);
    expect(plan.steps).toEqual([]);
    expect(plan.meta).toBeUndefined();
  });

  it("normalizes steps, clamps indices, and preserves meta", () => {
    const meta = { nested: { depth: { value: 1 } } };
    const plan = createPlan({
      runId: "  run_123 ",
      planId: "  plan_custom ",
      title: "  My Plan  ",
      kind: "  custom  ",
      lifecycleStatus: "approved",
      steps: [
        { stepId: "", text: "  First  ", status: "nope", updatedAt: 0, meta: { note: "a" } },
        { stepId: "s2", title: "Second", status: "completed" },
      ],
      selectedStepIndex: 99,
      meta,
    });

    expect(plan.runId).toBe("run_123");
    expect(plan.planId).toBe("plan_custom");
    expect(plan.title).toBe("My Plan");
    expect(plan.kind).toBe("custom");
    expect(plan.lifecycleStatus).toBe("approved");
    expect(plan.selectedStepIndex).toBe(1);
    expect(plan.steps[0]).toMatchObject({
      stepId: "step_1",
      title: "First",
      status: "pending",
      updatedAt: ISO_EPOCH,
      meta: { note: "a" },
    });
    expect(plan.steps[1]).toMatchObject({ stepId: "s2", title: "Second", status: "completed" });
    expect(plan.meta).toBe(meta);
  });

  it("handles boundary values and invalid types", () => {
    const negative = createPlan({
      steps: [{ title: "A" }, { title: "B" }],
      selectedStepIndex: -1,
    });
    expect(negative.selectedStepIndex).toBe(0);

    const stringIndex = createPlan({
      steps: [{ title: "Only" }],
      selectedStepIndex: "2",
    });
    expect(stringIndex.selectedStepIndex).toBe(0);

    const objectSteps = createPlan({
      steps: {},
      selectedStepIndex: 1,
      title: "   ",
    });
    expect(objectSteps.steps).toEqual([]);
    expect(objectSteps.selectedStepIndex).toBe(0);
    expect(objectSteps.title).toBe("Plan");
  });

  it("supports concurrent creation without shared state", async () => {
    const [a, b, c] = await Promise.all([
      Promise.resolve().then(() => createPlan({ title: "A" })),
      Promise.resolve().then(() => createPlan({ title: "B" })),
      Promise.resolve().then(() => createPlan({ title: "C" })),
    ]);

    const ids = new Set([a.planId, b.planId, c.planId]);
    expect(ids.size).toBe(3);
    expect(a.title).toBe("A");
    expect(b.title).toBe("B");
    expect(c.title).toBe("C");
  });
});

describe("normalizePlanStep", () => {
  it("normalizes fields and timestamps", () => {
    const step = normalizePlanStep({
      stepId: "s1",
      title: "Title",
      status: "completed",
      createdAt: 0,
      updatedAt: 0,
      meta: { ok: true },
    });

    expect(step).toMatchObject({
      stepId: "s1",
      title: "Title",
      status: "completed",
      createdAt: ISO_EPOCH,
      updatedAt: ISO_EPOCH,
      meta: { ok: true },
    });
  });

  it("falls back for invalid input and status", () => {
    const step = normalizePlanStep({ text: "  From Text  ", status: "bad", meta: [] }, { fallbackIndex: 1 });
    expect(step.stepId).toBe("step_2");
    expect(step.title).toBe("From Text");
    expect(step.status).toBe("pending");
    expect(step.meta).toBeUndefined();
  });

  it("handles null and empty inputs", () => {
    const step = normalizePlanStep(null, { fallbackIndex: 0 });
    expect(step.stepId).toBe("step_1");
    expect(step.title).toBe("step_1");
    expect(step.status).toBe("pending");
  });
});

describe("findPlanStepIndex", () => {
  it("finds numeric indexes and respects bounds", () => {
    const plan = { steps: [{ stepId: "a" }, { stepId: "b" }] };
    expect(findPlanStepIndex(plan, 0)).toBe(0);
    expect(findPlanStepIndex(plan, 1.7)).toBe(1);
    expect(findPlanStepIndex(plan, -1)).toBe(-1);
    expect(findPlanStepIndex(plan, Number.MAX_SAFE_INTEGER)).toBe(-1);
  });

  it("finds steps by id and handles whitespace", () => {
    const plan = { steps: [{ stepId: "1" }, { stepId: "b" }] };
    expect(findPlanStepIndex(plan, "1")).toBe(0);
    expect(findPlanStepIndex(plan, "   ")).toBe(-1);
    expect(findPlanStepIndex(plan, "missing")).toBe(-1);
  });

  it("returns -1 for invalid plans or steps", () => {
    expect(findPlanStepIndex(null, 0)).toBe(-1);
    expect(findPlanStepIndex({ steps: {} }, "a")).toBe(-1);
  });
});

describe("setPlanStepStatus", () => {
  it("updates a step status and selects it by default", () => {
    const plan = buildPlan({
      steps: [
        { stepId: "s1", title: "One", status: "pending" },
        { stepId: "s2", title: "Two", status: "pending" },
      ],
      selectedStepIndex: 0,
    });

    const updated = setPlanStepStatus(plan, "s2", "completed", { updatedAt: 0 });

    expect(updated.steps[1].status).toBe("completed");
    expect(updated.steps[1].updatedAt).toBe(ISO_EPOCH);
    expect(updated.steps[1].createdAt).toBe(ISO_EPOCH);
    expect(updated.selectedStepIndex).toBe(1);
    expect(updated.updatedAt).toBe(ISO_EPOCH);
    expect(plan.steps[1].status).toBe("pending");
  });

  it("respects select=false and preserves createdAt", () => {
    const plan = buildPlan({
      steps: [
        { stepId: "s1", title: "One", status: "pending", createdAt: "2023-01-01T00:00:00.000Z" },
      ],
      selectedStepIndex: 0,
    });

    const updated = setPlanStepStatus(plan, "s1", "completed", { updatedAt: 0, select: false });

    expect(updated.selectedStepIndex).toBe(0);
    expect(updated.steps[0].createdAt).toBe("2023-01-01T00:00:00.000Z");
  });

  it("returns the original plan when the step is missing", () => {
    const plan = buildPlan({ steps: [{ stepId: "s1", status: "pending" }] });
    const result = setPlanStepStatus(plan, "missing", "completed");
    expect(result).toBe(plan);
  });

  it("throws on invalid input", () => {
    expect(() => setPlanStepStatus(null, 0, "completed")).toThrow(TypeError);
    expect(() => setPlanStepStatus({ steps: "nope" }, 0, "completed")).toThrow(TypeError);
    expect(() => setPlanStepStatus(buildPlan(), 0, "   ")).toThrow();
  });
});

describe("savePlan", () => {
  it("requires a runStore with saveArtifact", async () => {
    await expect(savePlan({})).rejects.toThrow(TypeError);
    await expect(savePlan({ runStore: {} })).rejects.toThrow(TypeError);
  });

  it("requires a runId and plan object", async () => {
    const runStore = { saveArtifact: vi.fn() };
    await expect(savePlan({ runStore, plan: {} })).rejects.toThrow();
    await expect(savePlan({ runStore, runId: "run_1", plan: null })).rejects.toThrow();
  });

  it("uses plan.toJSON and passes artifact options", async () => {
    const runStore = { saveArtifact: vi.fn().mockResolvedValue({ ok: true }) };
    const plan = { runId: "run_1", toJSON: () => ({ ok: true }) };

    const result = await savePlan({ runStore, plan, artifactId: "artifact_1" });

    expect(runStore.saveArtifact).toHaveBeenCalledWith(
      "run_1",
      PLAN_ARTIFACT_TYPE,
      { ok: true },
      { artifactId: "artifact_1", mime: "application/json" },
    );
    expect(result).toEqual({ ok: true });
  });

  it("omits empty artifactId and supports large payloads concurrently", async () => {
    const runStore = { saveArtifact: vi.fn().mockResolvedValue({ ok: true }) };
    const large = "x".repeat(200000);

    await savePlan({ runStore, runId: "run_a", plan: { runId: "run_a", content: large }, artifactId: "   " });

    const options = runStore.saveArtifact.mock.calls[0][3];
    expect(options).toEqual({ mime: "application/json" });

    const results = await Promise.all([
      savePlan({ runStore, plan: { runId: "run_b", content: large } }),
      savePlan({ runStore, plan: { runId: "run_c", content: large } }),
    ]);

    expect(results).toHaveLength(2);
    expect(runStore.saveArtifact).toHaveBeenCalledTimes(3);
    expect(runStore.saveArtifact.mock.calls[1][2].content.length).toBe(200000);
  });
});

describe("STRUCTURED_PLAN_SCHEMA_VERSION", () => {
  it("exports the structured plan schema version", () => {
    expect(STRUCTURED_PLAN_SCHEMA_VERSION).toBe("1.0");
  });
});

describe("createRequirementsAnalysis", () => {
  it("creates an empty requirements analysis object", () => {
    expect(createRequirementsAnalysis()).toEqual({
      functional: [],
      nonFunctional: [],
      assumptions: [],
      clarifications: [],
      outOfScope: [],
    });
  });
});

describe("createRequirement", () => {
  it("creates a normalized requirement", () => {
    const req = createRequirement({
      id: "req_1",
      type: "constraint",
      description: "Need it",
      priority: "must_have",
      acceptanceCriteria: ["a", 1, null, "b"],
    });

    expect(req).toEqual({
      id: "req_1",
      type: "constraint",
      description: "Need it",
      priority: "must_have",
      acceptanceCriteria: ["a", "b"],
    });
  });

  it("handles invalid input and boundary strings", () => {
    freezeTime();
    const now = Date.now();

    const req = createRequirement(null);
    expect(req.id).toBe(`req_${now}`);
    expect(req.type).toBe("functional");
    expect(req.priority).toBe("should_have");
    expect(req.description).toBe("");
    expect(req.acceptanceCriteria).toEqual([]);

    const long = "a".repeat(50000);
    const trimmed = createRequirement({
      description: `  ${long}  `,
      type: "bad",
      priority: "bad",
      acceptanceCriteria: {},
    });

    expect(trimmed.description).toBe(long);
    expect(trimmed.type).toBe("functional");
    expect(trimmed.priority).toBe("should_have");
    expect(trimmed.acceptanceCriteria).toEqual([]);
  });
});

describe("createArchitecturalDecision", () => {
  it("creates a normalized architectural decision", () => {
    const decision = createArchitecturalDecision({
      id: "adr_1",
      title: "Use API",
      context: "ctx",
      decision: "do",
      rationale: "because",
      alternatives: ["a", 1],
      tradeoffs: ["t", null],
      consequences: ["c", 2],
    });

    expect(decision).toEqual({
      id: "adr_1",
      title: "Use API",
      context: "ctx",
      decision: "do",
      rationale: "because",
      alternatives: ["a"],
      tradeoffs: ["t"],
      consequences: ["c"],
    });
  });

  it("handles invalid inputs with defaults", () => {
    freezeTime();
    const now = Date.now();

    const decision = createArchitecturalDecision("bad");
    expect(decision.id).toBe(`adr_${now}`);
    expect(decision.title).toBe("");
    expect(decision.context).toBe("");
    expect(decision.decision).toBe("");
    expect(decision.rationale).toBe("");
    expect(decision.alternatives).toEqual([]);
    expect(decision.tradeoffs).toEqual([]);
    expect(decision.consequences).toEqual([]);
  });
});

describe("createPlanStep", () => {
  it("creates a normalized structured plan step", () => {
    const step = createPlanStep({
      stepId: "s1",
      title: "Title",
      description: "Desc",
      status: "completed",
      dependencies: ["a", 1],
      complexity: "high",
      files: ["file", {}],
      tools: ["tool", 2],
      outputs: ["out", null],
    });

    expect(step).toEqual({
      stepId: "s1",
      title: "Title",
      description: "Desc",
      status: "completed",
      dependencies: ["a"],
      complexity: "high",
      files: ["file"],
      tools: ["tool"],
      outputs: ["out"],
    });
  });

  it("handles invalid input and fallback indexes", () => {
    const step = createPlanStep(
      {
        stepId: "   ",
        status: "nope",
        complexity: "nope",
        dependencies: {},
        files: "bad",
      },
      { fallbackIndex: 2 },
    );

    expect(step.stepId).toBe("step_3");
    expect(step.status).toBe("pending");
    expect(step.complexity).toBe("medium");
    expect(step.dependencies).toEqual([]);
    expect(step.files).toEqual([]);
  });
});

describe("createRisk", () => {
  it("creates a normalized risk entry", () => {
    const risk = createRisk({
      id: "risk_1",
      category: "schedule",
      description: "delay",
      severity: "high",
      likelihood: "low",
      mitigation: "buffer",
      contingency: "plan b",
    });

    expect(risk).toEqual({
      id: "risk_1",
      category: "schedule",
      description: "delay",
      severity: "high",
      likelihood: "low",
      mitigation: "buffer",
      contingency: "plan b",
    });
  });

  it("defaults invalid fields and omits empty contingency", () => {
    freezeTime();
    const now = Date.now();

    const risk = createRisk({ category: "bad", severity: "bad", likelihood: "bad", contingency: "   " });
    expect(risk.id).toBe(`risk_${now}`);
    expect(risk.category).toBe("technical");
    expect(risk.severity).toBe("medium");
    expect(risk.likelihood).toBe("medium");
    expect("contingency" in risk).toBe(false);
  });
});

describe("createCriticalFile", () => {
  it("creates a normalized critical file entry", () => {
    const file = createCriticalFile({
      path: "src/app.js",
      action: "delete",
      reason: "cleanup",
      changes: ["a", 1, "b"],
    });

    expect(file).toEqual({
      path: "src/app.js",
      action: "delete",
      reason: "cleanup",
      changes: ["a", "b"],
    });
  });

  it("defaults invalid fields and handles empty input", () => {
    const file = createCriticalFile({ path: "  ", action: "invalid", reason: "   " });
    expect(file.path).toBe("");
    expect(file.action).toBe("modify");
    expect(file.reason).toBe("");
    expect(file.changes).toBeUndefined();

    const empty = createCriticalFile(null);
    expect(empty.path).toBe("");
    expect(empty.action).toBe("modify");
    expect(empty.reason).toBe("");
  });
});

describe("createStructuredPlan", () => {
  it("creates a structured plan with defaults", () => {
    freezeTime();
    const now = Date.now();

    const plan = createStructuredPlan();

    expect(plan.schemaVersion).toBe(STRUCTURED_PLAN_SCHEMA_VERSION);
    expect(plan.planId).toBe(`plan_${now}`);
    expect(plan.title).toBe("Implementation Plan");
    expect(plan.summary).toBe("");
    expect(plan.createdAt).toBe(FIXED_ISO);
    expect(plan.requirements).toEqual({
      functional: [],
      nonFunctional: [],
      assumptions: [],
      clarifications: [],
      outOfScope: [],
    });
    expect(plan.decisions).toEqual([]);
    expect(plan.steps).toEqual([]);
    expect(plan.risks).toEqual([]);
    expect(plan.criticalFiles).toEqual([]);
    expect(plan.meta).toBeUndefined();
  });

  it("normalizes nested data and preserves meta", () => {
    const meta = { level: { deep: { value: "ok" } } };
    const plan = createStructuredPlan({
      planId: "plan_custom",
      title: "Custom",
      summary: "Summary",
      createdAt: "2023-01-01T00:00:00.000Z",
      requirements: {
        functional: [{ description: "Do it", priority: "must_have" }],
        nonFunctional: [{ description: "Fast", priority: "nice_to_have" }],
        assumptions: ["A", 1],
        clarifications: ["C", {}],
        outOfScope: [],
      },
      decisions: [{ title: "Decision", alternatives: ["a", 2] }],
      steps: [{ title: "Step", status: "completed", files: ["file", 3] }],
      risks: [{ description: "risk", severity: "high", contingency: "backup" }],
      criticalFiles: [{ path: "src/app.js", action: "review", reason: "touch", changes: ["c1", 2] }],
      meta,
    });

    expect(plan.requirements.functional[0].type).toBe("functional");
    expect(plan.requirements.nonFunctional[0].type).toBe("non_functional");
    expect(plan.requirements.assumptions).toEqual(["A"]);
    expect(plan.requirements.clarifications).toEqual(["C"]);
    expect(plan.decisions[0].alternatives).toEqual(["a"]);
    expect(plan.steps[0].stepId).toBe("step_1");
    expect(plan.steps[0].files).toEqual(["file"]);
    expect(plan.risks[0].contingency).toBe("backup");
    expect(plan.criticalFiles[0].changes).toEqual(["c1"]);
    expect(plan.meta).toBe(meta);
  });
});

describe("validateStructuredPlan", () => {
  it("rejects non-object plans", () => {
    expect(validateStructuredPlan(null)).toEqual({ valid: false, errors: ["Plan must be an object"] });
  });

  it("reports missing fields and empty steps", () => {
    const result = validateStructuredPlan({ planId: "", title: " ", steps: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("planId is required");
    expect(result.errors).toContain("title is required");
    expect(result.errors).toContain("At least one step is required");
  });

  it("reports unknown step dependencies", () => {
    const result = validateStructuredPlan({
      planId: "plan_1",
      title: "Plan",
      steps: [{ stepId: "s1", dependencies: ["s2"] }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Step s1 has unknown dependency: s2");
  });

  it("accepts valid plans", () => {
    const result = validateStructuredPlan({
      planId: "plan_1",
      title: "Plan",
      steps: [
        { stepId: "s1", dependencies: [] },
        { stepId: "s2", dependencies: ["s1"] },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("structuredPlanToMarkdown", () => {
  it("renders a minimal plan summary", () => {
    const plan = {
      title: "Plan One",
      summary: "Summary text",
      requirements: createRequirementsAnalysis(),
      decisions: [],
      steps: [],
      risks: [],
      criticalFiles: [],
    };

    const md = structuredPlanToMarkdown(plan);
    expect(md).toContain("# Plan One");
    expect(md).toContain("Summary text");
    expect(md).not.toContain("## Requirements");
  });

  it("renders full markdown with escaping", () => {
    const plan = {
      title: "Plan *Alpha*",
      summary: "Use [link] and pipes | here",
      requirements: {
        functional: [
          {
            priority: "must_have",
            description: "Do *thing*",
            acceptanceCriteria: ["A&B"],
          },
        ],
        nonFunctional: [],
        assumptions: ["A > B"],
        clarifications: [],
        outOfScope: [],
      },
      decisions: [
        {
          title: "Use API",
          context: "Context",
          decision: "Decision",
          rationale: "Rationale",
          tradeoffs: ["fast", "cheap"],
        },
      ],
      steps: [
        {
          stepId: "step_1",
          title: "Step 1",
          description: "Do it",
          status: "pending",
          dependencies: [],
          complexity: "low",
          files: ["src/app.js"],
        },
      ],
      criticalFiles: [{ path: "src/app|main.js", action: "modify", reason: "line1\nline2" }],
      risks: [{ category: "technical", description: "Risk *desc*", severity: "high", mitigation: "Test" }],
    };

    const md = structuredPlanToMarkdown(plan);

    expect(md).toContain("# Plan \\*Alpha\\*");
    expect(md).toContain("Use \\[link\\] and pipes \\| here");
    expect(md).toContain("## Requirements");
    expect(md).toContain("## Architecture Decisions");
    expect(md).toContain("## Implementation Steps");
    expect(md).toContain("## Critical Files");
    expect(md).toContain("## Risks");
    expect(md).toContain("1. [o] **Step 1** [low]");
    expect(md).toContain("`src/app\\|main\\.js`");
    expect(md).toContain("line1 line2");
    expect(md).toContain("- [HIGH] **[technical]** Risk \\*desc\\*");
    expect(md).toContain("**[must\\_have]** Do \\*thing\\*");
  });

  it("throws for null input", () => {
    expect(() => structuredPlanToMarkdown(null)).toThrow();
  });
});
