import { describe, it, expect, vi, beforeEach } from 'vitest';

const MODULE_PATH = '../../../../../js/agents/stages/deepsearch/stage-utils.js';

const stateUtilsMock = vi.hoisted(() => ({
  EVENT_SCHEMA_VERSION: 'test.schema.v1',
  EventStatus: Object.freeze({
    STARTED: 'started',
    PROGRESS: 'progress',
    COMPLETED: 'completed',
    FAILED: 'failed',
    WARNING: 'warning',
    INFO: 'info',
  }),
}));

vi.mock('../../../../../js/agents/stages/deepsearch/utils/state-utils.js', () => stateUtilsMock);

const loadModule = async () => {
  vi.resetModules();
  return import(MODULE_PATH);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('makeStageEmitter', () => {
  it('returns null when no emitter exists on stageApi', async () => {
    const { makeStageEmitter } = await loadModule();
    const inputs = [null, undefined, {}, [], { emit: 'nope' }, { eventBus: {} }, { eventBus: { emit: 'nope' } }];
    for (const input of inputs) {
      expect(makeStageEmitter(input)).toBeNull();
    }
  });

  it('emits with schema metadata, context, and default status', async () => {
    const { makeStageEmitter } = await loadModule();
    vi.useFakeTimers();
    const now = new Date('2024-02-01T00:00:00.000Z');
    vi.setSystemTime(now);

    const emit = vi.fn();
    const deepContext = { runId: 'run-1', nested: { level1: { level2: { level3: { value: 'deep' } } } } };
    const getContext = vi.fn(() => deepContext);
    const emitter = makeStageEmitter({ emit }, undefined, getContext);
    const payload = { step: 1, items: [] };

    emitter('progress', payload, { throttle: false });

    expect(emit).toHaveBeenCalledTimes(1);
    const [name, event] = emit.mock.calls[0];
    expect(name).toBe('progress');
    expect(event).toEqual(
      expect.objectContaining({
        schemaVersion: stateUtilsMock.EVENT_SCHEMA_VERSION,
        name: 'progress',
        actor: 'deepsearch',
        status: stateUtilsMock.EventStatus.COMPLETED,
        payload,
        ...deepContext,
      })
    );
    expect(event.ts).toBe(now.toISOString());
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it('uses eventBus.emit and preserves empty/whitespace boundaries', async () => {
    const { makeStageEmitter } = await loadModule();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-01T00:00:00.000Z'));

    const eventBus = { emit: vi.fn() };
    const emitter = makeStageEmitter({ eventBus }, '   ');
    const payload = [];

    emitter('', payload, { status: '', throttle: false });

    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    const [name, event] = eventBus.emit.mock.calls[0];
    expect(name).toBe('');
    expect(event).toEqual(
      expect.objectContaining({
        schemaVersion: stateUtilsMock.EVENT_SCHEMA_VERSION,
        name: '',
        actor: '   ',
        status: '',
        payload,
      })
    );
  });

  it('throttles rapid calls for the same event name', async () => {
    const { makeStageEmitter } = await loadModule();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-01T00:00:00.000Z'));

    const emit = vi.fn();
    const emitter = makeStageEmitter({ emit });

    emitter('tick', { step: 1 });
    emitter('tick', { step: 2 });
    expect(emit).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2024-02-01T00:00:00.050Z'));
    emitter('tick', { step: 3 });
    expect(emit).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2024-02-01T00:00:00.100Z'));
    emitter('tick', { step: 4 });
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('allows concurrent calls for different event names', async () => {
    const { makeStageEmitter } = await loadModule();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-01T00:00:00.000Z'));

    const emit = vi.fn();
    const emitter = makeStageEmitter({ emit });

    await Promise.all([
      Promise.resolve().then(() => emitter('alpha', { n: 1 })),
      Promise.resolve().then(() => emitter('beta', { n: 2 })),
    ]);

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.map((call) => call[0]).sort()).toEqual(['alpha', 'beta']);
  });

  it('allows rapid calls when throttle is disabled and passes through large payloads', async () => {
    const { makeStageEmitter } = await loadModule();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-01T00:00:00.000Z'));

    const emit = vi.fn();
    const emitter = makeStageEmitter({ emit }, 'deepsearch', null);
    const hugeString = 'x'.repeat(200000);
    const arrayLike = { 0: 'x', length: 1 };

    emitter('bulk', null, { throttle: false });
    emitter('bulk', arrayLike, { throttle: false });
    emitter('bulk', hugeString, { throttle: false });

    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit.mock.calls[0][1].payload).toBeNull();
    expect(emit.mock.calls[1][1].payload).toBe(arrayLike);
    expect(emit.mock.calls[2][1].payload).toBe(hugeString);
  });
});

describe('generateNodeId', () => {
  it('builds ids using custom idFactory when provided', async () => {
    const { generateNodeId } = await loadModule();
    const id = generateNodeId('run1', 'node', {
      stage: 'stage',
      iteration: 0,
      trajectoryId: 'traj',
      idFactory: vi.fn(({ prefix }) => `${prefix}__custom`),
    });

    expect(id).toBe('run1_node_stage_i0_traj__custom');
  });

  it('generates secure timestamped ids by default', async () => {
    const { generateNodeId } = await loadModule();
    const first = generateNodeId('run', 'node', { stage: 'stage', iteration: 1 });
    const second = generateNodeId('run', 'node', { stage: 'stage', iteration: 1 });

    expect(first.startsWith('run_node_stage_i1_')).toBe(true);
    expect(second.startsWith('run_node_stage_i1_')).toBe(true);
    expect(first).not.toBe(second);
  });

  it('defaults runId/kind and ignores non-number iteration', async () => {
    const { generateNodeId } = await loadModule();

    const idEmpty = generateNodeId('', '', { iteration: '3' });
    expect(idEmpty.startsWith('run_node_')).toBe(true);
    expect(idEmpty.includes('_i3_')).toBe(false);
  });

  it('supports very long runId and kind strings', async () => {
    const { generateNodeId } = await loadModule();

    const longRunId = 'r'.repeat(5000);
    const longKind = 'k'.repeat(4000);
    const id = generateNodeId(longRunId, longKind);

    expect(id.startsWith(`${longRunId}_${longKind}_`)).toBe(true);
  });
});

describe('checkCancelled', () => {
  it('ignores empty inputs and non-aborted signals', async () => {
    const { checkCancelled } = await loadModule();
    const inputs = [null, undefined, {}, [], { signal: {} }, { signal: { aborted: false } }];
    for (const input of inputs) {
      expect(() => checkCancelled(input)).not.toThrow();
    }
  });

  it('calls stageApi.checkCancelled when provided', async () => {
    const { checkCancelled } = await loadModule();
    const stageApi = { checkCancelled: vi.fn(), signal: { aborted: false } };

    checkCancelled(stageApi);

    expect(stageApi.checkCancelled).toHaveBeenCalledTimes(1);
  });

  it('throws with signal reason when aborted', async () => {
    const { checkCancelled } = await loadModule();
    const stageApi = { signal: { aborted: true, reason: 'Stopped' } };

    expect(() => checkCancelled(stageApi)).toThrow('Stopped');
  });

  it('throws default message for non-string signal reasons', async () => {
    const { checkCancelled } = await loadModule();
    const stageApi = { signal: { aborted: true, reason: { code: 123 } } };

    expect(() => checkCancelled(stageApi)).toThrow('Run cancelled');
  });

  it('propagates errors from stageApi.checkCancelled', async () => {
    const { checkCancelled } = await loadModule();
    const error = new Error('Boom');
    const stageApi = { checkCancelled: vi.fn(() => {
      throw error;
    }) };

    expect(() => checkCancelled(stageApi)).toThrow(error);
  });
});
