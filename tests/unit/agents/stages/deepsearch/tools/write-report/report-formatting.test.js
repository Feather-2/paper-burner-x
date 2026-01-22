import { describe, it, expect, vi, beforeEach } from 'vitest';

const fixtures = vi.hoisted(() => {
  const hugeFile = 'line\n'.repeat(20000);
  const longString = 'x'.repeat(200000);

  const deepNested = {};
  let cursor = deepNested;
  for (let i = 0; i < 200; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }

  const arrayLike = { 0: { title: 'A', content: 'B' }, length: 1 };

  const dangerousCallback = vi.fn(() => {
    throw new Error('dangerous callback should not be executed');
  });

  return {
    hugeFile,
    longString,
    deepNested,
    arrayLike,
    dangerousCallback,
  };
});

vi.mock(
  'virtual:report-formatting-fixtures',
  () => ({
    hugeFile: fixtures.hugeFile,
    longString: fixtures.longString,
    deepNested: fixtures.deepNested,
    arrayLike: fixtures.arrayLike,
    dangerousCallback: fixtures.dangerousCallback,
  }),
  { virtual: true }
);

import reportFormatting, {
  countContentChars,
  renderSectionsMarkdown,
  buildReportOutline,
} from '../../../../../../../js/agents/stages/deepsearch/tools/write-report/report-formatting.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('countContentChars', () => {
  it('counts non-whitespace characters for the normal path', () => {
    expect(countContentChars('Hello world')).toBe(10);
    expect(countContentChars('a b\tc\n')).toBe(3);
    expect(countContentChars('  spaced   out  ')).toBe(9);
  });

  it.each([
    ['empty string', ''],
    ['whitespace string', '   \n\t'],
    ['null', null],
    ['undefined', undefined],
    ['empty array', []],
    ['empty object', {}],
    ['zero', 0],
    ['negative one', -1],
    ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
  ])('returns 0 for %s inputs', (_label, value) => {
    expect(() => countContentChars(value)).not.toThrow();
    expect(countContentChars(value)).toBe(0);
  });

  it('handles numeric strings and preserves punctuation as characters', () => {
    const maxSafe = String(Number.MAX_SAFE_INTEGER);

    expect(countContentChars('0')).toBe(1);
    expect(countContentChars('123')).toBe(3);
    expect(countContentChars('-1')).toBe(2);
    expect(countContentChars(' -1 ')).toBe(2);
    expect(countContentChars(maxSafe)).toBe(maxSafe.length);
  });

  it('handles resource-heavy inputs (huge file + long string + deep nesting)', async () => {
    const { hugeFile, longString, deepNested } = await import(
      'virtual:report-formatting-fixtures'
    );

    expect(countContentChars(hugeFile)).toBe(4 * 20000);
    expect(countContentChars(longString)).toBe(200000);
    expect(() => countContentChars(deepNested)).not.toThrow();
    expect(countContentChars(deepNested)).toBe(0);
  });

  it('is deterministic under concurrent calls', async () => {
    const inputs = Array.from({ length: 60 }, (_, index) =>
      index % 3 === 0 ? 'a b' : index % 3 === 1 ? '   ' : '0'
    );

    const results = await Promise.all(
      inputs.map((value) => Promise.resolve(countContentChars(value)))
    );

    expect(results.filter((value) => value === 2)).toHaveLength(20);
    expect(results.filter((value) => value === 0)).toHaveLength(20);
    expect(results.filter((value) => value === 1)).toHaveLength(20);
  });

  it('supports rapid consecutive calls', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(countContentChars('a b')).toBe(2);
    }
  });
});

describe('renderSectionsMarkdown', () => {
  it('renders markdown for each section (normal path)', () => {
    const sections = [
      { title: 'Intro', content: 'Hello' },
      { title: 'Methods', content: 'World' },
    ];

    expect(renderSectionsMarkdown(sections)).toBe(
      '## Intro\n\nHello\n\n## Methods\n\nWorld'
    );
  });

  it('uses emptyPlaceholder only for missing/falsy content, not whitespace strings', () => {
    const sections = [
      { title: 'Empty', content: '' },
      { title: 'Missing' },
      { title: 'ZeroNumber', content: 0 },
      { title: 'ZeroString', content: '0' },
      { title: 'Whitespace', content: '   ' },
    ];

    const result = renderSectionsMarkdown(sections, { emptyPlaceholder: 'TBD' });

    expect(result).toBe(
      [
        '## Empty\n\nTBD',
        '## Missing\n\nTBD',
        '## ZeroNumber\n\nTBD',
        '## ZeroString\n\n0',
        '## Whitespace\n\n   ',
      ].join('\n\n')
    );
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty object (object as array)', {}],
    ['zero', 0],
    ['negative one', -1],
    ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
    ['numeric string (string as number)', '123'],
  ])('returns empty string for non-array sections (%s)', (_label, value) => {
    expect(() => renderSectionsMarkdown(value)).not.toThrow();
    expect(renderSectionsMarkdown(value)).toBe('');
  });

  it('returns empty string for an empty sections array', () => {
    expect(renderSectionsMarkdown([])).toBe('');
  });

  it('handles non-object sections and non-string fields without throwing', () => {
    const sections = [
      null,
      { title: 0, content: 0 },
      { title: { nested: { value: 'x' } }, content: { nested: { value: 'y' } } },
    ];

    expect(() => renderSectionsMarkdown(sections)).not.toThrow();
    expect(renderSectionsMarkdown(sections)).toBe(
      '## \n\nundefined\n\n## \n\n0\n\n## [object Object]\n\n[object Object]'
    );
  });

  it('ignores non-string emptyPlaceholder option', () => {
    expect(
      renderSectionsMarkdown([{ title: 'Intro', content: '' }], {
        emptyPlaceholder: 0,
      })
    ).toBe('## Intro\n\n');
  });

  it('does not execute function content values', async () => {
    const { dangerousCallback } = await import(
      'virtual:report-formatting-fixtures'
    );

    let result;
    expect(() => {
      result = renderSectionsMarkdown([
        { title: 'Fn', content: dangerousCallback },
      ]);
    }).not.toThrow();
    expect(dangerousCallback).not.toHaveBeenCalled();
    expect(result.startsWith('## Fn\n\n')).toBe(true);
    expect(result.length).toBeGreaterThan('## Fn\n\n'.length);
  });

  it('throws when title/content is a Symbol (type boundary error path)', () => {
    expect(() =>
      renderSectionsMarkdown([{ title: Symbol('t'), content: 'x' }])
    ).toThrow(TypeError);

    expect(() =>
      renderSectionsMarkdown([{ title: 'A', content: Symbol('c') }])
    ).toThrow(TypeError);
  });

  it('handles large lists and long content, including concurrent calls', async () => {
    const { longString } = await import('virtual:report-formatting-fixtures');

    const bigSections = Array.from({ length: 1000 }, (_, index) => ({
      title: `Section ${index}`,
      content: 'x',
    }));
    const rendered = renderSectionsMarkdown(bigSections);
    expect((rendered.match(/## /g) || []).length).toBe(1000);

    const renderedLong = renderSectionsMarkdown([
      { title: 'Big', content: longString },
    ]);
    expect(renderedLong.startsWith('## Big\n\n')).toBe(true);
    expect(renderedLong.length).toBe('## Big\n\n'.length + longString.length);

    const outputs = await Promise.all(
      Array.from({ length: 25 }, () =>
        Promise.resolve(renderSectionsMarkdown(bigSections.slice(0, 1)))
      )
    );
    outputs.forEach((value) => {
      expect(value).toBe('## Section 0\n\nx');
    });

    for (let i = 0; i < 200; i += 1) {
      expect(renderSectionsMarkdown([{ title: 'A', content: 'B' }])).toBe(
        '## A\n\nB'
      );
    }
  });
});

describe('buildReportOutline', () => {
  it('builds outline entries with counts, status, and configured limits (normal path)', () => {
    const sections = [
      { sectionId: 's1', title: 'Intro', content: 'Hello world' },
      { sectionId: 's2', title: 'Methods', content: '' },
      { sectionId: 's3', title: 'Whitespace', content: '   ' },
      { sectionId: 's4', title: 0, content: 'x y' },
      { sectionId: 's5', title: 'MissingLimit', content: undefined },
    ];
    const state = {
      reportConfig: {
        sectionWordLimits: {
          Intro: 100,
          Methods: 0,
          Whitespace: -1,
          0: 5,
          MissingLimit: Number.MAX_SAFE_INTEGER,
        },
      },
    };

    const result = buildReportOutline(sections, state);

    expect(result).toEqual({
      outline: [
        {
          index: 0,
          sectionId: 's1',
          title: 'Intro',
          wordCount: 10,
          status: 'filled',
          minWords: 100,
        },
        {
          index: 1,
          sectionId: 's2',
          title: 'Methods',
          wordCount: 0,
          status: 'empty',
          minWords: null,
        },
        {
          index: 2,
          sectionId: 's3',
          title: 'Whitespace',
          wordCount: 0,
          status: 'filled',
          minWords: -1,
        },
        {
          index: 3,
          sectionId: 's4',
          title: 0,
          wordCount: 2,
          status: 'filled',
          minWords: 5,
        },
        {
          index: 4,
          sectionId: 's5',
          title: 'MissingLimit',
          wordCount: 0,
          status: 'empty',
          minWords: Number.MAX_SAFE_INTEGER,
        },
      ],
      totalSections: 5,
      filledSections: 3,
      emptySections: 2,
    });
  });

  it.each([
    ['null sections', null],
    ['undefined sections', undefined],
    ['empty object (object as array)', {}],
    ['numeric string (string as number)', '123'],
  ])('returns empty outline for %s inputs', (_label, sections) => {
    expect(() => buildReportOutline(sections, {})).not.toThrow();
    expect(buildReportOutline(sections, {})).toEqual({
      outline: [],
      totalSections: 0,
      filledSections: 0,
      emptySections: 0,
    });
  });

  it('treats non-string content as empty and supports string limits (type boundary)', () => {
    const sections = [
      { sectionId: 's0', title: 'T0', content: { nested: true } },
      { sectionId: 's1', title: 'T1', content: 123 },
      { sectionId: 's2', title: 'T2', content: '0' },
    ];
    const state = {
      reportConfig: {
        sectionWordLimits: {
          T0: '0',
          T1: '10',
          T2: '1',
        },
      },
    };

    const result = buildReportOutline(sections, state);

    expect(result.totalSections).toBe(3);
    expect(result.filledSections).toBe(1);
    expect(result.emptySections).toBe(2);
    expect(result.outline[0]).toMatchObject({
      status: 'empty',
      wordCount: 0,
      minWords: '0',
    });
    expect(result.outline[1]).toMatchObject({
      status: 'empty',
      wordCount: 0,
      minWords: '10',
    });
    expect(result.outline[2]).toMatchObject({
      status: 'filled',
      wordCount: 1,
      minWords: '1',
    });
  });

  it('handles resource-heavy sections and deep nesting, including concurrent calls', async () => {
    const { hugeFile, longString, deepNested } = await import(
      'virtual:report-formatting-fixtures'
    );

    const sections = [
      deepNested,
      { sectionId: 'huge', title: 'Huge', content: hugeFile },
      { sectionId: 'long', title: 'Long', content: longString },
    ];

    const state = { reportConfig: { sectionWordLimits: { Huge: 1, Long: 2 } } };
    const result = buildReportOutline(sections, state);

    expect(result.totalSections).toBe(3);
    expect(result.outline[0]).toMatchObject({
      index: 0,
      status: 'empty',
      wordCount: 0,
      minWords: null,
    });
    expect(result.outline[1]).toMatchObject({
      index: 1,
      sectionId: 'huge',
      title: 'Huge',
      status: 'filled',
      wordCount: 4 * 20000,
      minWords: 1,
    });
    expect(result.outline[2]).toMatchObject({
      index: 2,
      sectionId: 'long',
      title: 'Long',
      status: 'filled',
      wordCount: 200000,
      minWords: 2,
    });

    const outputs = await Promise.all(
      Array.from({ length: 10 }, () => Promise.resolve(buildReportOutline(sections, state)))
    );
    outputs.forEach((value) => {
      expect(value).toEqual(result);
    });

    for (let i = 0; i < 200; i += 1) {
      expect(buildReportOutline([{ title: 'A', content: 'x y' }], {})).toMatchObject({
        totalSections: 1,
        filledSections: 1,
        emptySections: 0,
      });
    }
  });
});

describe('default', () => {
  it('exposes helper functions as stable references', () => {
    expect(reportFormatting).toEqual(
      expect.objectContaining({
        countContentChars,
        renderSectionsMarkdown,
        buildReportOutline,
      })
    );

    expect(reportFormatting.countContentChars).toBe(countContentChars);
    expect(reportFormatting.renderSectionsMarkdown).toBe(renderSectionsMarkdown);
    expect(reportFormatting.buildReportOutline).toBe(buildReportOutline);
  });

  it('default export functions behave the same as named exports', () => {
    const sections = [{ title: 'A', content: 'B', sectionId: 's' }];
    const state = { reportConfig: { sectionWordLimits: { A: 1 } } };

    expect(reportFormatting.countContentChars('a b')).toBe(countContentChars('a b'));
    expect(reportFormatting.renderSectionsMarkdown(sections)).toBe(renderSectionsMarkdown(sections));
    expect(reportFormatting.buildReportOutline(sections, state)).toEqual(buildReportOutline(sections, state));
  });
});
