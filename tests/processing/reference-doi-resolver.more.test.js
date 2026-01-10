/**
 * @file tests/processing/reference-doi-resolver.more.test.js
 * @description Additional coverage for js/processing/reference-doi-resolver.js
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINALS = {
  window: globalThis.window,
  fetch: globalThis.fetch,
  localStorage: globalThis.localStorage,
};

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

describe('processing/reference-doi-resolver (more cases)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    globalThis.window ??= {};

    delete globalThis.DOIResolver;
    delete globalThis.window.DOIResolver;

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();

    if (ORIGINALS.window === undefined) delete globalThis.window;
    else globalThis.window = ORIGINALS.window;

    if (ORIGINALS.fetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = ORIGINALS.fetch;

    if (ORIGINALS.localStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = ORIGINALS.localStorage;

    delete globalThis.DOIResolver;
  });

  it('CrossRefResolver internal matching respects year tolerance and substring similarity', async () => {
    const api = await loadDOIResolver();
    const resolver = new api.CrossRefResolver();

    expect(resolver._calculateSimilarity('', '')).toBe(1);
    expect(resolver._calculateSimilarity('hello world', 'hello')).toBe(0.95);
    expect(resolver._levenshteinDistance('kitten', 'sitting')).toBe(3);

    const items = [
      {
        DOI: '10.0/old',
        title: ['Exact Title'],
        published: { 'date-parts': [[2010, 1, 1]] },
      },
      {
        DOI: '10.0/new',
        title: ['Exact Title'],
        published: { 'date-parts': [[2020, 1, 1]] },
      },
    ];

    const best = resolver._findBestMatch(items, 'Exact Title', { year: 2020 });
    expect(best?.DOI).toBe('10.0/new');
  });

  it('CrossRefResolver.batchQuery serializes queries and waits between items', async () => {
    const api = await loadDOIResolver();
    const resolver = new api.CrossRefResolver();

    vi.useFakeTimers();

    resolver.queryByTitle = vi.fn(async (title) => ({ doi: `10.0/${title}`, source: 'crossref' }));

    const refs = [{ title: 'one' }, { title: 'two' }];
    const pending = resolver.batchQuery(refs);

    await vi.advanceTimersByTimeAsync(400);
    const results = await pending;

    expect(resolver.queryByTitle).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      expect.objectContaining({ original: refs[0], success: true }),
      expect.objectContaining({ original: refs[1], success: true }),
    ]);
  });

  it('OpenAlexResolver.queryByTitle formats results and strips doi prefix', async () => {
    const api = await loadDOIResolver();

    const inverted = {};
    for (let i = 0; i < 20; i++) inverted[`w${i}`] = [i];

    const fetchMock = vi.fn(async (url) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get('search')).toBe('Imaging 18F-FDG in PET');

      return okJson({
        results: [
          {
            title: 'Imaging (18)F-FDG in [PET].',
            publication_year: 2010,
            doi: 'https://doi.org/10.0/bad',
          },
          {
            title: 'Imaging (18)F-FDG in [PET].',
            publication_year: 2020,
            doi: 'https://doi.org/10.1234/oa',
            id: 'https://openalex.org/W123',
            cited_by_count: 5,
            open_access: { oa_url: 'https://oa.example' },
            primary_location: { source: { display_name: 'Journal' } },
            authorships: [{ author: { display_name: 'Alice' } }],
            abstract_inverted_index: inverted,
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const resolver = new api.OpenAlexResolver();
    const out = await resolver.queryByTitle('Imaging (18)F-FDG in [PET].', { year: 2020 });

    expect(out).toMatchObject({
      doi: '10.1234/oa',
      title: 'Imaging (18)F-FDG in [PET].',
      authors: ['Alice'],
      year: 2020,
      journal: 'Journal',
      openAccessUrl: 'https://oa.example',
      citationCount: 5,
      source: 'openalex',
    });
    expect(out.abstract).toContain('w0 w1 w2');
  });

  it('SemanticScholarResolver uses proxy + auth headers when proxy config is enabled', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key) => {
        if (key !== 'academicSearchProxyConfig') return null;
        return JSON.stringify({
          enabled: true,
          baseUrl: 'https://proxy.example',
          authKey: 'auth',
          semanticScholarApiKey: 'sk',
        });
      }),
    });

    const api = await loadDOIResolver();

    const fetchMock = vi.fn(async (url, init) => {
      expect(String(url)).toMatch(/^https:\/\/proxy\.example\/api\/semanticscholar\/graph\/v1\/paper\/search\?/);
      expect(init).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Auth-Key': 'auth', 'X-Api-Key': 'sk' }),
        }),
      );

      return okJson({
        data: [
          {
            title: 'A long enough title',
            year: 2020,
            venue: 'Venue',
            authors: [{ name: 'Bob' }],
            externalIds: { DOI: '10.9/ss' },
            url: 'https://paper',
            citationCount: 1,
            abstract: 'abs',
            paperId: 'p1',
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const resolver = new api.SemanticScholarResolver();
    const out = await resolver.queryByTitle('A long enough title', { year: 2020 });

    expect(out).toMatchObject({
      doi: '10.9/ss',
      title: 'A long enough title',
      authors: ['Bob'],
      year: 2020,
      journal: 'Venue',
      source: 'semanticscholar',
    });
  });

  it('SemanticScholarResolver.batchQuery uses configured TPS rateLimit to compute delay', async () => {
    vi.useFakeTimers();

    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key) => {
        if (key !== 'academicSearchProxyConfig') return null;
        return JSON.stringify({
          enabled: true,
          baseUrl: 'https://proxy.example',
          rateLimit: { services: { semanticscholar: { tps: 10 } } },
        });
      }),
    });

    const api = await loadDOIResolver();
    const resolver = new api.SemanticScholarResolver();

    resolver.queryByTitle = vi.fn(async () => null);

    const refs = [{ title: 'first title 123' }, { title: 'second title 456' }];
    const pending = resolver.batchQuery(refs);

    // delay = ceil((1000/10)*1.5) = 150ms
    await vi.advanceTimersByTimeAsync(150);
    const out = await pending;

    expect(resolver.queryByTitle).toHaveBeenCalledTimes(2);
    expect(out).toEqual([
      { original: refs[0], resolved: null, success: false },
      { original: refs[1], resolved: null, success: false },
    ]);
  });
});

