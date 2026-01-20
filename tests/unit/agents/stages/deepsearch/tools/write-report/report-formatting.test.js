/**
 * Unit tests for report-formatting helpers to lock markdown rendering and outline stats across edge cases.
 * Targets js/agents/stages/deepsearch/tools/write-report/report-formatting.js for empty inputs, limits, and concurrency.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'mock-uuid'),
}));

import { randomUUID } from 'node:crypto';

import reportFormatting, {
  countContentChars,
  renderSectionsMarkdown,
  buildReportOutline,
} from '../../../../../../../js/agents/stages/deepsearch/tools/write-report/report-formatting.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('countContentChars', () => {
  it('counts non-whitespace characters in normal strings', () => {
    expect(countContentChars('Hello world')).toBe(10);
    expect(countContentChars('a b\tc\n')).toBe(3);
  });

  it('returns 0 for empty or non-string inputs', () => {
    const deep = { a: { b: { c: { d: 'value' } } } };

    expect(() => countContentChars(deep)).not.toThrow();
    expect(countContentChars('')).toBe(0);
    expect(countContentChars('   \n\t')).toBe(0);
    expect(countContentChars(null)).toBe(0);
    expect(countContentChars(undefined)).toBe(0);
    expect(countContentChars([])).toBe(0);
    expect(countContentChars({})).toBe(0);
    expect(countContentChars(deep)).toBe(0);
    expect(countContentChars(0)).toBe(0);
    expect(countContentChars(-1)).toBe(0);
    expect(countContentChars(Number.MAX_SAFE_INTEGER)).toBe(0);
  });

  it('handles numeric strings and large content', () => {
    const maxSafe = String(Number.MAX_SAFE_INTEGER);
    const large = 'a'.repeat(100000);

    expect(countContentChars('0')).toBe(1);
    expect(countContentChars('123')).toBe(3);
    expect(countContentChars(' -1 ')).toBe(2);
    expect(countContentChars(maxSafe)).toBe(maxSafe.length);
    expect(countContentChars(large)).toBe(large.length);
  });

  it('is deterministic under rapid concurrent calls', async () => {
    const inputs = Array.from({ length: 50 }, (_, index) => (index % 2 === 0 ? 'a b' : '   '));
    const results = await Promise.all(inputs.map((value) => Promise.resolve(countContentChars(value))));

    expect(results.filter((value) => value === 2).length).toBe(25);
    expect(results.filter((value) => value === 0).length).toBe(25);
  });
});

describe('renderSectionsMarkdown', () => {
  it('renders markdown for each section', () => {
    const sections = [
      { title: 'Intro', content: 'Hello' },
      { title: 'Methods', content: 'World' },
    ];

    expect(renderSectionsMarkdown(sections)).toBe('## Intro\n\nHello\n\n## Methods\n\nWorld');
  });

  it('uses emptyPlaceholder for missing or falsy content', () => {
    const sections = [
      { title: 'Intro', content: '' },
      { title: 'Body' },
      { title: 'Zero', content: 0 },
    ];

    const result = renderSectionsMarkdown(sections, { emptyPlaceholder: 'TBD' });

    expect(result).toBe('## Intro\n\nTBD\n\n## Body\n\nTBD\n\n## Zero\n\nTBD');
  });

  it('returns empty string for non-array sections input', () => {
    expect(renderSectionsMarkdown(null)).toBe('');
    expect(renderSectionsMarkdown(undefined)).toBe('');
    expect(renderSectionsMarkdown({})).toBe('');
    expect(renderSectionsMarkdown(0)).toBe('');
  });

  it('handles non-object sections and non-string fields', () => {
    const sections = [
      null,
      { title: 0, content: 0 },
      { title: { nested: { value: 'x' } }, content: { nested: { value: 'y' } } },
    ];

    const result = renderSectionsMarkdown(sections);

    expect(result).toBe('## \n\nundefined\n\n## \n\n0\n\n## [object Object]\n\n[object Object]');
  });

  it('ignores non-string emptyPlaceholder option', () => {
    const result = renderSectionsMarkdown([{ title: 'Intro', content: '' }], { emptyPlaceholder: 0 });

    expect(result).toBe('## Intro\n\n');
  });

  it('handles large lists and rapid successive calls', async () => {
    const sections = Array.from({ length: 1000 }, (_, index) => ({
      title: `Section ${index}`,
      content: 'x',
    }));

    const result = renderSectionsMarkdown(sections);
    const headings = result.match(/## /g) || [];
    expect(headings.length).toBe(1000);

    const calls = Array.from({ length: 20 }, () => Promise.resolve(renderSectionsMarkdown(sections.slice(0, 1))));
    const outputs = await Promise.all(calls);
    outputs.forEach((value) => {
      expect(value).toBe('## Section 0\n\nx');
    });
  });
});

describe('buildReportOutline', () => {
  it('builds outline with counts, status, and limits', () => {
    const sectionId = randomUUID();
    const sections = [
      { sectionId, title: 'Intro', content: 'Hello world' },
      { sectionId: 's2', title: 'Methods', content: '' },
      { sectionId: 's3', title: 'Space', content: '   ' },
      { sectionId: 's4', title: 'Zero', content: '0' },
    ];
    const state = {
      reportConfig: {
        sectionWordLimits: {
          Intro: 100,
          Methods: 0,
          Space: -1,
          Zero: Number.MAX_SAFE_INTEGER,
        },
      },
    };

    expect(sectionId).toBe('mock-uuid');

    const result = buildReportOutline(sections, state);

    expect(result.totalSections).toBe(4);
    expect(result.filledSections).toBe(3);
    expect(result.emptySections).toBe(1);
    expect(result.outline[0]).toMatchObject({
      index: 0,
      sectionId,
      title: 'Intro',
      wordCount: 10,
      status: 'filled',
      minWords: 100,
    });
    expect(result.outline[1]).toMatchObject({
      status: 'empty',
      wordCount: 0,
      minWords: null,
    });
    expect(result.outline[2]).toMatchObject({
      status: 'filled',
      wordCount: 0,
      minWords: -1,
    });
    expect(result.outline[3]).toMatchObject({
      status: 'filled',
      wordCount: 1,
      minWords: Number.MAX_SAFE_INTEGER,
    });
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('handles empty or invalid inputs safely', () => {
    expect(() => buildReportOutline(null, null)).not.toThrow();

    const resultNull = buildReportOutline(null, null);
    expect(resultNull).toEqual({
      outline: [],
      totalSections: 0,
      filledSections: 0,
      emptySections: 0,
    });

    const resultObject = buildReportOutline({}, {});
    expect(resultObject.totalSections).toBe(0);
    expect(resultObject.filledSections).toBe(0);
    expect(resultObject.emptySections).toBe(0);
  });

  it('handles non-string content and numeric titles', () => {
    const sections = [
      { sectionId: 'deep', title: 0, content: { nested: { value: 'x' } } },
    ];
    const state = {
      reportConfig: {
        sectionWordLimits: {
          0: 5,
        },
      },
    };

    const result = buildReportOutline(sections, state);

    expect(result.totalSections).toBe(1);
    expect(result.filledSections).toBe(0);
    expect(result.emptySections).toBe(1);
    expect(result.outline[0]).toMatchObject({
      title: 0,
      wordCount: 0,
      status: 'empty',
      minWords: 5,
    });
  });

  it('handles large outlines and concurrent calls', async () => {
    const sections = Array.from({ length: 1000 }, (_, index) => ({
      sectionId: `s-${index}`,
      title: `T${index}`,
      content: index % 2 === 0 ? 'x' : '',
    }));
    const state = { reportConfig: { sectionWordLimits: {} } };

    const result = buildReportOutline(sections, state);

    expect(result.totalSections).toBe(1000);
    expect(result.filledSections).toBe(500);
    expect(result.emptySections).toBe(500);

    const calls = Array.from({ length: 10 }, () => Promise.resolve(buildReportOutline(sections, state)));
    const outputs = await Promise.all(calls);

    outputs.forEach((value) => {
      expect(value.totalSections).toBe(1000);
      expect(value.filledSections).toBe(500);
      expect(value.emptySections).toBe(500);
    });
  });
});

describe('default', () => {
  it('exposes helper functions', () => {
    expect(reportFormatting).toMatchObject({
      countContentChars,
      renderSectionsMarkdown,
      buildReportOutline,
    });
  });

  it('functions from default export behave as expected', () => {
    expect(reportFormatting.countContentChars('a b')).toBe(2);
    expect(reportFormatting.renderSectionsMarkdown([{ title: 'A', content: 'B' }])).toBe('## A\n\nB');
  });
});
