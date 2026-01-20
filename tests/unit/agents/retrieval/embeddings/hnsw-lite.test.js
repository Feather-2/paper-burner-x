import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockedValueUtils = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
  toNonEmptyString: vi.fn(),
  toPositiveInt: vi.fn(),
}));

vi.mock('../../../../../js/agents/shared/utils/value-utils.js', () => ({
  isPlainObject: mockedValueUtils.isPlainObject,
  toNonEmptyString: mockedValueUtils.toNonEmptyString,
  toPositiveInt: mockedValueUtils.toPositiveInt,
}));

async function loadModule() {
  return await import('../../../../../js/agents/retrieval/embeddings/hnsw-lite.js');
}

let HnswLiteIndexError;
let DimensionMismatchError;
let InvalidIndexError;
let HnswLiteIndex;

beforeEach(async () => {
  vi.clearAllMocks();
  const actual = await vi.importActual('../../../../../js/agents/shared/utils/value-utils.js');
  mockedValueUtils.isPlainObject.mockImplementation(actual.isPlainObject);
  mockedValueUtils.toNonEmptyString.mockImplementation(actual.toNonEmptyString);
  mockedValueUtils.toPositiveInt.mockImplementation(actual.toPositiveInt);
  ({ HnswLiteIndexError, DimensionMismatchError, InvalidIndexError, HnswLiteIndex } = await loadModule());
});

describe('HnswLiteIndexError', () => {
  it('sets name and message', () => {
    const err = new HnswLiteIndexError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('HnswLiteIndexError');
    expect(err.message).toBe('boom');
  });
});

describe('DimensionMismatchError', () => {
  it('formats message with boundary values', () => {
    const err = new DimensionMismatchError(0, Number.MAX_SAFE_INTEGER);
    expect(err).toBeInstanceOf(HnswLiteIndexError);
    expect(err.name).toBe('DimensionMismatchError');
    expect(err.message).toBe(`HnswLiteIndex dimension mismatch: expected 0, got ${Number.MAX_SAFE_INTEGER}`);
  });
});

describe('InvalidIndexError', () => {
  it('sets name and message', () => {
    const err = new InvalidIndexError('invalid index');
    expect(err).toBeInstanceOf(HnswLiteIndexError);
    expect(err.name).toBe('InvalidIndexError');
    expect(err.message).toBe('invalid index');
  });
});

describe('HnswLiteIndex', () => {
  it('clamps options and serializes config', () => {
    const index = new HnswLiteIndex({
      maxItems: '2',
      numHashBits: 2,
      numProbes: 100,
      seed: '7',
      rebuildThreshold: '0.05',
    });

    expect(index.upsert('a', [1, 0])).toBe(true);

    const json = index.toJSON();
    expect(json.dim).toBe(2);
    expect(json.numHashBits).toBe(4);
    expect(json.numProbes).toBe(32);
    expect(json.seed).toBe(7);
  });

  it('rejects invalid ids and vectors, accepts numeric strings', () => {
    const index = new HnswLiteIndex();
    const invalidIds = [null, undefined, '', '   '];

    for (const id of invalidIds) {
      expect(index.has(id)).toBe(false);
      expect(index.delete(id)).toBe(false);
      expect(index.upsert(id, [1, 0])).toBe(false);
    }

    const invalidVectors = [
      null,
      undefined,
      [],
      {},
      { length: 2 },
      [0, 0],
      new Float32Array([1, NaN]),
      [1, Infinity],
    ];
    for (const vec of invalidVectors) {
      expect(index.upsert('valid', vec)).toBe(false);
    }

    expect(index.upsert('valid', ['1', '2'])).toBe(true);
    expect(index.has('valid')).toBe(true);
  });

  it('updates existing entries without growing size', () => {
    const index = new HnswLiteIndex();
    const firstMeta = { ts: 1, tag: 'first' };
    const secondMeta = { ts: 2, tag: 'second' };

    expect(index.upsert('dup', [1, 0], firstMeta)).toBe(true);
    expect(index.size).toBe(1);

    expect(index.upsert('dup', [0, 1], secondMeta)).toBe(true);
    expect(index.size).toBe(1);

    const results = index.search([0, 1], { topK: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('dup');
    expect(results[0].meta).toBe(secondMeta);
  });

  it('throws DimensionMismatchError for mismatched dimensions', () => {
    const index = new HnswLiteIndex();
    expect(index.upsert('a', [1, 0])).toBe(true);
    expect(() => index.upsert('b', [1, 0, 0])).toThrow(DimensionMismatchError);
  });

  it('evicts oldest entries when maxItems is exceeded', () => {
    const index = new HnswLiteIndex({ maxItems: 2 });
    index.upsert('a', [1, 0]);
    index.upsert('b', [0, 1]);
    index.upsert('c', [1, 1]);

    expect(index.size).toBe(2);
    expect(index.has('a')).toBe(false);
    expect(index.has('b')).toBe(true);
    expect(index.has('c')).toBe(true);
  });

  it('deletes entries and rebuilds when threshold is exceeded', () => {
    const index = new HnswLiteIndex({ rebuildThreshold: 0.1 });
    index.upsert('a', [1, 0]);
    index.upsert('b', [0, 1]);

    expect(index.delete('a')).toBe(true);
    expect(index.size).toBe(1);
    expect(index.has('b')).toBe(true);
    expect(index.getStats().rebuilds).toBe(1);
  });

  it('search respects filters, minScore, and partitions', () => {
    const index = new HnswLiteIndex();
    const now = 1_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    index.upsert('hot', [1, 0, 0], { tag: 'keep', ts: now - 1000 });
    index.upsert('warm', [0, 1, 0], { tag: 'skip', ts: now - 2 * 60 * 60 * 1000 });
    index.upsert('cold', [0, 0, 1], { tag: 'keep', ts: now - 2 * 24 * 60 * 60 * 1000 });

    const results = index.search([1, 0, 0], {
      topK: 2,
      filter: (meta) => meta.tag === 'keep',
      minScore: 0.1,
      partitions: ['hot', 'cold'],
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('hot');

    const warmResults = index.search([0, 1, 0], { partitions: 'warm', topK: 5 });
    expect(warmResults).toHaveLength(1);
    expect(warmResults[0].id).toBe('warm');

    nowSpy.mockRestore();
  });

  it('returns empty results for invalid queries and handles boundary topK values', () => {
    const index = new HnswLiteIndex();
    index.upsert('a', [1, 0]);

    expect(index.search(null)).toEqual([]);
    expect(index.search(undefined)).toEqual([]);
    expect(index.search([])).toEqual([]);
    expect(index.search([NaN, 1])).toEqual([]);
    expect(index.search([1, 0, 0])).toEqual([]);

    const zeroResults = index.search([1, 0], { topK: 0 });
    expect(zeroResults).toHaveLength(1);

    const negativeResults = index.search([1, 0], { topK: -1 });
    expect(negativeResults).toHaveLength(1);
  });

  it('searchBruteForce returns sorted results and honors filters', () => {
    const index = new HnswLiteIndex();
    const now = 1_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    index.upsert('best', [1, 0], { tag: 'keep', ts: now - 1000 });
    index.upsert('mid', [1, 1], { tag: 'keep', ts: now - 1000 });
    index.upsert('low', [0, 1], { tag: 'skip', ts: now - 2 * 24 * 60 * 60 * 1000 });

    const results = index.searchBruteForce([1, 0], {
      topK: 3,
      filter: (meta) => meta.tag === 'keep',
      partitions: ['hot'],
      minScore: 0.1,
    });

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('best');
    expect(results[0].score).toBeGreaterThan(results[1].score);

    nowSpy.mockRestore();
  });

  it('getPartitionStats classifies hot, warm, and cold', () => {
    const index = new HnswLiteIndex();
    const now = 1_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    index.upsert('hot', [1, 0], { ts: now - 1000 });
    index.upsert('warm', [0, 1], { ts: now - 2 * 60 * 60 * 1000 });
    index.upsert('cold', [1, 1], { ts: now - 2 * 24 * 60 * 60 * 1000 });

    expect(index.getPartitionStats()).toEqual({ hot: 1, warm: 1, cold: 1, total: 3 });
    nowSpy.mockRestore();
  });

  it('handles concurrent and rapid searches consistently', async () => {
    const index = new HnswLiteIndex();
    index.upsert('a', [1, 0], { ts: 1 });

    const query = [1, 0];
    const concurrent = await Promise.all([
      Promise.resolve(index.search(query, { topK: 1 })),
      Promise.resolve(index.search(query, { topK: 1 })),
      Promise.resolve(index.search(query, { topK: 1 })),
    ]);

    for (const result of concurrent) {
      expect(result[0].id).toBe('a');
    }

    for (let i = 0; i < 5; i++) {
      index.search(query, { topK: 1 });
    }

    const stats = index.getStats();
    expect(stats.searches).toBe(8);
    expect(Number.isFinite(stats.avgCandidates)).toBe(true);
  });

  it('fromJSON restores index and rejects invalid payloads', () => {
    const index = new HnswLiteIndex({ numHashBits: 8, numProbes: 8, seed: 123 });
    index.upsert('a', [1, 0], { ts: 1 });
    index.upsert('b', [0, 1], { ts: 2 });

    const restored = HnswLiteIndex.fromJSON(index.toJSON());
    expect(restored.size).toBe(2);
    expect(restored.dimension).toBe(2);
    expect(restored.has('a')).toBe(true);
    expect(restored.search([1, 0], { topK: 1 })[0].id).toBe('a');

    expect(() => HnswLiteIndex.fromJSON(null)).toThrow(InvalidIndexError);
    expect(() => HnswLiteIndex.fromJSON({})).toThrow(InvalidIndexError);
    expect(() => HnswLiteIndex.fromJSON({ version: 2 })).toThrow(InvalidIndexError);
  });

  it('handles large vectors, long ids, and deep metadata', () => {
    const index = new HnswLiteIndex();
    const longId = 'x'.repeat(10000);
    const largeVector = Array.from({ length: 1024 }, (_, i) => (i % 2 === 0 ? 2 : 1));
    const deepMeta = {
      level1: { level2: { level3: { level4: { note: 'deep' } } } },
      payload: 'y'.repeat(20000),
    };

    expect(index.upsert(longId, largeVector, deepMeta)).toBe(true);
    const results = index.search(largeVector, { topK: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(longId);
    expect(results[0].meta).toBe(deepMeta);
  });
});
