import { describe, expect, it, vi } from "vitest";
import { StepRunner } from "../../../../../js/agents/runtime/core/agent-loop-steps.js";

function createLoop() {
  return {
    stageName: "demo",
    actor: "agent-x",
    emit: vi.fn(),
    eventBus: null,
    _activeStep: null,
  };
}

describe("StepRunner step id generation", () => {
  it("uses per-instance sequence counters", () => {
    const loopA = createLoop();
    const loopB = createLoop();
    const runnerA = new StepRunner(loopA);
    const runnerB = new StepRunner(loopB);

    const a1 = runnerA._beginStep({ runId: "run-a" }).step.stepId;
    const a2 = runnerA._beginStep({ runId: "run-a" }).step.stepId;
    const b1 = runnerB._beginStep({ runId: "run-b" }).step.stepId;

    expect(a1).toMatch(/_run-a_1$/);
    expect(a2).toMatch(/_run-a_2$/);
    expect(b1).toMatch(/_run-b_1$/);
    expect(a1).not.toBe(b1);
  });
});

