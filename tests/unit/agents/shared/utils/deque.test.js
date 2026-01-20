import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from 'node:fs';

import { Deque } from '../../../../../js/agents/shared/utils/deque.js';

describe('Deque', () => {
  /** @type {Deque<unknown>} */
  let deque;

  beforeEach(() => {
    deque = new Deque();
    vi.clearAllMocks();
  });

  it('starts empty for default or empty iterables', () => {
    const emptyDefault = new Deque();
    const emptyUndefined = new Deque(undefined);
    const emptyArray = new Deque([]);
    const emptyString = new Deque('');
    const emptySet = new Deque(new Set());

    expect(emptyDefault.size).toBe(0);
    expect(emptyUndefined.isEmpty()).toBe(true);
    expect(emptyArray.toArray()).toEqual([]);
    expect(emptyString.size).toBe(0);
    expect(emptySet.isEmpty()).toBe(true);
  });

  it('constructs from iterables and preserves order', () => {
    const fromArray = new Deque([1, 2, 3]);
    const fromSet = new Deque(new Set(['a', 'b']));
    const fromGenerator = new Deque(
      (function* () {
        yield 4;
        yield 5;
      })(),
    );

    expect(fromArray.toArray()).toEqual([1, 2, 3]);
    expect(fromSet.toArray()).toEqual(['a', 'b']);
    expect(fromGenerator.toArray()).toEqual([4, 5]);
  });

  it('throws for non-iterable inputs like null or plain objects', () => {
    expect(() => new Deque(null)).toThrow(TypeError);
    expect(() => new Deque(123)).toThrow(TypeError);
    expect(() => new Deque({})).toThrow(TypeError);
    expect(() => new Deque({ 0: 'a', length: 1 })).toThrow(TypeError);
  });

  it('accepts empty, boundary, and type-edge values without coercion', () => {
    const emptyArr = [];
    const emptyObj = {};

    deque.push(null);
    deque.push(undefined);
    deque.push('');
    deque.push(emptyArr);
    deque.push(emptyObj);
    deque.push(0);
    deque.push(-1);
    deque.push(Number.MAX_SAFE_INTEGER);
    deque.push('   ');
    deque.push('1');
    deque.push(1);

    const values = deque.toArray();

    expect(values).toEqual([
      null,
      undefined,
      '',
      emptyArr,
      emptyObj,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      '   ',
      '1',
      1,
    ]);
    expect(values[3]).toBe(emptyArr);
    expect(values[4]).toBe(emptyObj);
    expect(typeof values[9]).toBe('string');
    expect(typeof values[10]).toBe('number');
  });

  it('supports push/pop/unshift/shift and updates size', () => {
    deque.push('b');
    deque.unshift('a');
    deque.push('c');
    deque.unshift('z');

    expect(deque.size).toBe(4);
    expect(deque.peekFront()).toBe('z');
    expect(deque.peekBack()).toBe('c');

    expect(deque.shift()).toBe('z');
    expect(deque.pop()).toBe('c');

    expect(deque.toArray()).toEqual(['a', 'b']);
    expect(deque.size).toBe(2);
  });

  it('returns undefined for pop/shift on empty and keeps size at 0', () => {
    expect(deque.pop()).toBe(undefined);
    expect(deque.shift()).toBe(undefined);
    expect(deque.size).toBe(0);
    expect(deque.isEmpty()).toBe(true);
  });

  it('peekFront/peekBack are non-destructive and undefined when empty', () => {
    expect(deque.peekFront()).toBe(undefined);
    expect(deque.peekBack()).toBe(undefined);

    deque.push(1);
    deque.push(2);

    expect(deque.peekFront()).toBe(1);
    expect(deque.peekBack()).toBe(2);
    expect(deque.size).toBe(2);
  });

  it('toArray returns a snapshot and clear resets state', () => {
    deque.push(1);
    deque.push(2);

    const snapshot = deque.toArray();
    snapshot.push(3);

    expect(deque.toArray()).toEqual([1, 2]);

    deque.clear();
    expect(deque.toArray()).toEqual([]);
    expect(deque.isEmpty()).toBe(true);
    expect(deque.peekFront()).toBe(undefined);
    expect(deque.peekBack()).toBe(undefined);
  });

  it('iterates in order after mixed operations', () => {
    deque.push('b');
    deque.push('c');
    deque.unshift('a');
    deque.shift();
    deque.unshift('z');

    const values = [];
    for (const value of deque) {
      values.push(value);
    }

    expect(values).toEqual(['z', 'b', 'c']);
  });

  it('handles rapid successive operations on both ends', () => {
    const count = 500;

    for (let i = 0; i < count; i += 1) {
      deque.push(i);
    }
    for (let i = 0; i < count; i += 1) {
      expect(deque.shift()).toBe(i);
    }
    expect(deque.isEmpty()).toBe(true);

    for (let i = 0; i < count; i += 1) {
      deque.unshift(i);
    }
    for (let i = 0; i < count; i += 1) {
      expect(deque.pop()).toBe(i);
    }
    expect(deque.isEmpty()).toBe(true);
  });

  it('handles microtask-scheduled operations without losing items', async () => {
    const pushes = Array.from({ length: 20 }, (_, i) => i);
    const unshifts = Array.from({ length: 20 }, (_, i) => i + 1000);

    await Promise.all([
      ...pushes.map((value) => Promise.resolve().then(() => deque.push(value))),
      ...unshifts.map((value) =>
        Promise.resolve().then(() => deque.unshift(value)),
      ),
    ]);

    const result = deque.toArray();
    const sorted = result.slice().sort((a, b) => a - b);
    const expected = [...pushes, ...unshifts].sort((a, b) => a - b);

    expect(result.length).toBe(expected.length);
    expect(sorted).toEqual(expected);
  });

  it('handles large payloads, long strings, and deep nesting', () => {
    const hugePayload = 'x'.repeat(1_000_000);
    readFileSync.mockReturnValueOnce(hugePayload);

    const fileData = readFileSync('/fake/huge.bin', 'utf8');
    const longString = 'y'.repeat(100_000);
    const deepObject = createDeepObject(60);

    const largeIterable = Array.from({ length: 10_000 }, (_, i) => i);
    const largeDeque = new Deque(largeIterable);

    expect(largeDeque.size).toBe(largeIterable.length);
    expect(largeDeque.peekFront()).toBe(0);
    expect(largeDeque.peekBack()).toBe(largeIterable.length - 1);

    deque.push(fileData);
    deque.push(longString);
    deque.push(deepObject);

    expect(deque.shift()).toBe(hugePayload);
    expect(deque.shift()).toBe(longString);
    expect(deque.shift()).toBe(deepObject);
  });
});

function createDeepObject(depth) {
  let current = { level: depth };
  for (let i = depth - 1; i >= 0; i -= 1) {
    current = { level: i, child: current };
  }
  return current;
}
