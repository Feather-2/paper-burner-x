/**
 * @file tests/processing/reference-extractor.test.js
 * @description js/processing/reference-extractor.js unit tests (global side-effect module)
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

async function loadReferenceExtractor() {
  if (!globalThis.ReferenceExtractor) {
    await import('../../js/processing/reference-extractor.js');
  }
  return globalThis.ReferenceExtractor;
}

describe('processing/reference-extractor (ReferenceExtractor)', () => {
  beforeAll(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('extractDOI supports multiple formats and trims trailing punctuation', async () => {
    const ReferenceExtractor = await loadReferenceExtractor();

    expect(ReferenceExtractor.extractDOI('doi: 10.1234/abcd,')).toBe('10.1234/abcd');
    expect(ReferenceExtractor.extractDOI('DOI:10.1234/abcd.')).toBe('10.1234/abcd');
    expect(ReferenceExtractor.extractDOI('https://doi.org/10.5555/xyz')).toBe('10.5555/xyz');
    expect(ReferenceExtractor.extractDOI('no doi here')).toBeNull();
  });

  it('extractURLs extracts URLs and trims trailing punctuation', async () => {
    const ReferenceExtractor = await loadReferenceExtractor();

    const urls = ReferenceExtractor.extractURLs(
      'See https://example.com/a, and (https://example.com/b).',
    );
    expect(urls).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('extractYear finds years in range and ignores unreasonable values', async () => {
    const ReferenceExtractor = await loadReferenceExtractor();

    expect(ReferenceExtractor.extractYear('Smith (2023) ...')).toBe(2023);
    expect(ReferenceExtractor.extractYear('Published in 1999.')).toBe(1999);
    expect(ReferenceExtractor.extractYear('Year: 1800')).toBeNull();
    expect(ReferenceExtractor.extractYear('')).toBeNull();
  });

  it('extractReferenceInfo parses common metadata and computes confidence', async () => {
    const ReferenceExtractor = await loadReferenceExtractor();

    const info = ReferenceExtractor.extractReferenceInfo(
      'Smith, J. (2023). "A Study". Journal of Testing, Vol. 12, pp. 10-20. doi: 10.1234/abcd.',
    );

    expect(info).toMatchObject({
      doi: '10.1234/abcd',
      year: 2023,
      title: 'A Study',
      volume: '12',
      pages: '10-20',
      extractedBy: 'regex',
    });
    expect(info.urls).toEqual([]);
    expect(Array.isArray(info.authors)).toBe(true);
    expect(info.authors.length).toBeGreaterThan(0);
    expect(info.confidence).toBeGreaterThan(0.7);
  });

  it('batchExtract returns [] for non-array input and sets needsAIProcessing by confidence', async () => {
    const ReferenceExtractor = await loadReferenceExtractor();

    expect(ReferenceExtractor.batchExtract(null)).toEqual([]);

    const out = ReferenceExtractor.batchExtract([
      {
        rawText:
          'Smith, J. (2023). "A Study". Journal of Testing, Vol. 12, pp. 10-20. doi: 10.1234/abcd.',
        extra: 1,
      },
      'Just some text without metadata.',
    ]);

    expect(out[0].extra).toBe(1);
    expect(out[0].needsAIProcessing).toBe(false);
    expect(out[1].needsAIProcessing).toBe(true);
  });

  it('generateTags adds tags based on year/journal/doi', async () => {
    const ReferenceExtractor = await loadReferenceExtractor();

    const tagsRecent = ReferenceExtractor.generateTags({
      year: new Date().getFullYear(),
      journal: 'Proceedings of Something',
      doi: '10.1234/abcd',
    });
    expect(tagsRecent).toEqual(expect.arrayContaining(['Recent', 'Conference', 'Verified']));

    const tagsClassic = ReferenceExtractor.generateTags({
      year: 1990,
      journal: 'Journal of Testing',
      doi: null,
    });
    expect(tagsClassic).toEqual(expect.arrayContaining(['Classic', 'Journal']));
    expect(tagsClassic).not.toContain('Verified');
  });
});

