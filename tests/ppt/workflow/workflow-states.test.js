import { describe, it, expect, afterEach, vi } from "vitest";

import {
  WorkflowState,
  WORKFLOW_TRANSITIONS,
  transitionWorkflow,
  forceWorkflowState,
} from "../../../js/ppt/workflow/workflow-states.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WorkflowState", () => {
  it("is a frozen enum-like object with unique string values", () => {
    expect(Object.isFrozen(WorkflowState)).toBe(true);

    const values = Object.values(WorkflowState);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => typeof value === "string")).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });

  it("contains expected core states", () => {
    expect(WorkflowState.IDLE).toBe("idle");
    expect(WorkflowState.READING).toBe("reading");
    expect(WorkflowState.SCANNING).toBe("scanning");
    expect(WorkflowState.RESEARCHING).toBe("researching");
    expect(WorkflowState.DEEPSEARCH_REVIEW).toBe("deepsearch_review");
    expect(WorkflowState.SCRIPT_REVIEW).toBe("script_review");
    expect(WorkflowState.OUTLINE_REVIEW).toBe("outline_review");
    expect(WorkflowState.OUTLINE_PLANNING).toBe("outline_planning");
    expect(WorkflowState.PAGE_LAYOUT).toBe("page_layout");
    expect(WorkflowState.BRIEFING).toBe("briefing");
    expect(WorkflowState.DESIGN_PREFERENCES).toBe("design_preferences");
    expect(WorkflowState.DESIGNER).toBe("designer");
    expect(WorkflowState.COMPLETED).toBe("completed");
    expect(WorkflowState.EDITING).toBe("editing");
    expect(WorkflowState.QUESTIONING).toBe("questioning");
    expect(WorkflowState.SCRIPTING).toBe("scripting");
    expect(WorkflowState.FAILED).toBe("failed");
  });
});

describe("WORKFLOW_TRANSITIONS", () => {
  it("defines transitions for every WorkflowState", () => {
    const allStates = Object.values(WorkflowState);
    const transitionKeys = Object.keys(WORKFLOW_TRANSITIONS);

    expect(new Set(transitionKeys).size).toBe(transitionKeys.length);
    expect(transitionKeys.sort()).toEqual([...allStates].sort());
  });

  it("references only valid WorkflowState values and has no duplicates", () => {
    const allStates = new Set(Object.values(WorkflowState));

    for (const [from, tos] of Object.entries(WORKFLOW_TRANSITIONS)) {
      expect(allStates.has(from)).toBe(true);
      expect(Array.isArray(tos)).toBe(true);

      for (const to of tos) {
        expect(allStates.has(to)).toBe(true);
      }

      expect(new Set(tos).size).toBe(tos.length);
    }
  });
});

describe("transitionWorkflow()", () => {
  it("performs allowed transitions and updates context.state", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const context = { state: WorkflowState.IDLE };
    const ok = transitionWorkflow(context, WorkflowState.READING);

    expect(ok).toBe(true);
    expect(context.state).toBe(WorkflowState.READING);
    expect(logSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("rejects disallowed transitions and does not mutate context.state", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const context = { state: WorkflowState.IDLE };
    const ok = transitionWorkflow(context, WorkflowState.COMPLETED, { reason: "test" });

    expect(ok).toBe(false);
    expect(context.state).toBe(WorkflowState.IDLE);
    expect(errorSpy).toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("accepts every transition declared in WORKFLOW_TRANSITIONS", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    for (const [from, tos] of Object.entries(WORKFLOW_TRANSITIONS)) {
      for (const to of tos) {
        const context = { state: from };
        const ok = transitionWorkflow(context, to);
        expect(ok).toBe(true);
        expect(context.state).toBe(to);
      }
    }
  });

  it("rejects transitions that are not declared for each state", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const allStates = Object.values(WorkflowState);

    for (const [from, allowed] of Object.entries(WORKFLOW_TRANSITIONS)) {
      const disallowed = allStates.find(
        (candidate) => candidate !== from && !allowed.includes(candidate)
      );
      expect(disallowed).toBeDefined();

      const context = { state: from };
      const ok = transitionWorkflow(context, disallowed);

      expect(ok).toBe(false);
      expect(context.state).toBe(from);
    }
  });

  it("treats unknown current states as having no allowed transitions", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const context = { state: "not-a-workflow-state" };
    const ok = transitionWorkflow(context, WorkflowState.IDLE);

    expect(ok).toBe(false);
    expect(context.state).toBe("not-a-workflow-state");
  });
});

describe("forceWorkflowState()", () => {
  it("sets context.state without validation", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const context = { state: WorkflowState.IDLE };
    forceWorkflowState(context, WorkflowState.READING);
    expect(context.state).toBe(WorkflowState.READING);

    forceWorkflowState(context, "custom_state");
    expect(context.state).toBe("custom_state");
  });
});
