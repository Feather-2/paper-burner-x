import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const previousWindow = globalThis.window;
const previousDocument = globalThis.document;

let appendQueryParamToUrl;
let normalizeOpenAIModelsUrl;
let normalizeGeminiModelsUrl;
let mapGeminiModelsResponse;
let isGeminiFormat;

beforeAll(async () => {
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = {};
  }

  if (typeof globalThis.document === 'undefined') {
    globalThis.document = { addEventListener: () => {} };
  } else if (typeof globalThis.document.addEventListener !== 'function') {
    globalThis.document.addEventListener = () => {};
  }

  const module = await import('../../js/api/model-detector.js');
  ({
    appendQueryParamToUrl,
    normalizeOpenAIModelsUrl,
    normalizeGeminiModelsUrl,
    mapGeminiModelsResponse,
    isGeminiFormat
  } = module);
});

afterAll(() => {
  if (typeof previousWindow === 'undefined') {
    delete globalThis.window;
  } else {
    globalThis.window = previousWindow;
  }

  if (typeof previousDocument === 'undefined') {
    delete globalThis.document;
  } else {
    globalThis.document = previousDocument;
  }
});

describe('appendQueryParamToUrl', () => {
  it('adds a query param to a normal URL', () => {
    const result = appendQueryParamToUrl('https://example.com/v1/models', 'key', 'abc');
    const url = new URL(result);

    expect(url.origin + url.pathname).toBe('https://example.com/v1/models');
    expect(url.searchParams.get('key')).toBe('abc');
  });

  it('preserves existing query params', () => {
    const result = appendQueryParamToUrl('https://example.com/v1/models?foo=1', 'key', 'abc');
    const url = new URL(result);

    expect(url.searchParams.get('foo')).toBe('1');
    expect(url.searchParams.get('key')).toBe('abc');
  });

  it('falls back when URL is invalid', () => {
    expect(appendQueryParamToUrl('example.com/v1/models', 'key', 'abc')).toBe('example.com/v1/models?key=abc');
  });
});

describe('normalizeOpenAIModelsUrl', () => {
  it('throws on empty input', () => {
    expect(() => normalizeOpenAIModelsUrl('')).toThrow('API Base URL 不能为空');
    expect(() => normalizeOpenAIModelsUrl(null)).toThrow('API Base URL 不能为空');
  });

  it('keeps existing /models suffixes', () => {
    expect(normalizeOpenAIModelsUrl('https://api.openai.com/v1/models/')).toBe('https://api.openai.com/v1/models');
    expect(normalizeOpenAIModelsUrl('https://api.openai.com/models')).toBe('https://api.openai.com/models');
  });

  it('adds /v1/models when missing', () => {
    expect(normalizeOpenAIModelsUrl('https://api.openai.com')).toBe('https://api.openai.com/v1/models');
    expect(normalizeOpenAIModelsUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/models');
  });

  it('handles manual mode inputs', () => {
    expect(normalizeOpenAIModelsUrl('https://api.openai.com/v1/chat/completions', 'manual')).toBe('https://api.openai.com/v1/models');
  });
});

describe('normalizeGeminiModelsUrl', () => {
  it('throws on empty input', () => {
    expect(() => normalizeGeminiModelsUrl('')).toThrow('Gemini API Base URL 不能为空');
    expect(() => normalizeGeminiModelsUrl(null)).toThrow('Gemini API Base URL 不能为空');
  });

  it('normalizes standard Gemini model list URLs', () => {
    expect(normalizeGeminiModelsUrl('https://generativelanguage.googleapis.com/v1beta/models?key=abc')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models'
    );
  });

  it('adds /v1beta/models when missing', () => {
    expect(normalizeGeminiModelsUrl('https://generativelanguage.googleapis.com')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models'
    );
  });
});

describe('mapGeminiModelsResponse', () => {
  it('returns an empty array for empty inputs', () => {
    expect(mapGeminiModelsResponse([])).toEqual([]);
  });

  it('maps a Gemini models list to {id,name,...}', () => {
    const mapped = mapGeminiModelsResponse([
      { name: 'models/gemini-pro', displayName: 'Gemini Pro' },
      { id: 'models/gemini-pro-vision', displayName: 'Vision' },
      { name: 'gemini-2.0-flash' }
    ]);

    expect(mapped).toEqual([
      {
        id: 'gemini-pro',
        name: 'gemini-pro',
        rawName: 'models/gemini-pro',
        rawDisplayName: 'Gemini Pro'
      },
      {
        id: 'gemini-pro-vision',
        name: 'gemini-pro-vision',
        rawName: 'models/gemini-pro-vision',
        rawDisplayName: 'Vision'
      },
      {
        id: 'gemini-2.0-flash',
        name: 'gemini-2.0-flash',
        rawName: 'gemini-2.0-flash',
        rawDisplayName: ''
      }
    ]);
  });

  it('deduplicates models by id (first wins)', () => {
    const mapped = mapGeminiModelsResponse([
      { name: 'models/gemini-pro', displayName: 'First' },
      { name: 'models/gemini-pro', displayName: 'Second' }
    ]);

    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toEqual({
      id: 'gemini-pro',
      name: 'gemini-pro',
      rawName: 'models/gemini-pro',
      rawDisplayName: 'First'
    });
  });
});

describe('isGeminiFormat', () => {
  it('returns true when requestFormat is gemini', () => {
    expect(isGeminiFormat('gemini', 'https://api.openai.com')).toBe(true);
  });

  it('returns true when baseUrl points to generativelanguage.googleapis.com', () => {
    expect(isGeminiFormat('openai', 'https://generativelanguage.googleapis.com/v1beta/models')).toBe(true);
  });

  it('returns false otherwise', () => {
    expect(isGeminiFormat('openai', 'https://api.openai.com')).toBe(false);
  });
});
