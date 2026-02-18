import { describe, it, expect } from 'vitest';
import {
  AgentMessageKind,
  TaskStatus,
  AgentRunStatus,
  validateTaskRequest,
  validateTaskResult,
  validateStatusUpdate,
  validateKnowledgeShare,
  validateAgentMessage,
  createTaskRequest,
  createTaskResult,
  createStatusUpdate,
  createKnowledgeShare,
  isValidTaskType,
} from '../../../../../js/agents/core/contracts/agent-message.js';

// ─── Constants ──────────────────────────────────────────

describe('AgentMessageKind', () => {
  it('exposes four message kinds', () => {
    expect(AgentMessageKind).toEqual([
      'task-request',
      'task-result',
      'status-update',
      'knowledge-share',
    ]);
  });
});

describe('TaskStatus', () => {
  it('exposes five statuses', () => {
    expect(TaskStatus).toEqual(['pending', 'running', 'completed', 'failed', 'cancelled']);
  });
});

describe('AgentRunStatus', () => {
  it('exposes five run statuses', () => {
    expect(AgentRunStatus).toEqual(['idle', 'busy', 'degraded', 'stopping', 'stopped']);
  });
});

// ─── validateTaskRequest ────────────────────────────────

describe('validateTaskRequest', () => {
  it('rejects non-object inputs', () => {
    for (const v of [null, undefined, '', 42, true]) {
      expect(validateTaskRequest(v)).toEqual({ ok: false, error: 'TaskRequest: expected object' });
    }
  });

  it('rejects missing agentId', () => {
    expect(validateTaskRequest({ taskType: 'search:execute', payload: {} })).toEqual({
      ok: false,
      error: 'TaskRequest.agentId: required non-empty string',
    });
  });

  it('rejects missing taskType', () => {
    expect(validateTaskRequest({ agentId: 'a1', payload: {} })).toEqual({
      ok: false,
      error: 'TaskRequest.taskType: required non-empty string',
    });
  });

  it('rejects invalid taskType format', () => {
    const invalid = ['ping', 'Ping:action', 'ping:Action', '1x:y', 'x:1y'];
    for (const taskType of invalid) {
      const r = validateTaskRequest({ agentId: 'a1', taskType, payload: null });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('domain:action');
    }
  });

  it('rejects out-of-range priority', () => {
    const r = validateTaskRequest({ agentId: 'a1', taskType: 'search:execute', payload: null, priority: 11 });
    expect(r).toEqual({ ok: false, error: 'TaskRequest.priority: must be 0-10' });
  });

  it('rejects non-positive timeoutMs', () => {
    const r = validateTaskRequest({ agentId: 'a1', taskType: 'search:execute', payload: null, timeoutMs: 0 });
    expect(r).toEqual({ ok: false, error: 'TaskRequest.timeoutMs: must be positive' });
  });

  it('accepts valid minimal request', () => {
    const r = validateTaskRequest({ agentId: 'a1', taskType: 'search:execute', payload: { q: 'test' } });
    expect(r.ok).toBe(true);
    expect(r.value.kind).toBe('task-request');
    expect(r.value.agentId).toBe('a1');
    expect(r.value.taskType).toBe('search:execute');
    expect(r.value.payload).toEqual({ q: 'test' });
    expect(r.value.priority).toBe(5);
    expect(typeof r.value.ts).toBe('number');
  });

  it('preserves optional fields', () => {
    const r = validateTaskRequest({
      agentId: 'a1',
      targetAgentId: 'b2',
      taskType: 'search:execute',
      payload: null,
      correlationId: 'c1',
      priority: 0,
      timeoutMs: 5000,
      ts: 1000,
    });
    expect(r.ok).toBe(true);
    expect(r.value.targetAgentId).toBe('b2');
    expect(r.value.correlationId).toBe('c1');
    expect(r.value.priority).toBe(0);
    expect(r.value.timeoutMs).toBe(5000);
    expect(r.value.ts).toBe(1000);
  });

  it('defaults priority to 5 when not provided', () => {
    const r = validateTaskRequest({ agentId: 'a1', taskType: 'search:execute', payload: null });
    expect(r.ok).toBe(true);
    expect(r.value.priority).toBe(5);
  });

  it('rejects invalid trace payload as a hard validation error', () => {
    expect(validateTaskRequest({
      agentId: 'a1',
      taskType: 'search:execute',
      payload: null,
      trace: { spanId: 'missing-trace-id' },
    })).toEqual({
      ok: false,
      error: 'TaskRequest.trace.traceId: required non-empty string',
    });
  });
});

// ─── validateTaskResult ─────────────────────────────────

describe('validateTaskResult', () => {
  it('rejects non-object inputs', () => {
    expect(validateTaskResult(null)).toEqual({ ok: false, error: 'TaskResult: expected object' });
  });

  it('rejects missing agentId', () => {
    expect(validateTaskResult({ correlationId: 'c1', status: 'completed' })).toEqual({
      ok: false,
      error: 'TaskResult.agentId: required non-empty string',
    });
  });

  it('rejects missing correlationId', () => {
    expect(validateTaskResult({ agentId: 'a1', status: 'completed' })).toEqual({
      ok: false,
      error: 'TaskResult.correlationId: required non-empty string',
    });
  });

  it('rejects invalid status', () => {
    const r = validateTaskResult({ agentId: 'a1', correlationId: 'c1', status: 'unknown' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('must be one of');
  });

  it('accepts all valid statuses', () => {
    for (const status of TaskStatus) {
      const r = validateTaskResult({ agentId: 'a1', correlationId: 'c1', status });
      expect(r.ok).toBe(true);
      expect(r.value.status).toBe(status);
    }
  });

  it('preserves optional data/error/durationMs', () => {
    const r = validateTaskResult({
      agentId: 'a1',
      correlationId: 'c1',
      status: 'completed',
      data: { results: [1, 2] },
      error: 'partial',
      durationMs: 150,
      ts: 2000,
    });
    expect(r.ok).toBe(true);
    expect(r.value.data).toEqual({ results: [1, 2] });
    expect(r.value.error).toBe('partial');
    expect(r.value.durationMs).toBe(150);
    expect(r.value.ts).toBe(2000);
  });

  it('rejects invalid trace payload', () => {
    expect(validateTaskResult({
      agentId: 'a1',
      correlationId: 'c1',
      status: 'completed',
      trace: 'oops',
    })).toEqual({
      ok: false,
      error: 'TaskResult.trace: expected object',
    });
  });
});

// ─── validateStatusUpdate ───────────────────────────────

describe('validateStatusUpdate', () => {
  it('rejects non-object inputs', () => {
    expect(validateStatusUpdate(42)).toEqual({ ok: false, error: 'StatusUpdate: expected object' });
  });

  it('rejects missing agentId', () => {
    expect(validateStatusUpdate({ status: 'idle' })).toEqual({
      ok: false,
      error: 'StatusUpdate.agentId: required non-empty string',
    });
  });

  it('rejects invalid status', () => {
    const r = validateStatusUpdate({ agentId: 'a1', status: 'exploding' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('must be one of');
  });

  it('rejects out-of-range progress', () => {
    expect(validateStatusUpdate({ agentId: 'a1', status: 'busy', progress: 101 })).toEqual({
      ok: false,
      error: 'StatusUpdate.progress: must be 0-100',
    });
    expect(validateStatusUpdate({ agentId: 'a1', status: 'busy', progress: -1 })).toEqual({
      ok: false,
      error: 'StatusUpdate.progress: must be 0-100',
    });
  });

  it('accepts all valid run statuses', () => {
    for (const status of AgentRunStatus) {
      const r = validateStatusUpdate({ agentId: 'a1', status });
      expect(r.ok).toBe(true);
      expect(r.value.status).toBe(status);
    }
  });

  it('preserves optional fields', () => {
    const r = validateStatusUpdate({
      agentId: 'a1',
      status: 'busy',
      currentTask: 'Analyzing documents',
      progress: 75,
      meta: { tokensUsed: 1234 },
      ts: 3000,
    });
    expect(r.ok).toBe(true);
    expect(r.value.currentTask).toBe('Analyzing documents');
    expect(r.value.progress).toBe(75);
    expect(r.value.meta).toEqual({ tokensUsed: 1234 });
  });

  it('rejects invalid trace payload', () => {
    expect(validateStatusUpdate({
      agentId: 'a1',
      status: 'idle',
      trace: { traceId: '' },
    })).toEqual({
      ok: false,
      error: 'StatusUpdate.trace.traceId: required non-empty string',
    });
  });
});

// ─── validateKnowledgeShare ─────────────────────────────

describe('validateKnowledgeShare', () => {
  it('rejects non-object inputs', () => {
    expect(validateKnowledgeShare(null)).toEqual({ ok: false, error: 'KnowledgeShare: expected object' });
  });

  it('rejects missing agentId', () => {
    expect(validateKnowledgeShare({ topic: 'findings', content: 'data' })).toEqual({
      ok: false,
      error: 'KnowledgeShare.agentId: required non-empty string',
    });
  });

  it('rejects missing topic', () => {
    expect(validateKnowledgeShare({ agentId: 'a1', content: 'data' })).toEqual({
      ok: false,
      error: 'KnowledgeShare.topic: required non-empty string',
    });
  });

  it('rejects missing content', () => {
    expect(validateKnowledgeShare({ agentId: 'a1', topic: 'findings' })).toEqual({
      ok: false,
      error: 'KnowledgeShare.content: required',
    });
  });

  it('rejects invalid contentType', () => {
    const r = validateKnowledgeShare({ agentId: 'a1', topic: 'x', content: 'y', contentType: 'binary' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('text/json/reference');
  });

  it('accepts valid contentTypes', () => {
    for (const contentType of ['text', 'json', 'reference']) {
      const r = validateKnowledgeShare({ agentId: 'a1', topic: 'x', content: 'y', contentType });
      expect(r.ok).toBe(true);
      expect(r.value.contentType).toBe(contentType);
    }
  });

  it('preserves optional fields', () => {
    const r = validateKnowledgeShare({
      agentId: 'a1',
      targetAgentId: 'b2',
      topic: 'findings',
      content: { key: 'value' },
      contentType: 'json',
      correlationId: 'c1',
      ts: 4000,
    });
    expect(r.ok).toBe(true);
    expect(r.value.targetAgentId).toBe('b2');
    expect(r.value.correlationId).toBe('c1');
    expect(r.value.content).toEqual({ key: 'value' });
  });

  it('rejects invalid trace payload', () => {
    expect(validateKnowledgeShare({
      agentId: 'a1',
      topic: 'x',
      content: 'y',
      trace: 123,
    })).toEqual({
      ok: false,
      error: 'KnowledgeShare.trace: expected object',
    });
  });
});

// ─── validateAgentMessage (dispatch) ────────────────────

describe('validateAgentMessage', () => {
  it('rejects non-object inputs', () => {
    expect(validateAgentMessage(null)).toEqual({ ok: false, error: 'AgentMessage: expected object' });
  });

  it('rejects missing or invalid kind', () => {
    expect(validateAgentMessage({ agentId: 'a1' })).toEqual({
      ok: false,
      error: expect.stringContaining('AgentMessage.kind'),
    });
    expect(validateAgentMessage({ kind: 'unknown', agentId: 'a1' })).toEqual({
      ok: false,
      error: expect.stringContaining('must be one of'),
    });
  });

  it('dispatches to correct validator based on kind', () => {
    const req = validateAgentMessage({
      kind: 'task-request',
      agentId: 'a1',
      taskType: 'search:execute',
      payload: null,
    });
    expect(req.ok).toBe(true);
    expect(req.value.kind).toBe('task-request');

    const res = validateAgentMessage({
      kind: 'task-result',
      agentId: 'a1',
      correlationId: 'c1',
      status: 'completed',
    });
    expect(res.ok).toBe(true);
    expect(res.value.kind).toBe('task-result');

    const upd = validateAgentMessage({
      kind: 'status-update',
      agentId: 'a1',
      status: 'idle',
    });
    expect(upd.ok).toBe(true);
    expect(upd.value.kind).toBe('status-update');

    const ks = validateAgentMessage({
      kind: 'knowledge-share',
      agentId: 'a1',
      topic: 'findings',
      content: 'data',
    });
    expect(ks.ok).toBe(true);
    expect(ks.value.kind).toBe('knowledge-share');
  });

  it('propagates validation errors from sub-validators', () => {
    const r = validateAgentMessage({
      kind: 'task-request',
      agentId: 'a1',
      taskType: 'bad-format',
      payload: null,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('domain:action');
  });

  it('never returns ok:true with an error field when trace is invalid', () => {
    const r = validateAgentMessage({
      kind: 'task-result',
      agentId: 'a1',
      correlationId: 'c1',
      status: 'completed',
      trace: { spanId: 'missing' },
    });
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty('value');
  });
});

describe('isValidTaskType', () => {
  it('validates domain:action format', () => {
    expect(isValidTaskType('search:execute')).toBe(true);
    expect(isValidTaskType('search:Execute')).toBe(false);
    expect(isValidTaskType('invalid')).toBe(false);
  });
});

// ─── Factory functions ──────────────────────────────────

describe('createTaskRequest', () => {
  it('creates a valid TaskRequest', () => {
    const msg = createTaskRequest('a1', 'search:execute', { q: 'test' });
    expect(msg.kind).toBe('task-request');
    expect(msg.agentId).toBe('a1');
    expect(msg.taskType).toBe('search:execute');
    expect(msg.payload).toEqual({ q: 'test' });
    expect(msg.priority).toBe(5);
    expect(typeof msg.ts).toBe('number');

    const validated = validateTaskRequest(msg);
    expect(validated.ok).toBe(true);
  });

  it('passes optional fields through', () => {
    const msg = createTaskRequest('a1', 'search:execute', null, {
      targetAgentId: 'b2',
      correlationId: 'c1',
      priority: 1,
      timeoutMs: 5000,
    });
    expect(msg.targetAgentId).toBe('b2');
    expect(msg.correlationId).toBe('c1');
    expect(msg.priority).toBe(1);
    expect(msg.timeoutMs).toBe(5000);
  });
});

describe('createTaskResult', () => {
  it('creates a valid TaskResult', () => {
    const msg = createTaskResult('a1', 'c1', 'completed', { data: { ok: true } });
    expect(msg.kind).toBe('task-result');
    expect(msg.status).toBe('completed');
    expect(msg.data).toEqual({ ok: true });

    const validated = validateTaskResult(msg);
    expect(validated.ok).toBe(true);
  });
});

describe('createStatusUpdate', () => {
  it('creates a valid StatusUpdate', () => {
    const msg = createStatusUpdate('a1', 'busy', { progress: 50 });
    expect(msg.kind).toBe('status-update');
    expect(msg.status).toBe('busy');
    expect(msg.progress).toBe(50);

    const validated = validateStatusUpdate(msg);
    expect(validated.ok).toBe(true);
  });
});

describe('createKnowledgeShare', () => {
  it('creates a valid KnowledgeShare', () => {
    const msg = createKnowledgeShare('a1', 'findings', { key: 'value' }, { contentType: 'json' });
    expect(msg.kind).toBe('knowledge-share');
    expect(msg.topic).toBe('findings');
    expect(msg.contentType).toBe('json');

    const validated = validateKnowledgeShare(msg);
    expect(validated.ok).toBe(true);
  });
});

// ─── Roundtrip: factory → validate ──────────────────────

describe('roundtrip: factory → validateAgentMessage', () => {
  it('all factory outputs pass validateAgentMessage', () => {
    const messages = [
      createTaskRequest('a1', 'search:execute', { q: 'test' }),
      createTaskResult('a1', 'c1', 'completed'),
      createStatusUpdate('a1', 'idle'),
      createKnowledgeShare('a1', 'findings', 'some text'),
    ];

    for (const msg of messages) {
      const r = validateAgentMessage(msg);
      expect(r.ok).toBe(true);
    }
  });
});
