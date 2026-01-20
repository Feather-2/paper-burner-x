import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockStorage } from './vitest-utils.js';

const modulePath = '../../../../js/agents/llm/ppt-model-bridge.js';

const mocks = vi.hoisted(() => {
  const safeJsonParse = vi.fn((raw, opts) => {
    if (typeof raw !== 'string') return null;
    if (opts && typeof opts.maxChars === 'number' && raw.length > opts.maxChars) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });

  return { safeJsonParse };
});

vi.mock('../../../../js/agents/shared/index.js', () => ({
  safeJsonParse: mocks.safeJsonParse,
}));

let getPptModelConfig;
let getPptModelTags;
let getPptRolePriority;
let store;
let storage;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ store, storage } = createMockStorage());
  globalThis.localStorage = storage;
  ({ getPptModelConfig, getPptModelTags, getPptRolePriority } = await import(modulePath));
});

describe('getPptModelConfig', () => {
  it('returns model configs for mapped usage types', () => {
    const langPayload = { modelKey: 'openai:gpt-4o', modelId: 'gpt-4o' };
    const visionPayload = { modelKey: 'vision-model', modelId: '' };
    store.set('pptModelConfigLanguage', JSON.stringify(langPayload));
    store.set('pptModelConfigVision', JSON.stringify(visionPayload));

    const langResult = getPptModelConfig('writer');
    const visionResult = getPptModelConfig('vision');

    expect(langResult).toEqual({ modelKey: 'openai:gpt-4o', modelId: 'gpt-4o' });
    expect(visionResult).toEqual({ modelKey: 'vision-model', modelId: '' });
    expect(storage.getItem).toHaveBeenCalledWith('pptModelConfigLanguage');
    expect(storage.getItem).toHaveBeenCalledWith('pptModelConfigVision');
    expect(mocks.safeJsonParse).toHaveBeenCalledWith(JSON.stringify(langPayload), { maxChars: 200000 });
    expect(mocks.safeJsonParse).toHaveBeenCalledWith(JSON.stringify(visionPayload), { maxChars: 200000 });
  });

  it('falls back to lang config for boundary and unknown usage values', () => {
    const payload = { modelKey: 'lang-model', modelId: 'lang-id' };
    store.set('pptModelConfigLanguage', JSON.stringify(payload));

    const usages = [0, -1, Number.MAX_SAFE_INTEGER, '', '  ', '1', {}];
    const results = usages.map((usage) => getPptModelConfig(usage));

    results.forEach((result) => {
      expect(result).toEqual({ modelKey: 'lang-model', modelId: 'lang-id' });
    });
    expect(storage.getItem).toHaveBeenCalledTimes(usages.length);
    storage.getItem.mock.calls.forEach((call) => {
      expect(call[0]).toBe('pptModelConfigLanguage');
    });
  });

  it('returns null for missing or empty config payloads', () => {
    const rawValues = [
      null,
      undefined,
      '',
      '   ',
      JSON.stringify({}),
      JSON.stringify([]),
      JSON.stringify({ modelKey: '' }),
    ];

    rawValues.forEach((raw) => {
      storage.getItem.mockReturnValueOnce(raw);
    });

    const results = rawValues.map(() => getPptModelConfig('analyst'));
    results.forEach((result) => expect(result).toBeNull());
  });

  it('returns null when localStorage.getItem throws', () => {
    storage.getItem.mockImplementationOnce(() => {
      throw new Error('storage fail');
    });

    expect(getPptModelConfig('writer')).toBeNull();
  });

  it('returns null when safeJsonParse throws', () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'lang-model' }));
    mocks.safeJsonParse.mockImplementationOnce(() => {
      throw new Error('parse fail');
    });

    expect(getPptModelConfig('writer')).toBeNull();
  });

  it('returns null for oversized payloads', () => {
    const huge = '{"modelKey":"' + 'a'.repeat(200001) + '"}';
    store.set('pptModelConfigLanguage', huge);

    const result = getPptModelConfig('writer');

    expect(result).toBeNull();
    expect(mocks.safeJsonParse).toHaveBeenCalledWith(huge, { maxChars: 200000 });
  });

  it('remains consistent under concurrent calls', async () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'lang-model', modelId: 'lang-id' }));

    const results = await Promise.all([
      Promise.resolve(getPptModelConfig('writer')),
      Promise.resolve(getPptModelConfig('analyst')),
      Promise.resolve(getPptModelConfig('worker')),
    ]);

    results.forEach((result) => {
      expect(result).toEqual({ modelKey: 'lang-model', modelId: 'lang-id' });
    });
  });
});

describe('getPptModelTags', () => {
  it('filters to valid capability tags and removes duplicates', () => {
    const deepNested = { level: { inner: { deeper: { deepest: { value: 1 } } } } };
    const raw = {
      'openai:gpt-4o': ['lang', 'vision', 'lang', 'invalid', 0, -1, Number.MAX_SAFE_INTEGER, ' '],
      'openai:gpt-4o:variant': ['image', 'audio', 'image'],
      'numeric-string-model': ['0', 'lang'],
      'bad-model': 'lang',
      'deep-model': deepNested,
      'empty-model': [],
    };
    store.set('pptModelTags', JSON.stringify(raw));

    const result = getPptModelTags();

    expect(result).toEqual({
      'openai:gpt-4o': ['lang', 'vision'],
      'openai:gpt-4o:variant': ['image', 'audio'],
      'numeric-string-model': ['lang'],
      'empty-model': [],
    });
    expect(result).not.toHaveProperty('bad-model');
    expect(result).not.toHaveProperty('deep-model');
  });

  it('returns empty mapping for nullish or empty payloads', () => {
    const rawValues = [null, undefined, '', '   ', 'null', '[]', '{}'];

    rawValues.forEach((raw) => {
      storage.getItem.mockReturnValueOnce(raw);
    });

    const results = rawValues.map(() => getPptModelTags());
    results.forEach((result) => expect(result).toEqual({}));
  });

  it('stays stable during rapid successive calls', () => {
    const raw = { 'model-a': ['lang', 'vision'] };
    store.set('pptModelTags', JSON.stringify(raw));

    const results = Array.from({ length: 5 }, () => getPptModelTags());

    results.forEach((result) => {
      expect(result).toEqual({ 'model-a': ['lang', 'vision'] });
    });
    expect(mocks.safeJsonParse).toHaveBeenCalledTimes(5);
  });
});

describe('getPptRolePriority', () => {
  it('normalizes base roles and merges designer priorities', () => {
    const deepNested = { a: { b: { c: { d: { e: 1 } } } } };
    const raw = {
      analyst: ['model-1', 'model-1', '', 0, -1, Number.MAX_SAFE_INTEGER, '  ', '0', 'model-2'],
      planner: deepNested,
      reviewer: [],
      design_brainstorm: ['brain-1', 'shared'],
      design_layout: ['layout-1', 'shared'],
      design_tokens: ['token-1'],
      design_svg: [123, 'svg-1'],
      design_image: [null, 'img-1'],
      design_review: ['review-1'],
      designer: ['legacy-1', 'shared'],
    };
    store.set('pptRolePriority', JSON.stringify(raw));

    const result = getPptRolePriority();

    expect(result.analyst).toEqual(['model-1', '  ', '0', 'model-2']);
    expect(result.planner).toEqual([]);
    expect(result.reviewer).toEqual([]);
    expect(result.designer).toEqual([
      'brain-1',
      'shared',
      'layout-1',
      'token-1',
      'svg-1',
      'img-1',
      'review-1',
      'legacy-1',
    ]);
  });

  it('returns empty arrays for missing or empty config payloads', () => {
    const rawValues = [null, undefined, '', 'null', '{}', '[]'];
    const roles = [
      'analyst',
      'planner',
      'writer',
      'reviewer',
      'vision',
      'worker',
      'reranker',
      'shadow',
      'think',
      'codesearch',
      'designer',
    ];

    rawValues.forEach((raw) => {
      storage.getItem.mockReturnValueOnce(raw);
    });

    const results = rawValues.map(() => getPptRolePriority());

    results.forEach((result) => {
      roles.forEach((role) => {
        expect(result[role]).toEqual([]);
      });
    });
  });
});
