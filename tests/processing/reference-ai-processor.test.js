/**
 * @file tests/processing/reference-ai-processor.test.js
 * @description js/processing/reference-ai-processor.js unit tests (global side-effect module)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_WINDOW = globalThis.window;
const ORIGINAL_FETCH = globalThis.fetch;

async function loadReferenceAIProcessor() {
  const mod = await import('../../js/processing/reference-ai-processor.esm.js');
  return mod.default ?? globalThis.ReferenceAIProcessor;
}

function okJsonResponse(data) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(data),
  };
}

function errorTextResponse(status, statusText, bodyText = '') {
  return {
    ok: false,
    status,
    statusText,
    text: async () => bodyText,
  };
}

describe('processing/reference-ai-processor (ReferenceAIProcessor)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    if (ORIGINAL_WINDOW === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = ORIGINAL_WINDOW;
    }

    globalThis.window ??= {};

    delete globalThis.ReferenceAIProcessor;
    if (globalThis.window) {
      delete globalThis.window.ReferenceAIProcessor;
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

    delete globalThis.ReferenceAIProcessor;
  });

  it('generateExtractionPrompt produces JSON input and strict id requirements', async () => {
    const api = await loadReferenceAIProcessor();

    const prompt = api.generateExtractionPrompt(['Ref A', 'Ref B'], 'zh');
    expect(typeof prompt.system).toBe('string');
    expect(typeof prompt.user).toBe('string');
    expect(prompt.system).toContain('必须返回 2 条文献');
    expect(prompt.system).toContain('0 到 1');
    expect(prompt.system).toContain('zh');

    expect(JSON.parse(prompt.user)).toEqual([
      { id: 0, raw: 'Ref A' },
      { id: 1, raw: 'Ref B' },
    ]);
  });

  it('buildAPIConfig throws for unsupported model', async () => {
    const api = await loadReferenceAIProcessor();
    expect(() => api.buildAPIConfig('nope', 'k')).toThrow(/Unsupported model/i);
  });

  it('buildAPIConfig(custom) builds a compatible body/response extractor', async () => {
    const api = await loadReferenceAIProcessor();

    const cfg = api.buildAPIConfig('custom', 'k', {
      apiEndpoint: 'https://api.example.test/v1/chat/completions',
      modelId: 'my-model',
      max_tokens: 123,
    });

    expect(cfg).toMatchObject({
      endpoint: 'https://api.example.test/v1/chat/completions',
      modelName: 'my-model',
      apiKey: 'k',
      headers: { 'Content-Type': 'application/json' },
    });

    const body = cfg.bodyBuilder('sys', 'user');
    expect(body).toEqual({
      model: 'my-model',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'user' },
      ],
      temperature: 0.1,
      max_tokens: 123,
    });

    expect(cfg.responseExtractor({ choices: [{ message: { content: 'ok' } }] })).toBe('ok');
  });

  it('batchProcessReferences returns [] for empty input', async () => {
    const api = await loadReferenceAIProcessor();
    const cfg = api.buildAPIConfig('mistral', 'k');

    expect(await api.batchProcessReferences(null, cfg)).toEqual([]);
    expect(await api.batchProcessReferences([], cfg)).toEqual([]);
  });

  it('batchProcessReferences falls back when API responds non-ok (non-retriable)', async () => {
    const api = await loadReferenceAIProcessor();
    const cfg = api.buildAPIConfig('mistral', 'k');

    const fetchMock = vi.fn(async () => errorTextResponse(400, 'Bad Request', 'nope'));
    vi.stubGlobal('fetch', fetchMock);

    const out = await api.batchProcessReferences(['a', 'b'], cfg);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      index: 0,
      rawText: 'a',
      extractedBy: 'fallback',
    });
    expect(out[1]).toMatchObject({
      index: 1,
      rawText: 'b',
      extractedBy: 'fallback',
    });
    expect(out[0].error).toMatch(/API请求失败 \(400\): Bad Request/);
  });

  it('batchProcessReferences parses JSON payloads and sorts extracted refs by id', async () => {
    const api = await loadReferenceAIProcessor();
    const cfg = api.buildAPIConfig('mistral', 'k');

    const fetchMock = vi.fn(async (_url, options) => {
      const body = JSON.parse(options?.body ?? '{}');
      expect(body.model).toBe(cfg.modelName);

      return okJsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                references: [
                  { id: 1, title: 'B' },
                  { id: 0, title: 'A' },
                ],
              }),
            },
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await api.batchProcessReferences(['Ref A', 'Ref B'], cfg);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toEqual([
      { id: 0, title: 'A' },
      { id: 1, title: 'B' },
    ]);
  });

  it('callAIExtraction splits batches when finish_reason=length and input > 5', async () => {
    const api = await loadReferenceAIProcessor();
    const cfg = api.buildAPIConfig('mistral', 'k');

    const fetchMock = vi.fn(async (_url, options) => {
      const body = JSON.parse(options?.body ?? '{}');
      const userMessage = body.messages?.find((m) => m.role === 'user')?.content;
      const input = JSON.parse(userMessage);
      const count = input.length;

      if (count === 6) {
        return okJsonResponse({
          choices: [{ finish_reason: 'length', message: { content: '' } }],
        });
      }

      const references = input.map((row) => ({ id: row.id, title: row.raw }));
      return okJsonResponse({
        choices: [{ message: { content: JSON.stringify({ references }) } }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await api.batchProcessReferences(['r0', 'r1', 'r2', 'r3', 'r4', 'r5'], cfg);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(out).toHaveLength(6);
  });

  it('batchProcessReferences reports progress across batches', async () => {
    const api = await loadReferenceAIProcessor();
    const cfg = api.buildAPIConfig('mistral', 'k');

    const fetchMock = vi.fn(async (_url, options) => {
      const body = JSON.parse(options?.body ?? '{}');
      const userMessage = body.messages?.find((m) => m.role === 'user')?.content;
      const input = JSON.parse(userMessage);
      const references = input.map((row) => ({ id: row.id, title: row.raw }));

      return okJsonResponse({
        choices: [{ message: { content: JSON.stringify({ references }) } }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const onProgress = vi.fn();
    const refs = Array.from({ length: 12 }, (_, i) => `r${i}`);
    const out = await api.batchProcessReferences(refs, cfg, 'auto', onProgress);

    expect(out).toHaveLength(12);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 12,
        totalBatches: 2,
      }),
    );

    const processedValues = onProgress.mock.calls.map((call) => call[0].processed);
    expect(processedValues).toContain(12);
  });

  it('smartProcessReferences marks regex-only entries without calling fetch', async () => {
    const api = await loadReferenceAIProcessor();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fetch called'))));

    const entries = [
      { index: 0, rawText: 'a', needsAIProcessing: false },
      { index: 1, rawText: 'b', needsAIProcessing: false },
    ];
    const out = await api.smartProcessReferences(entries, {}, 'auto');

    expect(out).toEqual([
      { index: 0, rawText: 'a', needsAIProcessing: false, extractedBy: 'regex' },
      { index: 1, rawText: 'b', needsAIProcessing: false, extractedBy: 'regex' },
    ]);
  });

  it('smartProcessReferences merges AI results and sorts by index', async () => {
    const api = await loadReferenceAIProcessor();
    const cfg = api.buildAPIConfig('mistral', 'k');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okJsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  references: [
                    { id: 0, title: 'AI0' },
                    { id: 1, title: 'AI1' },
                  ],
                }),
              },
            },
          ],
        }),
      ),
    );

    const entries = [
      { index: 2, rawText: 'R2', needsAIProcessing: false, extractedBy: 'regex', title: 'T2' },
      { index: 0, rawText: 'R0', needsAIProcessing: true },
      { index: 1, rawText: 'R1', needsAIProcessing: true },
    ];

    const out = await api.smartProcessReferences(entries, cfg, 'auto', null, { enrichWithDOI: true });

    expect(out.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(out[0]).toMatchObject({ index: 0, extractedBy: 'ai', confidence: 0.8, title: 'AI0' });
    expect(out[1]).toMatchObject({ index: 1, extractedBy: 'ai', confidence: 0.8, title: 'AI1' });
    expect(out[2]).toMatchObject({ index: 2, extractedBy: 'regex', title: 'T2' });
  });

  it('enrichWithDOI skips when DOIResolver is missing', async () => {
    const api = await loadReferenceAIProcessor();

    const refs = [{ title: 'T', doi: null }];
    const out = await api.enrichWithDOI(refs);

    expect(console.warn).toHaveBeenCalled();
    expect(out).toBe(refs);
  });

  it('enrichWithDOI merges resolved DOI results and reports progress', async () => {
    const api = await loadReferenceAIProcessor();

    const batchResolve = vi.fn(async (items, progressCb) => {
      progressCb({ completed: 1, total: 1, current: items[0] });
      return [
        {
          original: items[0],
          resolved: {
            doi: '10.1000/xyz',
            url: 'https://doi.org/10.1000/xyz',
            authors: ['Resolved'],
            year: 2021,
            journal: 'Resolved Journal',
            source: 'crossref',
            confidence: 0.9,
          },
        },
      ];
    });

    globalThis.window.DOIResolver = {
      create: vi.fn(() => ({ batchResolve })),
    };

    const refs = [
      { title: 'T1', doi: null, authors: ['Keep'], year: 2020, journal: 'Keep J', url: 'u1' },
      { title: 'T2', doi: '10.1/abc', url: 'u2' },
      { title: null, doi: null },
    ];

    const onProgress = vi.fn();
    const out = await api.enrichWithDOI(refs, onProgress);

    expect(globalThis.window.DOIResolver.create).toHaveBeenCalledWith(
      expect.objectContaining({
        queryOrder: ['crossref', 'openalex', 'pubmed'],
        timeout: 5000,
      }),
    );
    expect(batchResolve).toHaveBeenCalledWith(
      [refs[0]],
      expect.any(Function),
    );

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'doi-enrichment',
        completed: 1,
        total: 1,
        current: refs[0],
      }),
    );

    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      doi: '10.1000/xyz',
      url: 'https://doi.org/10.1000/xyz',
      authors: ['Keep'],
      year: 2020,
      journal: 'Keep J',
      doiSource: 'crossref',
      doiConfidence: 0.9,
    });
    expect(out[1]).toBe(refs[1]);
    expect(out[2]).toBe(refs[2]);
  });
});

