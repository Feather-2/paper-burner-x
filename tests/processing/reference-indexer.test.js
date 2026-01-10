/**
 * @file tests/processing/reference-indexer.test.js
 * @description js/processing/reference-indexer.js unit tests (global side-effect module)
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

async function loadReferenceIndexer() {
  if (!globalThis.ReferenceIndexer) {
    await import('../../js/processing/reference-indexer.js');
  }
  return globalThis.ReferenceIndexer;
}

describe('processing/reference-indexer (ReferenceIndexer)', () => {
  beforeAll(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    const ReferenceIndexer = await loadReferenceIndexer();
    ReferenceIndexer.clearIndex();
  });

  it('buildIndex is a no-op when markdown or references are missing', async () => {
    const ReferenceIndexer = await loadReferenceIndexer();
    expect(ReferenceIndexer.buildIndex('doc', '', [])).toEqual([]);
    expect(ReferenceIndexer.buildIndex('doc', 'x', [])).toEqual([]);
    expect(ReferenceIndexer.buildIndex('doc', '', [{ rawText: 'x' }])).toEqual([{ rawText: 'x' }]);
  });

  it('findTextPosition returns correct line/char boundaries', async () => {
    const ReferenceIndexer = await loadReferenceIndexer();

    const markdown = ['Line1', 'Line2 contains DOI 10.1234/abcd', 'Line3'].join('\n');
    const search = '10.1234/abcd';
    const pos = ReferenceIndexer.findTextPosition(markdown, search);

    expect(pos).toEqual({
      lineStart: 1,
      lineEnd: 1,
      charStart: markdown.indexOf(search),
      charEnd: markdown.indexOf(search) + search.length,
    });
  });

  it('findReferenceInText uses lineStart/lineEnd when provided', async () => {
    const ReferenceIndexer = await loadReferenceIndexer();

    const markdown = ['A', 'B', 'C'].join('\n');
    const ref = { lineStart: 1, lineEnd: 1 };
    const pos = ReferenceIndexer.findReferenceInText(markdown, ref);

    expect(pos).toEqual({
      lineStart: 1,
      lineEnd: 1,
      charStart: 2, // "A\n" length
      charEnd: 4, // up to end of line 1 + newline
    });
  });

  it('buildIndex stores positions and getReferencePosition returns them', async () => {
    const ReferenceIndexer = await loadReferenceIndexer();

    const markdown = 'See doi 10.1234/abcd here.';
    const refs = [{ doi: '10.1234/abcd' }];

    const indexed = ReferenceIndexer.buildIndex('doc1', markdown, refs);
    expect(indexed[0].position).toMatchObject({
      charStart: markdown.indexOf('10.1234/abcd'),
      charEnd: markdown.indexOf('10.1234/abcd') + '10.1234/abcd'.length,
    });

    expect(ReferenceIndexer.getReferencePosition('doc1', 0)).toEqual(indexed[0].position);
    expect(ReferenceIndexer.getReferencePosition('doc1', 1)).toBeNull();
    expect(ReferenceIndexer.getReferencePosition('missing', 0)).toBeNull();
  });
});

