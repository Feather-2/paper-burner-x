import { describe, it, expect, vi, beforeEach } from 'vitest';

const sharedMocks = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
  safeInt: vi.fn(),
  safeNumber: vi.fn(),
  toNonEmptyString: vi.fn(),
  stripThinkingTags: vi.fn(),
  extractJsonCandidate: vi.fn(),
}));

const usageMocks = vi.hoisted(() => ({
  normalizeTokenUsage: vi.fn(),
}));

vi.mock('../../../../../../js/agents/shared/index.js', () => sharedMocks);
vi.mock('../../../../../../js/agents/stages/deepsearch/model/usage.js', () => usageMocks);

import {
  normalizeTokenUsage,
  EVENT_SCHEMA_VERSION,
  EventStatus,
  ensureTokenUsage,
  normalizeBudgetConfig,
  stripThinkingTags,
} from '../../../../../../js/agents/stages/deepsearch/utils/state-utils.js';

const parseNumber = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
};

beforeEach(() => {
  vi.clearAllMocks();

  sharedMocks.isPlainObject.mockImplementation((value) => {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  sharedMocks.safeNumber.mockImplementation(parseNumber);

  sharedMocks.safeInt.mockImplementation((value) => {
    const num = parseNumber(value);
    return num === null ? null : Math.trunc(num);
  });

  sharedMocks.toNonEmptyString.mockImplementation((value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  });

  sharedMocks.stripThinkingTags.mockImplementation((text) => {
    if (typeof text !== 'string') return '';
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  });

  sharedMocks.extractJsonCandidate.mockImplementation((text) => (typeof text === 'string' ? text : null));

  usageMocks.normalizeTokenUsage.mockImplementation((usage) => {
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
    const input = parseNumber(usage.input ?? usage.prompt_tokens ?? usage.promptTokens);
    const output = parseNumber(usage.output ?? usage.completion_tokens ?? usage.completionTokens);
    if (input === null && output === null) return null;
    const inVal = input ?? 0;
    const outVal = output ?? 0;
    return { input: inVal, output: outVal, total: inVal + outVal };
  });
});

describe('normalizeTokenUsage', () => {
  it('delegates to the usage normalizer', () => {
    const normalized = { input: 3, output: 4, total: 7 };
    usageMocks.normalizeTokenUsage.mockReturnValue(normalized);

    const payload = { input: 3, output: 4 };
    const result = normalizeTokenUsage(payload);

    expect(result).toBe(normalized);
    expect(usageMocks.normalizeTokenUsage).toHaveBeenCalledWith(payload);
  });

  it('returns null for empty, boundary, and invalid inputs', () => {
    const inputs = [null, undefined, '', '   ', [], {}, 0, -1, Number.MAX_SAFE_INTEGER];
    for (const input of inputs) {
      expect(normalizeTokenUsage(input)).toBeNull();
    }
    expect(usageMocks.normalizeTokenUsage).toHaveBeenCalledTimes(inputs.length);
  });
});

describe('EVENT_SCHEMA_VERSION', () => {
  it('exposes a stable schema version string', () => {
    expect(EVENT_SCHEMA_VERSION).toBe('deepsearch.event.v1');
    expect(typeof EVENT_SCHEMA_VERSION).toBe('string');
    expect(EVENT_SCHEMA_VERSION.length).toBeGreaterThan(0);
  });
});

describe('EventStatus', () => {
  it('enumerates the known event statuses', () => {
    expect(EventStatus.STARTED).toBe('started');
    expect(EventStatus.PROGRESS).toBe('progress');
    expect(EventStatus.COMPLETED).toBe('completed');
    expect(EventStatus.FAILED).toBe('failed');
    expect(EventStatus.WARNING).toBe('warning');
    expect(EventStatus.INFO).toBe('info');
    expect(Object.isFrozen(EventStatus)).toBe(true);
  });
});

describe('ensureTokenUsage', () => {
  it('returns normalized usage and estimated cost', () => {
    usageMocks.normalizeTokenUsage.mockReturnValue({ input: 10, output: 5, total: 15 });

    const result = ensureTokenUsage({ estimatedCostUSD: 0.25 });

    expect(result).toEqual({ input: 10, output: 5, total: 15, estimatedCostUSD: 0.25 });
    expect(sharedMocks.safeNumber).toHaveBeenCalledWith(0.25);
  });

  it('falls back to costUSD and clamps negative costs', () => {
    usageMocks.normalizeTokenUsage.mockReturnValue({ input: 1, output: 1, total: 2 });

    const result = ensureTokenUsage({ costUSD: -5 });

    expect(result.estimatedCostUSD).toBe(0);
    expect(sharedMocks.safeNumber).toHaveBeenCalledWith(-5);
  });

  it('returns zeros when normalized usage is missing', () => {
    usageMocks.normalizeTokenUsage.mockReturnValue(null);

    const result = ensureTokenUsage({ estimatedCostUSD: 1 });

    expect(result).toEqual({ input: 0, output: 0, total: 0, estimatedCostUSD: 0 });
  });

  it('parses string costs and boundary values', () => {
    usageMocks.normalizeTokenUsage.mockReturnValue({ input: 0, output: 0, total: 0 });

    expect(ensureTokenUsage({ estimatedCostUSD: '12.5' }).estimatedCostUSD).toBe(12.5);
    expect(ensureTokenUsage({ estimatedCostUSD: '0' }).estimatedCostUSD).toBe(0);
    expect(ensureTokenUsage({ estimatedCostUSD: String(Number.MAX_SAFE_INTEGER) }).estimatedCostUSD).toBe(
      Number.MAX_SAFE_INTEGER
    );
  });

  it('handles empty inputs and type boundaries safely', () => {
    usageMocks.normalizeTokenUsage.mockReturnValue(null);

    const inputs = [null, undefined, '', '   ', [], {}];
    for (const input of inputs) {
      expect(ensureTokenUsage(input)).toEqual({ input: 0, output: 0, total: 0, estimatedCostUSD: 0 });
    }
  });

  it('uses zero when cost values are unparsable', () => {
    usageMocks.normalizeTokenUsage.mockReturnValue({ input: 2, output: 3, total: 5 });

    const result = ensureTokenUsage({ estimatedCostUSD: 'not-a-number' });

    expect(result.estimatedCostUSD).toBe(0);
  });

  it('supports rapid concurrent calls with mixed payloads', async () => {
    usageMocks.normalizeTokenUsage.mockImplementation((usage) => {
      if (!usage || typeof usage !== 'object') return null;
      const input = parseNumber(usage.input) ?? 0;
      const output = parseNumber(usage.output) ?? 0;
      return { input, output, total: input + output };
    });

    const inputs = [
      { input: 1, output: 2, estimatedCostUSD: 0.1 },
      { input: 0, output: 0, costUSD: 0 },
      { input: 5, output: 1, estimatedCostUSD: -1 },
    ];

    const results = await Promise.all(inputs.map((payload) => Promise.resolve(ensureTokenUsage(payload))));

    expect(results).toEqual([
      { input: 1, output: 2, total: 3, estimatedCostUSD: 0.1 },
      { input: 0, output: 0, total: 0, estimatedCostUSD: 0 },
      { input: 5, output: 1, total: 6, estimatedCostUSD: 0 },
    ]);
  });
});

describe('normalizeBudgetConfig', () => {
  it('uses defaults for empty or invalid inputs', () => {
    const inputs = [null, undefined, '', '   ', [], {}];
    for (const input of inputs) {
      const result = normalizeBudgetConfig(input);
      expect(result.maxTokens).toBe(50000);
      expect(result.maxCostUSD).toBe(0.5);
      expect(result.warnAt).toBe(0.8);
      expect(result.action).toBe('warn');
      expect(result.prices['gpt-4o-mini'].input).toBeCloseTo(0.00015, 6);
      expect(result.prices['claude-3-5-haiku'].output).toBeCloseTo(0.004, 6);
    }
  });

  it('clamps warnAt and normalizes actions', () => {
    const low = normalizeBudgetConfig({ warnAt: -1, action: 'unknown' });
    const high = normalizeBudgetConfig({ warnAt: 1.5, action: '  stop ' });
    const mid = normalizeBudgetConfig({ warnAt: '0.25', action: ' degrade ' });

    expect(low.warnAt).toBe(0);
    expect(low.action).toBe('warn');
    expect(high.warnAt).toBe(1);
    expect(high.action).toBe('stop');
    expect(mid.warnAt).toBe(0.25);
    expect(mid.action).toBe('degrade');
  });

  it('accepts numeric strings and boundary values for limits', () => {
    const fromStrings = normalizeBudgetConfig({ maxTokens: '0', maxCostUSD: '0.25' });
    const maxed = normalizeBudgetConfig({
      maxTokens: Number.MAX_SAFE_INTEGER,
      maxCostUSD: Number.MAX_SAFE_INTEGER,
    });
    const negative = normalizeBudgetConfig({ maxTokens: -1, maxCostUSD: -1 });

    expect(fromStrings.maxTokens).toBe(0);
    expect(fromStrings.maxCostUSD).toBe(0.25);
    expect(maxed.maxTokens).toBe(Number.MAX_SAFE_INTEGER);
    expect(maxed.maxCostUSD).toBe(Number.MAX_SAFE_INTEGER);
    expect(negative.maxTokens).toBe(50000);
    expect(negative.maxCostUSD).toBe(0.5);
  });

  it('normalizes and merges model prices safely', () => {
    const prices = Object.create(null);
    prices['gpt-4o'] = { input: 0.007, output: 0.02 };
    prices['new-model'] = { inputPer1K: '0.5', outputUsdPer1K: '1.5' };
    prices['neg-model'] = { input: -0.1, output: -0.2 };
    prices['__proto__'] = { polluted: true };
    prices.constructor = { input: 1 };
    prices.prototype = { input: 1 };
    prices.bad = 'nope';
    prices.array = [];
    prices.empty = {};
    prices[' spaced '] = { input: 0.1 };

    const result = normalizeBudgetConfig({ prices });

    expect(result.prices['gpt-4o'].input).toBe(0.007);
    expect(result.prices['gpt-4o'].output).toBe(0.02);
    expect(result.prices['new-model'].input).toBe(0.5);
    expect(result.prices['new-model'].output).toBe(1.5);
    expect(result.prices['neg-model'].input).toBe(0);
    expect(result.prices['neg-model'].output).toBe(0);
    expect(result.prices.spaced.input).toBe(0.1);
    expect(result.prices['claude-3-5-haiku'].output).toBeCloseTo(0.004, 6);
    expect(Object.prototype.hasOwnProperty.call(result.prices, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result.prices, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result.prices, 'prototype')).toBe(false);
    expect(result.prices.bad).toBeUndefined();
    expect(result.prices.array).toBeUndefined();
    expect(result.prices.empty).toBeUndefined();
    expect({}.polluted).toBeUndefined();
  });

  it('handles deep nesting and long model ids', () => {
    const deepMeta = {};
    let cursor = deepMeta;
    for (let i = 0; i < 50; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }

    const hugeKey = 'm'.repeat(10000);
    const result = normalizeBudgetConfig({
      prices: {
        [hugeKey]: { input: 0.123, output: 0.456, meta: deepMeta },
      },
    });

    expect(result.prices[hugeKey].input).toBe(0.123);
    expect(result.prices[hugeKey].output).toBe(0.456);
  });

  it('supports concurrent normalization without shared state', async () => {
    const configs = [
      { maxTokens: 0, warnAt: 0.1, action: 'warn' },
      { maxTokens: '12', maxCostUSD: '0.2', warnAt: 2, action: 'degrade' },
      { prices: { 'model-x': { input: 0.5 } } },
    ];

    const results = await Promise.all(configs.map((cfg) => Promise.resolve(normalizeBudgetConfig(cfg))));

    expect(results[0].maxTokens).toBe(0);
    expect(results[1].maxTokens).toBe(12);
    expect(results[1].warnAt).toBe(1);
    expect(results[1].action).toBe('degrade');
    expect(results[2].prices['model-x'].input).toBe(0.5);
  });
});

describe('stripThinkingTags', () => {
  it('delegates to the shared stripThinkingTags helper', () => {
    const input = '<think>reason</think>{"ok":true}';
    const result = stripThinkingTags(input);

    expect(result).toBe('{"ok":true}');
    expect(sharedMocks.stripThinkingTags).toHaveBeenCalledWith(input);
  });

  it('handles empty, whitespace, and non-string inputs', () => {
    expect(stripThinkingTags('')).toBe('');
    expect(stripThinkingTags('   ')).toBe('   ');
    expect(stripThinkingTags(null)).toBe('');
    expect(stripThinkingTags(undefined)).toBe('');
  });

  it('handles very large text payloads', () => {
    const chunk = 'x'.repeat(500000);
    const payload = `<think>secret</think>${chunk}<think>more</think>${chunk}`;
    const result = stripThinkingTags(payload);

    expect(result).toBe(chunk + chunk);
  });
});
