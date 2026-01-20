import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../js/agents/shared/index.js', async () => {
  const actual = await vi.importActual('../../../../js/agents/shared/index.js');
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    toPositiveInt: vi.fn(actual.toPositiveInt),
  };
});

const modulePath = '../../../../js/agents/retrieval/toc-builder.js';
const sharedPath = '../../../../js/agents/shared/index.js';

const loadTocBuilder = async () => import(modulePath);
const loadShared = async () => import(sharedPath);

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('buildToc', () => {
  it('throws on non-string normalizedText inputs', async () => {
    const { buildToc } = await loadTocBuilder();

    const cases = [null, undefined, [], {}, 0, -1, Number.MAX_SAFE_INTEGER];

    for (const value of cases) {
      expect(() => buildToc(value)).toThrow(/normalizedText must be a string/);
    }
  });

  it('throws on non-plain options inputs', async () => {
    const { buildToc } = await loadTocBuilder();

    const optionsCases = [null, [], 'not-an-object', 0, -1, Number.MAX_SAFE_INTEGER];

    for (const options of optionsCases) {
      expect(() => buildToc('# Title', options)).toThrow(/options must be an object/);
    }
  });

  it('returns empty results for empty string and fallback for whitespace', async () => {
    const { buildToc } = await loadTocBuilder();

    const emptyResult = buildToc('');
    expect(emptyResult.tocNodes).toEqual([]);
    expect(emptyResult.fallbackSections).toEqual([]);

    const whitespace = '   \n \t';
    const whitespaceResult = buildToc(whitespace, {});
    expect(whitespaceResult.tocNodes).toEqual([]);
    expect(whitespaceResult.fallbackSections).toHaveLength(1);
    expect(whitespaceResult.fallbackSections[0].locator).toEqual({
      charStart: 0,
      charEnd: whitespace.length,
    });
  });

  it('parses markdown, numbered, and caps headings while ignoring code fences', async () => {
    const { buildToc } = await loadTocBuilder();

    const text = [
      '#   Intro   ###',
      'Some text',
      '1.2.3   Deep   Section',
      '```',
      '# Not a heading',
      '```',
      'INTRODUCTION',
    ].join('\n');

    const { tocNodes, fallbackSections } = buildToc(text);

    expect(fallbackSections).toEqual([]);
    expect(tocNodes.map((node) => node.title)).toEqual(['Intro', 'Deep Section', 'INTRODUCTION']);
    expect(tocNodes.map((node) => node.level)).toEqual([1, 3, 1]);

    expect(tocNodes[0].locator.charStart).toBe(text.indexOf('#   Intro   ###'));
    expect(tocNodes[1].locator.charStart).toBe(text.indexOf('1.2.3   Deep   Section'));
    expect(tocNodes[2].locator.charStart).toBe(text.indexOf('INTRODUCTION'));
  });

  it('computes section ends based on the next same-or-higher level heading', async () => {
    const { buildToc } = await loadTocBuilder();

    const text = ['# A', 'intro', '## B', '### C', '# D', 'tail'].join('\n');
    const { tocNodes } = buildToc(text);

    const startA = text.indexOf('# A');
    const startB = text.indexOf('## B');
    const startC = text.indexOf('### C');
    const startD = text.indexOf('# D');

    expect(tocNodes.map((node) => node.title)).toEqual(['A', 'B', 'C', 'D']);
    expect(tocNodes[0].locator).toEqual({ charStart: startA, charEnd: startD });
    expect(tocNodes[1].locator.charStart).toBe(startB);
    expect(tocNodes[1].locator.charEnd).toBe(startD);
    expect(tocNodes[2].locator.charStart).toBe(startC);
    expect(tocNodes[2].locator.charEnd).toBe(startD);
    expect(tocNodes[3].locator.charStart).toBe(startD);
    expect(tocNodes[3].locator.charEnd).toBe(text.length);
  });

  it('skips headings longer than 200 chars and falls back to sections', async () => {
    const { buildToc } = await loadTocBuilder();

    const longTitle = 'A'.repeat(201);
    const text = `# ${longTitle}\n`;
    const { tocNodes, fallbackSections } = buildToc(text);

    expect(tocNodes).toEqual([]);
    expect(fallbackSections).toHaveLength(1);
    expect(fallbackSections[0].locator.charEnd).toBe(text.length);
  });

  it('handles deep numbered headings and large text fallback sections', async () => {
    const { buildToc } = await loadTocBuilder();

    const deepText = '1.2.3.4.5 Deep Nest\n';
    const deepResult = buildToc(deepText);

    expect(deepResult.tocNodes).toHaveLength(1);
    expect(deepResult.tocNodes[0].level).toBe(5);
    expect(deepResult.tocNodes[0].title).toBe('Deep Nest');

    const largeText = 'x'.repeat(12000);
    const largeResult = buildToc(largeText);

    expect(largeResult.tocNodes).toEqual([]);
    expect(largeResult.fallbackSections).toHaveLength(3);
    expect(largeResult.fallbackSections[0].locator).toEqual({ charStart: 0, charEnd: 5000 });
    expect(largeResult.fallbackSections[1].locator).toEqual({ charStart: 5000, charEnd: 10000 });
    expect(largeResult.fallbackSections[2].locator).toEqual({ charStart: 10000, charEnd: 12000 });
  });

  it('handles rapid consecutive calls without shared state', async () => {
    const { buildToc } = await loadTocBuilder();

    const results = ['# One', '# Two', '# Three'].map((text) => buildToc(text));

    expect(results.map((result) => result.tocNodes[0].tocNodeId)).toEqual(['toc_1', 'toc_1', 'toc_1']);
    expect(results.map((result) => result.tocNodes[0].title)).toEqual(['One', 'Two', 'Three']);
  });
});

describe('buildTocAsync', () => {
  it('processes headings and accepts numeric strings for yieldEveryLines', async () => {
    const { buildTocAsync } = await loadTocBuilder();
    const { toPositiveInt } = await loadShared();

    const text = ['# One', 'line', '# Two', 'line'].join('\n');
    const result = await buildTocAsync(text, { yieldEveryLines: '2' });

    expect(toPositiveInt).toHaveBeenCalledWith('2', 800);
    expect(result.tocNodes.map((node) => node.title)).toEqual(['One', 'Two']);
    expect(result.fallbackSections).toEqual([]);
  });

  it('rejects non-string normalizedText inputs', async () => {
    const { buildTocAsync } = await loadTocBuilder();

    await expect(buildTocAsync(null)).rejects.toThrow(/normalizedText must be a string/);
  });

  it('rejects when the signal is aborted', async () => {
    const { buildTocAsync } = await loadTocBuilder();

    const controller = new AbortController();
    controller.abort();

    await expect(buildTocAsync('# One\n', { signal: controller.signal })).rejects.toThrow('buildTocAsync: aborted');
  });

  it('supports concurrent calls with independent results', async () => {
    const { buildTocAsync } = await loadTocBuilder();

    const [resultA, resultB] = await Promise.all([
      buildTocAsync('# Alpha\n'),
      buildTocAsync('1.2 Beta\n'),
    ]);

    expect(resultA.tocNodes[0].title).toBe('Alpha');
    expect(resultB.tocNodes[0].title).toBe('Beta');
    expect(resultA.tocNodes[0].tocNodeId).toBe('toc_1');
    expect(resultB.tocNodes[0].tocNodeId).toBe('toc_1');
  });
});

describe('buildTocStreaming', () => {
  it('builds toc nodes across chunk boundaries', async () => {
    const { buildTocStreaming } = await loadTocBuilder();

    const fullText = '# Title\nBody\n1.2.3 Deep\n';
    const chunks = [
      { text: '# Tit', offset: 0 },
      { text: 'le\nBody\n1.2.3 Deep\n', offset: 5 },
    ];

    const { tocNodes, fallbackSections } = await buildTocStreaming(chunks, {});

    expect(fallbackSections).toEqual([]);
    expect(tocNodes.map((node) => node.title)).toEqual(['Title', 'Deep']);
    expect(tocNodes.map((node) => node.level)).toEqual([1, 3]);
    expect(tocNodes[0].locator.charStart).toBe(fullText.indexOf('# Title'));
    expect(tocNodes[1].locator.charStart).toBe(fullText.indexOf('1.2.3 Deep'));
  });

  it('returns empty results for an empty chunk iterator', async () => {
    const { buildTocStreaming } = await loadTocBuilder();

    const result = await buildTocStreaming([]);
    expect(result.tocNodes).toEqual([]);
    expect(result.fallbackSections).toEqual([]);
  });

  it('rejects non-iterable chunk iterators', async () => {
    const { buildTocStreaming } = await loadTocBuilder();

    await expect(buildTocStreaming({})).rejects.toThrow(TypeError);
  });

  it('throws AbortError when aborted', async () => {
    const { buildTocStreaming } = await loadTocBuilder();

    const controller = new AbortController();
    controller.abort();

    await expect(
      buildTocStreaming([{ text: '# Title\n', offset: 0 }], { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
