import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'mocked-uuid'),
}));

const makeSnapshotable = (overrides = {}) => ({
  toSnapshot: vi.fn(() => ({ ok: true })),
  fromSnapshot: vi.fn(),
  ...overrides,
});

const makeDeepObject = (depth) => {
  let node = { level: depth };
  for (let i = depth - 1; i >= 0; i -= 1) {
    node = { level: i, child: node };
  }
  return node;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isSnapshotable', () => {
  it('returns true for objects with toSnapshot/fromSnapshot functions', async () => {
    const { isSnapshotable } = await import('../../../../../../js/agents/runtime/core/context/snapshotable.js');

    const snapshotable = makeSnapshotable({ extra: 123 });

    expect(isSnapshotable(snapshotable)).toBe(true);
    expect(snapshotable.toSnapshot).not.toHaveBeenCalled();
    expect(snapshotable.fromSnapshot).not.toHaveBeenCalled();
  });

  it('returns false when only one snapshot method exists', async () => {
    const { isSnapshotable } = await import('../../../../../../js/agents/runtime/core/context/snapshotable.js');

    expect(isSnapshotable({ toSnapshot: () => ({}) })).toBe(false);
    expect(isSnapshotable({ fromSnapshot: () => {} })).toBe(false);
    expect(isSnapshotable({ toSnapshot: () => ({}), fromSnapshot: null })).toBe(false);
  });

  it('returns false for nullish and empty values', async () => {
    const { isSnapshotable } = await import('../../../../../../js/agents/runtime/core/context/snapshotable.js');

    expect(isSnapshotable(null)).toBe(false);
    expect(isSnapshotable(undefined)).toBe(false);
    expect(isSnapshotable('')).toBe(false);
    expect(isSnapshotable([])).toBe(false);
    expect(isSnapshotable({})).toBe(false);
  });

  it('returns false for boundary numbers, whitespace, and type-mismatched values', async () => {
    const { isSnapshotable } = await import('../../../../../../js/agents/runtime/core/context/snapshotable.js');

    expect(isSnapshotable(0)).toBe(false);
    expect(isSnapshotable(-1)).toBe(false);
    expect(isSnapshotable(Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(isSnapshotable('   ')).toBe(false);
    expect(isSnapshotable('123')).toBe(false);
    expect(isSnapshotable({ length: 0 })).toBe(false);
  });

  it('handles large payloads and deep nesting without caring about contents', async () => {
    const { isSnapshotable } = await import('../../../../../../js/agents/runtime/core/context/snapshotable.js');

    const hugeContent = 'x'.repeat(1024 * 1024);
    const deep = makeDeepObject(32);
    const snapshotable = makeSnapshotable({
      file: { name: 'big.bin', content: hugeContent },
      deep,
      longText: 'l'.repeat(8192),
    });

    expect(isSnapshotable(snapshotable)).toBe(true);
  });

  it('supports concurrent and rapid consecutive calls', async () => {
    const { isSnapshotable } = await import('../../../../../../js/agents/runtime/core/context/snapshotable.js');

    const values = [
      makeSnapshotable(),
      null,
      undefined,
      {},
      { toSnapshot: () => ({}), fromSnapshot: () => {} },
      [],
      '123',
    ];

    const results = await Promise.all(values.map((value) => Promise.resolve(isSnapshotable(value))));

    expect(results).toEqual([true, false, false, false, true, false, false]);

    const snapshotable = makeSnapshotable();
    const rapid = [];
    for (let i = 0; i < 100; i += 1) {
      rapid.push(isSnapshotable(snapshotable));
    }
    expect(rapid.every(Boolean)).toBe(true);
  });
});

describe('assertSnapshotable', () => {
  it('returns the same value for valid snapshotable', async () => {
    const { assertSnapshotable } = await import('../../../../../../js/agents/runtime/core/context/snapshotable.js');

    const snapshotable = makeSnapshotable({ tag: 'ok' });
    const result = assertSnapshotable(snapshotable);

    expect(result).toBe(snapshotable);
    expect(snapshotable.toSnapshot).not.toHaveBeenCalled();
    expect(snapshotable.fromSnapshot).not.toHaveBeenCalled();
  });

  it('throws for nullish and falsy values', async () => {
    const { assertSnapshotable } = await import('../../../../../../js/agents/runtime/core/context/snapshotable.js');

    expect(() => assertSnapshotable(null)).toThrowError(new TypeError('value is required'));
    expect(() => assertSnapshotable(undefined)).toThrowError(new TypeError('value is required'));
    expect(() => assertSnapshotable('')).toThrowError(new TypeError('value is required'));
    expect(() => assertSnapshotable(0)).toThrowError(new TypeError('value is required'));
  });

  it('includes custom label in required error', async () => {
    const { assertSnapshotable } = await import('../../../../../../js/agents/runtime/core/context/snapshotable.js');

    expect(() => assertSnapshotable(null, 'snapshotable')).toThrowError(new TypeError('snapshotable is required'));
  });

  it('throws for missing toSnapshot with boundary values and type mismatches', async () => {
    const { assertSnapshotable } = await import('../../../../../../js/agents/runtime/core/context/snapshotable.js');

    expect(() => assertSnapshotable([])).toThrowError(new TypeError('value.toSnapshot must be a function'));
    expect(() => assertSnapshotable({})).toThrowError(new TypeError('value.toSnapshot must be a function'));
    expect(() => assertSnapshotable('   ')).toThrowError(new TypeError('value.toSnapshot must be a function'));
    expect(() => assertSnapshotable('123')).toThrowError(new TypeError('value.toSnapshot must be a function'));
    expect(() => assertSnapshotable(-1)).toThrowError(new TypeError('value.toSnapshot must be a function'));
    expect(() => assertSnapshotable(Number.MAX_SAFE_INTEGER)).toThrowError(
      new TypeError('value.toSnapshot must be a function')
    );
    expect(() => assertSnapshotable({ length: 0 })).toThrowError(new TypeError('value.toSnapshot must be a function'));
  });

  it('throws for non-function toSnapshot or fromSnapshot with custom label', async () => {
    const { assertSnapshotable } = await import('../../../../../../js/agents/runtime/core/context/snapshotable.js');
    const { randomUUID } = await import('node:crypto');

    const label = randomUUID();

    expect(() => assertSnapshotable({ toSnapshot: 'nope', fromSnapshot: () => {} }, label)).toThrowError(
      new TypeError(`${label}.toSnapshot must be a function`)
    );

    expect(() => assertSnapshotable({ toSnapshot: () => ({}), fromSnapshot: 123 }, label)).toThrowError(
      new TypeError(`${label}.fromSnapshot must be a function`)
    );

    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('accepts large payloads and deep nesting without inspection', async () => {
    const { assertSnapshotable } = await import('../../../../../../js/agents/runtime/core/context/snapshotable.js');

    const hugeContent = 'y'.repeat(1024 * 1024);
    const deep = makeDeepObject(40);
    const longLabel = 'label-'.repeat(2000);
    const snapshotable = makeSnapshotable({
      file: { name: 'huge.dat', content: hugeContent },
      deep,
      longText: 'z'.repeat(10000),
    });

    const result = assertSnapshotable(snapshotable, longLabel);
    expect(result).toBe(snapshotable);
  });

  it('supports concurrent and rapid consecutive calls', async () => {
    const { assertSnapshotable } = await import('../../../../../../js/agents/runtime/core/context/snapshotable.js');

    const items = [makeSnapshotable(), makeSnapshotable(), makeSnapshotable()];
    const results = await Promise.all(items.map((item) => Promise.resolve(assertSnapshotable(item))));

    expect(results).toEqual(items);

    const snapshotable = makeSnapshotable();
    for (let i = 0; i < 100; i += 1) {
      expect(assertSnapshotable(snapshotable)).toBe(snapshotable);
    }
  });
});
