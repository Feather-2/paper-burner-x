import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedCrypto = vi.hoisted(() => ({
  randomUUID: vi.fn(() => 'mock-uuid'),
}));

vi.mock('node:crypto', () => ({
  randomUUID: mockedCrypto.randomUUID,
}));

import { randomUUID } from 'node:crypto';
import { RuntimeAdapter, RuntimeType } from '../../../../../js/agents/runtime/core/runtime-adapter.js';

const FIXED_NOW = 1700000000000;

const withFixedNow = async (fn) => {
  const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  try {
    return await fn();
  } finally {
    nowSpy.mockRestore();
  }
};

const makeDeepNested = (depth) => {
  let node = {};
  let cursor = node;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return node;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RuntimeType', () => {
  it('exposes the expected runtime identifiers', () => {
    expect(RuntimeType).toEqual({
      JS: 'js',
      PYTHON: 'python',
      R: 'r',
    });
  });

  it('returns undefined for unknown or boundary keys', () => {
    const keys = [undefined, null, '', '   ', [], {}, 0, -1, Number.MAX_SAFE_INTEGER];
    for (const key of keys) {
      expect(RuntimeType[key]).toBeUndefined();
    }
  });
});

describe('RuntimeAdapter', () => {
  it('defaults type/id when options are missing or falsy', async () => {
    await withFixedNow(() => {
      const adapterDefault = new RuntimeAdapter();
      expect(adapterDefault.type).toBe(RuntimeType.JS);
      expect(adapterDefault.id).toBe(`js_${FIXED_NOW}`);

      const adapterEmpty = new RuntimeAdapter({});
      expect(adapterEmpty.type).toBe(RuntimeType.JS);
      expect(adapterEmpty.id).toBe(`js_${FIXED_NOW}`);

      const adapterFalsy = new RuntimeAdapter({ type: '', id: 0 });
      expect(adapterFalsy.type).toBe(RuntimeType.JS);
      expect(adapterFalsy.id).toBe(`js_${FIXED_NOW}`);
    });
  });

  it('respects provided type/id values including boundary cases', async () => {
    await withFixedNow(() => {
      const uuid = randomUUID();
      expect(uuid).toBe('mock-uuid');

      const adapterNumericString = new RuntimeAdapter({ type: '123', id: uuid });
      expect(adapterNumericString.type).toBe('123');
      expect(adapterNumericString.id).toBe('mock-uuid');

      const whitespaceType = '   ';
      const adapterWhitespace = new RuntimeAdapter({ type: whitespaceType });
      expect(adapterWhitespace.type).toBe(whitespaceType);
      expect(adapterWhitespace.id).toBe(`${whitespaceType}_${FIXED_NOW}`);

      const adapterNegative = new RuntimeAdapter({ type: RuntimeType.R, id: -1 });
      expect(adapterNegative.type).toBe(RuntimeType.R);
      expect(adapterNegative.id).toBe(-1);

      const adapterMax = new RuntimeAdapter({
        type: RuntimeType.PYTHON,
        id: Number.MAX_SAFE_INTEGER,
      });
      expect(adapterMax.type).toBe(RuntimeType.PYTHON);
      expect(adapterMax.id).toBe(Number.MAX_SAFE_INTEGER);

      expect(mockedCrypto.randomUUID).toHaveBeenCalledTimes(1);
    });
  });

  it('throws when constructed with null options', () => {
    expect(() => new RuntimeAdapter(null)).toThrow(TypeError);
  });

  it('rejects initialize and execute for normal inputs', async () => {
    const adapter = new RuntimeAdapter({ type: RuntimeType.JS, id: 'unit' });
    const context = { vfs: {}, state: {} };

    await expect(adapter.initialize()).rejects.toThrow('Not implemented');
    await expect(adapter.execute('console.log(1);', context)).rejects.toThrow('Not implemented');
  });

  it('rejects concurrent initialize/execute calls with large payloads', async () => {
    const adapter = new RuntimeAdapter({ type: RuntimeType.JS, id: 'concurrent' });

    const hugeFile = 'f'.repeat(200000);
    const longCode = 'c'.repeat(150000);
    const deepState = makeDeepNested(64);
    const context = { vfs: { '/big.txt': hugeFile }, state: deepState };

    const results = await Promise.allSettled([
      adapter.initialize(),
      adapter.initialize(),
      adapter.execute(longCode, context),
      adapter.execute(`${longCode} `, context),
    ]);

    for (const result of results) {
      expect(result.status).toBe('rejected');
      expect(result.reason).toBeInstanceOf(Error);
      expect(result.reason.message).toBe('Not implemented');
    }
  });

  it('preload and terminate are no-ops for boundary inputs and rapid calls', async () => {
    const adapter = new RuntimeAdapter({ type: RuntimeType.JS, id: 'noop' });
    const fakeArray = { 0: 'pkg', length: 1 };

    const preloadResults = await Promise.all([
      adapter.preload(undefined),
      adapter.preload(null),
      adapter.preload([]),
      adapter.preload(['pkg']),
      adapter.preload(fakeArray),
      adapter.preload('1'),
      adapter.preload({}),
    ]);

    for (const result of preloadResults) {
      expect(result).toBeUndefined();
    }

    await expect(adapter.preload([])).resolves.toBeUndefined();
    await expect(adapter.preload(['a', 'b'])).resolves.toBeUndefined();

    await expect(adapter.terminate()).resolves.toBeUndefined();
    await expect(adapter.terminate()).resolves.toBeUndefined();

    const terminateResults = await Promise.all([adapter.terminate(), adapter.terminate()]);
    for (const result of terminateResults) {
      expect(result).toBeUndefined();
    }
  });
});
