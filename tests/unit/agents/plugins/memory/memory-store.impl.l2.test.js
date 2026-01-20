import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const defineGetterMock = vi.hoisted(() =>
  vi.fn((fn) => ({
    get: fn,
    configurable: true,
  }))
);
const defineMethodMock = vi.hoisted(() =>
  vi.fn((fn) => ({
    value: fn,
    writable: true,
    configurable: true,
  }))
);
const genIdMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../js/agents/plugins/memory/memory-store.impl.utils.js', () => ({
  defineGetter: defineGetterMock,
  defineMethod: defineMethodMock,
  genId: genIdMock,
}));

vi.mock('../../../../../js/agents/shared/index.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    deepClone: vi.fn((value) => original.deepClone(value)),
    toNonEmptyString: vi.fn((value) => original.toNonEmptyString(value)),
  };
});

import { defineL2Layer } from '../../../../../js/agents/plugins/memory/memory-store.impl.l2.js';
import { deepClone } from '../../../../../js/agents/shared/index.js';

const createStore = ({ historySummary = 'summary', stageSummaries, claims } = {}) => {
  const store = {
    _L2: {
      historySummary,
      stageSummaries: stageSummaries ?? new Map(),
      claims: claims ?? [],
    },
    _markDirty: vi.fn(),
  };

  Object.defineProperties(store, defineL2Layer());
  return store;
};

let dateNowSpy;

beforeEach(() => {
  vi.clearAllMocks();
  let counter = 0;
  genIdMock.mockImplementation((prefix = 'id') => `${prefix}_${counter++}`);
  dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
});

afterEach(() => {
  dateNowSpy.mockRestore();
});

describe('defineL2Layer', () => {
  it('returns a frozen shallow snapshot for L2', () => {
    const stageSummaries = new Map([['stage-a', 'A']]);
    const claims = [{ id: 'c1', content: 'alpha' }];
    const store = createStore({ historySummary: 'history', stageSummaries, claims });

    const snapshot = store.L2;

    expect(snapshot.historySummary).toBe('history');
    expect(snapshot.stageSummaries).toBe(stageSummaries);
    expect(snapshot.claims).toEqual(claims);
    expect(snapshot.claims).not.toBe(claims);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.claims)).toBe(true);
    expect(() => snapshot.claims.push({ id: 'c2' })).toThrow();
  });

  it('handles empty L2 values without throwing', () => {
    const store = createStore({
      historySummary: null,
      stageSummaries: new Map(),
      claims: [],
    });

    const snapshot = store.L2;

    expect(snapshot.historySummary).toBeNull();
    expect(snapshot.stageSummaries.size).toBe(0);
    expect(snapshot.claims).toEqual([]);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('clones L2 using deepClone', () => {
    const stageSummaries = new Map([['stage-a', 'A']]);
    const claims = [{ id: 'c1', content: 'alpha' }];
    const store = createStore({ historySummary: 'history', stageSummaries, claims });

    const clone = store.cloneL2();

    expect(deepClone).toHaveBeenCalledWith(store._L2);
    expect(clone).not.toBe(store._L2);
    expect(clone.stageSummaries).not.toBe(store._L2.stageSummaries);
    expect(clone.claims).not.toBe(store._L2.claims);
  });

  it('ignores empty or whitespace stage keys', () => {
    const store = createStore();
    const setSpy = vi.spyOn(store._L2.stageSummaries, 'set');

    [null, undefined, '', '   '].forEach((stage) => {
      store.setStageSummary(stage, 'summary');
    });

    expect(setSpy).not.toHaveBeenCalled();
    expect(store._markDirty).not.toHaveBeenCalled();
  });

  it('normalizes stage keys and stores boundary summaries', () => {
    const store = createStore();

    store.setStageSummary('  stage  ', '  summary  ');
    store.setStageSummary(0, 0);
    store.setStageSummary(-1, -1);
    store.setStageSummary(Number.MAX_SAFE_INTEGER, '   ');

    expect(store._L2.stageSummaries.get('stage')).toBe('summary');
    expect(store._L2.stageSummaries.get('0')).toBe('0');
    expect(store._L2.stageSummaries.get('-1')).toBe('-1');
    expect(store._L2.stageSummaries.get(String(Number.MAX_SAFE_INTEGER))).toBe('');
    expect(store._markDirty).toHaveBeenCalledTimes(4);
  });

  it('returns stage summaries or empty string when missing', () => {
    const store = createStore({ stageSummaries: new Map([['alpha', 'A']]) });

    expect(store.getStageSummary('alpha')).toBe('A');
    expect(store.getStageSummary('missing')).toBe('');
  });

  it('treats numeric stage keys as strings in setStageSummary', () => {
    const store = createStore();

    store.setStageSummary(1, 'one');

    expect(store.getStageSummary(1)).toBe('');
    expect(store.getStageSummary('1')).toBe('one');
  });

  it('returns all stage summaries as a plain object', () => {
    const stageSummaries = new Map([
      [1, 'one'],
      ['two', '2'],
    ]);
    const store = createStore({ stageSummaries });

    expect(store.getAllStageSummaries()).toEqual({
      1: 'one',
      two: '2',
    });
  });

  it('adds a claim with defaults and marks L2 dirty', () => {
    const store = createStore();

    const entry = store.addClaim({
      content: 'claim',
      source: 'source',
      confidence: 0.75,
      verified: true,
    });

    expect(entry).toEqual({
      id: 'claim_0',
      content: 'claim',
      source: 'source',
      confidence: 0.75,
      verified: true,
      ts: 1700000000000,
    });
    expect(store._L2.claims).toHaveLength(1);
    expect(store._L2.claims[0]).toBe(entry);
    expect(store._markDirty).toHaveBeenCalledWith('L2');
  });

  it('supports boundary claim values and large content', () => {
    const store = createStore();
    const hugeText = 'x'.repeat(1024 * 1024);

    const zeroConfidence = store.addClaim({ content: 'zero', confidence: 0 });
    const negativeConfidence = store.addClaim({ content: 'neg', confidence: -1 });
    const maxConfidence = store.addClaim({ content: 'max', confidence: Number.MAX_SAFE_INTEGER });
    const stringConfidence = store.addClaim({ content: 'string', confidence: '0' });
    const emptyObjectClaim = store.addClaim({});
    const hugeClaim = store.addClaim(hugeText);

    expect(zeroConfidence.confidence).toBe(1.0);
    expect(negativeConfidence.confidence).toBe(-1);
    expect(maxConfidence.confidence).toBe(Number.MAX_SAFE_INTEGER);
    expect(stringConfidence.confidence).toBe('0');
    expect(emptyObjectClaim.content).toBe('[object Object]');
    expect(hugeClaim.content).toBe(hugeText);
    expect(store._markDirty).toHaveBeenCalledTimes(6);
  });

  it('throws when adding null or undefined claims', () => {
    const store = createStore();

    expect(() => store.addClaim(null)).toThrow();
    expect(() => store.addClaim(undefined)).toThrow();
  });

  it('returns filtered claims or full copies without leaking references', () => {
    const claims = [
      { id: 'c1', verified: true },
      { id: 'c2', verified: false },
    ];
    const store = createStore({ claims });

    const all = store.getClaims();
    all.push({ id: 'c3' });

    expect(all).toEqual(claims.concat({ id: 'c3' }));
    expect(store._L2.claims).toHaveLength(2);

    const verified = store.getClaims((claim) => claim.verified);
    expect(verified).toEqual([claims[0]]);

    const nonFunctionFilter = store.getClaims('not-a-function');
    expect(nonFunctionFilter).toEqual(claims);
  });

  it('replaces claims with deep cloned arrays and handles non-arrays', () => {
    const store = createStore({ claims: [{ id: 'existing' }] });
    const depth = 12;
    const nested = { level: 0 };
    let cursor = nested;
    for (let i = 1; i <= depth; i += 1) {
      cursor.child = { level: i, items: [{ level: i + 1 }] };
      cursor = cursor.child;
    }
    const leafItem = cursor.items[0];
    const input = [{ id: 'c1', payload: nested }];

    const replaced = store.replaceClaims(input);

    expect(deepClone).toHaveBeenCalledWith(input);
    expect(replaced).toEqual(store._L2.claims);
    expect(replaced).not.toBe(store._L2.claims);
    expect(replaced[0]).toBe(store._L2.claims[0]);

    const originalLeafLevel = leafItem.level;
    leafItem.level = 99;

    let clonedCursor = store._L2.claims[0].payload;
    for (let i = 1; i <= depth; i += 1) {
      clonedCursor = clonedCursor.child;
    }
    expect(clonedCursor.items[0].level).toBe(originalLeafLevel);

    store.replaceClaims([]);
    store.replaceClaims(null);
    store.replaceClaims(undefined);
    store.replaceClaims({});

    expect(store._L2.claims).toEqual([]);
    expect(store._markDirty).toHaveBeenCalledTimes(5);
  });

  it('handles rapid consecutive claim additions', async () => {
    const store = createStore();
    const inputs = Array.from({ length: 5 }, (_, i) => ({ content: `c${i}` }));

    await Promise.all(inputs.map((claim) => Promise.resolve().then(() => store.addClaim(claim))));

    const ids = store._L2.claims.map((claim) => claim.id);
    expect(store._L2.claims).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(store._markDirty).toHaveBeenCalledTimes(5);
  });
});
