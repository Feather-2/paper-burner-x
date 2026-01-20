import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState = vi.hoisted(() => {
  const defaultIsPlainObject = (value) => {
    if (value === null || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  return {
    defaultIsPlainObject,
    isPlainObjectMock: vi.fn(defaultIsPlainObject),
  };
});

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  isPlainObject: mockState.isPlainObjectMock,
}));

import {
  ChunkStrategy,
  detectChunkStrategy,
  smartChunk,
  chunkText,
} from '../../../../../js/agents/stages/textprep/chunk.js';

const repeatText = (length, char = 'a') => char.repeat(length);

beforeEach(() => {
  mockState.isPlainObjectMock.mockClear();
  mockState.isPlainObjectMock.mockImplementation(mockState.defaultIsPlainObject);
});

describe('ChunkStrategy', () => {
  it('exposes expected strategy values', () => {
    expect(ChunkStrategy).toEqual({
      MARKDOWN: 'markdown',
      SEMANTIC: 'semantic',
      FIXED: 'fixed',
    });
  });
});

describe('detectChunkStrategy', () => {
  it.each([
    [null, 'null'],
    [undefined, 'undefined'],
    ['', 'empty string'],
    [{}, 'empty object'],
    [[], 'empty array'],
  ])('returns fixed for empty or invalid input (%s)', (input) => {
    const result = detectChunkStrategy(input);
    expect(result.strategy).toBe(ChunkStrategy.FIXED);
    expect(result.reason).toBe('empty or invalid');
  });

  it('returns fixed for whitespace-only text', () => {
    const result = detectChunkStrategy('   \n  ');
    expect(result.strategy).toBe(ChunkStrategy.FIXED);
    expect(result.reason).toBe('no clear structure');
  });

  it('detects markdown structure when headings are present', () => {
    const text = [
      '# Title',
      '',
      'Intro text',
      '',
      '## Details',
      'More text',
    ].join('\n');
    const result = detectChunkStrategy(text);
    expect(result.strategy).toBe(ChunkStrategy.MARKDOWN);
    expect(result.reason).toBe('has markdown structure');
    expect(result.headingCount).toBe(2);
  });

  it('detects paragraph structure when multiple long paragraphs exist', () => {
    const paraA = repeatText(60, 'a');
    const paraB = repeatText(60, 'b');
    const paraC = repeatText(60, 'c');
    const text = `${paraA}\n\n${paraB}\n\n${paraC}`;
    const result = detectChunkStrategy(text);
    expect(result.strategy).toBe(ChunkStrategy.SEMANTIC);
    expect(result.reason).toBe('has paragraph structure');
    expect(result.paragraphCount).toBe(3);
  });

  it('handles large text with sparse headings', () => {
    const body = repeatText(4800, 'x');
    const text = `# H1\n${body}\n\n## H2\n${body}`;
    const result = detectChunkStrategy(text);
    expect(result.strategy).toBe(ChunkStrategy.MARKDOWN);
    expect(result.headingCount).toBe(2);
  });
});

describe('smartChunk', () => {
  it('selects markdown strategy and returns sections', () => {
    const text = '# Title\n\nIntro\n\n## Part\nContent';
    const result = smartChunk(text, { maxSize: 200 });
    expect(result.strategy).toBe(ChunkStrategy.MARKDOWN);
    expect(result.reason).toBe('has markdown structure');
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.meta.headingCount).toBe(2);
    expect(result.meta.chunkCount).toBe(result.chunks.length);
  });

  it('selects semantic strategy for paragraph text', () => {
    const paraA = repeatText(60, 'a');
    const paraB = repeatText(60, 'b');
    const paraC = repeatText(60, 'c');
    const text = `${paraA}\n\n${paraB}\n\n${paraC}`;
    const result = smartChunk(text, { maxSize: 120 });
    expect(result.strategy).toBe(ChunkStrategy.SEMANTIC);
    expect(result.reason).toBe('has paragraph structure');
    expect(result.chunks.length).toBeGreaterThan(0);
    result.chunks.forEach((chunk) => {
      expect(chunk.chunkId).toMatch(/^chunk_/);
    });
  });

  it('falls back to fixed strategy when no structure', () => {
    const text = repeatText(25, 'a');
    const result = smartChunk(text, { maxSize: 10 });
    expect(result.strategy).toBe(ChunkStrategy.FIXED);
    expect(result.chunks.length).toBe(3);
    expect(result.chunks[0].chunkId).toBe('chunk_1');
  });

  it('respects forceStrategy over detection', () => {
    const text = '# Title\n\nBody\n\n## Part\nMore';
    const result = smartChunk(text, {
      forceStrategy: ChunkStrategy.FIXED,
      maxSize: 8,
    });
    expect(result.strategy).toBe(ChunkStrategy.FIXED);
    expect(result.chunks[0]).toHaveProperty('chunkId');
    expect(result.chunks[0]).not.toHaveProperty('sectionId');
  });

  it('handles empty string with zero chunks', () => {
    const result = smartChunk('');
    expect(result.strategy).toBe(ChunkStrategy.FIXED);
    expect(result.chunks).toEqual([]);
    expect(result.meta.totalLength).toBe(0);
    expect(result.meta.avgChunkSize).toBe(0);
  });

  it('throws for non-string input', () => {
    expect(() => smartChunk(null)).toThrow(TypeError);
  });

  it('handles concurrent calls without shared state', async () => {
    const text = repeatText(25, 'a');
    const tasks = Array.from({ length: 5 }, () =>
      Promise.resolve().then(() => smartChunk(text, { maxSize: 10 }))
    );
    const results = await Promise.all(tasks);
    results.forEach((result) => {
      expect(result.chunks[0].chunkId).toBe('chunk_1');
      expect(result.chunks.length).toBe(3);
    });
  });

  it('is deterministic across rapid successive calls', () => {
    const text = repeatText(25, 'a');
    for (let i = 0; i < 5; i += 1) {
      const result = smartChunk(text, { maxSize: 10 });
      expect(result.chunks.length).toBe(3);
      expect(result.chunks[0].chunkId).toBe('chunk_1');
    }
  });
});

describe('chunkText', () => {
  it.each([
    [null, 'null'],
    [undefined, 'undefined'],
    [{}, 'empty object'],
    [[], 'empty array'],
  ])('throws TypeError for non-string normalizedText (%s)', (input) => {
    expect(() => chunkText(input)).toThrow(TypeError);
  });

  it('returns empty array for empty string', () => {
    expect(chunkText('')).toEqual([]);
  });

  it.each([
    [null, 'null'],
    [[], 'array'],
    ['bad', 'string'],
  ])('throws TypeError for invalid options (%s)', (options) => {
    expect(() => chunkText('abc', options)).toThrow(TypeError);
  });

  it('throws when isPlainObject reports false', () => {
    mockState.isPlainObjectMock.mockImplementationOnce(() => false);
    expect(() => chunkText('abc', {})).toThrow(TypeError);
  });

  it('throws when overlap is not less than chunkSize', () => {
    expect(() => chunkText('abc', { chunkSize: 2, overlap: 2 })).toThrow(
      'overlap must be < chunkSize'
    );
  });

  it('chunks with overlap and locators', () => {
    const result = chunkText('abcdef', { chunkSize: 4, overlap: 1 });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      chunkId: 'chunk_1',
      text: 'abcd',
      locator: { charStart: 0, charEnd: 4 },
    });
    expect(result[1]).toMatchObject({
      chunkId: 'chunk_2',
      text: 'def',
      locator: { charStart: 3, charEnd: 6 },
    });
  });

  it('includes line numbers when requested', () => {
    const text = 'a\nb\nc';
    const result = chunkText(text, {
      chunkSize: 2,
      overlap: 0,
      includeLineNumbers: true,
    });
    expect(result).toHaveLength(3);
    expect(result[0].locator.lineStart).toBe(1);
    expect(result[0].locator.lineEnd).toBe(1);
    expect(result[1].locator.lineStart).toBe(2);
    expect(result[1].locator.lineEnd).toBe(2);
    expect(result[2].locator.lineStart).toBe(3);
    expect(result[2].locator.lineEnd).toBe(3);
  });

  it.each([0, -1])('treats chunkSize %s as minimum 1', (chunkSize) => {
    const text = 'abc';
    const result = chunkText(text, { chunkSize, overlap: 0 });
    expect(result).toHaveLength(text.length);
    expect(result[0].text).toBe('a');
  });

  it('handles very large chunkSize without splitting', () => {
    const text = 'abc';
    const result = chunkText(text, {
      chunkSize: Number.MAX_SAFE_INTEGER,
      overlap: 0,
    });
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(text);
  });

  it('ignores non-numeric chunkSize values', () => {
    const text = repeatText(100, 'a');
    const result = chunkText(text, { chunkSize: '5', overlap: '2' });
    expect(result).toHaveLength(1);
  });

  it('accepts deep nested options objects', () => {
    const text = 'abcd';
    const options = {
      chunkSize: 2,
      overlap: 0,
      extra: { level1: { level2: { level3: true } } },
    };
    const result = chunkText(text, options);
    expect(result).toHaveLength(2);
    expect(mockState.isPlainObjectMock).toHaveBeenCalledWith(options);
  });

  it('handles long strings without losing chunks', () => {
    const text = repeatText(100000, 'z');
    const result = chunkText(text, { chunkSize: 1000, overlap: 0 });
    expect(result).toHaveLength(100);
    expect(result[0].text.length).toBe(1000);
  });

  it('is safe to call concurrently', async () => {
    const text = 'abcde';
    const baseline = chunkText(text, { chunkSize: 2, overlap: 0 });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        Promise.resolve(chunkText(text, { chunkSize: 2, overlap: 0 }))
      )
    );
    results.forEach((result) => {
      expect(result).toEqual(baseline);
    });
  });
});
