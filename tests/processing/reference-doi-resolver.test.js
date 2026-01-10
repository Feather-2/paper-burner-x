/**
 * @file tests/processing/reference-doi-resolver.test.js
 * @description js/processing/reference-doi-resolver.js unit tests (global side-effect module)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_WINDOW = globalThis.window;
const ORIGINAL_FETCH = globalThis.fetch;

async function loadDOIResolver() {
  const mod = await import('../../js/processing/reference-doi-resolver.esm.js');
  return mod.default ?? globalThis.DOIResolver;
}

function okJson(data) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => data,
  };
}

describe('processing/reference-doi-resolver (DOIResolver)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    if (ORIGINAL_WINDOW === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = ORIGINAL_WINDOW;
    }

    globalThis.window ??= {};

    delete globalThis.DOIResolver;
    if (globalThis.window) {
      delete globalThis.window.DOIResolver;
    }

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    if (ORIGINAL_FETCH === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = ORIGINAL_FETCH;
    }

    if (ORIGINAL_WINDOW === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = ORIGINAL_WINDOW;
    }

    delete globalThis.DOIResolver;
  });

  it('exports default API and mirrors to window', async () => {
    const api = await loadDOIResolver();
    expect(api).toBeTruthy();
    expect(api).toBe(globalThis.DOIResolver);
    expect(globalThis.window.DOIResolver).toBe(api);
    expect(api.version).toBeTruthy();
    expect(typeof api.create).toBe('function');
  });

  it('CrossRefResolver.queryByTitle returns null for short titles and does not call fetch', async () => {
    const api = await loadDOIResolver();

    const fetchMock = vi.fn(() => Promise.reject(new Error('fetch called')));
    vi.stubGlobal('fetch', fetchMock);

    const resolver = new api.CrossRefResolver();
    const out = await resolver.queryByTitle('too short');

    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CrossRefResolver.queryByTitle queries normalized title and formats result', async () => {
    const api = await loadDOIResolver();

    const title = 'Imaging (18)F-FDG in [PET].';
    const normalized = 'Imaging 18F-FDG in PET';

    const fetchMock = vi.fn(async (url) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get('query.title')).toBe(normalized);
      expect(parsed.searchParams.get('rows')).toBe('5');

      return okJson({
        message: {
          'total-results': 1,
          items: [
            {
              DOI: '10.1234/abcd',
              title: [title],
              author: [{ given: 'Alice', family: 'Smith' }],
              published: { 'date-parts': [[2023, 1, 1]] },
              'container-title': ['Journal of Testing'],
              volume: '12',
              issue: '1',
              page: '10-20',
              URL: 'https://doi.org/10.1234/abcd',
              abstract: '<jats:p>Abstract <b>bold</b></jats:p>',
              publisher: 'ACME',
              type: 'journal-article',
            },
          ],
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const resolver = new api.CrossRefResolver();
    const out = await resolver.queryByTitle(title, { year: 2023 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({
      doi: '10.1234/abcd',
      title,
      authors: ['Alice Smith'],
      year: 2023,
      journal: 'Journal of Testing',
      volume: '12',
      issue: '1',
      pages: '10-20',
      url: 'https://doi.org/10.1234/abcd',
      publisher: 'ACME',
      type: 'journal-article',
      source: 'crossref',
      confidence: 0.9,
    });
    expect(out.abstract).toBe('Abstract bold');
  });

  it('OpenAlexResolver._reconstructAbstract returns null for invalid or too-short output', async () => {
    const api = await loadDOIResolver();
    const resolver = new api.OpenAlexResolver();

    expect(resolver._reconstructAbstract(null)).toBeNull();
    expect(resolver._reconstructAbstract('not-an-object')).toBeNull();

    const tooShort = { hello: [0], world: [1] };
    expect(resolver._reconstructAbstract(tooShort)).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('OpenAlexResolver._reconstructAbstract rebuilds abstract from inverted index', async () => {
    const api = await loadDOIResolver();
    const resolver = new api.OpenAlexResolver();

    const inverted = {};
    for (let i = 0; i < 20; i++) inverted[`word${i}`] = [i];

    const out = resolver._reconstructAbstract(inverted);
    expect(out).toContain('word0 word1');
    expect(out).toContain('word19');
    expect(out.length).toBeGreaterThan(50);
  });

  it('MultiSourceDOIResolver.batchResolve marks unresolved references with google-search fallback', async () => {
    const api = await loadDOIResolver();

    const resolver = new api.MultiSourceDOIResolver({
      queryOrder: ['crossref'],
      enableSemanticScholarFallback: false,
    });

    const refs = [
      { title: 'Resolved Paper Title', year: 2020 },
      { title: 'Study of (18)F in [PET].', year: 2021 },
    ];

    resolver.crossref.batchQuery = vi.fn(async (items) => [
      {
        original: items[0],
        resolved: { doi: '10.1/res', source: 'crossref', url: 'https://doi.org/10.1/res' },
        success: true,
      },
      { original: items[1], resolved: null, success: false },
    ]);

    const onProgress = vi.fn();
    const results = await resolver.batchResolve(refs, onProgress);

    expect(resolver.crossref.batchQuery).toHaveBeenCalledWith(refs);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: 1,
        total: 2,
        phase: 'primary',
      }),
    );

    const resolved = results.find((r) => r.original === refs[0]);
    const fallback = results.find((r) => r.original === refs[1]);

    expect(resolved).toMatchObject({
      success: true,
      resolved: { doi: '10.1/res', source: 'crossref' },
    });

    expect(fallback.success).toBe(true);
    expect(fallback.resolved).toMatchObject({
      doi: null,
      title: refs[1].title,
      fallback: true,
      source: 'google-search',
    });
    expect(fallback.resolved.url).toBe(
      `https://www.google.com/search?q=${encodeURIComponent('Study of 18F in PET')}`,
    );
  });

  it('MultiSourceDOIResolver.batchResolve uses Semantic Scholar fallback when enabled', async () => {
    const api = await loadDOIResolver();

    const resolver = new api.MultiSourceDOIResolver({
      queryOrder: ['crossref'],
      enableSemanticScholarFallback: true,
    });

    const refs = [{ title: 'Needs fallback', year: 2022 }];

    resolver.crossref.batchQuery = vi.fn(async (items) => [
      { original: items[0], resolved: null, success: false },
    ]);
    resolver.semanticscholar.batchQuery = vi.fn(async (items) => [
      {
        original: items[0],
        resolved: { doi: '10.9/fb', source: 'semanticscholar' },
        success: true,
      },
    ]);

    const onProgress = vi.fn();
    const results = await resolver.batchResolve(refs, onProgress);

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 1,
        current: 'Semantic Scholar托底查询',
        phase: 'fallback',
      }),
    );
    expect(results[0]).toMatchObject({
      original: refs[0],
      success: true,
      resolved: { doi: '10.9/fb', source: 'semanticscholar' },
    });
  });
});

