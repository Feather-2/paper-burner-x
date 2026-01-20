import { describe, it, expect, vi, beforeEach } from 'vitest';

const emitterMocks = vi.hoisted(() => ({
  emit: vi.fn(),
}));

vi.mock('virtual:design-stage-emitter', () => ({ emit: emitterMocks.emit }), { virtual: true });

import { emit as externalEmit } from 'virtual:design-stage-emitter';
import safeEmitModule, {
  safeEmit,
} from '../../../../../../js/agents/stages/design/shared/safe-emit.js';

const makeDeepNestedObject = () => {
  let root = { level: 0 };
  let current = root;
  for (let i = 1; i <= 25; i += 1) {
    const next = { level: i };
    current.child = next;
    current = next;
  }
  return root;
};

const boundaryCases = [
  { name: 'null', value: null },
  { name: 'undefined', value: undefined },
  { name: 'empty string', value: '' },
  { name: 'whitespace string', value: '   ' },
  { name: 'empty array', value: [] },
  { name: 'empty object', value: {} },
  { name: 'zero', value: 0 },
  { name: 'negative one', value: -1 },
  { name: 'max safe integer', value: Number.MAX_SAFE_INTEGER },
  { name: 'string number', value: '123' },
  { name: 'array-like object', value: { 0: 'a', length: 1 } },
  { name: 'long string', value: 'x'.repeat(10000) },
  { name: 'huge file', value: new Uint8Array(1024 * 1024 * 2) },
  { name: 'deep nested object', value: makeDeepNestedObject() },
];

beforeEach(() => {
  vi.resetAllMocks();
});

describe('safeEmit', () => {
  it('emits design-stage events when emit is a function', () => {
    const payload = { id: 'payload' };

    safeEmit(externalEmit, 'design:event', 'ok', payload);

    expect(externalEmit).toHaveBeenCalledTimes(1);
    const [name, event] = externalEmit.mock.calls[0];
    expect(name).toBe('design:event');
    expect(event.actor).toBe('design');
    expect(event.status).toBe('ok');
    expect(event.payload).toBe(payload);
  });

  it.each(boundaryCases)('skips emission when emit is $name', ({ value }) => {
    expect(() => safeEmit(value, 'event', 'status', { ok: true })).not.toThrow();
    expect(externalEmit).not.toHaveBeenCalled();
  });

  it.each(boundaryCases)('passes through boundary values: $name', ({ value }) => {
    safeEmit(externalEmit, value, value, value);

    expect(externalEmit).toHaveBeenCalledTimes(1);
    const [name, event] = externalEmit.mock.calls[0];
    expect(name).toBe(value);
    expect(event.actor).toBe('design');
    expect(event.status).toBe(value);
    expect(event.payload).toBe(value);
  });

  it('propagates errors from emit', () => {
    const error = new Error('boom');
    const throwingEmit = vi.fn(() => {
      throw error;
    });

    expect(() => safeEmit(throwingEmit, 'event', 'status', {})).toThrow(error);
  });

  it('handles simultaneous calls', async () => {
    const payloads = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const names = payloads.map((payload) => `event:${payload.id}`);
    const statuses = payloads.map((payload) => `status:${payload.id}`);

    await Promise.all(
      payloads.map((payload, index) =>
        Promise.resolve().then(() =>
          safeEmit(externalEmit, names[index], statuses[index], payload)
        )
      )
    );

    expect(externalEmit).toHaveBeenCalledTimes(payloads.length);
    const calledNames = externalEmit.mock.calls.map((call) => call[0]).sort();
    const calledStatuses = externalEmit.mock.calls.map((call) => call[1].status).sort();
    expect(calledNames).toEqual([...names].sort());
    expect(calledStatuses).toEqual([...statuses].sort());
    payloads.forEach((payload) => {
      expect(externalEmit.mock.calls.some((call) => call[1].payload === payload)).toBe(true);
    });
  });

  it('handles rapid successive calls', () => {
    const sequence = [
      { name: 'first', status: 'ready', payload: { step: 1 } },
      { name: 'second', status: 'running', payload: { step: 2 } },
      { name: 'third', status: 'done', payload: { step: 3 } },
    ];

    sequence.forEach((item) => safeEmit(externalEmit, item.name, item.status, item.payload));

    expect(externalEmit).toHaveBeenCalledTimes(sequence.length);
    sequence.forEach((item, index) => {
      const [name, event] = externalEmit.mock.calls[index];
      expect(name).toBe(item.name);
      expect(event.actor).toBe('design');
      expect(event.status).toBe(item.status);
      expect(event.payload).toBe(item.payload);
    });
  });
});

describe('default export', () => {
  it('exposes safeEmit', () => {
    expect(safeEmitModule.safeEmit).toBe(safeEmit);
  });
});
