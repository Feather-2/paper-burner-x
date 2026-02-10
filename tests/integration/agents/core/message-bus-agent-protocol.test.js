import { describe, it, expect, vi } from 'vitest';

// Mock lamport-clock to avoid TDZ issue (class used before declaration at module level)
vi.mock('../../../../js/agents/core/lamport-clock.js', () => {
  let seq = 0;
  return {
    nextTick: () => ({ seq: ++seq, ts: Date.now(), id: `mock_${seq}` }),
    sync: () => {},
    currentSeq: () => seq,
    resetClock: () => { seq = 0; },
    compare: (a, b) => ((a?.seq ?? 0) - (b?.seq ?? 0)),
    stampEvent: (e) => ({ ...e, _clock: { seq: ++seq, ts: Date.now(), id: `mock_${seq}` } }),
    sortByLogicalOrder: (events) => [...(events || [])],
    LamportClock: class LamportClock {
      constructor() { this._seq = 0; }
      tick() { return { seq: ++this._seq, ts: Date.now(), id: `lc_${this._seq}` }; }
      update() { return this.tick(); }
      get() { return { seq: this._seq, ts: Date.now(), id: `lc_${this._seq}` }; }
    },
    LamportClockService: class LamportClockService {
      constructor() { this._seq = 0; }
      nextTick() { return { seq: ++this._seq, ts: Date.now(), id: `svc_${this._seq}` }; }
      sync() {}
      currentSeq() { return this._seq; }
      resetClock() { this._seq = 0; }
    },
    getDefaultClockService: () => null,
    setDefaultClockService: () => {},
    default: {
      nextTick: () => ({ seq: ++seq, ts: Date.now(), id: `mock_${seq}` }),
      sync: () => {},
      currentSeq: () => seq,
      resetClock: () => { seq = 0; },
      compare: () => 0,
      stampEvent: (e) => e,
      sortByLogicalOrder: (events) => [...(events || [])],
    },
  };
});

import { MessageBus } from '../../../../js/agents/core/message-bus.js';
import { EventBus } from '../../../../js/agents/core/event-bus.js';
import {
  validateAgentMessage,
  createTaskRequest,
  createTaskResult,
  createStatusUpdate,
  createKnowledgeShare,
} from '../../../../js/agents/core/contracts/agent-message.js';

/**
 * Integration: agent-message protocol over MessageBus RPC
 *
 * Uses snake_case event names per EventBus validation: /^[a-z0-9_]+([.:][a-z0-9_]+)*$/
 */

describe('MessageBus + agent-message protocol', () => {
  it('task-request → task-result roundtrip via RPC', async () => {
    const bus = new EventBus();
    const requester = new MessageBus(bus);
    const worker = new MessageBus(bus);

    worker.on('agent:task_request', (payload) => {
      const validated = validateAgentMessage(payload);
      expect(validated.ok).toBe(true);
      expect(validated.value.kind).toBe('task-request');

      return createTaskResult(
        'worker-1',
        validated.value.correlationId || 'no-corr',
        'completed',
        { data: { found: 42 } },
      );
    });

    const request = createTaskRequest('requester-1', 'search:execute', { q: 'test' }, {
      correlationId: 'corr-001',
    });

    const result = await requester.request('agent:task_request', request, { timeoutMs: 2000 });
    const validated = validateAgentMessage({ ...result, kind: 'task-result' });
    expect(validated.ok).toBe(true);
    expect(validated.value.status).toBe('completed');
    expect(validated.value.data).toEqual({ found: 42 });
    expect(validated.value.correlationId).toBe('corr-001');

    requester.dispose();
    worker.dispose();
  });

  it('status-update broadcast via emit/on', async () => {
    const bus = new EventBus();
    const sender = new MessageBus(bus);
    const listener = new MessageBus(bus);

    const received = [];
    listener.on('agent:status_update', (payload) => {
      const v = validateAgentMessage(payload);
      if (v.ok) received.push(v.value);
    });

    sender.emit('agent:status_update', createStatusUpdate('agent-a', 'busy', { progress: 25 }));
    sender.emit('agent:status_update', createStatusUpdate('agent-a', 'busy', { progress: 75 }));
    sender.emit('agent:status_update', createStatusUpdate('agent-a', 'idle'));

    expect(received).toHaveLength(3);
    expect(received[0].status).toBe('busy');
    expect(received[0].progress).toBe(25);
    expect(received[1].progress).toBe(75);
    expect(received[2].status).toBe('idle');

    sender.dispose();
    listener.dispose();
  });

  it('knowledge-share via channel routing', async () => {
    const bus = new EventBus();
    const sharer = new MessageBus(bus);
    const receiver = new MessageBus(bus);

    const received = [];
    receiver.onChannel('research', 'agent:knowledge_share', (payload) => {
      const v = validateAgentMessage(payload);
      if (v.ok) received.push(v.value);
    });

    sharer.emit(
      'agent:knowledge_share',
      createKnowledgeShare('agent-a', 'paper-summary', { abstract: 'AI is great' }, { contentType: 'json' }),
      { channel: 'research' },
    );

    expect(received).toHaveLength(1);
    expect(received[0].topic).toBe('paper-summary');
    expect(received[0].contentType).toBe('json');

    sharer.dispose();
    receiver.dispose();
  });

  it('multi-agent task delegation chain', async () => {
    const bus = new EventBus();
    const coordinator = new MessageBus(bus);
    const searchAgent = new MessageBus(bus);
    const analyzeAgent = new MessageBus(bus);

    searchAgent.on('agent:search', (payload) => {
      const v = validateAgentMessage(payload);
      if (!v.ok) throw new Error(v.error);
      return createTaskResult('search-agent', v.value.correlationId || '', 'completed', {
        data: { documents: ['doc1', 'doc2'] },
      });
    });

    analyzeAgent.on('agent:analyze', (payload) => {
      const v = validateAgentMessage(payload);
      if (!v.ok) throw new Error(v.error);
      return createTaskResult('analyze-agent', v.value.correlationId || '', 'completed', {
        data: { summary: 'Two documents found' },
      });
    });

    const searchResult = await coordinator.request(
      'agent:search',
      createTaskRequest('coordinator', 'search:execute', { q: 'AI' }, { correlationId: 'step-1' }),
      { timeoutMs: 2000 },
    );

    const analyzeResult = await coordinator.request(
      'agent:analyze',
      createTaskRequest('coordinator', 'analyze:summarize', searchResult.data, { correlationId: 'step-2' }),
      { timeoutMs: 2000 },
    );

    expect(analyzeResult.data).toEqual({ summary: 'Two documents found' });

    coordinator.dispose();
    searchAgent.dispose();
    analyzeAgent.dispose();
  });

  it('RPC timeout produces error for unhandled task types', async () => {
    const bus = new EventBus();
    const sender = new MessageBus(bus);

    const request = createTaskRequest('a1', 'unknown:task', {});

    await expect(
      sender.request('agent:no_handler', request, { timeoutMs: 100 }),
    ).rejects.toThrow(/timeout/i);

    sender.dispose();
  });
});
