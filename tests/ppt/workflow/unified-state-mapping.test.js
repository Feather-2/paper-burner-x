const test = require("node:test");
const assert = require("node:assert/strict");

async function loadUnifiedModule() {
  return await import("../../../js/ppt/workflow/unified-state-mapping.js");
}

async function loadWorkflowStates() {
  return await import("../../../js/ppt/workflow/workflow-states.js");
}

async function loadAgentStatus() {
  return await import("../../../js/agents/runtime/core/agent-status.js");
}

test("AgentToWorkflowMap maps deepsearch and design statuses", async () => {
  const { AgentToWorkflowMap } = await loadUnifiedModule();
  const { WorkflowState } = await loadWorkflowStates();
  const { AgentStatus } = await loadAgentStatus();

  // 简化后只有 IDLE, RUNNING, PAUSED, COMPLETED, FAILED
  assert.equal(
    AgentToWorkflowMap.deepsearch[AgentStatus.PAUSED],
    WorkflowState.DEEPSEARCH_REVIEW
  );
  assert.equal(
    AgentToWorkflowMap.deepsearch[AgentStatus.COMPLETED],
    WorkflowState.SCRIPT_REVIEW
  );
  assert.equal(
    AgentToWorkflowMap.design[AgentStatus.IDLE],
    null // IDLE 不映射到任何 WorkflowState
  );
  assert.equal(
    AgentToWorkflowMap.design[AgentStatus.COMPLETED],
    WorkflowState.COMPLETED
  );
});

test("inferWorkflowStateFromEvent handles deepsearch/design/ingest events", async () => {
  const { inferWorkflowStateFromEvent } = await loadUnifiedModule();
  const { WorkflowState } = await loadWorkflowStates();
  const { AgentStatus } = await loadAgentStatus();

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
  // 简化后 status.changed 使用 AgentStatus.RUNNING
  assert.equal(
    inferWorkflowStateFromEvent(
      "deepsearch.agent.status.changed",
      WorkflowState.RESEARCHING,
      { to: AgentStatus.RUNNING }
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
  const { AgentStatus } = await loadAgentStatus();

  // 简化后 RESEARCHING 期望 RUNNING
  const ok = validateStateConsistency(
    WorkflowState.RESEARCHING,
    AgentStatus.RUNNING
  );
  assert.equal(ok.consistent, true);
  assert.ok(ok.expected.includes(AgentStatus.RUNNING));

  // FAILED 不在 READING 的期望范围内
  const bad = validateStateConsistency(
    WorkflowState.READING,
    AgentStatus.FAILED
  );
  assert.equal(bad.consistent, false);

  // DESIGNER 期望 RUNNING 或 PAUSED
  const designOk = validateStateConsistency(
    WorkflowState.DESIGNER,
    AgentStatus.RUNNING,
    "design"
  );
  assert.equal(designOk.consistent, true);
});

test("StateSynchronizer updates workflow and tracks agent status", async () => {
  const { StateSynchronizer } = await loadUnifiedModule();
  const { WorkflowState } = await loadWorkflowStates();
  const { AgentStatus } = await loadAgentStatus();

  const context = { state: WorkflowState.READING };
  const sync = new StateSynchronizer(context);

  sync.handleAgentEvent("deepsearch.agent.status.changed", {
    to: AgentStatus.RUNNING,
  });
  assert.equal(context.state, WorkflowState.RESEARCHING);
  assert.equal(sync.getAgentStatus("deepsearch"), AgentStatus.RUNNING);

  context.state = WorkflowState.DESIGN_PREFERENCES;
  sync.handleAgentEvent("design.started");
  assert.equal(context.state, WorkflowState.DESIGNER);

  sync.handleAgentEvent("design.agent.status.changed", {
    to: AgentStatus.RUNNING,
  });
  const report = sync.checkConsistency();
  assert.equal(report.consistent, true);
  assert.equal(report.design.actual, AgentStatus.RUNNING);
});
