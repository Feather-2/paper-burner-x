// Unit tests for memory-store.impl.utils helpers, covering edge cases, concurrency, and resource limits.
// Located under memory plugin tests to validate shared utility behavior.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const estimateTokensCachedMock = vi.hoisted(() => vi.fn());
const makeSecureTimestampedIdMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  estimateTokensCached: estimateTokensCachedMock,
  makeSecureTimestampedId: makeSecureTimestampedIdMock,
}));

import {
  defineMethod,
  defineGetter,
  defineAccessor,
  estimateBytes,
  estimateTokens,
  truncate,
  genId,
  isFiniteNumber,
} from '../../../../../js/agents/plugins/memory/memory-store.impl.utils.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('defineMethod', () => {
  it('creates a writable configurable value descriptor', () => {
    const fn = () => 'ok';
    const target = {};

    Object.defineProperty(target, 'method', defineMethod(fn));
    const descriptor = Object.getOwnPropertyDescriptor(target, 'method');

    expect(descriptor.value).toBe(fn);
    expect(descriptor.writable).toBe(true);
    expect(descriptor.configurable).toBe(true);
    expect(target.method()).toBe('ok');
  });

  it('handles concurrent descriptor creation without shared state', async () => {
    const fns = [() => 1, () => 2, () => 3];
    const descriptors = await Promise.all(fns.map((fn) => Promise.resolve(defineMethod(fn))));

    expect(descriptors.map((descriptor) => descriptor.value())).toEqual([1, 2, 3]);
    expect(descriptors.every((descriptor) => descriptor.writable && descriptor.configurable)).toBe(true);
  });
});

describe('defineGetter', () => {
  it('creates a getter descriptor that computes values', () => {
    const target = { base: 4 };

    Object.defineProperty(target, 'double', defineGetter(() => target.base * 2));
    const descriptor = Object.getOwnPropertyDescriptor(target, 'double');

    expect(descriptor.get).toEqual(expect.any(Function));
    expect(descriptor.configurable).toBe(true);
    expect(target.double).toBe(8);
  });

  it('handles concurrent getter definitions for separate objects', async () => {
    const sources = [
      { value: ' alpha ' },
      { value: '' },
      { value: '   ' },
    ];

    const results = await Promise.all(
      sources.map((source) =>
        Promise.resolve().then(() => {
          const target = {};
          Object.defineProperty(target, 'value', defineGetter(() => source.value));
          return target.value;
        })
      )
    );

    expect(results).toEqual([' alpha ', '', '   ']);
  });
});

describe('defineAccessor', () => {
  it('creates accessor descriptors with get and set behavior', () => {
    let current = 0;
    const target = {};

    Object.defineProperty(
      target,
      'count',
      defineAccessor(
        () => current,
        (next) => {
          current = next;
        }
      )
    );

    target.count = 5;
    const descriptor = Object.getOwnPropertyDescriptor(target, 'count');

    expect(descriptor.get).toEqual(expect.any(Function));
    expect(descriptor.set).toEqual(expect.any(Function));
    expect(descriptor.configurable).toBe(true);
    expect(target.count).toBe(5);
  });

  it('accepts object values even when array-like data was expected', async () => {
    const buildAccessorTarget = () => {
      let payload = [];
      const target = {};
      Object.defineProperty(
        target,
        'payload',
        defineAccessor(
          () => payload,
          (next) => {
            payload = next;
          }
        )
      );
      return target;
    };

    const [first, second] = await Promise.all([
      Promise.resolve().then(buildAccessorTarget),
      Promise.resolve().then(buildAccessorTarget),
    ]);

    first.payload = { id: 1 };
    second.payload = ['ok'];

    expect(first.payload).toEqual({ id: 1 });
    expect(second.payload).toEqual(['ok']);
  });
});

describe('estimateBytes', () => {
  it('returns zero for nullish values and handles empty inputs', () => {
    expect(estimateBytes(null)).toBe(0);
    expect(estimateBytes(undefined)).toBe(0);
    expect(estimateBytes('')).toBe(0);
    expect(estimateBytes([])).toBe(4);
    expect(estimateBytes({})).toBe(4);
  });

  it('estimates primitives and whitespace strings', () => {
    expect(estimateBytes('abc')).toBe(6);
    expect(estimateBytes('   ')).toBe(6);
    expect(estimateBytes(0)).toBe(8);
    expect(estimateBytes(-1)).toBe(8);
    expect(estimateBytes(Number.MAX_SAFE_INTEGER)).toBe(8);
    expect(estimateBytes(true)).toBe(4);
  });

  it('estimates arrays and deep nested objects', () => {
    const deep = { level: 0 };
    let node = deep;
    for (let i = 1; i <= 25; i += 1) {
      node.child = { level: i, items: [i, i + 1] };
      node = node.child;
    }

    expect(estimateBytes([1, 2, 3])).toBe(JSON.stringify([1, 2, 3]).length * 2);
    expect(estimateBytes(deep)).toBe(JSON.stringify(deep).length * 2);
  });

  it('handles very large strings as a resource boundary', () => {
    const huge = 'x'.repeat(100000);

    expect(estimateBytes(huge)).toBe(huge.length * 2);
  });

  it('falls back when JSON.stringify throws', () => {
    const circular = {};
    circular.self = circular;

    expect(estimateBytes(circular)).toBe(1024);
  });
});

describe('estimateTokens', () => {
  it('returns zero for null or undefined without calling the estimator', () => {
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
    expect(estimateTokensCachedMock).not.toHaveBeenCalled();
  });

  it('passes string input through and forwards token counters', () => {
    const counter = vi.fn(() => 42);
    estimateTokensCachedMock.mockReturnValue(7);

    const result = estimateTokens('hello', counter);

    expect(result).toBe(7);
    expect(estimateTokensCachedMock).toHaveBeenCalledWith('hello', counter);
  });

  it('stringifies objects and arrays, including empty values', () => {
    estimateTokensCachedMock.mockImplementation((text) => text.length);

    const objectResult = estimateTokens({ a: 1 });
    const arrayResult = estimateTokens([]);

    expect(objectResult).toBe(JSON.stringify({ a: 1 }).length);
    expect(arrayResult).toBe(JSON.stringify([]).length);
  });

  it('falls back to String() when JSON.stringify fails', () => {
    estimateTokensCachedMock.mockImplementation((text) => text.length);
    const circular = {};
    circular.self = circular;

    const result = estimateTokens(circular);

    expect(estimateTokensCachedMock).toHaveBeenCalledWith('[object Object]', undefined);
    expect(result).toBe('[object Object]'.length);
  });

  it('handles whitespace strings, long inputs, and concurrent calls', async () => {
    estimateTokensCachedMock.mockImplementation((text) => Math.ceil(text.length / 4));
    const longText = 'y'.repeat(20000);

    const results = await Promise.all([
      Promise.resolve(estimateTokens('   ')),
      Promise.resolve(estimateTokens(longText)),
      Promise.resolve(estimateTokens('short')),
    ]);

    expect(results).toEqual([
      Math.ceil(3 / 4),
      Math.ceil(longText.length / 4),
      Math.ceil('short'.length / 4),
    ]);
    expect(estimateTokensCachedMock).toHaveBeenCalledTimes(3);
  });
});

describe('truncate', () => {
  it('returns input unchanged for nullish or empty values', () => {
    expect(truncate(null)).toBeNull();
    expect(truncate(undefined)).toBeUndefined();
    expect(truncate('')).toBe('');
  });

  it('does not truncate when text length is within maxLen', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('   ', 10)).toBe('   ');
    expect(truncate('tiny', Number.MAX_SAFE_INTEGER)).toBe('tiny');
  });

  it('truncates long text and appends ellipsis', () => {
    const result = truncate('hello world', 8);

    expect(result).toBe('hello...');
    expect(result.length).toBe(8);
  });

  it('handles string maxLen values and rapid consecutive calls', async () => {
    const results = await Promise.all([
      Promise.resolve(truncate('abcdef', '4')),
      Promise.resolve(truncate('abcdef', 5)),
      Promise.resolve(truncate('abcdef', 6)),
    ]);

    expect(results).toEqual(['a...', 'ab...', 'abcdef']);
  });

  it('handles very long strings as a resource boundary', () => {
    const longText = 'z'.repeat(10000);
    const result = truncate(longText, 200);

    expect(result.length).toBe(200);
    expect(result.endsWith('...')).toBe(true);
  });
});

describe('genId', () => {
  it('uses the default prefix when none is provided', () => {
    makeSecureTimestampedIdMock.mockReturnValue('id_123');

    const result = genId();

    expect(result).toBe('id_123');
    expect(makeSecureTimestampedIdMock).toHaveBeenCalledWith('id');
  });

  it('uses custom prefixes and supports rapid consecutive calls', async () => {
    let counter = 0;
    makeSecureTimestampedIdMock.mockImplementation((prefix) => `${prefix}_${counter++}`);

    const results = await Promise.all([
      Promise.resolve(genId('run')),
      Promise.resolve(genId('run')),
      Promise.resolve(genId('task')),
    ]);

    expect(results).toEqual(['run_0', 'run_1', 'task_2']);
    expect(makeSecureTimestampedIdMock).toHaveBeenCalledTimes(3);
  });
});

describe('isFiniteNumber', () => {
  it('returns true for finite numbers including boundaries', () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-1)).toBe(true);
    expect(isFiniteNumber(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('returns false for non-numbers or non-finite values', () => {
    expect(isFiniteNumber(NaN)).toBe(false);
    expect(isFiniteNumber(Infinity)).toBe(false);
    expect(isFiniteNumber('123')).toBe(false);
    expect(isFiniteNumber(null)).toBe(false);
    expect(isFiniteNumber(undefined)).toBe(false);
    expect(isFiniteNumber({})).toBe(false);
    expect(isFiniteNumber([])).toBe(false);
  });
});
