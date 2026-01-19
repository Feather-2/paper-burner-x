/**
 * Tests for unified-state-mapping.js
 * Covers AgentToWorkflowMap, inferWorkflowStateFromEvent, validateStateConsistency, StateSynchronizer
 */
import { describe, it, test, expect, beforeEach, vi } from "vitest";

import { AgentStatus } from '../../../../js/agents/runtime/core/agent-status.js';
import { WorkflowState } from '../../../../js/ppt/workflow/workflow-states.js';
import {
  AgentToWorkflowMap,
  inferWorkflowStateFromEvent,
  validateStateConsistency,
  StateSynchronizer,
  UiAgentStatus,
  normalizeLoopStatusForUi,
  mapWorkflowStateFromLoopStatus,
  WorkflowToAgentExpectation,
} from '../../../../js/ppt/workflow/unified-state-mapping.js';

describe("AgentToWorkflowMap", () => {
  test("maps deepsearch statuses correctly", () => {
    expect(AgentToWorkflowMap.deepsearch[AgentStatus.IDLE]).toBeNull();
    expect(AgentToWorkflowMap.deepsearch[AgentStatus.RUNNING]).toBe(WorkflowState.RESEARCHING);
    expect(AgentToWorkflowMap.deepsearch[AgentStatus.PAUSED]).toBe(WorkflowState.DEEPSEARCH_REVIEW);
    expect(AgentToWorkflowMap.deepsearch[AgentStatus.COMPLETED]).toBe(WorkflowState.SCRIPT_REVIEW);
    expect(AgentToWorkflowMap.deepsearch[AgentStatus.FAILED]).toBe(WorkflowState.FAILED);
  });

  test("maps design statuses correctly", () => {
    expect(AgentToWorkflowMap.design[AgentStatus.IDLE]).toBeNull();
    expect(AgentToWorkflowMap.design[AgentStatus.RUNNING]).toBe(WorkflowState.DESIGNER);
    expect(AgentToWorkflowMap.design[AgentStatus.PAUSED]).toBe(WorkflowState.DESIGNER);
    expect(AgentToWorkflowMap.design[AgentStatus.COMPLETED]).toBe(WorkflowState.COMPLETED);
    expect(AgentToWorkflowMap.design[AgentStatus.FAILED]).toBe(WorkflowState.FAILED);
  });
});

describe("normalizeLoopStatusForUi", () => {
  test("returns idle for empty input", () => {
    expect(normalizeLoopStatusForUi(null)).toBe(UiAgentStatus.IDLE);
    expect(normalizeLoopStatusForUi("")).toBe(UiAgentStatus.IDLE);
    expect(normalizeLoopStatusForUi(undefined)).toBe(UiAgentStatus.IDLE);
  });

  test("maps AgentStatus values correctly", () => {
    expect(normalizeLoopStatusForUi(AgentStatus.RUNNING)).toBe(UiAgentStatus.RUNNING);
    expect(normalizeLoopStatusForUi(AgentStatus.PAUSED)).toBe(UiAgentStatus.PAUSED);
    expect(normalizeLoopStatusForUi(AgentStatus.COMPLETED)).toBe(UiAgentStatus.COMPLETED);
    expect(normalizeLoopStatusForUi(AgentStatus.FAILED)).toBe(UiAgentStatus.FAILED);
    expect(normalizeLoopStatusForUi(AgentStatus.IDLE)).toBe(UiAgentStatus.IDLE);
  });

  test("maps legacy failed/aborted strings", () => {
    expect(normalizeLoopStatusForUi("failed")).toBe(UiAgentStatus.FAILED);
    expect(normalizeLoopStatusForUi("aborted")).toBe(UiAgentStatus.FAILED);
  });

  test("returns unknown default for unrecognized statuses", () => {
    expect(normalizeLoopStatusForUi("something_else")).toBe(UiAgentStatus.RUNNING);
    expect(normalizeLoopStatusForUi("something_else", { unknown: UiAgentStatus.IDLE })).toBe(UiAgentStatus.IDLE);
  });
});

describe("mapWorkflowStateFromLoopStatus", () => {
  test("returns null for invalid inputs", () => {
    expect(mapWorkflowStateFromLoopStatus(null, AgentStatus.RUNNING, WorkflowState.IDLE)).toBeNull();
    expect(mapWorkflowStateFromLoopStatus("deepsearch", null, WorkflowState.IDLE)).toBeNull();
  });

  test("returns null for terminal workflow states", () => {
    expect(mapWorkflowStateFromLoopStatus("deepsearch", AgentStatus.RUNNING, WorkflowState.FAILED)).toBeNull();
    expect(mapWorkflowStateFromLoopStatus("deepsearch", AgentStatus.RUNNING, WorkflowState.COMPLETED)).toBeNull();
    expect(mapWorkflowStateFromLoopStatus("deepsearch", AgentStatus.RUNNING, WorkflowState.DEEPSEARCH_REVIEW)).toBeNull();
  });

  test("maps deepsearch status to workflow state", () => {
    expect(mapWorkflowStateFromLoopStatus("deepsearch", AgentStatus.RUNNING, WorkflowState.READING)).toBe(
      WorkflowState.RESEARCHING
    );
  });

  test("maps design status to workflow state", () => {
    expect(mapWorkflowStateFromLoopStatus("design", AgentStatus.COMPLETED, WorkflowState.DESIGNER)).toBe(
      WorkflowState.COMPLETED
    );
  });
});

describe("inferWorkflowStateFromEvent", () => {
  test("handles deepsearch events", () => {
    expect(inferWorkflowStateFromEvent("deepsearch.agent.started", WorkflowState.READING)).toBe(
      WorkflowState.RESEARCHING
    );
    expect(inferWorkflowStateFromEvent("deepsearch.agent.completed", WorkflowState.RESEARCHING)).toBe(
      WorkflowState.SCRIPT_REVIEW
    );
    expect(inferWorkflowStateFromEvent("deepsearch.agent.failed", WorkflowState.RESEARCHING)).toBe(WorkflowState.FAILED);
    expect(inferWorkflowStateFromEvent("deepsearch.agent.paused", WorkflowState.RESEARCHING)).toBe(
      WorkflowState.DEEPSEARCH_REVIEW
    );
  });

  test("handles deepsearch.agent.status.changed with payload", () => {
    const result = inferWorkflowStateFromEvent("deepsearch.agent.status.changed", WorkflowState.READING, {
      to: AgentStatus.RUNNING,
    });
    expect(result).toBe(WorkflowState.RESEARCHING);
  });

  test("handles design events", () => {
    expect(inferWorkflowStateFromEvent("design.started", WorkflowState.PAGE_LAYOUT)).toBe(WorkflowState.DESIGNER);
    expect(inferWorkflowStateFromEvent("design.ended", WorkflowState.DESIGNER)).toBe(WorkflowState.COMPLETED);
  });

  test("handles design.phase.transition to completed", () => {
    expect(inferWorkflowStateFromEvent("design.phase.transition", WorkflowState.DESIGNER, { to: "completed" })).toBe(
      WorkflowState.COMPLETED
    );
  });

  test("handles ingest.completed event", () => {
    expect(inferWorkflowStateFromEvent("ingest.completed", WorkflowState.READING)).toBe(WorkflowState.SCANNING);
  });

  test("returns null for unknown events", () => {
    expect(inferWorkflowStateFromEvent("unknown.event", WorkflowState.IDLE)).toBeNull();
  });
});

describe("validateStateConsistency", () => {
  test("returns consistent when workflow state has no expectations", () => {
    const result = validateStateConsistency(WorkflowState.IDLE, AgentStatus.RUNNING);
    expect(result.consistent).toBe(true);
    expect(result.expected).toEqual([]);
  });

  test("returns consistent when agent status matches expectation", () => {
    const result = validateStateConsistency(WorkflowState.RESEARCHING, AgentStatus.RUNNING, "deepsearch");
    expect(result.consistent).toBe(true);
    expect(result.expected).toEqual([AgentStatus.RUNNING]);
    expect(result.actual).toBe(AgentStatus.RUNNING);
  });

  test("returns inconsistent when agent status does not match expectation", () => {
    const result = validateStateConsistency(WorkflowState.RESEARCHING, AgentStatus.IDLE, "deepsearch");
    expect(result.consistent).toBe(false);
    expect(result.expected).toEqual([AgentStatus.RUNNING]);
    expect(result.actual).toBe(AgentStatus.IDLE);
  });

  test("DESIGNER expects RUNNING or PAUSED", () => {
    expect(validateStateConsistency(WorkflowState.DESIGNER, AgentStatus.RUNNING, "design").consistent).toBe(true);
    expect(validateStateConsistency(WorkflowState.DESIGNER, AgentStatus.PAUSED, "design").consistent).toBe(true);
    expect(validateStateConsistency(WorkflowState.DESIGNER, AgentStatus.COMPLETED, "design").consistent).toBe(false);
  });
});

describe("WorkflowToAgentExpectation", () => {
  test("defines expected statuses for workflow states", () => {
    expect(WorkflowToAgentExpectation[WorkflowState.READING]).toContain(AgentStatus.IDLE);
    expect(WorkflowToAgentExpectation[WorkflowState.RESEARCHING]).toContain(AgentStatus.RUNNING);
    expect(WorkflowToAgentExpectation[WorkflowState.DESIGNER]).toContain(AgentStatus.RUNNING);
    expect(WorkflowToAgentExpectation[WorkflowState.DESIGNER]).toContain(AgentStatus.PAUSED);
  });
});

describe("StateSynchronizer", () => {
  let context;
  let synchronizer;

  beforeEach(() => {
    context = { state: WorkflowState.READING };
    synchronizer = new StateSynchronizer(context);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("initializes with IDLE agent statuses", () => {
    expect(synchronizer.getAgentStatus("deepsearch")).toBe(AgentStatus.IDLE);
    expect(synchronizer.getAgentStatus("design")).toBe(AgentStatus.IDLE);
  });

  test("updates agent status on deepsearch.agent.status.changed", () => {
    synchronizer.handleAgentEvent("deepsearch.agent.status.changed", { to: AgentStatus.RUNNING });
    expect(synchronizer.getAgentStatus("deepsearch")).toBe(AgentStatus.RUNNING);
  });

  test("updates agent status on deepsearch lifecycle events", () => {
    synchronizer.handleAgentEvent("deepsearch.agent.started");
    expect(synchronizer.getAgentStatus("deepsearch")).toBe(AgentStatus.RUNNING);

    synchronizer.handleAgentEvent("deepsearch.agent.paused");
    expect(synchronizer.getAgentStatus("deepsearch")).toBe(AgentStatus.PAUSED);

    synchronizer.handleAgentEvent("deepsearch.agent.completed");
    expect(synchronizer.getAgentStatus("deepsearch")).toBe(AgentStatus.COMPLETED);
  });

  test("updates agent status on deepsearch failure/abort", () => {
    synchronizer.handleAgentEvent("deepsearch.agent.failed");
    expect(synchronizer.getAgentStatus("deepsearch")).toBe(AgentStatus.FAILED);

    // Create fresh synchronizer for aborted test since workflow is now in terminal state
    const freshContext = { state: WorkflowState.RESEARCHING };
    const freshSynchronizer = new StateSynchronizer(freshContext);
    freshSynchronizer.handleAgentEvent("deepsearch.agent.aborted");
    expect(freshSynchronizer.getAgentStatus("deepsearch")).toBe(AgentStatus.FAILED);
  });

  test("updates design agent status on events", () => {
    synchronizer.handleAgentEvent("design.agent.status.changed", { to: AgentStatus.RUNNING });
    expect(synchronizer.getAgentStatus("design")).toBe(AgentStatus.RUNNING);

    synchronizer.handleAgentEvent("design.ended");
    expect(synchronizer.getAgentStatus("design")).toBe(AgentStatus.COMPLETED);
  });

  test("transitions workflow state on deepsearch.agent.started", () => {
    synchronizer.handleAgentEvent("deepsearch.agent.started");
    expect(context.state).toBe(WorkflowState.RESEARCHING);
  });

  test("does not process events in terminal states", () => {
    context.state = WorkflowState.FAILED;
    synchronizer.handleAgentEvent("deepsearch.agent.started");
    expect(context.state).toBe(WorkflowState.FAILED);
  });

  test("checkConsistency returns correct result for design state", () => {
    context.state = WorkflowState.DESIGNER;
    synchronizer._agentStatus.design = AgentStatus.RUNNING;
    const result = synchronizer.checkConsistency();
    expect(result.consistent).toBe(true);
    expect(result.primary.agentType).toBe("design");
  });

  test("checkConsistency returns correct result for deepsearch state", () => {
    context.state = WorkflowState.RESEARCHING;
    synchronizer._agentStatus.deepsearch = AgentStatus.RUNNING;
    const result = synchronizer.checkConsistency();
    expect(result.consistent).toBe(true);
    expect(result.primary.agentType).toBe("deepsearch");
  });

  test("checkConsistency detects inconsistency", () => {
    context.state = WorkflowState.RESEARCHING;
    synchronizer._agentStatus.deepsearch = AgentStatus.IDLE;
    const result = synchronizer.checkConsistency();
    expect(result.consistent).toBe(false);
  });

  test("checkConsistency returns consistent for non-agent states", () => {
    context.state = WorkflowState.IDLE;
    const result = synchronizer.checkConsistency();
    expect(result.consistent).toBe(true);
    expect(result.primary).toBeNull();
  });
});
