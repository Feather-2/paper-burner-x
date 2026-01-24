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
let getPptAudioConfig;
let buildPptUsageConfigForModelRouter;
let createPptConfiguredChat;
let createPptAwareAiApiService;
let getPptConfigSummary;
let store;
let storage;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ store, storage } = createMockStorage());
  globalThis.localStorage = storage;
  ({
    getPptModelConfig,
    getPptModelTags,
    getPptRolePriority,
    getPptAudioConfig,
    buildPptUsageConfigForModelRouter,
    createPptConfiguredChat,
    createPptAwareAiApiService,
    getPptConfigSummary,
  } = await import(modulePath));
});

describe('getPptModelConfig', () => {
  it('should_return_model_configs_when_usage_is_mapped', () => {
    const langPayload = { modelKey: 'openai:gpt-4o', modelId: 'gpt-4o' };
    const visionPayload = { modelKey: 'vision-model', modelId: '' };
    store.set('pptModelConfigLanguage', JSON.stringify(langPayload));
    store.set('pptModelConfigVision', JSON.stringify(visionPayload));

    const result = [getPptModelConfig('writer'), getPptModelConfig('vision')];

    expect(result).toEqual([
      { modelKey: 'openai:gpt-4o', modelId: 'gpt-4o' },
      { modelKey: 'vision-model', modelId: '' },
    ]);
  });

  it('should_fallback_to_lang_config_when_usage_is_unknown_or_boundary', () => {
    const payload = { modelKey: 'lang-model', modelId: 'lang-id' };
    store.set('pptModelConfigLanguage', JSON.stringify(payload));

    const usages = [0, -1, Number.MAX_SAFE_INTEGER, '', '  ', '1', {}];
    const results = usages.map((usage) => getPptModelConfig(usage));

    expect(results).toEqual(usages.map(() => ({ modelKey: 'lang-model', modelId: 'lang-id' })));
  });

  it('should_return_null_when_config_is_missing_or_empty', () => {
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
    expect(results).toEqual(rawValues.map(() => null));
  });

  it('should_return_null_when_localStorage_getItem_throws', () => {
    storage.getItem.mockImplementationOnce(() => {
      throw new Error('storage fail');
    });

    expect(getPptModelConfig('writer')).toBeNull();
  });

  it('should_return_null_when_safeJsonParse_throws', () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'lang-model' }));
    mocks.safeJsonParse.mockImplementationOnce(() => {
      throw new Error('parse fail');
    });

    expect(getPptModelConfig('writer')).toBeNull();
  });

  it('should_return_null_when_payload_exceeds_maxChars', () => {
    const huge = '{"modelKey":"' + 'a'.repeat(200001) + '"}';
    store.set('pptModelConfigLanguage', huge);

    const result = getPptModelConfig('writer');

    expect(result).toBeNull();
  });

  it('should_remain_consistent_when_called_concurrently', async () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'lang-model', modelId: 'lang-id' }));

    const results = await Promise.all([
      Promise.resolve(getPptModelConfig('writer')),
      Promise.resolve(getPptModelConfig('analyst')),
      Promise.resolve(getPptModelConfig('worker')),
    ]);

    expect(results).toEqual([
      { modelKey: 'lang-model', modelId: 'lang-id' },
      { modelKey: 'lang-model', modelId: 'lang-id' },
      { modelKey: 'lang-model', modelId: 'lang-id' },
    ]);
  });
});

describe('getPptModelTags', () => {
  it('should_filter_to_valid_tags_and_dedupe', () => {
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
  });

  it('should_return_empty_object_when_payload_is_nullish_or_empty', () => {
    const rawValues = [null, undefined, '', '   ', 'null', '[]', '{}'];

    rawValues.forEach((raw) => {
      storage.getItem.mockReturnValueOnce(raw);
    });

    const results = rawValues.map(() => getPptModelTags());
    expect(results).toEqual(rawValues.map(() => ({})));
  });

  it('should_be_stable_during_rapid_successive_calls', () => {
    const raw = { 'model-a': ['lang', 'vision'] };
    store.set('pptModelTags', JSON.stringify(raw));

    const results = Array.from({ length: 5 }, () => getPptModelTags());

    expect(results).toEqual(Array.from({ length: 5 }, () => ({ 'model-a': ['lang', 'vision'] })));
  });
});

describe('getPptRolePriority', () => {
  it('should_normalize_roles_and_merge_designer_priorities', () => {
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

    expect(result).toEqual({
      analyst: ['model-1', '  ', '0', 'model-2'],
      planner: [],
      writer: [],
      reviewer: [],
      vision: [],
      worker: [],
      reranker: [],
      shadow: [],
      think: [],
      codesearch: [],
      designer: ['brain-1', 'shared', 'layout-1', 'token-1', 'svg-1', 'img-1', 'review-1', 'legacy-1'],
    });
  });

  it('should_return_empty_arrays_when_payload_is_missing_or_invalid', () => {
    const rawValues = [null, undefined, '', 'null', '{}', '[]'];

    rawValues.forEach((raw) => {
      storage.getItem.mockReturnValueOnce(raw);
    });

    const results = rawValues.map(() => getPptRolePriority());

    const expected = {
      analyst: [],
      planner: [],
      writer: [],
      reviewer: [],
      vision: [],
      worker: [],
      reranker: [],
      shadow: [],
      think: [],
      codesearch: [],
      designer: [],
    };
    expect(results).toEqual(rawValues.map(() => expected));
  });
});

describe('getPptAudioConfig', () => {
  it('should_return_defaults_when_payload_is_nullish_or_invalid', () => {
    const rawValues = [null, undefined, '', '   ', 'null', '{}', '[]'];

    rawValues.forEach((raw) => {
      storage.getItem.mockReturnValueOnce(raw);
    });

    const results = rawValues.map(() => getPptAudioConfig());
    const expectedDefault = {
      transcription: { provider: 'groq', apiKey: '', model: 'whisper-large-v3' },
      synthesis: { provider: 'elevenlabs', apiKey: '', model: 'eleven_turbo_v2_5', voice: '' },
    };
    expect(results).toEqual(rawValues.map(() => expectedDefault));
  });

  it('should_merge_partial_payload_with_defaults', () => {
    store.set(
      'pptAudioConfig',
      JSON.stringify({
        transcription: { provider: 'openai', apiKey: 'k', model: 'whisper-1' },
        synthesis: { provider: 'aws', voice: 'amy' },
      })
    );

    const result = getPptAudioConfig();

    expect(result).toEqual({
      transcription: { provider: 'openai', apiKey: 'k', model: 'whisper-1' },
      synthesis: { provider: 'aws', apiKey: '', model: 'eleven_turbo_v2_5', voice: 'amy' },
    });
  });

  it('should_return_defaults_when_localStorage_getItem_throws', () => {
    storage.getItem.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const result = getPptAudioConfig();

    expect(result).toEqual({
      transcription: { provider: 'groq', apiKey: '', model: 'whisper-large-v3' },
      synthesis: { provider: 'elevenlabs', apiKey: '', model: 'eleven_turbo_v2_5', voice: '' },
    });
  });

  it('should_return_defaults_when_safeJsonParse_throws', () => {
    store.set('pptAudioConfig', JSON.stringify({ transcription: { provider: 'openai' } }));
    mocks.safeJsonParse.mockImplementationOnce(() => {
      throw new Error('parse fail');
    });

    const result = getPptAudioConfig();

    expect(result).toEqual({
      transcription: { provider: 'groq', apiKey: '', model: 'whisper-large-v3' },
      synthesis: { provider: 'elevenlabs', apiKey: '', model: 'eleven_turbo_v2_5', voice: '' },
    });
  });
});

describe('buildPptUsageConfigForModelRouter', () => {
  it('should_build_usage_config_using_priority_and_tag_filtering_with_fallbacks', () => {
    store.set(
      'pptRolePriority',
      JSON.stringify({
        analyst: ['m_lang', 'm_visionOnly', 'm_unlabeled'],
        reviewer: ['m_visionOnly', 'm_lang'],
        worker: ['m_lang'],
        designer: ['m_lang'],
        vision: ['m_vision', 'm_lang'],
      })
    );
    store.set('pptModelTags', JSON.stringify({ m_lang: ['lang'], m_visionOnly: ['vision'], m_vision: ['vision'] }));
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'm_legacyLang', modelId: '' }));

    const result = buildPptUsageConfigForModelRouter();

    expect(result).toEqual({
      analyst: ['m_lang', 'm_unlabeled'],
      planner: ['m_legacyLang'],
      writer: ['m_legacyLang'],
      reviewer: ['m_lang'],
      designer: ['m_lang'],
      worker: ['m_lang'],
      reranker: ['m_legacyLang'],
      shadow: ['m_lang'],
      think: ['m_lang', 'm_unlabeled'],
      codesearch: ['m_lang'],
      vision: ['m_vision'],
    });
  });

  it('should_aggregate_tags_from_prefixed_entries_when_direct_key_missing', () => {
    store.set('pptRolePriority', JSON.stringify({ analyst: ['openai:gpt-4o'], vision: ['openai:gpt-4o'] }));
    store.set(
      'pptModelTags',
      JSON.stringify({
        'openai:gpt-4o:variantA': ['lang'],
        'openai:gpt-4o:variantB': ['vision'],
      })
    );

    const result = buildPptUsageConfigForModelRouter();

    expect(result).toEqual({
      analyst: ['openai:gpt-4o'],
      planner: [],
      writer: [],
      reviewer: [],
      designer: [],
      worker: [],
      reranker: [],
      shadow: [],
      think: ['openai:gpt-4o'],
      codesearch: [],
      vision: ['openai:gpt-4o'],
    });
  });

  it('should_fallback_to_legacy_configs_when_priority_is_empty', () => {
    store.set('pptRolePriority', JSON.stringify({}));
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'legacy-lang', modelId: '' }));
    store.set('pptModelConfigVision', JSON.stringify({ modelKey: 'legacy-vision', modelId: '' }));
    store.set('pptModelTags', JSON.stringify({ 'legacy-lang': ['lang'], 'legacy-vision': ['vision'] }));

    const result = buildPptUsageConfigForModelRouter();

    expect(result).toEqual({
      analyst: ['legacy-lang'],
      planner: ['legacy-lang'],
      writer: ['legacy-lang'],
      reviewer: ['legacy-lang'],
      designer: ['legacy-lang'],
      worker: ['legacy-lang'],
      reranker: ['legacy-lang'],
      shadow: ['legacy-lang'],
      think: ['legacy-lang'],
      codesearch: ['legacy-lang'],
      vision: ['legacy-vision'],
    });
  });
});

describe('createPptConfiguredChat', () => {
  it('should_return_null_when_aiApiService_chat_is_missing', () => {
    const result = createPptConfiguredChat({});

    expect(result).toBeNull();
  });

  it('should_return_callApi_result_when_internal_resolve_succeeds', async () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'openai:gpt-4o', modelId: 'gpt-4o' }));
    const aiApiService = {
      chat: vi.fn(async () => ({ content: 'chat' })),
      _resolveModelConfig: vi.fn(() => ({ provider: 'mock' })),
      _callApi: vi.fn(async () => ({ content: 'callApi' })),
    };

    const chat = createPptConfiguredChat(aiApiService, 'writer');
    const result = await chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result).toEqual({ content: 'callApi' });
  });

  it('should_pass_default_temperature_and_maxTokens_when_not_provided', async () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'openai:gpt-4o', modelId: 'gpt-4o' }));
    const messages = [{ role: 'user', content: 'hi' }];
    const apiConfig = { provider: 'mock' };
    const aiApiService = {
      chat: vi.fn(async () => ({ content: 'chat' })),
      _resolveModelConfig: vi.fn(() => apiConfig),
      _callApi: vi.fn(async () => ({ content: 'callApi' })),
    };

    const chat = createPptConfiguredChat(aiApiService, 'writer');
    await chat({ messages });

    expect(aiApiService._callApi.mock.calls[0]).toEqual([apiConfig, messages, 0.7, 4096]);
  });

  it('should_pass_temperature_and_maxTokens_when_provided', async () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'openai:gpt-4o', modelId: 'gpt-4o' }));
    const messages = [{ role: 'user', content: 'hi' }];
    const apiConfig = { provider: 'mock' };
    const aiApiService = {
      chat: vi.fn(async () => ({ content: 'chat' })),
      _resolveModelConfig: vi.fn(() => apiConfig),
      _callApi: vi.fn(async () => ({ content: 'callApi' })),
    };

    const chat = createPptConfiguredChat(aiApiService, 'writer');
    await chat({ messages, temperature: 0.2, maxTokens: 123 });

    expect(aiApiService._callApi.mock.calls[0]).toEqual([apiConfig, messages, 0.2, 123]);
  });

  it('should_call_chat_with_ppt_modelKey_when_internal_resolve_returns_null', async () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'openai:gpt-4o', modelId: 'gpt-4o' }));
    const aiApiService = {
      chat: vi.fn(async (opts) => ({ echoedModel: opts.model })),
      _resolveModelConfig: vi.fn(() => null),
      _callApi: vi.fn(async () => ({ content: 'callApi' })),
    };

    const chat = createPptConfiguredChat(aiApiService, 'writer');
    await chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(aiApiService.chat.mock.calls[0][0].model).toBe('openai:gpt-4o');
  });

  it('should_not_override_model_when_explicit_and_not_auto', async () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'openai:gpt-4o', modelId: 'gpt-4o' }));
    const aiApiService = { chat: vi.fn(async (opts) => ({ echoedModel: opts.model })) };

    const chat = createPptConfiguredChat(aiApiService, 'writer');
    await chat({ messages: [{ role: 'user', content: 'hi' }], model: 'explicit-model' });

    expect(aiApiService.chat.mock.calls[0][0].model).toBe('explicit-model');
  });

  it('should_override_model_when_model_is_auto', async () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'openai:gpt-4o', modelId: 'gpt-4o' }));
    const aiApiService = { chat: vi.fn(async (opts) => ({ echoedModel: opts.model })) };

    const chat = createPptConfiguredChat(aiApiService, 'writer');
    await chat({ messages: [{ role: 'user', content: 'hi' }], model: 'auto' });

    expect(aiApiService.chat.mock.calls[0][0].model).toBe('openai:gpt-4o');
  });

  it('should_format_custom_source_model_when_modelId_is_present', async () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'custom_source_site1', modelId: 'm1' }));
    const aiApiService = { chat: vi.fn(async (opts) => ({ echoedModel: opts.model })) };

    const chat = createPptConfiguredChat(aiApiService, 'writer');
    await chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(aiApiService.chat.mock.calls[0][0].model).toBe('site1:m1');
  });

  it('should_map_modelId_to_model_when_model_is_missing', async () => {
    const aiApiService = { chat: vi.fn(async (opts) => ({ echoedModel: opts.model })) };

    const chat = createPptConfiguredChat(aiApiService, 'writer');
    await chat({ messages: [{ role: 'user', content: 'hi' }], modelId: '  legacy-model  ' });

    expect(aiApiService.chat.mock.calls[0][0].model).toBe('legacy-model');
  });
});

describe('createPptAwareAiApiService', () => {
  it('should_return_null_when_baseService_is_null', () => {
    const result = createPptAwareAiApiService(null);

    expect(result).toBeNull();
  });

  it('should_return_callApi_result_when_internal_resolve_succeeds', async () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'openai:gpt-4o', modelId: 'gpt-4o' }));
    const baseService = {
      chat: vi.fn(async () => ({ content: 'chat' })),
      _resolveModelConfig: vi.fn(() => ({ provider: 'mock' })),
      _callApi: vi.fn(async () => ({ content: 'callApi' })),
    };
    const service = createPptAwareAiApiService(baseService);

    const result = await service.chat({ usage: 'writer', messages: [{ role: 'user', content: 'hi' }] });

    expect(result).toEqual({ content: 'callApi' });
  });

  it('should_pass_messages_temperature_and_maxTokens_to_callApi', async () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'openai:gpt-4o', modelId: 'gpt-4o' }));
    const apiConfig = { provider: 'mock' };
    const messages = [{ role: 'user', content: 'hi' }];
    const baseService = {
      chat: vi.fn(async () => ({ content: 'chat' })),
      _resolveModelConfig: vi.fn(() => apiConfig),
      _callApi: vi.fn(async () => ({ content: 'callApi' })),
    };
    const service = createPptAwareAiApiService(baseService);

    await service.chat({ usage: 'writer', messages, temperature: 0.1, maxTokens: 100 });

    expect(baseService._callApi.mock.calls[0]).toEqual([apiConfig, messages, 0.1, 100]);
  });

  it('should_use_base_chat_when_messages_is_not_array_even_with_internal_methods', async () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'openai:gpt-4o', modelId: 'gpt-4o' }));
    const baseService = {
      chat: vi.fn(async (opts) => ({ echoedModel: opts.model })),
      _resolveModelConfig: vi.fn(() => ({ provider: 'mock' })),
      _callApi: vi.fn(async () => ({ content: 'callApi' })),
    };
    const service = createPptAwareAiApiService(baseService);

    await service.chat({ usage: 'writer', messages: 'not-array' });

    expect(baseService.chat.mock.calls[0][0].model).toBe('openai:gpt-4o');
  });

  it('should_respect_explicit_model_when_not_auto', async () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'openai:gpt-4o', modelId: 'gpt-4o' }));
    const baseService = { chat: vi.fn(async (opts) => ({ echoedModel: opts.model })) };
    const service = createPptAwareAiApiService(baseService);

    await service.chat({ usage: 'writer', messages: [{ role: 'user', content: 'hi' }], model: 'explicit-model' });

    expect(baseService.chat.mock.calls[0][0].model).toBe('explicit-model');
  });

  it('should_override_model_when_model_is_auto', async () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'openai:gpt-4o', modelId: 'gpt-4o' }));
    const baseService = { chat: vi.fn(async (opts) => ({ echoedModel: opts.model })) };
    const service = createPptAwareAiApiService(baseService);

    await service.chat({ usage: 'writer', messages: [{ role: 'user', content: 'hi' }], model: 'auto' });

    expect(baseService.chat.mock.calls[0][0].model).toBe('openai:gpt-4o');
  });

  it('should_map_modelId_to_model_when_model_is_missing', async () => {
    const baseService = { chat: vi.fn(async (opts) => ({ echoedModel: opts.model })) };
    const service = createPptAwareAiApiService(baseService);

    await service.chat({ messages: [{ role: 'user', content: 'hi' }], modelId: '  legacy-model  ' });

    expect(baseService.chat.mock.calls[0][0].model).toBe('legacy-model');
  });

  it('should_return_parsed_configs_from_getPptConfigs', () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'lang', modelId: 'id' }));
    store.set('pptModelConfigImage', JSON.stringify({ modelKey: 'img', modelId: '' }));
    store.set('pptModelConfigVision', JSON.stringify({ modelKey: 'vision', modelId: '' }));
    store.set('pptModelTags', JSON.stringify({ m: ['lang'] }));
    store.set('pptRolePriority', JSON.stringify({ analyst: ['m1'] }));
    store.set('pptAudioConfig', JSON.stringify({ transcription: { provider: 'openai' } }));

    const baseService = { chat: vi.fn(async () => ({ content: 'chat' })) };
    const service = createPptAwareAiApiService(baseService);
    const result = service.getPptConfigs();

    expect(result).toEqual({
      lang: { modelKey: 'lang', modelId: 'id' },
      img: { modelKey: 'img', modelId: '' },
      vision: { modelKey: 'vision', modelId: '' },
      modelTags: { m: ['lang'] },
      rolePriority: { analyst: ['m1'] },
      audio: { transcription: { provider: 'openai' } },
    });
  });

  it('should_return_true_when_usage_is_configured_and_false_when_not', () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'lang', modelId: '' }));
    const baseService = { chat: vi.fn(async () => ({ content: 'chat' })) };
    const service = createPptAwareAiApiService(baseService);

    const result = [service.isUsageConfigured('writer'), service.isUsageConfigured('image')];

    expect(result).toEqual([true, false]);
  });
});

describe('getPptConfigSummary', () => {
  it('should_return_unconfigured_summary_when_no_configs_exist', () => {
    const result = getPptConfigSummary();

    expect(result).toEqual({ lang: '未配置', img: '未配置', vision: '未配置', configured: false });
  });

  it('should_return_summary_strings_when_configs_are_present', () => {
    store.set('pptModelConfigLanguage', JSON.stringify({ modelKey: 'lang-model', modelId: 'id1' }));
    store.set('pptModelConfigImage', JSON.stringify({ modelKey: 'img-model', modelId: '' }));
    store.set('pptModelConfigVision', JSON.stringify({ modelKey: 'vision-model', modelId: 'v1' }));

    const result = getPptConfigSummary();

    expect(result).toEqual({ lang: 'lang-model:id1', img: 'img-model', vision: 'vision-model:v1', configured: true });
  });
});