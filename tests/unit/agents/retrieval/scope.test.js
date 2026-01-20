import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedShared = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
}));

vi.mock('../../../../js/agents/shared/index.js', () => ({
  isPlainObject: mockedShared.isPlainObject,
}));

import { selectScope, chunksInScope } from '../../../../js/agents/retrieval/scope.js';

beforeEach(() => {
  mockedShared.isPlainObject.mockReset();
  mockedShared.isPlainObject.mockImplementation((value) => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
  ));
});

describe('selectScope', () => {
  it('returns floored scope for a matching toc node', () => {
    const tocNodes = [
      { tocNodeId: 'intro', locator: { charStart: 5.8, charEnd: 12.2 } },
    ];

    expect(selectScope(tocNodes, 'intro')).toEqual({ charStart: 5, charEnd: 12 });
  });

  it('clamps negative values to zero', () => {
    const tocNodes = [
      { tocNodeId: 'neg', locator: { charStart: -1, charEnd: -1 } },
    ];

    expect(selectScope(tocNodes, 'neg')).toEqual({ charStart: 0, charEnd: 0 });
  });

  it('ensures charEnd is not below charStart', () => {
    const tocNodes = [
      { tocNodeId: 'reverse', locator: { charStart: 10.9, charEnd: 9.1 } },
    ];

    expect(selectScope(tocNodes, 'reverse')).toEqual({ charStart: 10, charEnd: 10 });
  });

  it('uses Infinity when charEnd is not finite', () => {
    const tocNodes = [
      { tocNodeId: 'open', locator: { charStart: 2.2, charEnd: NaN } },
    ];

    expect(selectScope(tocNodes, 'open')).toEqual({ charStart: 2, charEnd: Infinity });
  });

  it('returns full scope when tocNodes is nullish or empty', () => {
    const cases = [null, undefined, [], {}];

    for (const tocNodes of cases) {
      expect(selectScope(tocNodes, 'any')).toEqual({ charStart: 0, charEnd: Infinity });
    }
  });

  it('falls back to max charEnd when no target match', () => {
    const tocNodes = [
      { tocNodeId: 'a', locator: { charStart: 0, charEnd: 7 } },
      { tocNodeId: 'b', locator: { charStart: 5, charEnd: 20 } },
      { tocNodeId: 'c', locator: { charStart: 1, charEnd: '30' } },
      { tocNodeId: 'd', locator: { charStart: 2 } },
    ];

    expect(selectScope(tocNodes, 'missing')).toEqual({ charStart: 0, charEnd: 20 });
  });

  it('returns Infinity when no valid charEnd values exist', () => {
    const tocNodes = [
      { tocNodeId: 'a', locator: { charStart: 1, charEnd: '10' } },
      { tocNodeId: 'b', locator: { charStart: 2 } },
      { tocNodeId: 'c' },
    ];

    expect(selectScope(tocNodes, 'missing')).toEqual({ charStart: 0, charEnd: Infinity });
  });

  it('uses fallback when targetSectionId is empty or not a string', () => {
    const tocNodes = [
      { tocNodeId: 'x', locator: { charStart: 0, charEnd: 9 } },
    ];
    const targets = [null, undefined, '', 0, {}];

    for (const target of targets) {
      expect(selectScope(tocNodes, target)).toEqual({ charStart: 0, charEnd: 9 });
    }
  });

  it('handles whitespace targetSectionId by falling back when not found', () => {
    const tocNodes = [
      { tocNodeId: 'x', locator: { charStart: 1, charEnd: 11 } },
    ];

    expect(selectScope(tocNodes, ' ')).toEqual({ charStart: 0, charEnd: 11 });
  });

  it('handles large tocNodes and long targetSectionId values', () => {
    const longId = 'a'.repeat(10000);
    const tocNodes = Array.from({ length: 2000 }, (_, i) => ({
      tocNodeId: `sec_${i}`,
      locator: { charStart: i * 10, charEnd: i * 10 + 5 },
      meta: { deep: { nested: { index: i } } },
    }));
    tocNodes.push({
      tocNodeId: 'last',
      locator: { charStart: 0, charEnd: Number.MAX_SAFE_INTEGER },
    });

    expect(selectScope(tocNodes, longId)).toEqual({
      charStart: 0,
      charEnd: Number.MAX_SAFE_INTEGER,
    });
  });

  it('is stable across rapid and concurrent calls', async () => {
    const tocNodes = [
      { tocNodeId: 'target', locator: { charStart: 3.3, charEnd: 8.8 } },
    ];
    const expected = selectScope(tocNodes, 'target');

    const rapid = Array.from({ length: 50 }, () => selectScope(tocNodes, 'target'));
    for (const result of rapid) {
      expect(result).toEqual(expected);
    }

    const concurrent = await Promise.all(
      Array.from({ length: 20 }, () => Promise.resolve(selectScope(tocNodes, 'target'))),
    );
    for (const result of concurrent) {
      expect(result).toEqual(expected);
    }
  });
});

describe('chunksInScope', () => {
  it('throws when chunks is not an array', () => {
    const scope = { charStart: 0, charEnd: 10 };
    const cases = [null, undefined, {}, 'not array'];

    for (const invalid of cases) {
      expect(() => chunksInScope(invalid, scope)).toThrow(/chunks must be an array/);
    }
  });

  it('throws when scope is not a plain object', () => {
    const chunks = [{ locator: { charStart: 0, charEnd: 1 } }];
    const cases = [null, undefined, [], ' ', 0];

    for (const invalidScope of cases) {
      expect(() => chunksInScope(chunks, invalidScope)).toThrow(/scope must be an object/);
    }
  });

  it('returns empty when scope end is not greater than start', () => {
    const chunks = [{ chunkId: 'c1', locator: { charStart: 0, charEnd: 100 } }];
    const cases = [
      { charStart: 0, charEnd: 0 },
      { charStart: 10, charEnd: 9 },
      { charStart: 0, charEnd: -1 },
    ];

    for (const scope of cases) {
      expect(chunksInScope(chunks, scope)).toEqual([]);
    }
  });

  it('filters chunks by overlapping range and ignores invalid locators', () => {
    const chunks = [
      { chunkId: 'before', locator: { charStart: 0, charEnd: 9 } },
      { chunkId: 'overlap-start', locator: { charStart: 9, charEnd: 11 } },
      { chunkId: 'touch-start', locator: { charStart: 10, charEnd: 10 } },
      { chunkId: 'inside', locator: { charStart: 12, charEnd: 18 } },
      { chunkId: 'after', locator: { charStart: 20, charEnd: 30 } },
      { chunkId: 'invalid', locator: { charStart: '1', charEnd: 2 } },
      { chunkId: 'missing' },
    ];

    const result = chunksInScope(chunks, { charStart: 10, charEnd: 20 });

    expect(result.map((chunk) => chunk.chunkId)).toEqual(['overlap-start', 'inside']);
  });

  it('defaults non-finite scope values and includes valid chunks', () => {
    const chunks = [
      { chunkId: 'a', locator: { charStart: 0, charEnd: 5 } },
      { chunkId: 'b', locator: { charStart: 5, charEnd: 10 } },
    ];

    const result = chunksInScope(chunks, { charStart: '1', charEnd: '2' });

    expect(result.map((chunk) => chunk.chunkId)).toEqual(['a', 'b']);
  });

  it('accepts an empty scope object and defaults to full range', () => {
    const chunks = [
      { chunkId: 'a', locator: { charStart: 0, charEnd: 5 } },
    ];

    const result = chunksInScope(chunks, {});

    expect(mockedShared.isPlainObject).toHaveBeenCalledWith({});
    expect(result.map((chunk) => chunk.chunkId)).toEqual(['a']);
  });

  it('returns empty array for empty chunks', () => {
    const result = chunksInScope([], { charStart: 0, charEnd: 10 });

    expect(result).toEqual([]);
  });

  it('handles large chunk sets with long text and deep metadata', () => {
    const longText = 'x'.repeat(10000);
    const chunks = Array.from({ length: 2000 }, (_, i) => ({
      chunkId: `c${i}`,
      text: longText,
      locator: { charStart: i * 10, charEnd: i * 10 + 5 },
      meta: { deep: { nested: { index: i } } },
    }));
    const scope = { charStart: 5000, charEnd: 5050 };

    const result = chunksInScope(chunks, scope);

    expect(result.map((chunk) => chunk.chunkId)).toEqual([
      'c500',
      'c501',
      'c502',
      'c503',
      'c504',
    ]);
  });

  it('is stable across rapid and concurrent calls', async () => {
    const chunks = [
      { chunkId: 'a', locator: { charStart: 0, charEnd: 5 } },
      { chunkId: 'b', locator: { charStart: 6, charEnd: 12 } },
    ];
    const scope = { charStart: 0, charEnd: Number.MAX_SAFE_INTEGER };
    const expected = chunksInScope(chunks, scope);

    const rapid = Array.from({ length: 40 }, () => chunksInScope(chunks, scope));
    for (const result of rapid) {
      expect(result).toEqual(expected);
    }

    const concurrent = await Promise.all(
      Array.from({ length: 15 }, () => Promise.resolve(chunksInScope(chunks, scope))),
    );
    for (const result of concurrent) {
      expect(result).toEqual(expected);
    }
  });
});
