import { describe, it, expect, vi, beforeEach } from 'vitest';

const sharedState = vi.hoisted(() => ({
  estimateTokensCached: vi.fn(),
  makeSecureTimestampedId: vi.fn(),
  Platform: { isBrowser: false },
}));

vi.mock('../../../../../js/agents/shared/index.js', () => sharedState);

const utilsPath = '../../../../../js/agents/plugins/memory/unified-memory-store.utils.js';

const loadUtils = async () => import(utilsPath);

beforeEach(() => {
  vi.resetModules();
  sharedState.Platform.isBrowser = false;
  sharedState.estimateTokensCached.mockReset();
  sharedState.makeSecureTimestampedId.mockReset();
});

describe('DEFAULT_CONFIG', () => {
  it('uses non-browser maxL3Bytes and freezes config', async () => {
    sharedState.Platform.isBrowser = false;
    const { DEFAULT_CONFIG } = await loadUtils();

    expect(DEFAULT_CONFIG).toMatchObject({
      maxMessages: 20,
      maxSignals: 50,
      maxDecisions: 30,
      keepLastTurns: 6,
      compressThreshold: 0.8,
      contextWindow: 128000,
    });
    expect(DEFAULT_CONFIG.maxL3Bytes).toBe(Infinity);
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
  });

  it('uses browser cap for maxL3Bytes', async () => {
    sharedState.Platform.isBrowser = true;
    const { DEFAULT_CONFIG } = await loadUtils();

    expect(DEFAULT_CONFIG.maxL3Bytes).toBe(5 * 1024 * 1024 * 1024);
  });
});

describe('estimateBytes', () => {
  it('returns zero for nullish values and handles empty inputs', async () => {
    const { estimateBytes } = await loadUtils();

    expect(estimateBytes(null)).toBe(0);
    expect(estimateBytes(undefined)).toBe(0);
    expect(estimateBytes('')).toBe(0);
    expect(estimateBytes([])).toBe(4);
    expect(estimateBytes({})).toBe(4);
  });

  it('handles primitive boundaries and whitespace strings', async () => {
    const { estimateBytes } = await loadUtils();

    expect(estimateBytes('   ')).toBe(6);
    expect(estimateBytes('123')).toBe(6);
    expect(estimateBytes(0)).toBe(8);
    expect(estimateBytes(-1)).toBe(8);
    expect(estimateBytes(Number.MAX_SAFE_INTEGER)).toBe(8);
    expect(estimateBytes(true)).toBe(4);
    expect(estimateBytes(false)).toBe(4);
  });

  it('stringifies arrays, array-like objects, and deep nesting', async () => {
    const { estimateBytes } = await loadUtils();
    const arrayLike = { 0: 'a', length: 1 };
    const deep = { level: 0 };
    let node = deep;
    for (let i = 1; i <= 20; i += 1) {
      node.child = { level: i, items: [i, i + 1] };
      node = node.child;
    }

    expect(estimateBytes([1, 2, 3])).toBe(JSON.stringify([1, 2, 3]).length * 2);
    expect(estimateBytes(arrayLike)).toBe(JSON.stringify(arrayLike).length * 2);
    expect(estimateBytes(deep)).toBe(JSON.stringify(deep).length * 2);
  });

  it('handles large payloads and circular fallback', async () => {
    const { estimateBytes } = await loadUtils();
    const hugeText = 'x'.repeat(100000);
    const hugePayload = { name: 'file', content: hugeText };
    const circular = {};
    circular.self = circular;

    expect(estimateBytes(hugeText)).toBe(hugeText.length * 2);
    expect(estimateBytes(hugePayload)).toBe(JSON.stringify(hugePayload).length * 2);
    expect(estimateBytes(circular)).toBe(1024);
  });
});

describe('estimateTokensValue', () => {
  it('returns zero for nullish values without calling the estimator', async () => {
    const { estimateTokensValue } = await loadUtils();
    sharedState.estimateTokensCached.mockReturnValue(5);

    expect(estimateTokensValue(null)).toBe(0);
    expect(estimateTokensValue(undefined)).toBe(0);
    expect(sharedState.estimateTokensCached).not.toHaveBeenCalled();
  });

  it('passes string input through and forwards token counters', async () => {
    const { estimateTokensValue } = await loadUtils();
    const counter = vi.fn(() => 42);
    sharedState.estimateTokensCached.mockReturnValue(7);

    const result = estimateTokensValue('hello', counter);

    expect(result).toBe(7);
    expect(sharedState.estimateTokensCached).toHaveBeenCalledWith('hello', counter);
  });

  it('stringifies objects, arrays, and array-like data including empty values', async () => {
    const { estimateTokensValue } = await loadUtils();
    sharedState.estimateTokensCached.mockImplementation((text) => text.length);
    const arrayLike = { 0: 'a', length: 1 };

    const objectResult = estimateTokensValue({ a: 1 });
    const arrayResult = estimateTokensValue([]);
    const arrayLikeResult = estimateTokensValue(arrayLike);

    expect(objectResult).toBe(JSON.stringify({ a: 1 }).length);
    expect(arrayResult).toBe(JSON.stringify([]).length);
    expect(arrayLikeResult).toBe(JSON.stringify(arrayLike).length);
  });

  it('falls back to String() when JSON.stringify throws', async () => {
    const { estimateTokensValue } = await loadUtils();
    sharedState.estimateTokensCached.mockImplementation((text) => text.length);
    const circular = {};
    circular.self = circular;

    const result = estimateTokensValue(circular);

    expect(sharedState.estimateTokensCached).toHaveBeenCalledWith('[object Object]', undefined);
    expect(result).toBe('[object Object]'.length);
  });

  it('handles long text, deep nesting, and concurrent calls', async () => {
    const { estimateTokensValue } = await loadUtils();
    sharedState.estimateTokensCached.mockImplementation((text) => Math.ceil(text.length / 5));
    const longText = 'y'.repeat(50000);
    const deep = { level: 0 };
    let node = deep;
    for (let i = 1; i <= 15; i += 1) {
      node.child = { level: i, items: [i, i + 1] };
      node = node.child;
    }

    const results = await Promise.all([
      Promise.resolve(estimateTokensValue('   ')),
      Promise.resolve(estimateTokensValue(longText)),
      Promise.resolve(estimateTokensValue(deep)),
    ]);

    expect(results).toEqual([
      Math.ceil(3 / 5),
      Math.ceil(longText.length / 5),
      Math.ceil(JSON.stringify(deep).length / 5),
    ]);
    expect(sharedState.estimateTokensCached).toHaveBeenCalledTimes(3);
  });
});

describe('truncate', () => {
  it('returns input unchanged for nullish or empty values', async () => {
    const { truncate } = await loadUtils();

    expect(truncate(null)).toBeNull();
    expect(truncate(undefined)).toBeUndefined();
    expect(truncate('')).toBe('');
  });

  it('does not truncate when text length is within maxLen', async () => {
    const { truncate } = await loadUtils();

    expect(truncate('short', 10)).toBe('short');
    expect(truncate('   ', 10)).toBe('   ');
    expect(truncate('tiny', Number.MAX_SAFE_INTEGER)).toBe('tiny');
  });

  it('truncates long text and appends ellipsis', async () => {
    const { truncate } = await loadUtils();

    const result = truncate('hello world', 8);

    expect(result).toBe('hello...');
    expect(result.length).toBe(8);
  });

  it('handles string maxLen values, zero/negative boundaries, and rapid calls', async () => {
    const { truncate } = await loadUtils();

    const results = await Promise.all([
      Promise.resolve(truncate('abcdef', '4')),
      Promise.resolve(truncate('abcdef', 0)),
      Promise.resolve(truncate('abcdef', -1)),
    ]);

    expect(results).toEqual(['a...', 'abc...', 'ab...']);
  });

  it('handles very long strings as a resource boundary', async () => {
    const { truncate } = await loadUtils();
    const longText = 'z'.repeat(10000);

    const result = truncate(longText, 200);

    expect(result.length).toBe(200);
    expect(result.endsWith('...')).toBe(true);
  });
});

describe('genId', () => {
  it('uses the default prefix when none is provided', async () => {
    const { genId } = await loadUtils();
    sharedState.makeSecureTimestampedId.mockReturnValue('id_123');

    const result = genId();

    expect(result).toBe('id_123');
    expect(sharedState.makeSecureTimestampedId).toHaveBeenCalledWith('id');
  });

  it('uses custom prefixes and supports rapid consecutive calls', async () => {
    const { genId } = await loadUtils();
    let counter = 0;
    sharedState.makeSecureTimestampedId.mockImplementation((prefix) => `${prefix}_${counter++}`);

    const results = await Promise.all([
      Promise.resolve(genId('run')),
      Promise.resolve(genId('run')),
      Promise.resolve(genId('task')),
    ]);

    expect(results).toEqual(['run_0', 'run_1', 'task_2']);
    expect(sharedState.makeSecureTimestampedId).toHaveBeenCalledTimes(3);
  });

  it('forwards non-string prefixes without mutation', async () => {
    const { genId } = await loadUtils();
    sharedState.makeSecureTimestampedId.mockReturnValue('123_id');

    const result = genId(123);

    expect(result).toBe('123_id');
    expect(sharedState.makeSecureTimestampedId).toHaveBeenCalledWith(123);
  });
});

describe('isFiniteNumber', () => {
  it('returns true for finite numbers including boundaries', async () => {
    const { isFiniteNumber } = await loadUtils();

    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-1)).toBe(true);
    expect(isFiniteNumber(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('returns false for non-numbers or non-finite values', async () => {
    const { isFiniteNumber } = await loadUtils();

    expect(isFiniteNumber(NaN)).toBe(false);
    expect(isFiniteNumber(Infinity)).toBe(false);
    expect(isFiniteNumber(-Infinity)).toBe(false);
    expect(isFiniteNumber('123')).toBe(false);
    expect(isFiniteNumber('   ')).toBe(false);
    expect(isFiniteNumber(null)).toBe(false);
    expect(isFiniteNumber(undefined)).toBe(false);
    expect(isFiniteNumber({})).toBe(false);
    expect(isFiniteNumber([])).toBe(false);
  });
});
