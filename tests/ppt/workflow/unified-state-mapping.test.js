const test = require("node:test");
const assert = require("node:assert/strict");

async function loadUnifiedModule() {
  return await import("../../../js/ppt/workflow/unified-state-mapping.js");
}

async function loadWorkflowStates() {
  return await import("../../../js/ppt/workflow/workflow-states.js");
}

async function loadDeepsearchStates() {
  return await import("../../../js/agents/stages/deepsearch/states.js");
}

async function loadDesignStates() {
  return await import("../../../js/agents/stages/design/states.js");
}

test("AgentToWorkflowMap maps deepsearch and design statuses", async () => {
  const { AgentToWorkflowMap } = await loadUnifiedModule();
  const { WorkflowState } = await loadWorkflowStates();
  const { AgentLoopStatus } = await loadDeepsearchStates();
  const { DesignLoopStatus } = await loadDesignStates();

  assert.equal(
    AgentToWorkflowMap.deepsearch[AgentLoopStatus.REVIEWING],
    WorkflowState.DEEPSEARCH_REVIEW
  );
  assert.equal(
    AgentToWorkflowMap.deepsearch[AgentLoopStatus.COMPLETED],
    WorkflowState.SCRIPT_REVIEW
  );
  assert.equal(
    AgentToWorkflowMap.design[DesignLoopStatus.IDLE],
    WorkflowState.PAGE_LAYOUT
  );
  assert.equal(
    AgentToWorkflowMap.design[DesignLoopStatus.COMPLETED],
    WorkflowState.COMPLETED
  );
});

test("inferWorkflowStateFromEvent handles deepsearch/design/ingest events", async () => {
  const { inferWorkflowStateFromEvent } = await loadUnifiedModule();
  const { WorkflowState } = await loadWorkflowStates();
  const { AgentLoopStatus } = await loadDeepsearchStates();

  assert.equal(
    inferWorkflowStateFromEvent("deepsearch.agent.started", WorkflowState.READING),
    WorkflowState.RESEARCHING
  );
  assert.equal(
    inferWorkflowStateFromEvent("deepsearch.agent.completed", WorkflowState.RESEARCHING),
    WorkflowState.SCRIPT_REVIEW
  );
  assert.equal(
    inferWorkflowStateFromEvent("deepsearch.agent.failed", WorkflowState.RESEARCHING),
    WorkflowState.FAILED
  );
  assert.equal(
    inferWorkflowStateFromEvent("deepsearch.agent.paused", WorkflowState.RESEARCHING),
    WorkflowState.DEEPSEARCH_REVIEW
  );
  assert.equal(
    inferWorkflowStateFromEvent(
      "deepsearch.agent.status.changed",
      WorkflowState.RESEARCHING,
      { to: AgentLoopStatus.THINKING }
    ),
    WorkflowState.RESEARCHING
  );
  assert.equal(
    inferWorkflowStateFromEvent("design.started", WorkflowState.PAGE_LAYOUT),
    WorkflowState.DESIGNER
  );
  assert.equal(
    inferWorkflowStateFromEvent("design.ended", WorkflowState.DESIGNER),
    WorkflowState.COMPLETED
  );
  assert.equal(
    inferWorkflowStateFromEvent(
      "design.phase.transition",
      WorkflowState.DESIGNER,
      { to: "completed" }
    ),
    WorkflowState.COMPLETED
  );
  assert.equal(
    inferWorkflowStateFromEvent("ingest.completed", WorkflowState.READING),
    WorkflowState.SCANNING
  );
  assert.equal(
    inferWorkflowStateFromEvent("unknown.event", WorkflowState.READING),
    null
  );
});

test("validateStateConsistency checks expected status ranges", async () => {
  const { validateStateConsistency } = await loadUnifiedModule();
  const { WorkflowState } = await loadWorkflowStates();
  const { AgentLoopStatus } = await loadDeepsearchStates();
  const { DesignLoopStatus } = await loadDesignStates();

  const ok = validateStateConsistency(
    WorkflowState.RESEARCHING,
    AgentLoopStatus.EXECUTING
  );
  assert.equal(ok.consistent, true);
  assert.ok(ok.expected.includes(AgentLoopStatus.EXECUTING));

  const bad = validateStateConsistency(
    WorkflowState.READING,
    AgentLoopStatus.ABORTED
  );
  assert.equal(bad.consistent, false);

  const designOk = validateStateConsistency(
    WorkflowState.DESIGNER,
    DesignLoopStatus.EXECUTING,
    "design"
  );
  assert.equal(designOk.consistent, true);
});

test("StateSynchronizer updates workflow and tracks agent status", async () => {
  const { StateSynchronizer } = await loadUnifiedModule();
  const { WorkflowState } = await loadWorkflowStates();
  const { AgentLoopStatus } = await loadDeepsearchStates();
  const { DesignLoopStatus } = await loadDesignStates();

  const context = { state: WorkflowState.READING };
  const sync = new StateSynchronizer(context);

  sync.handleAgentEvent("deepsearch.agent.status.changed", {
    to: AgentLoopStatus.RUNNING,
  });
  assert.equal(context.state, WorkflowState.RESEARCHING);
  assert.equal(sync.getAgentStatus("deepsearch"), AgentLoopStatus.RUNNING);

  context.state = WorkflowState.DESIGN_PREFERENCES;
  sync.handleAgentEvent("design.started");
  assert.equal(context.state, WorkflowState.DESIGNER);

  sync.handleAgentEvent("design.loop.status.changed", {
    to: DesignLoopStatus.EXECUTING,
  });
  const report = sync.checkConsistency();
  assert.equal(report.consistent, true);
  assert.equal(report.design.actual, DesignLoopStatus.EXECUTING);
});
