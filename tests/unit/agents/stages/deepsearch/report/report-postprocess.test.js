import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  isPlainObject: vi.fn(),
  toNonEmptyString: vi.fn(),
  createSafeRegex: vi.fn(),
}));

import {
  getReportConfig,
  countNonWhitespaceChars,
  countSemanticWords,
  countReferences,
  reorderReportSections,
  validateReport,
  getReportProgress,
} from '../../../../../../js/agents/stages/deepsearch/report/report-postprocess.js';
import { isPlainObject, toNonEmptyString, createSafeRegex } from '../../../../../../js/agents/shared/index.js';

beforeEach(() => {
  const isPlainObjectMock = vi.mocked(isPlainObject);
  const toNonEmptyStringMock = vi.mocked(toNonEmptyString);
  const createSafeRegexMock = vi.mocked(createSafeRegex);

  isPlainObjectMock.mockReset();
  toNonEmptyStringMock.mockReset();
  createSafeRegexMock.mockReset();

  isPlainObjectMock.mockImplementation((value) => {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  toNonEmptyStringMock.mockImplementation((value) => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed ? trimmed : '';
  });

  createSafeRegexMock.mockImplementation((pattern, flags) => new RegExp(pattern, flags));
});

describe('getReportConfig', () => {
  it('merges base, global, and state config with precedence and preserves edge values', () => {
    const state = {
      globalConfig: {
        report: {
          quick: {
            minWords: 5000,
            minReferences: 2,
            requiredSections: ['A'],
            recommendedSections: ['B'],
            sectionWordLimits: { intro: 100 },
          },
        },
      },
      reportConfig: {
        quick: {
          minWords: 0,
          minReferences: -1,
          requiredSections: [],
          recommendedSections: [],
          sectionWordLimits: {
            deep: { level: { value: 1 } },
            max: Number.MAX_SAFE_INTEGER,
          },
        },
      },
    };

    const result = getReportConfig(state, 'quick');

    expect(result.minWords).toBe(0);
    expect(result.minReferences).toBe(-1);
    expect(result.requiredSections).toEqual([]);
    expect(result.recommendedSections).toEqual([]);
    expect(result.sectionWordLimits.deep.level.value).toBe(1);
    expect(result.sectionWordLimits.max).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('falls back to defaults when mode is empty and configs are non-plain objects', () => {
    const state = {
      globalConfig: { report: { wider: [] } },
      reportConfig: { wider: new Date('2024-01-01T00:00:00Z') },
    };

    const result = getReportConfig(state, '   ');

    expect(result.minWords).toBe(6000);
    expect(result.minReferences).toBe(3);
    expect(Array.isArray(result.requiredSections)).toBe(true);
    expect(result.requiredSections.length).toBe(4);
    expect(result.recommendedSections.length).toBe(3);
    expect(result.sectionWordLimits).toEqual({});
  });

  it('accepts string-number overrides and ignores invalid section arrays', () => {
    const state = {
      globalConfig: {
        report: {
          wider: {
            minWords: '5000',
            requiredSections: { not: 'array' },
            recommendedSections: 'nope',
          },
        },
      },
    };

    const result = getReportConfig(state, 'wider');

    expect(result.minWords).toBe('5000');
    expect(Array.isArray(result.requiredSections)).toBe(true);
    expect(result.requiredSections.length).toBe(4);
    expect(Array.isArray(result.recommendedSections)).toBe(true);
    expect(result.recommendedSections.length).toBe(3);
  });

  it('handles nullish state and mode without throwing', () => {
    expect(() => getReportConfig(null, null)).not.toThrow();
    expect(() => getReportConfig(undefined, undefined)).not.toThrow();
    expect(() => getReportConfig({}, undefined)).not.toThrow();

    const result = getReportConfig(null, null);
    expect(result.minWords).toBe(6000);
    expect(result.requiredSections.length).toBe(4);
  });

  it('handles concurrent calls with independent results', async () => {
    const states = [
      { reportConfig: { quick: { minWords: 123, requiredSections: [] } } },
      { reportConfig: { wider: { minReferences: 0, recommendedSections: [] } } },
    ];

    const [quick, wider] = await Promise.all([
      Promise.resolve().then(() => getReportConfig(states[0], 'quick')),
      Promise.resolve().then(() => getReportConfig(states[1], 'wider')),
    ]);

    expect(quick.minWords).toBe(123);
    expect(quick.requiredSections).toEqual([]);
    expect(wider.minReferences).toBe(0);
    expect(wider.recommendedSections).toEqual([]);
  });
});

describe('countNonWhitespaceChars', () => {
  it('counts non-whitespace characters in mixed whitespace', () => {
    const input = 'a b\tc\n d';
    expect(countNonWhitespaceChars(input)).toBe(4);
  });

  it('returns 0 for nullish or whitespace-only input', () => {
    expect(countNonWhitespaceChars(null)).toBe(0);
    expect(countNonWhitespaceChars(undefined)).toBe(0);
    expect(countNonWhitespaceChars('')).toBe(0);
    expect(countNonWhitespaceChars('   \n\t  ')).toBe(0);
  });

  it('returns 0 for non-string types including numeric boundaries', () => {
    expect(countNonWhitespaceChars(0)).toBe(0);
    expect(countNonWhitespaceChars(-1)).toBe(0);
    expect(countNonWhitespaceChars(Number.MAX_SAFE_INTEGER)).toBe(0);
    expect(countNonWhitespaceChars({})).toBe(0);
    expect(countNonWhitespaceChars([])).toBe(0);
    expect(countNonWhitespaceChars(Symbol('x'))).toBe(0);
  });

  it('handles very long strings', () => {
    const long = `${'a'.repeat(100000)}${' '.repeat(1000)}${'b'.repeat(100000)}`;
    expect(countNonWhitespaceChars(long)).toBe(200000);
  });

  it('handles concurrent and rapid calls consistently', async () => {
    const inputs = ['a b', '  c\nd', 'ef'];
    const results = await Promise.all(inputs.map((value) => Promise.resolve(countNonWhitespaceChars(value))));
    expect(results).toEqual([2, 2, 2]);

    for (let i = 0; i < 50; i++) {
      expect(countNonWhitespaceChars('x y')).toBe(2);
    }
  });
});

describe('countSemanticWords', () => {
  it('counts mixed CJK chars and latin tokens', () => {
    const input = '中文测试 deep search v2';
    expect(countSemanticWords(input)).toBe(4 + 3);
  });

  it('returns 0 for non-string input', () => {
    expect(countSemanticWords(null)).toBe(0);
    expect(countSemanticWords(undefined)).toBe(0);
    expect(countSemanticWords(0)).toBe(0);
  });
});

describe('countReferences', () => {
  it('counts reference markers in markdown', () => {
    const markdown = 'Intro [src:1] text.\nMore [ref:2] data.';
    expect(countReferences(markdown)).toBe(2);
  });

  it('returns 0 for empty or nullish input', () => {
    expect(countReferences('')).toBe(0);
    expect(countReferences('   \n')).toBe(0);
    expect(countReferences(null)).toBe(0);
    expect(countReferences(undefined)).toBe(0);
  });

  it('returns 0 for non-string types and numeric boundaries', () => {
    expect(countReferences(0)).toBe(0);
    expect(countReferences(-1)).toBe(0);
    expect(countReferences(Number.MAX_SAFE_INTEGER)).toBe(0);
    expect(countReferences({})).toBe(0);
    expect(countReferences([])).toBe(0);
    expect(countReferences(Symbol('x'))).toBe(0);
  });

  it('ignores malformed reference markers', () => {
    const markdown = 'x [a:] [a] [ok:1]';
    expect(countReferences(markdown)).toBe(1);
  });

  it('handles large markdown with many references', () => {
    const refs = Array.from({ length: 2000 }, (_, i) => `[s:${i}]`).join(' ');
    expect(countReferences(refs)).toBe(2000);
  });

  it('handles concurrent calls without shared state', async () => {
    const inputs = ['[a:1]', '[b:2] [c:3]', 'no refs'];
    const results = await Promise.all(inputs.map((value) => Promise.resolve(countReferences(value))));
    expect(results).toEqual([1, 2, 0]);

    for (let i = 0; i < 20; i++) {
      expect(countReferences('[x:1]')).toBe(1);
    }
  });
});

describe('reorderReportSections', () => {
  it('moves trailing sections to the end while keeping normal order', () => {
    const markdown = [
      '## Intro',
      'Intro text.',
      '## References',
      '- ref1',
      '## Body',
      'Body text.',
      '## Appendix',
      'Appendix text.',
    ].join('\n');

    const output = reorderReportSections(markdown);

    expect(output.indexOf('## Intro')).toBeLessThan(output.indexOf('## Body'));
    expect(output.indexOf('## Body')).toBeLessThan(output.indexOf('## References'));
    expect(output.indexOf('## References')).toBeLessThan(output.indexOf('## Appendix'));
  });

  it('deduplicates conclusion sections by merging content into the last one', () => {
    const markdown = [
      '## Summary',
      'Summary text.',
      '## Conclusion',
      'First conclusion.',
      '',
      '## Findings',
      'Findings text.',
      '## Conclusion',
      'Second conclusion.',
    ].join('\n');

    const output = reorderReportSections(markdown);
    const matches = output.match(/## Conclusion/g) || [];

    expect(matches.length).toBe(1);
    expect(output).toContain('First conclusion.');
    expect(output).toContain('Second conclusion.');
    expect(output.indexOf('Second conclusion.')).toBeLessThan(output.indexOf('First conclusion.'));
    expect(output.indexOf('## Findings')).toBeLessThan(output.indexOf('## Conclusion'));
  });

  it('deduplicates references and keeps them trailing', () => {
    const markdown = [
      '## Intro',
      'Intro text.',
      '## References',
      '- ref1',
      '## Body',
      'Body text.',
      '## References',
      '- ref2',
    ].join('\n');

    const output = reorderReportSections(markdown);
    const matches = output.match(/## References/g) || [];

    expect(matches.length).toBe(1);
    expect(output.indexOf('## References')).toBeGreaterThan(output.indexOf('## Body'));
    expect(output).toContain('- ref1');
    expect(output).toContain('- ref2');
    expect(output.indexOf('- ref2')).toBeLessThan(output.indexOf('- ref1'));
  });

  it('handles empty, whitespace, and non-string inputs safely', () => {
    expect(reorderReportSections('')).toBe('');
    expect(reorderReportSections('   \n')).toBe('   \n');
    expect(reorderReportSections(null)).toBe('');
    expect(reorderReportSections(undefined)).toBe('');
    expect(reorderReportSections([])).toBe('');
    expect(reorderReportSections({})).toBe('');
  });

  it('handles large inputs and concurrent calls', async () => {
    const sections = Array.from({ length: 200 }, (_, i) => `## Section ${i}\nContent ${i}`);
    const markdown = sections.join('\n');
    const big = `${markdown}\n## References\n- ref`;

    const [result1, result2] = await Promise.all([
      Promise.resolve(reorderReportSections(big)),
      Promise.resolve(reorderReportSections('## A\n1\n## References\n- r')),
    ]);

    expect(result1.indexOf('## References')).toBeGreaterThan(result1.indexOf('## Section 199'));
    expect(result1).toContain('Content 0');
    expect(result2.endsWith('- r')).toBe(true);

    for (let i = 0; i < 10; i++) {
      expect(reorderReportSections('## A\nX\n## References\n- r')).toContain('## References');
    }
  });
});

describe('validateReport & progress semantics', () => {
  it('does not treat body mentions as section coverage (heading-based check)', () => {
    const markdown = [
      '# 报告',
      '正文提到摘要、发现、信息缺口，但并没有对应标题。',
      '[来源:1]',
    ].join('\n');

    const validation = validateReport(markdown, 'quick', {
      reportConfig: {
        quick: {
          minWords: 1,
          minReferences: 1,
          requiredSections: ['摘要', '发现'],
          recommendedSections: ['信息缺口'],
        },
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues.some((msg) => msg.includes('缺少必需章节：摘要'))).toBe(true);
    expect(validation.issues.some((msg) => msg.includes('缺少必需章节：发现'))).toBe(true);
  });

  it('accepts explicit gap coverage via gap headings and uses semantic word count', () => {
    const markdown = [
      '## 摘要',
      '中文内容 English words here',
      '## 发现',
      '发现内容 [来源:1]',
      '## 信息缺口',
      '当前证据不足，仍需补充实验数据。',
    ].join('\n\n');

    const validation = validateReport(markdown, 'quick', {
      reportConfig: {
        quick: {
          minWords: 5,
          minReferences: 1,
          requiredSections: ['摘要', '发现'],
          recommendedSections: ['信息缺口'],
        },
      },
    });

    expect(validation.valid).toBe(true);
    expect(validation.wordCount).toBeGreaterThanOrEqual(5);
    expect(validation.charCount).toBeGreaterThan(validation.wordCount);
  });

  it('progress missingSections checks headings instead of substring mentions', () => {
    const markdown = [
      '正文里有“摘要”和“发现”这两个词，但无标题。',
      '[来源:1]',
    ].join('\n');

    const progress = getReportProgress({ markdown }, 'quick', {
      reportConfig: {
        quick: {
          minWords: 1,
          minReferences: 1,
          requiredSections: ['摘要', '发现'],
        },
      },
    });

    expect(progress.missingSections).toEqual(['摘要', '发现']);
  });
});
