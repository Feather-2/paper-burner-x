import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UIEventBus } from '../../../js/ppt/ui-v2/core/event-bus.js';
import { AgentStatus } from '../../../js/agents/runtime/core/agent-status.js';
import { StateStore, ViewType, WorkflowState } from '../../../js/ppt/ui-v2/core/state-store.js';

describe('StateStore (agent/event handling)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('handles run.* and ingest.* lifecycle events', () => {
    const bus = new UIEventBus();
    const store = new StateStore(bus);

    bus.emit('run.started', { runId: 'run-1' });
    expect(store.get('workflow.state')).toBe(WorkflowState.READING);
    expect(store.get('workflow.startedAt')).toBe(Date.now());
    expect(store.get('workflow.runId')).toBe('run-1');
    expect(store.get('ui.view')).toBe(ViewType.DEEPSEARCH_PREMIUM);

    vi.setSystemTime(new Date('2024-01-01T00:00:01Z'));
    bus.emit('ingest.completed', { runId: 'run-1' });
    expect(store.get('workflow.state')).toBe(WorkflowState.SCANNING);
    expect(store.get('ui.view')).toBe(ViewType.DEEPSEARCH_PREMIUM);

    vi.setSystemTime(new Date('2024-01-01T00:00:02Z'));
    bus.emit('run.failed', { error: 'boom', runId: 'run-2' });
    expect(store.get('workflow.state')).toBe(WorkflowState.FAILED);
    expect(store.get('workflow.error')).toBe('boom');
    expect(store.get('workflow.completedAt')).toBe(Date.now());
    expect(store.get('workflow.runId')).toBe('run-2');
    expect(store.get('ui.view')).toBe(ViewType.FAILED);

    vi.setSystemTime(new Date('2024-01-01T00:00:03Z'));
    bus.emit('run.cancelled', { reason: 'user_cancelled', runId: 'run-3' });
    expect(store.get('workflow.state')).toBe(WorkflowState.IDLE);
    expect(store.get('workflow.error')).toBe('user_cancelled');
    expect(store.get('workflow.completedAt')).toBe(Date.now());
    expect(store.get('workflow.runId')).toBe('run-3');
    expect(store.get('ui.view')).toBe(ViewType.UPLOAD);
  });

  it('maps deepsearch agent status updates into workflow/view and preserves progress fields', () => {
    const bus = new UIEventBus();
    const store = new StateStore(bus);

    expect(store.get('workflow.state')).toBe(WorkflowState.IDLE);
    expect(store.get('deepsearch.status')).toBe('idle');

    bus.emit('deepsearch.agent.status.changed', { to: AgentStatus.RUNNING, runId: 'run-1' });
    expect(store.get('workflow.state')).toBe(WorkflowState.RESEARCHING);
    expect(store.get('workflow.startedAt')).toBe(Date.now());
    expect(store.get('workflow.runId')).toBe('run-1');
    expect(store.get('ui.view')).toBe(ViewType.DEEPSEARCH_PREMIUM);
    expect(store.get('deepsearch.loopStatus')).toBe(AgentStatus.RUNNING);
    expect(store.get('deepsearch.status')).toBe('running');

    bus.emit('deepsearch.agent.paused', {});
    expect(store.get('deepsearch.loopStatus')).toBe('paused');
    expect(store.get('deepsearch.status')).toBe('paused');
    expect(store.get('workflow.state')).toBe(WorkflowState.DEEPSEARCH_REVIEW);
    expect(store.get('ui.view')).toBe(ViewType.DEEPSEARCH_REVIEW);

    // Progress events merge with previous values.
    bus.emit('deepsearch.any.progress', { phase: 'retrieve', current: 1, total: 3, msg: 'step 1' });
    expect(store.get('deepsearch.progress')).toEqual(
      expect.objectContaining({ phase: 'retrieve', current: 1, total: 3, message: 'step 1' }),
    );

    bus.emit('deepsearch.other.progress', { current: 2 });
    expect(store.get('deepsearch.progress')).toEqual(
      expect.objectContaining({ phase: 'retrieve', current: 2, total: 3, message: '' }),
    );
  });

  it('handles deepsearch completion workflowMode=auto vs manual and iteration updates', () => {
    const bus = new UIEventBus();
    const store = new StateStore(bus);

    store.set('data.workflowMode', 'auto');
    bus.emit('deepsearch.agent.completed', { iteration: 0 });
    expect(store.get('deepsearch.iteration')).toBe(1);
    expect(store.get('workflow.state')).toBe(WorkflowState.SCRIPT_REVIEW);
    expect(store.get('ui.view')).toBe(ViewType.SCRIPT_REVIEW);

    store.reset();
    store.set('data.workflowMode', 'manual');
    bus.emit('deepsearch.completed', { iterations: 2 });
    expect(store.get('deepsearch.iteration')).toBe(2);
    expect(store.get('workflow.state')).toBe(WorkflowState.DEEPSEARCH_REVIEW);
    expect(store.get('ui.view')).toBe(ViewType.DEEPSEARCH_REVIEW);
  });

  it('collects agent logs and handles evidence/draft events', () => {
    const bus = new UIEventBus();
    const store = new StateStore(bus);

    bus.emit('deepsearch.log.warn', { message: 'hi', stage: 'scan', iteration: 0, data: { reason: 'x' } });

    const logs = store.get('ui.logs');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual(
      expect.objectContaining({
        scope: 'deepsearch',
        level: 'warning',
        message: 'hi',
        stage: 'scan',
        iteration: 1,
        reason: 'x',
        timestamp: Date.now(),
      }),
    );

    // Evidence list caps at 20.
    for (let i = 0; i < 25; i++) {
      bus.emit('deepsearch.evidence.synthesized', { evidenceId: `e${i}`, source: 's', content: String(i) });
    }
    expect(store.get('deepsearch.evidences')).toHaveLength(20);
    expect(store.get('deepsearch.evidences')[0].id).toBe('e5');

    vi.setSystemTime(new Date('2024-01-01T00:00:05Z'));
    bus.emit('deepsearch.draft.updated', { sectionId: 'sec', phrase: 'draft', isComplete: true });
    expect(store.get('deepsearch.draftPreview')).toEqual(
      expect.objectContaining({ sectionId: 'sec', phrase: 'draft', isComplete: true, updatedAt: Date.now() }),
    );
  });

  it('handles design timeline events and cleans up subscriptions on destroy()', () => {
    const bus = new UIEventBus();
    const store = new StateStore(bus);

    bus.emit('design.phase.transition', { from: 'idle', to: 'theme' });
    expect(store.get('design.currentPhase')).toBe('theme');
    expect(store.get('design.previousPhase')).toBe('idle');

    bus.emit('design.batch.started', { batchIndex: 1, batchSize: 2, slideIds: ['s1', 's2'] });
    expect(store.get('design.currentBatch')).toEqual(
      expect.objectContaining({ batchIndex: 1, batchSize: 2, slideIds: ['s1', 's2'], status: 'running' }),
    );

    bus.emit('design.slide.started', { slideIndex: 0, slideId: 'slide-1', slideIntentId: 'intent-1', title: 'T' });
    expect(store.get('design.currentSlide')).toEqual(
      expect.objectContaining({ slideIndex: 0, slideId: 'slide-1', slideIntentId: 'intent-1', title: 'T', status: 'generating' }),
    );

    bus.emit('design.slide.completed', { slideIndex: 0, slideId: 'slide-1', status: 'ok' });
    expect(store.get('design.currentSlide')).toEqual(expect.objectContaining({ slideIndex: 0, slideId: 'slide-1', status: 'ok' }));

    bus.emit('design.deck.updated', { deckHtmlDsl: '<deck/>', slidesMeta: [{ id: 's1' }] });
    expect(store.get('design.deckHtmlDsl')).toBe('<deck/>');
    expect(store.get('design.slidesMeta')).toEqual([{ id: 's1' }]);

    vi.setSystemTime(new Date('2024-01-01T00:00:06Z'));
    bus.emit('design.chat.ask', { question: 'Q', options: ['A'] });
    expect(store.get('design.pendingChatAsk')).toEqual(
      expect.objectContaining({ question: 'Q', options: ['A'], timestamp: Date.now() }),
    );

    // destroy unsubscribes from bus; subsequent events should not change state.
    store.destroy();
    bus.emit('design.phase.transition', { from: 'theme', to: 'completed' });
    expect(store.get('design.currentPhase')).toBe('theme');
  });
});

