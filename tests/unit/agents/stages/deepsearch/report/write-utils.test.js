import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedShared = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
  toNonEmptyString: vi.fn(),
}));

const mockedRuntime = vi.hoisted(() => ({
  normalizeReportLength: vi.fn(),
  ReportLength: { STANDARD: 'standard' },
}));

vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  isPlainObject: mockedShared.isPlainObject,
  toNonEmptyString: mockedShared.toNonEmptyString,
}));

vi.mock('../../../../../../js/agents/runtime/index.js', () => ({
  normalizeReportLength: mockedRuntime.normalizeReportLength,
  ReportLength: mockedRuntime.ReportLength,
}));

import {
  REPORT_LENGTH_PRESETS,
  safeFiniteNumber,
  normalizeStringArray,
  countWordsApprox,
  clampInt,
  resolveMaxParallelSections,
  resolveReviewerConfig,
  extractTitleFromMarkdown,
  resolveReportLengthConfig,
  mapConcurrent,
} from '../../../../../../js/agents/stages/deepsearch/report/write-utils.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockedShared.isPlainObject.mockImplementation((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });
  mockedShared.toNonEmptyString.mockImplementation((value) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  });
  mockedRuntime.normalizeReportLength.mockImplementation((value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  });
  mockedRuntime.ReportLength.STANDARD = 'standard';
});

describe('REPORT_LENGTH_PRESETS', () => {
  it('exposes frozen presets with expected ranges', () => {
    expect(Object.isFrozen(REPORT_LENGTH_PRESETS)).toBe(true);
    expect(REPORT_LENGTH_PRESETS).toMatchObject({
      brief: { minWords: 800, maxWords: 2000, targetWords: 1200 },
      standard: { minWords: 2000, maxWords: 5000, targetWords: 3500 },
      detailed: { minWords: 5000, maxWords: 10000, targetWords: 8000 },
      comprehensive: { minWords: 10000, maxWords: 20000, targetWords: 15000 },
    });
    Object.values(REPORT_LENGTH_PRESETS).forEach((preset) => {
      expect(preset.minWords).toBeLessThanOrEqual(preset.targetWords);
      expect(preset.targetWords).toBeLessThanOrEqual(preset.maxWords);
    });
  });
});

describe('safeFiniteNumber', () => {
  it('returns finite numbers for numeric inputs', () => {
    expect(safeFiniteNumber(0)).toBe(0);
    expect(safeFiniteNumber(-1)).toBe(-1);
    expect(safeFiniteNumber(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(safeFiniteNumber(' 42 ')).toBe(42);
    expect(safeFiniteNumber('3.14')).toBe(3.14);
  });

  it('returns null for non-finite or invalid inputs', () => {
    expect(safeFiniteNumber(NaN)).toBeNull();
    expect(safeFiniteNumber(Infinity)).toBeNull();
    expect(safeFiniteNumber(-Infinity)).toBeNull();
    expect(safeFiniteNumber('')).toBeNull();
    expect(safeFiniteNumber('   ')).toBeNull();
    expect(safeFiniteNumber('abc')).toBeNull();
    expect(safeFiniteNumber(null)).toBeNull();
    expect(safeFiniteNumber(undefined)).toBeNull();
    expect(safeFiniteNumber({})).toBeNull();
    expect(safeFiniteNumber([])).toBeNull();
  });

  it('is deterministic under rapid concurrent calls', async () => {
    const values = [0, '1', '  ', '3', -1, 'nope', Number.MAX_SAFE_INTEGER];
    const results = await Promise.all(values.map((value) => Promise.resolve(safeFiniteNumber(value))));
    expect(results).toEqual([0, 1, null, 3, -1, null, Number.MAX_SAFE_INTEGER]);
  });
});

describe('normalizeStringArray', () => {
  it('normalizes arrays to unique trimmed strings', () => {
    const input = [' a ', 'b', 'a', '', '  ', null, undefined, 0, -1, 'b'];
    expect(normalizeStringArray(input)).toEqual(['a', 'b', '-1']);
  });

  it('wraps non-array input and stringifies values', () => {
    expect(normalizeStringArray('  hello ')).toEqual(['hello']);
    expect(normalizeStringArray(123)).toEqual(['123']);
    expect(normalizeStringArray({})).toEqual(['[object Object]']);
  });

  it('returns empty array for empty or whitespace inputs', () => {
    expect(normalizeStringArray(null)).toEqual([]);
    expect(normalizeStringArray(undefined)).toEqual([]);
    expect(normalizeStringArray('')).toEqual([]);
    expect(normalizeStringArray('   ')).toEqual([]);
    expect(normalizeStringArray([])).toEqual([]);
  });

  it('handles deep nested objects and concurrent calls', async () => {
    const deep = { a: { b: { c: { d: { e: 'x' } } } } };
    expect(normalizeStringArray([deep, deep])).toEqual(['[object Object]']);

    const inputs = [deep, 'x', ' x ', ''];
    const outputs = await Promise.all(inputs.map((value) => Promise.resolve(normalizeStringArray(value))));
    expect(outputs).toEqual([['[object Object]'], ['x'], ['x'], []]);
  });
});

describe('countWordsApprox', () => {
  it('counts Latin tokens and CJK characters', () => {
    const text = "state-of-the-art rock'n'roll 2024 你好";
    expect(countWordsApprox(text)).toBe(5);
  });

  it('returns 0 for empty or non-string inputs', () => {
    expect(countWordsApprox('')).toBe(0);
    expect(countWordsApprox('   ')).toBe(0);
    expect(countWordsApprox(null)).toBe(0);
    expect(countWordsApprox(undefined)).toBe(0);
    expect(countWordsApprox(0)).toBe(0);
    expect(countWordsApprox(-1)).toBe(0);
    expect(countWordsApprox({})).toBe(0);
  });

  it('handles large input and concurrent calls', async () => {
    const large = `${'word '.repeat(10000)}漢字`;
    const expected = 10002;
    expect(countWordsApprox(large)).toBe(expected);

    const results = await Promise.all([
      Promise.resolve(countWordsApprox(large)),
      Promise.resolve(countWordsApprox(`${large} test`)),
    ]);
    expect(results).toEqual([expected, expected + 1]);
  });
});

describe('clampInt', () => {
  it('clamps and floors numeric input', () => {
    expect(clampInt(5.9, 1, 10)).toBe(5);
    expect(clampInt('3.7', 1, 10)).toBe(3);
    expect(clampInt(-1, 0, 10)).toBe(0);
    expect(clampInt(0, 0, 10)).toBe(0);
    expect(clampInt(Number.MAX_SAFE_INTEGER, 1, 100)).toBe(100);
  });

  it('returns null for non-numeric inputs', () => {
    expect(clampInt('abc', 1, 10)).toBeNull();
    expect(clampInt(null, 1, 10)).toBeNull();
    expect(clampInt(undefined, 1, 10)).toBeNull();
    expect(clampInt({}, 1, 10)).toBeNull();
    expect(clampInt(NaN, 1, 10)).toBeNull();
    expect(clampInt(Infinity, 1, 10)).toBeNull();
    expect(clampInt('', 1, 10)).toBeNull();
    expect(clampInt('   ', 1, 10)).toBeNull();
  });
});

describe('resolveMaxParallelSections', () => {
  it('uses configured value bounded by section count', () => {
    const userConfig = { write: { maxParallelSections: 8 } };
    expect(resolveMaxParallelSections(userConfig, 3)).toBe(3);
  });

  it('falls back to defaults and handles invalid section counts', () => {
    expect(resolveMaxParallelSections({}, 10)).toBe(3);
    expect(resolveMaxParallelSections(null, 2)).toBe(2);
    expect(resolveMaxParallelSections({ write: { maxParallelSections: 4 } }, 0)).toBe(1);
    expect(resolveMaxParallelSections({ write: { maxParallelSections: 4 } }, '3')).toBe(1);
  });

  it('clamps config to bounds and floors values', () => {
    expect(resolveMaxParallelSections({ write: { maxParallelSections: 0 } }, 50)).toBe(1);
    expect(resolveMaxParallelSections({ write: { maxParallelSections: 99.8 } }, 5)).toBe(5);
  });

  it('is stable under rapid concurrent calls', async () => {
    const calls = [
      Promise.resolve(resolveMaxParallelSections({ write: { maxParallelSections: 2 } }, 10)),
      Promise.resolve(resolveMaxParallelSections({ write: { maxParallelSections: 15 } }, 4)),
      Promise.resolve(resolveMaxParallelSections({}, 1)),
    ];
    const results = await Promise.all(calls);
    expect(results).toEqual([2, 4, 1]);
  });
});

describe('resolveReviewerConfig', () => {
  it('returns defaults when write is not a plain object', () => {
    mockedShared.isPlainObject.mockReturnValue(false);
    expect(resolveReviewerConfig({ write: [] })).toEqual({ enableReviewer: false, maxReviewRounds: 1 });
    expect(resolveReviewerConfig(null)).toEqual({ enableReviewer: false, maxReviewRounds: 1 });
  });

  it('uses config values when write is plain object', () => {
    mockedShared.isPlainObject.mockReturnValue(true);
    const userConfig = { write: { enableReviewer: 'yes', maxReviewRounds: '5' } };
    expect(resolveReviewerConfig(userConfig)).toEqual({ enableReviewer: true, maxReviewRounds: 5 });
    expect(mockedShared.isPlainObject).toHaveBeenCalledWith(userConfig.write);
  });

  it('clamps maxReviewRounds to bounds', () => {
    mockedShared.isPlainObject.mockReturnValue(true);
    expect(resolveReviewerConfig({ write: { maxReviewRounds: -1 } }).maxReviewRounds).toBe(1);
    expect(resolveReviewerConfig({ write: { maxReviewRounds: 0 } }).maxReviewRounds).toBe(1);
    expect(resolveReviewerConfig({ write: { maxReviewRounds: Number.MAX_SAFE_INTEGER } }).maxReviewRounds).toBe(10);
  });
});

describe('extractTitleFromMarkdown', () => {
  it('extracts the first H1 heading', () => {
    const markdown = `Intro
# Main Title
More text
# Another Title`;
    expect(extractTitleFromMarkdown(markdown)).toBe('Main Title');
    expect(mockedShared.toNonEmptyString).toHaveBeenCalledWith('Main Title');
  });

  it('returns undefined for missing or blank input', () => {
    expect(extractTitleFromMarkdown(null)).toBeUndefined();
    expect(extractTitleFromMarkdown('')).toBeUndefined();
    expect(extractTitleFromMarkdown('## Subtitle')).toBeUndefined();
    expect(extractTitleFromMarkdown('   ')).toBeUndefined();
  });

  it('handles large markdown and trims title', () => {
    const large = `${'x'.repeat(10000)}\n   #   Big Title   \nMore`;
    expect(extractTitleFromMarkdown(large)).toBe('Big Title');
  });
});

describe('resolveReportLengthConfig', () => {
  it('infers preset when target words provided', () => {
    mockedRuntime.normalizeReportLength.mockReturnValue(null);
    const result = resolveReportLengthConfig({ reportTargetWords: 9000 });
    expect(result).toEqual({
      reportLength: 'detailed',
      targetWords: 9000,
      minWords: REPORT_LENGTH_PRESETS.detailed.minWords,
      maxWords: REPORT_LENGTH_PRESETS.detailed.maxWords,
      strategy: 'toc-based',
    });
  });

  it('prefers preset even when target words imply different preset', () => {
    mockedRuntime.normalizeReportLength.mockReturnValue('brief');
    const result = resolveReportLengthConfig({ reportLength: 'brief', reportTargetWords: 12000 });
    expect(result.reportLength).toBe('brief');
    expect(result.targetWords).toBe(12000);
    expect(result.minWords).toBe(REPORT_LENGTH_PRESETS.comprehensive.minWords);
    expect(result.maxWords).toBe(REPORT_LENGTH_PRESETS.comprehensive.maxWords);
    expect(result.strategy).toBe('toc-based');
    expect(mockedRuntime.normalizeReportLength).toHaveBeenCalledWith('brief');
  });

  it('clamps target words to lower and upper bounds', () => {
    mockedRuntime.normalizeReportLength.mockReturnValue(null);
    const low = resolveReportLengthConfig({ reportTargetWords: 0 });
    expect(low.targetWords).toBe(REPORT_LENGTH_PRESETS.brief.minWords);
    expect(low.reportLength).toBe('brief');
    expect(low.strategy).toBe('single');

    const high = resolveReportLengthConfig({ reportTargetWords: Number.MAX_SAFE_INTEGER });
    expect(high.targetWords).toBe(REPORT_LENGTH_PRESETS.comprehensive.maxWords);
    expect(high.reportLength).toBe('comprehensive');
    expect(high.strategy).toBe('toc-based');
  });

  it('falls back to preset or standard when target words are missing', () => {
    mockedRuntime.normalizeReportLength.mockReturnValue('detailed');
    const detailed = resolveReportLengthConfig({ reportLength: 'detailed', reportTargetWords: '   ' });
    expect(detailed.reportLength).toBe('detailed');
    expect(detailed.targetWords).toBe(REPORT_LENGTH_PRESETS.detailed.targetWords);
    expect(detailed.strategy).toBe('toc-based');

    mockedRuntime.normalizeReportLength.mockReturnValue('unknown');
    const fallback = resolveReportLengthConfig({});
    expect(fallback.reportLength).toBe('standard');
    expect(fallback.targetWords).toBe(REPORT_LENGTH_PRESETS.standard.targetWords);
    expect(fallback.strategy).toBe('single');
  });

  it('is stable under rapid concurrent calls', async () => {
    mockedRuntime.normalizeReportLength.mockImplementation((value) => value || null);
    const configs = [
      { reportLength: 'brief' },
      { reportTargetWords: 15000 },
      { reportLength: 'standard', reportTargetWords: 2500 },
    ];
    const results = await Promise.all(configs.map((cfg) => Promise.resolve(resolveReportLengthConfig(cfg))));
    expect(results[0].reportLength).toBe('brief');
    expect(results[1].reportLength).toBe('comprehensive');
    expect(results[2].reportLength).toBe('standard');
  });
});

describe('mapConcurrent', () => {
  it('maps items with bounded concurrency and preserves order', async () => {
    const items = [1, 2, 3, 4];
    let active = 0;
    let maxActive = 0;
    const results = await mapConcurrent(items, 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return item * 2;
    });
    expect(results).toEqual([2, 4, 6, 8]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('handles invalid inputs without invoking worker', async () => {
    const worker = vi.fn(async () => 'x');
    const result = await mapConcurrent(null, 0, worker);
    expect(result).toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });

  it('supports rapid concurrent invocations', async () => {
    const results = await Promise.all([
      mapConcurrent([1, 2], 4, async (item) => item + 1),
      mapConcurrent([], 2, async () => 0),
      mapConcurrent([3], 1, async (item) => item * 3),
    ]);
    expect(results).toEqual([[2, 3], [], [9]]);
  });
});
