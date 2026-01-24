import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedMakeSecureTimestampedId = vi.hoisted(() => vi.fn(() => "plan_mock_id"));
const mockedStepStatus = vi.hoisted(() => ({
  PENDING: "pending",
  DONE: "done",
}));
const mockedIsValidStepStatus = vi.hoisted(() =>
  vi.fn((value) => value === mockedStepStatus.PENDING || value === mockedStepStatus.DONE)
);

const mockedValueUtils = vi.hoisted(() => ({
  isPlainObject(v) {
    if (v === null || typeof v !== "object") return false;
    if (Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  },
  toNonEmptyString(v) {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s.length ? s : undefined;
  },
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  makeSecureTimestampedId: mockedMakeSecureTimestampedId,
  isPlainObject: mockedValueUtils.isPlainObject,
  toNonEmptyString: mockedValueUtils.toNonEmptyString,
}));

vi.mock(
  "../../../../../js/agents/runtime/core/agent-status.js",
  () => ({
    StepStatus: mockedStepStatus,
    isValidStepStatus: mockedIsValidStepStatus,
  }),
  { virtual: true }
);

import planStore, {
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
} from "../../../../../js/agents/plugins/plan/plan-store.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
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
  it("should_return_0_1_when_accessing_constant", () => {
    expect(PLAN_SCHEMA_VERSION).toBe("0.1");
  });
});

describe("PLAN_ARTIFACT_TYPE", () => {
  it("should_return_plan_json_when_accessing_constant", () => {
    expect(PLAN_ARTIFACT_TYPE).toBe("plan.json");
  });
});

describe("PlanLifecycleStatus", () => {
  it("should_expose_all_lifecycle_values_when_reading_object", () => {
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

  it("should_be_frozen_when_attempting_mutation", () => {
    expect(Object.isFrozen(PlanLifecycleStatus)).toBe(true);
  });
});

describe("isValidPlanLifecycleStatus", () => {
  it("should_return_true_when_value_is_known_status", () => {
    const values = Object.values(PlanLifecycleStatus);
    expect(values.every((status) => isValidPlanLifecycleStatus(status))).toBe(true);
  });

  it("should_return_false_when_value_is_not_known_status", () => {
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

    expect(invalidValues.every((value) => !isValidPlanLifecycleStatus(value))).toBe(true);
  });

  it("should_return_false_when_value_is_very_long_string", () => {
    const longValue = "x".repeat(10000);
    expect(isValidPlanLifecycleStatus(longValue)).toBe(false);
  });
});

describe("canTransitionPlanLifecycle", () => {
  it("should_return_true_when_transition_is_allowed", () => {
    const validTransitions = [
      [PlanLifecycleStatus.DRAFT, PlanLifecycleStatus.APPROVED],
      [PlanLifecycleStatus.DRAFT, PlanLifecycleStatus.CANCELLED],
      [PlanLifecycleStatus.APPROVED, PlanLifecycleStatus.IN_PROGRESS],
      [PlanLifecycleStatus.IN_PROGRESS, PlanLifecycleStatus.COMPLETED],
      [PlanLifecycleStatus.IN_PROGRESS, PlanLifecycleStatus.FAILED],
      [PlanLifecycleStatus.IN_PROGRESS, PlanLifecycleStatus.CANCELLED],
      [PlanLifecycleStatus.COMPLETED, PlanLifecycleStatus.COMPLETED],
    ];

    expect(validTransitions.every(([from, to]) => canTransitionPlanLifecycle(from, to))).toBe(
      true
    );
  });

  it("should_return_false_when_transition_is_disallowed", () => {
    const invalidTransitions = [
      [PlanLifecycleStatus.COMPLETED, PlanLifecycleStatus.APPROVED],
      [PlanLifecycleStatus.FAILED, PlanLifecycleStatus.DRAFT],
      [PlanLifecycleStatus.APPROVED, PlanLifecycleStatus.COMPLETED],
      [PlanLifecycleStatus.CANCELLED, PlanLifecycleStatus.IN_PROGRESS],
    ];

    expect(invalidTransitions.every(([from, to]) => !canTransitionPlanLifecycle(from, to))).toBe(
      true
    );
  });

  it("should_default_from_to_draft_when_from_is_blank", () => {
    expect(canTransitionPlanLifecycle(null, PlanLifecycleStatus.APPROVED)).toBe(true);
  });

  it("should_default_from_to_draft_when_from_is_invalid_string", () => {
    expect(canTransitionPlanLifecycle("unknown", PlanLifecycleStatus.APPROVED)).toBe(true);
  });

  it("should_return_true_when_from_is_whitespace_and_to_is_allowed", () => {
    expect(canTransitionPlanLifecycle("   ", PlanLifecycleStatus.CANCELLED)).toBe(true);
  });

  it("should_return_false_when_to_is_blank", () => {
    expect(canTransitionPlanLifecycle(PlanLifecycleStatus.DRAFT, "   ")).toBe(false);
  });

  it("should_return_false_when_to_is_unknown", () => {
    expect(canTransitionPlanLifecycle(PlanLifecycleStatus.DRAFT, "unknown")).toBe(false);
  });

  it("should_return_true_when_from_is_number_and_to_is_allowed", () => {
    expect(canTransitionPlanLifecycle(0, PlanLifecycleStatus.APPROVED)).toBe(true);
  });

  it("should_return_false_when_to_is_number", () => {
    expect(canTransitionPlanLifecycle(PlanLifecycleStatus.DRAFT, 0)).toBe(false);
  });

  it("should_support_trimmed_strings_when_from_has_whitespace", () => {
    expect(canTransitionPlanLifecycle(" draft ", "draft")).toBe(true);
  });

  it("should_support_concurrent_checks_when_inputs_are_mixed", async () => {
    const results = await Promise.all([
      Promise.resolve().then(() =>
        canTransitionPlanLifecycle(PlanLifecycleStatus.DRAFT, PlanLifecycleStatus.APPROVED)
      ),
      Promise.resolve().then(() =>
        canTransitionPlanLifecycle(PlanLifecycleStatus.IN_PROGRESS, PlanLifecycleStatus.COMPLETED)
      ),
      Promise.resolve().then(() => canTransitionPlanLifecycle(PlanLifecycleStatus.APPROVED, "x")),
    ]);

    expect(results).toEqual([true, true, false]);
  });
});

describe("setPlanLifecycleStatus", () => {
  it("should_throw_TypeError_when_plan_is_not_object", () => {
    const invalidPlans = [null, undefined, 0, "plan"];
    const results = invalidPlans.map((plan) => {
      try {
        setPlanLifecycleStatus(plan, PlanLifecycleStatus.DRAFT);
        return false;
      } catch (error) {
        return error instanceof TypeError;
      }
    });

    expect(results.every(Boolean)).toBe(true);
  });

  it("should_set_lifecycleStatus_when_transition_is_valid", () => {
    const plan = { lifecycleStatus: PlanLifecycleStatus.DRAFT };
    const result = setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED, { updatedAt: 0 });

    expect(result.lifecycleStatus).toBe(PlanLifecycleStatus.APPROVED);
  });

  it("should_set_updatedAt_to_iso_when_updatedAt_is_number", () => {
    const plan = { lifecycleStatus: PlanLifecycleStatus.DRAFT };
    const result = setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED, { updatedAt: 0 });

    expect(result.updatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("should_not_mutate_input_plan_when_updating_lifecycleStatus", () => {
    const plan = { lifecycleStatus: PlanLifecycleStatus.DRAFT };
    setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED, { updatedAt: 0 });

    expect(plan.lifecycleStatus).toBe(PlanLifecycleStatus.DRAFT);
  });

  it("should_use_legacy_status_when_lifecycleStatus_is_missing", () => {
    const plan = { status: PlanLifecycleStatus.APPROVED };
    const result = setPlanLifecycleStatus(plan, PlanLifecycleStatus.IN_PROGRESS, { updatedAt: 1 });

    expect(result.lifecycleStatus).toBe(PlanLifecycleStatus.IN_PROGRESS);
  });

  it("should_preserve_legacy_status_property_when_updating_lifecycleStatus", () => {
    const plan = { status: PlanLifecycleStatus.APPROVED };
    const result = setPlanLifecycleStatus(plan, PlanLifecycleStatus.IN_PROGRESS, { updatedAt: 1 });

    expect(result.status).toBe(PlanLifecycleStatus.APPROVED);
  });

  it("should_throw_when_status_is_invalid", () => {
    const invalidStatuses = ["", "   ", "unknown", null, undefined, {}, []];
    const results = invalidStatuses.map((status) => {
      try {
        setPlanLifecycleStatus({ lifecycleStatus: PlanLifecycleStatus.DRAFT }, status);
        return false;
      } catch (error) {
        return /invalid status/i.test(String(error?.message || ""));
      }
    });

    expect(results.every(Boolean)).toBe(true);
  });

  it("should_throw_when_transition_is_invalid_and_force_is_false", () => {
    const plan = { lifecycleStatus: PlanLifecycleStatus.COMPLETED };
    expect(() =>
      setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED, { updatedAt: 0 })
    ).toThrow(/invalid transition/i);
  });

  it("should_set_lifecycleStatus_when_force_is_true_even_if_transition_invalid", () => {
    const plan = { lifecycleStatus: PlanLifecycleStatus.COMPLETED };
    const forced = setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED, {
      updatedAt: 0,
      force: true,
    });

    expect(forced.lifecycleStatus).toBe(PlanLifecycleStatus.APPROVED);
  });

  it("should_return_raw_string_when_updatedAt_is_non_empty_string", () => {
    const plan = { lifecycleStatus: PlanLifecycleStatus.DRAFT };
    const result = setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED, { updatedAt: "0" });

    expect(result.updatedAt).toBe("0");
  });

  it("should_set_updatedAt_to_iso_when_updatedAt_is_negative_number", () => {
    const plan = { lifecycleStatus: PlanLifecycleStatus.DRAFT };
    const result = setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED, { updatedAt: -1 });

    expect(result.updatedAt).toBe("1969-12-31T23:59:59.999Z");
  });

  it("should_preserve_additional_fields_when_updating_lifecycleStatus", () => {
    const largePayload = "x".repeat(100000);
    const deepMeta = createDeepMeta(40);
    const plan = { lifecycleStatus: PlanLifecycleStatus.DRAFT, meta: deepMeta, blob: largePayload };

    const result = setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED, { updatedAt: 0 });

    expect(result.blob.length).toBe(100000);
  });

  it("should_support_array_plan_input_when_plan_is_array_object", () => {
    const arrayPlan = [];
    const arrayResult = setPlanLifecycleStatus(arrayPlan, PlanLifecycleStatus.APPROVED, {
      updatedAt: 0,
    });

    expect(arrayResult.lifecycleStatus).toBe(PlanLifecycleStatus.APPROVED);
  });

  it("should_support_concurrent_updates_without_shared_state", async () => {
    const base = { lifecycleStatus: PlanLifecycleStatus.DRAFT };

    const results = await Promise.all([
      Promise.resolve().then(() =>
        setPlanLifecycleStatus(base, PlanLifecycleStatus.APPROVED, { updatedAt: 0 })
      ),
      Promise.resolve().then(() =>
        setPlanLifecycleStatus(base, PlanLifecycleStatus.CANCELLED, { updatedAt: 1 })
      ),
    ]);

    expect(results.map((p) => p.lifecycleStatus)).toEqual([
      PlanLifecycleStatus.APPROVED,
      PlanLifecycleStatus.CANCELLED,
    ]);
  });

  it("should_support_rapid_sequential_updates", () => {
    const base = { lifecycleStatus: PlanLifecycleStatus.DRAFT };
    const approved = setPlanLifecycleStatus(base, PlanLifecycleStatus.APPROVED, { updatedAt: 0 });
    const inProgress = setPlanLifecycleStatus(approved, PlanLifecycleStatus.IN_PROGRESS, {
      updatedAt: 1,
    });
    const completed = setPlanLifecycleStatus(inProgress, PlanLifecycleStatus.COMPLETED, {
      updatedAt: 2,
    });

    expect(completed.updatedAt).toBe("1970-01-01T00:00:00.002Z");
  });
});

describe("createPlan", () => {
  it("should_use_generated_planId_when_planId_is_missing", () => {
    const plan = createPlan();
    expect(plan.planId).toBe("plan_mock_id");
  });

  it("should_call_makeSecureTimestampedId_with_plan_when_planId_is_missing", () => {
    createPlan();
    expect(mockedMakeSecureTimestampedId).toHaveBeenCalledWith("plan");
  });

  it("should_use_provided_planId_when_planId_is_non_empty", () => {
    const plan = createPlan({ planId: "custom_plan_id" });
    expect(plan.planId).toBe("custom_plan_id");
  });

  it("should_default_runId_when_runId_is_missing", () => {
    const plan = createPlan();
    expect(plan.runId).toBe("run_unknown");
  });

  it("should_trim_runId_when_runId_has_whitespace", () => {
    const plan = createPlan({ runId: "  run_1  " });
    expect(plan.runId).toBe("run_1");
  });

  it("should_default_title_when_title_is_missing", () => {
    const plan = createPlan();
    expect(plan.title).toBe("Plan");
  });

  it("should_trim_title_when_title_has_whitespace", () => {
    const plan = createPlan({ title: "  Hello  " });
    expect(plan.title).toBe("Hello");
  });

  it("should_default_kind_when_kind_is_missing", () => {
    const plan = createPlan();
    expect(plan.kind).toBe("plan");
  });

  it("should_trim_kind_when_kind_has_whitespace", () => {
    const plan = createPlan({ kind: "  workflow  " });
    expect(plan.kind).toBe("workflow");
  });

  it("should_set_createdAt_equal_to_updatedAt_when_created", () => {
    const plan = createPlan();
    expect(plan.createdAt).toBe(plan.updatedAt);
  });

  it("should_default_lifecycleStatus_to_draft_when_lifecycleStatus_is_invalid", () => {
    const plan = createPlan({ lifecycleStatus: "unknown" });
    expect(plan.lifecycleStatus).toBe(PlanLifecycleStatus.DRAFT);
  });

  it("should_keep_lifecycleStatus_when_lifecycleStatus_is_valid", () => {
    const plan = createPlan({ lifecycleStatus: PlanLifecycleStatus.APPROVED });
    expect(plan.lifecycleStatus).toBe(PlanLifecycleStatus.APPROVED);
  });

  it("should_normalize_steps_to_empty_array_when_steps_is_not_array", () => {
    const plan = createPlan({ steps: {} });
    expect(plan.steps.length).toBe(0);
  });

  it("should_assign_fallback_stepId_when_step_has_no_stepId", () => {
    const plan = createPlan({ steps: [{}] });
    expect(plan.steps[0].stepId).toBe("step_1");
  });

  it("should_floor_selectedStepIndex_when_selectedStepIndex_is_float", () => {
    const plan = createPlan({
      steps: [{ stepId: "a" }, { stepId: "b" }],
      selectedStepIndex: 1.9,
    });

    expect(plan.selectedStepIndex).toBe(1);
  });

  it("should_clamp_selectedStepIndex_to_0_when_selectedStepIndex_is_negative", () => {
    const plan = createPlan({ steps: [{ stepId: "a" }], selectedStepIndex: -1 });
    expect(plan.selectedStepIndex).toBe(0);
  });

  it("should_clamp_selectedStepIndex_to_last_when_selectedStepIndex_exceeds_steps_length", () => {
    const plan = createPlan({
      steps: [{ stepId: "a" }, { stepId: "b" }],
      selectedStepIndex: 99,
    });

    expect(plan.selectedStepIndex).toBe(1);
  });

  it("should_force_selectedStepIndex_to_0_when_steps_is_empty", () => {
    const plan = createPlan({ steps: [], selectedStepIndex: 9 });
    expect(plan.selectedStepIndex).toBe(0);
  });

  it("should_include_meta_when_meta_is_plain_object", () => {
    const plan = createPlan({ meta: { tag: "x" } });
    expect(plan.meta).toEqual({ tag: "x" });
  });

  it("should_omit_meta_when_meta_is_not_plain_object", () => {
    const plan = createPlan({ meta: [] });
    expect("meta" in plan).toBe(false);
  });
});

describe("normalizePlanStep", () => {
  it("should_generate_stepId_when_stepId_is_missing", () => {
    const step = normalizePlanStep({}, { fallbackIndex: 0 });
    expect(step.stepId).toBe("step_1");
  });

  it("should_use_trimmed_title_when_title_is_non_empty", () => {
    const step = normalizePlanStep({ title: "  Do it  " }, { fallbackIndex: 0 });
    expect(step.title).toBe("Do it");
  });

  it("should_fallback_title_to_text_when_title_is_missing", () => {
    const step = normalizePlanStep({ text: "From text" }, { fallbackIndex: 0 });
    expect(step.title).toBe("From text");
  });

  it("should_fallback_title_to_stepId_when_title_and_text_are_missing", () => {
    const step = normalizePlanStep({}, { fallbackIndex: 0 });
    expect(step.title).toBe("step_1");
  });

  it("should_default_status_to_PENDING_when_status_is_missing", () => {
    const step = normalizePlanStep({}, { fallbackIndex: 0 });
    expect(step.status).toBe(mockedStepStatus.PENDING);
  });

  it("should_fallback_status_to_PENDING_when_status_is_invalid", () => {
    const step = normalizePlanStep({ status: "invalid" }, { fallbackIndex: 0 });
    expect(step.status).toBe(mockedStepStatus.PENDING);
  });

  it("should_preserve_status_when_status_is_valid", () => {
    const step = normalizePlanStep({ status: mockedStepStatus.DONE }, { fallbackIndex: 0 });
    expect(step.status).toBe(mockedStepStatus.DONE);
  });

  it("should_include_updatedAt_when_updatedAt_is_provided", () => {
    const step = normalizePlanStep({ updatedAt: 0 }, { fallbackIndex: 0 });
    expect(step.updatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("should_omit_updatedAt_when_updatedAt_is_blank_string", () => {
    const step = normalizePlanStep({ updatedAt: "   " }, { fallbackIndex: 0 });
    expect("updatedAt" in step).toBe(false);
  });

  it("should_include_createdAt_when_createdAt_is_provided", () => {
    const step = normalizePlanStep({ createdAt: 0 }, { fallbackIndex: 0 });
    expect(step.createdAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("should_omit_createdAt_when_createdAt_is_blank_string", () => {
    const step = normalizePlanStep({ createdAt: "   " }, { fallbackIndex: 0 });
    expect("createdAt" in step).toBe(false);
  });

  it("should_include_meta_when_meta_is_plain_object", () => {
    const step = normalizePlanStep({ meta: { a: 1 } }, { fallbackIndex: 0 });
    expect(step.meta).toEqual({ a: 1 });
  });

  it("should_omit_meta_when_meta_is_not_plain_object", () => {
    const step = normalizePlanStep({ meta: [] }, { fallbackIndex: 0 });
    expect("meta" in step).toBe(false);
  });
});

describe("findPlanStepIndex", () => {
  it("should_return_minus1_when_plan_is_null", () => {
    expect(findPlanStepIndex(null, "step_1")).toBe(-1);
  });

  it("should_return_minus1_when_plan_steps_is_not_array", () => {
    expect(findPlanStepIndex({ steps: {} }, "step_1")).toBe(-1);
  });

  it("should_return_index_when_stepIdOrIndex_is_valid_number", () => {
    const plan = { steps: [{ stepId: "a" }, { stepId: "b" }] };
    expect(findPlanStepIndex(plan, 1)).toBe(1);
  });

  it("should_floor_index_when_stepIdOrIndex_is_float", () => {
    const plan = { steps: [{ stepId: "a" }, { stepId: "b" }] };
    expect(findPlanStepIndex(plan, 1.9)).toBe(1);
  });

  it("should_return_minus1_when_stepIdOrIndex_is_out_of_range", () => {
    const plan = { steps: [{ stepId: "a" }, { stepId: "b" }] };
    expect(findPlanStepIndex(plan, 2)).toBe(-1);
  });

  it("should_return_minus1_when_stepId_is_blank_string", () => {
    const plan = { steps: [{ stepId: "a" }] };
    expect(findPlanStepIndex(plan, "   ")).toBe(-1);
  });

  it("should_return_index_when_stepId_matches_after_trimming", () => {
    const plan = { steps: [{ stepId: "step_1" }, { stepId: "step_2" }] };
    expect(findPlanStepIndex(plan, "  step_2  ")).toBe(1);
  });

  it("should_match_numeric_stepId_after_string_coercion", () => {
    const plan = { steps: [{ stepId: 123 }] };
    expect(findPlanStepIndex(plan, "123")).toBe(0);
  });
});

describe("setPlanStepStatus", () => {
  it("should_throw_TypeError_when_plan_is_not_object", () => {
    expect(() => setPlanStepStatus(null, 0, mockedStepStatus.DONE)).toThrow(TypeError);
  });

  it("should_throw_TypeError_when_plan_steps_is_not_array", () => {
    expect(() => setPlanStepStatus({ steps: {} }, 0, mockedStepStatus.DONE)).toThrow(TypeError);
  });

  it("should_return_original_plan_when_step_is_not_found", () => {
    const plan = { steps: [{ stepId: "a", status: mockedStepStatus.PENDING }], updatedAt: "old" };
    const result = setPlanStepStatus(plan, "missing", mockedStepStatus.DONE, { updatedAt: 0 });
    expect(result).toBe(plan);
  });

  it("should_throw_when_status_is_invalid", () => {
    const plan = { steps: [{ stepId: "a", status: mockedStepStatus.PENDING }], updatedAt: "old" };
    expect(() => setPlanStepStatus(plan, 0, "invalid")).toThrow(/invalid status/i);
  });

  it("should_update_step_status_when_step_is_found", () => {
    const plan = { steps: [{ stepId: "a", status: mockedStepStatus.PENDING }], updatedAt: "old" };
    const result = setPlanStepStatus(plan, 0, mockedStepStatus.DONE, { updatedAt: 0 });
    expect(result.steps[0].status).toBe(mockedStepStatus.DONE);
  });

  it("should_set_step_updatedAt_when_updatedAt_is_number", () => {
    const plan = { steps: [{ stepId: "a", status: mockedStepStatus.PENDING }], updatedAt: "old" };
    const result = setPlanStepStatus(plan, 0, mockedStepStatus.DONE, { updatedAt: 0 });
    expect(result.steps[0].updatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("should_set_step_createdAt_when_step_has_no_createdAt", () => {
    const plan = { steps: [{ stepId: "a", status: mockedStepStatus.PENDING }], updatedAt: "old" };
    const result = setPlanStepStatus(plan, 0, mockedStepStatus.DONE, { updatedAt: 0 });
    expect(result.steps[0].createdAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("should_preserve_step_createdAt_when_step_already_has_createdAt", () => {
    const plan = {
      steps: [{ stepId: "a", status: mockedStepStatus.PENDING, createdAt: "keep" }],
      updatedAt: "old",
    };
    const result = setPlanStepStatus(plan, 0, mockedStepStatus.DONE, { updatedAt: 0 });
    expect(result.steps[0].createdAt).toBe("keep");
  });

  it("should_set_plan_updatedAt_when_step_status_is_updated", () => {
    const plan = { steps: [{ stepId: "a", status: mockedStepStatus.PENDING }], updatedAt: "old" };
    const result = setPlanStepStatus(plan, 0, mockedStepStatus.DONE, { updatedAt: 0 });
    expect(result.updatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("should_set_selectedStepIndex_by_default_when_step_is_updated", () => {
    const plan = {
      steps: [
        { stepId: "a", status: mockedStepStatus.PENDING },
        { stepId: "b", status: mockedStepStatus.PENDING },
      ],
      selectedStepIndex: 0,
      updatedAt: "old",
    };
    const result = setPlanStepStatus(plan, 1, mockedStepStatus.DONE, { updatedAt: 0 });
    expect(result.selectedStepIndex).toBe(1);
  });

  it("should_not_change_selectedStepIndex_when_select_is_false", () => {
    const plan = {
      steps: [
        { stepId: "a", status: mockedStepStatus.PENDING },
        { stepId: "b", status: mockedStepStatus.PENDING },
      ],
      selectedStepIndex: 0,
      updatedAt: "old",
    };
    const result = setPlanStepStatus(plan, 1, mockedStepStatus.DONE, {
      updatedAt: 0,
      select: false,
    });
    expect(result.selectedStepIndex).toBe(0);
  });
});

describe("savePlan", () => {
  it("should_throw_TypeError_when_runStore_saveArtifact_is_missing", async () => {
    await expect(savePlan({ runStore: {} })).rejects.toThrow(TypeError);
  });

  it("should_throw_when_runId_is_missing_from_input_and_plan", async () => {
    const runStore = { saveArtifact: vi.fn() };
    await expect(savePlan({ runStore, plan: {} })).rejects.toThrow(/runId is required/i);
  });

  it("should_throw_when_plan_is_not_object", async () => {
    const runStore = { saveArtifact: vi.fn() };
    await expect(savePlan({ runStore, runId: "run_1", plan: null })).rejects.toThrow(
      /plan must be an object/i
    );
  });

  it("should_use_plan_toJSON_payload_when_plan_provides_toJSON", async () => {
    const runStore = { saveArtifact: vi.fn(async () => "ok") };
    const plan = { runId: "run_1", toJSON: () => ({ hello: "world" }) };

    await savePlan({ runStore, plan });

    expect(runStore.saveArtifact).toHaveBeenCalledWith(
      "run_1",
      PLAN_ARTIFACT_TYPE,
      { hello: "world" },
      { mime: "application/json" }
    );
  });

  it("should_use_runId_param_over_plan_runId_when_both_provided", async () => {
    const runStore = { saveArtifact: vi.fn(async () => "ok") };
    const plan = { runId: "inner", planId: "p1" };

    await savePlan({ runStore, runId: "override", plan });

    expect(runStore.saveArtifact).toHaveBeenCalledWith("override", PLAN_ARTIFACT_TYPE, plan, {
      mime: "application/json",
    });
  });

  it("should_include_artifactId_when_artifactId_is_non_empty", async () => {
    const runStore = { saveArtifact: vi.fn(async () => "ok") };
    const plan = { runId: "run_1", planId: "p1" };

    await savePlan({ runStore, plan, artifactId: "artifact_1" });

    expect(runStore.saveArtifact).toHaveBeenCalledWith(
      "run_1",
      PLAN_ARTIFACT_TYPE,
      plan,
      { artifactId: "artifact_1", mime: "application/json" }
    );
  });

  it("should_forward_custom_type_when_type_is_provided", async () => {
    const runStore = { saveArtifact: vi.fn(async () => "ok") };
    const plan = { runId: "run_1", planId: "p1" };

    await savePlan({ runStore, plan, type: "custom.json" });

    expect(runStore.saveArtifact).toHaveBeenCalledWith("run_1", "custom.json", plan, {
      mime: "application/json",
    });
  });

  it("should_throw_when_toJSON_returns_non_object", async () => {
    const runStore = { saveArtifact: vi.fn(async () => "ok") };
    const plan = { runId: "run_1", toJSON: () => "bad" };

    await expect(savePlan({ runStore, plan })).rejects.toThrow(/plan must be an object/i);
  });

  it("should_support_concurrent_saves_when_called_multiple_times", async () => {
    const runStore = { saveArtifact: vi.fn(async () => "ok") };
    await Promise.all([
      savePlan({ runStore, plan: { runId: "run_1", planId: "p1" } }),
      savePlan({ runStore, plan: { runId: "run_2", planId: "p2" } }),
    ]);

    expect(runStore.saveArtifact).toHaveBeenCalledTimes(2);
  });
});

describe("default export", () => {
  it("should_expose_named_exports_on_default_object", () => {
    const keys = Object.keys(planStore).slice().sort();
    expect(keys).toEqual(
      [
        "PLAN_SCHEMA_VERSION",
        "PLAN_ARTIFACT_TYPE",
        "PlanLifecycleStatus",
        "isValidPlanLifecycleStatus",
        "canTransitionPlanLifecycle",
        "setPlanLifecycleStatus",
        "createPlan",
        "normalizePlanStep",
        "findPlanStepIndex",
        "setPlanStepStatus",
        "savePlan",
      ]
        .slice()
        .sort()
    );
  });

  it("should_reference_same_createPlan_function_when_importing_default", () => {
    expect(planStore.createPlan).toBe(createPlan);
  });
});