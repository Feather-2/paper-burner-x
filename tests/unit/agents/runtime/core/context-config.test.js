import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../js/agents/runtime/core/context-config.js', async () => {
  const actual = await vi.importActual('../../../../../js/agents/runtime/core/context-config.js');
  return actual;
});

import { DEFAULT_CONTEXT_CONFIG, mergeContextConfig } from '../../../../../js/agents/runtime/core/context-config.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DEFAULT_CONTEXT_CONFIG', () => {
  it('exposes the expected frozen defaults', () => {
    expect(DEFAULT_CONTEXT_CONFIG).toEqual({
      contextWindow: 128000,
      maxOutputTokens: 4096,
      compressThreshold: 0.9,
      compressCooldownMs: 5000,
      keepLastTurns: 6,
      userMessageBuffer: 20000,
      titleOnlySummaryThreshold: 0.8,
      titleOnlySummaryMaxWords: 10,
      titleOnlySummaryMaxChars: 80,
      maxKeptMessageChars: 16000,
      useCompressionWorker: true,
      workerThresholdMessages: 50,
    });
    expect(Object.isFrozen(DEFAULT_CONTEXT_CONFIG)).toBe(true);
    expect(Object.isExtensible(DEFAULT_CONTEXT_CONFIG)).toBe(false);
  });

  it('prevents mutation attempts', () => {
    expect(() => {
      DEFAULT_CONTEXT_CONFIG.maxOutputTokens = 1;
    }).toThrow(TypeError);
    expect(() => {
      DEFAULT_CONTEXT_CONFIG.newField = 'x';
    }).toThrow(TypeError);
    expect(DEFAULT_CONTEXT_CONFIG.maxOutputTokens).toBe(4096);
    expect(Object.prototype.hasOwnProperty.call(DEFAULT_CONTEXT_CONFIG, 'newField')).toBe(false);
  });
});

describe('mergeContextConfig', () => {
  it('returns defaults for non-object inputs including empty and boundary values', () => {
    const inputs = [null, undefined, '', '   ', 0, -1, Number.MAX_SAFE_INTEGER];

    for (const input of inputs) {
      const result = mergeContextConfig(input);
      expect(result).toBe(DEFAULT_CONTEXT_CONFIG);
    }
  });

  it('merges overrides and returns a frozen new config', () => {
    const result = mergeContextConfig({
      maxOutputTokens: 1024,
      useCompressionWorker: false,
    });

    expect(result).not.toBe(DEFAULT_CONTEXT_CONFIG);
    expect(result.maxOutputTokens).toBe(1024);
    expect(result.useCompressionWorker).toBe(false);
    expect(result.contextWindow).toBe(DEFAULT_CONTEXT_CONFIG.contextWindow);
    expect(Object.isFrozen(result)).toBe(true);
    expect(DEFAULT_CONTEXT_CONFIG.maxOutputTokens).toBe(4096);
  });

  it('treats empty objects and arrays as mergeable configs', () => {
    const emptyObjectResult = mergeContextConfig({});
    const emptyArrayResult = mergeContextConfig([]);

    expect(emptyObjectResult).not.toBe(DEFAULT_CONTEXT_CONFIG);
    expect(emptyObjectResult).toEqual(DEFAULT_CONTEXT_CONFIG);
    expect(Object.isFrozen(emptyObjectResult)).toBe(true);

    expect(emptyArrayResult).not.toBe(DEFAULT_CONTEXT_CONFIG);
    expect(emptyArrayResult).toEqual(DEFAULT_CONTEXT_CONFIG);
    expect(Object.isFrozen(emptyArrayResult)).toBe(true);
  });

  it('keeps type mismatches and array-like objects without coercion', () => {
    const arrayLike = { 0: 'msg', length: 1 };
    const result = mergeContextConfig({
      contextWindow: '128k',
      keepLastTurns: { count: 3 },
      userMessageBuffer: arrayLike,
    });

    expect(result.contextWindow).toBe('128k');
    expect(result.keepLastTurns).toEqual({ count: 3 });
    expect(result.userMessageBuffer).toBe(arrayLike);
  });

  it('supports concurrent and rapid consecutive calls without shared state', async () => {
    const inputs = [
      { maxOutputTokens: 1 },
      { maxOutputTokens: 2 },
      { maxOutputTokens: 3 },
    ];

    const results = await Promise.all(
      inputs.map((config) => Promise.resolve().then(() => mergeContextConfig(config)))
    );

    expect(results.map((result) => result.maxOutputTokens)).toEqual([1, 2, 3]);
    expect(new Set(results).size).toBe(results.length);

    const first = mergeContextConfig({ maxOutputTokens: 10 });
    const second = mergeContextConfig({ maxOutputTokens: 11 });

    expect(first).not.toBe(second);
    expect(first.maxOutputTokens).toBe(10);
    expect(second.maxOutputTokens).toBe(11);
  });

  it('handles resource boundaries for huge strings, large arrays, and deep nesting', () => {
    const hugeString = 'a'.repeat(100000);
    const largeArray = Array.from({ length: 5000 }, (_, index) => `line-${index}`);
    const deepNested = { level: 0 };
    let current = deepNested;
    for (let i = 1; i <= 30; i += 1) {
      current.child = { level: i };
      current = current.child;
    }

    const result = mergeContextConfig({
      extraPayload: hugeString,
      extraLines: largeArray,
      nested: deepNested,
    });

    expect(result.extraPayload).toBe(hugeString);
    expect(result.extraLines).toBe(largeArray);
    expect(result.nested).toBe(deepNested);

    let depth = 0;
    let node = result.nested;
    while (node.child) {
      depth += 1;
      node = node.child;
    }
    expect(depth).toBe(30);
    expect(node.level).toBe(30);
  });
});
