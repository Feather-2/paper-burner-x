import { afterEach, describe, expect, it, vi } from 'vitest';

import StateSynchronizer, {
  AgentToWorkflowMap,
  UiAgentStatus,
  WorkflowToAgentExpectation,
  inferWorkflowStateFromEvent,
  mapWorkflowStateFromLoopStatus,
  normalizeLoopStatusForUi,
  validateStateConsistency,
} from '../../../js/ppt/workflow/unified-state-mapping.js';
import { WorkflowState } from '../../../js/ppt/workflow/workflow-states.js';
import { AgentStatus } from '../../../js/agents/runtime/core/agent-status.js';

describe('ppt/workflow/unified-state-mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizeLoopStatusForUi maps AgentStatus and tolerates unknown/custom values', () => {
    expect(normalizeLoopStatusForUi(null)).toBe(UiAgentStatus.IDLE);
    expect(normalizeLoopStatusForUi('')).toBe(UiAgentStatus.IDLE);
    expect(normalizeLoopStatusForUi(123)).toBe(UiAgentStatus.IDLE);

    expect(normalizeLoopStatusForUi(AgentStatus.RUNNING)).toBe(UiAgentStatus.RUNNING);
    expect(normalizeLoopStatusForUi(AgentStatus.PAUSED)).toBe(UiAgentStatus.PAUSED);
    expect(normalizeLoopStatusForUi(AgentStatus.COMPLETED)).toBe(UiAgentStatus.COMPLETED);
    expect(normalizeLoopStatusForUi(AgentStatus.FAILED)).toBe(UiAgentStatus.FAILED);
    expect(normalizeLoopStatusForUi('aborted')).toBe(UiAgentStatus.FAILED);

    // Accept already-normalized UI values.
    expect(normalizeLoopStatusForUi(UiAgentStatus.PAUSED)).toBe(UiAgentStatus.PAUSED);

    // Custom defaults.
    expect(normalizeLoopStatusForUi('', { empty: UiAgentStatus.FAILED })).toBe(UiAgentStatus.FAILED);
    expect(normalizeLoopStatusForUi('mystery', { unknown: UiAgentStatus.IDLE })).toBe(UiAgentStatus.IDLE);
  });

  it('mapWorkflowStateFromLoopStatus maps statuses unless current is terminal', () => {
    expect(mapWorkflowStateFromLoopStatus(null, AgentStatus.RUNNING, WorkflowState.READING)).toBeNull();
    expect(mapWorkflowStateFromLoopStatus('deepsearch', null, WorkflowState.READING)).toBeNull();
    expect(mapWorkflowStateFromLoopStatus('deepsearch', AgentStatus.RUNNING, WorkflowState.COMPLETED)).toBeNull();
    expect(mapWorkflowStateFromLoopStatus('deepsearch', AgentStatus.RUNNING, WorkflowState.FAILED)).toBeNull();
    expect(mapWorkflowStateFromLoopStatus('deepsearch', AgentStatus.RUNNING, WorkflowState.DEEPSEARCH_REVIEW)).toBeNull();

    expect(mapWorkflowStateFromLoopStatus('deepsearch', AgentStatus.RUNNING, WorkflowState.READING)).toBe(
      WorkflowState.RESEARCHING,
    );
    expect(mapWorkflowStateFromLoopStatus('deepsearch', AgentStatus.PAUSED, WorkflowState.READING)).toBe(
      WorkflowState.DEEPSEARCH_REVIEW,
    );
    expect(mapWorkflowStateFromLoopStatus('design', AgentStatus.RUNNING, WorkflowState.PAGE_LAYOUT)).toBe(
      WorkflowState.DESIGNER,
    );
  });

  it('inferWorkflowStateFromEvent handles deepsearch/design/ingest events and status changes', () => {
    expect(inferWorkflowStateFromEvent('deepsearch.agent.started', WorkflowState.READING)).toBe(WorkflowState.RESEARCHING);
    expect(inferWorkflowStateFromEvent('deepsearch.agent.completed', WorkflowState.RESEARCHING)).toBe(
      WorkflowState.SCRIPT_REVIEW,
    );
    expect(inferWorkflowStateFromEvent('deepsearch.agent.failed', WorkflowState.RESEARCHING)).toBe(WorkflowState.FAILED);
    expect(inferWorkflowStateFromEvent('deepsearch.agent.paused', WorkflowState.RESEARCHING)).toBe(
      WorkflowState.DEEPSEARCH_REVIEW,
    );

    expect(
      inferWorkflowStateFromEvent('deepsearch.agent.status.changed', WorkflowState.READING, { to: AgentStatus.RUNNING }),
    ).toBe(WorkflowState.RESEARCHING);

    expect(inferWorkflowStateFromEvent('design.started', WorkflowState.PAGE_LAYOUT)).toBe(WorkflowState.DESIGNER);
    expect(inferWorkflowStateFromEvent('design.ended', WorkflowState.DESIGNER)).toBe(WorkflowState.COMPLETED);
    expect(inferWorkflowStateFromEvent('design.phase.transition', WorkflowState.DESIGNER, { to: 'completed' })).toBe(
      WorkflowState.COMPLETED,
    );

    expect(inferWorkflowStateFromEvent('ingest.completed', WorkflowState.READING)).toBe(WorkflowState.SCANNING);
    expect(inferWorkflowStateFromEvent('unknown.event', WorkflowState.READING)).toBeNull();
  });

  it('validateStateConsistency reports expected ranges', () => {
    expect(WorkflowToAgentExpectation[WorkflowState.RESEARCHING]).toEqual([AgentStatus.RUNNING]);

    const ok = validateStateConsistency(WorkflowState.RESEARCHING, AgentStatus.RUNNING);
    expect(ok.consistent).toBe(true);
    expect(ok.expected).toContain(AgentStatus.RUNNING);

    const bad = validateStateConsistency(WorkflowState.READING, AgentStatus.FAILED);
    expect(bad.consistent).toBe(false);
    expect(bad.actual).toBe(AgentStatus.FAILED);
  });

  it('AgentToWorkflowMap includes both deepsearch and design mappings', () => {
    expect(AgentToWorkflowMap.deepsearch[AgentStatus.IDLE]).toBeNull();
    expect(AgentToWorkflowMap.deepsearch[AgentStatus.RUNNING]).toBe(WorkflowState.RESEARCHING);
    expect(AgentToWorkflowMap.deepsearch[AgentStatus.PAUSED]).toBe(WorkflowState.DEEPSEARCH_REVIEW);
    expect(AgentToWorkflowMap.deepsearch[AgentStatus.COMPLETED]).toBe(WorkflowState.SCRIPT_REVIEW);
    expect(AgentToWorkflowMap.deepsearch[AgentStatus.FAILED]).toBe(WorkflowState.FAILED);

    expect(AgentToWorkflowMap.design[AgentStatus.IDLE]).toBeNull();
    expect(AgentToWorkflowMap.design[AgentStatus.RUNNING]).toBe(WorkflowState.DESIGNER);
    expect(AgentToWorkflowMap.design[AgentStatus.PAUSED]).toBe(WorkflowState.DESIGNER);
    expect(AgentToWorkflowMap.design[AgentStatus.COMPLETED]).toBe(WorkflowState.COMPLETED);
    expect(AgentToWorkflowMap.design[AgentStatus.FAILED]).toBe(WorkflowState.FAILED);
  });

  it('StateSynchronizer updates workflow state and tracks agent status', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const context = { state: WorkflowState.READING };
    const sync = new StateSynchronizer(context);

    // From READING -> RESEARCHING via status change.
    sync.handleAgentEvent('deepsearch.agent.status.changed', { to: AgentStatus.RUNNING });
    expect(context.state).toBe(WorkflowState.RESEARCHING);
    expect(sync.getAgentStatus('deepsearch')).toBe(AgentStatus.RUNNING);

    // Transition to DESIGNER via design.started
    context.state = WorkflowState.DESIGN_PREFERENCES;
    sync.handleAgentEvent('design.started');
    expect(context.state).toBe(WorkflowState.DESIGNER);

    // Terminal states ignore further transitions.
    context.state = WorkflowState.COMPLETED;
    sync.handleAgentEvent('design.failed', { error: 'x' });
    expect(context.state).toBe(WorkflowState.COMPLETED);
  });

  it('StateSynchronizer warns when suggested transition is illegal and consistency breaks', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const context = { state: WorkflowState.READING };
    const sync = new StateSynchronizer(context);

    // This suggests DEEPSEARCH_REVIEW, but READING -> DEEPSEARCH_REVIEW is illegal.
    sync.handleAgentEvent('deepsearch.agent.paused');

    expect(context.state).toBe(WorkflowState.READING);
    expect(sync.getAgentStatus('deepsearch')).toBe(AgentStatus.PAUSED);

    const report = sync.checkConsistency();
    expect(report.consistent).toBe(false);
    expect(report.primary).toMatchObject({
      workflowState: WorkflowState.READING,
      actual: AgentStatus.PAUSED,
      agentType: 'deepsearch',
    });

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[StateSynchronizer] 无法转换到 deepsearch_review'),
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[StateSynchronizer] deepsearch.agent.paused 触发后检测到状态不一致:'),
      expect.objectContaining({
        workflowState: WorkflowState.READING,
        agentStatus: AgentStatus.PAUSED,
        agentType: 'deepsearch',
      }),
    );
  });
});
