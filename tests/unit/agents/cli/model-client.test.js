import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const MODULE_PATH = '../../../../js/agents/cli/model-client.js';

const mockedFs = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

const mockedShared = vi.hoisted(() => ({
  toNonEmptyString: vi.fn((value) => (typeof value === 'string' && value.trim() ? value : '')),
  estimateTokensCached: vi.fn((input) => (typeof input === 'string' ? input.length : 0)),
  protoSafeReviver: vi.fn((key, value) => value),
  logger: {
    warn: vi.fn((...args) => console.warn(...args)),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(),
}));

const mockedOverflow = vi.hoisted(() => ({
  executeWithOverflowRecovery: vi.fn(async (fn, opts) => fn(opts.initialMaxTokens)),
}));

vi.mock('node:fs', () => ({
  readFileSync: mockedFs.readFileSync,
  existsSync: mockedFs.existsSync,
}));

vi.mock('../../../../js/agents/shared/index.js', () => ({
  toNonEmptyString: mockedShared.toNonEmptyString,
  estimateTokensCached: mockedShared.estimateTokensCached,
  protoSafeReviver: mockedShared.protoSafeReviver,
  createLogger: mockedShared.createLogger,
}));

vi.mock('../../../../js/agents/llm/overflow-recovery.js', () => ({
  executeWithOverflowRecovery: mockedOverflow.executeWithOverflowRecovery,
}));

const originalEnv = { ...process.env };
let fetchMock;
let warnSpy;

const loadModule = async () => await import(MODULE_PATH);

const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
};

const makeResponse = ({ ok = true, status = 200, jsonData, textData = '', headers = {} } = {}) => {
  const headerMap = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok,
    status,
    headers: {
      get: (key) => headerMap.get(String(key).toLowerCase()) || '',
    },
    json: async () => jsonData,
    text: async () => textData,
  };
};

const makeDeepNested = (depth) => {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    const key = `level_${i}`;
    cursor[key] = {};
    cursor = cursor[key];
  }
  return root;
};

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  restoreEnv();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;

  mockedFs.readFileSync.mockReset();
  mockedFs.existsSync.mockReset();
  mockedShared.toNonEmptyString.mockReset();
  mockedShared.estimateTokensCached.mockReset();
  mockedShared.protoSafeReviver.mockReset();
  mockedShared.createLogger.mockReset();
  mockedShared.logger.warn.mockReset();
  mockedShared.logger.info.mockReset();
  mockedShared.logger.error.mockReset();
  mockedShared.logger.debug.mockReset();
  mockedOverflow.executeWithOverflowRecovery.mockReset();

  mockedFs.existsSync.mockReturnValue(false);
  mockedFs.readFileSync.mockReturnValue('');
  mockedShared.toNonEmptyString.mockImplementation((value) => (typeof value === 'string' && value.trim() ? value : ''));
  mockedShared.estimateTokensCached.mockImplementation((input) => (typeof input === 'string' ? input.length : 0));
  mockedShared.protoSafeReviver.mockImplementation((key, value) => value);
  mockedShared.logger.warn.mockImplementation((...args) => console.warn(...args));
  mockedShared.createLogger.mockImplementation(() => mockedShared.logger);
  mockedOverflow.executeWithOverflowRecovery.mockImplementation(async (fn, opts) => fn(opts.initialMaxTokens));

  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnv();
});

describe('CliModelRouter', () => {
  it('warns when config missing and env not set', async () => {
    mockedFs.existsSync.mockReturnValue(false);
    delete process.env.OPENAI_API_KEY;

    const { CliModelRouter } = await loadModule();
    const router = new CliModelRouter();

    expect(warnSpy).toHaveBeenCalled();
    expect(() => router.getClient()).toThrow('未配置模型');
  });

  it('returns env client and caches across calls', async () => {
    process.env.OPENAI_API_KEY = 'env-key';
    process.env.OPENAI_BASE_URL = 'https://api.example.com/v1/';
    process.env.OPENAI_MODEL = 'env-model';

    const { CliModelRouter, CliModelClient } = await loadModule();
    const router = new CliModelRouter();

    const client1 = router.getClient('worker');
    const client2 = router.getClient('fast');

    expect(client1).toBeInstanceOf(CliModelClient);
    expect(client1).toBe(client2);
    expect(client1.apiKey).toBe('env-key');
    expect(client1.baseUrl).toBe('https://api.example.com/v1');
    expect(client1.model).toBe('env-model');
  });

  it('selects tiers via tiers/roles/default mapping', async () => {
    const config = {
      default: 'normal',
      tiers: {
        fast: ['fast', 'worker'],
      },
      roles: {
        planner: 'advanced',
      },
      models: {
        normal: { apiKey: 'k1', baseUrl: 'https://n', model: 'normal-model' },
        fast: { apiKey: 'k2', baseUrl: 'https://f', model: 'fast-model' },
        advanced: { apiKey: 'k3', baseUrl: 'https://a', model: 'advanced-model' },
      },
    };

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(config));

    const { CliModelRouter } = await loadModule();
    const router = new CliModelRouter();

    const workerClient = router.getClient();
    const plannerClient = router.getClient('planner');
    const defaultClient = router.getClient('');

    expect(workerClient.model).toBe('fast-model');
    expect(plannerClient.model).toBe('advanced-model');
    expect(defaultClient.model).toBe('normal-model');
    expect(router.getClient('worker')).toBe(workerClient);
  });

  it('throws when requested tier config is missing', async () => {
    const config = {
      default: 'missing',
      models: {},
    };

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(config));

    const { CliModelRouter } = await loadModule();
    const router = new CliModelRouter();

    expect(() => router.getClient('worker')).toThrow('未找到模型配置: missing');
  });

  it('getAvailableModels filters apiKey and supports empty config', async () => {
    const config = {
      default: 'normal',
      models: {
        normal: { apiKey: 'k1', baseUrl: 'https://n', model: 'normal' },
        empty: { apiKey: '' },
        none: {},
      },
    };

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(config));

    const { CliModelRouter } = await loadModule();
    const router = new CliModelRouter();

    expect(router.getAvailableModels()).toEqual(['normal']);

    mockedFs.existsSync.mockReturnValue(false);
    const routerNoConfig = new CliModelRouter();
    expect(routerNoConfig.getAvailableModels()).toEqual([]);
  });

  it('getAvailableModels honors env overrides', async () => {
    process.env.OPENAI_API_KEY = 'env-key';
    process.env.OPENAI_MODEL = 'env-model';

    const { CliModelRouter } = await loadModule();
    const router = new CliModelRouter();

    expect(router.getAvailableModels()).toEqual(['env:env-model']);
  });

  it('getTierMapping returns tiers or empty object', async () => {
    const config = {
      default: 'normal',
      tiers: { fast: ['worker'] },
      models: { normal: { apiKey: 'k', baseUrl: 'https://n', model: 'm' } },
    };

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(config));

    const { CliModelRouter } = await loadModule();
    const router = new CliModelRouter();

    expect(router.getTierMapping()).toEqual({ fast: ['worker'] });

    mockedFs.existsSync.mockReturnValue(false);
    const routerNoConfig = new CliModelRouter();
    expect(routerNoConfig.getTierMapping()).toEqual({});
  });

  it('loads large config files without failing', async () => {
    const largeNote = 'x'.repeat(100000);
    const config = {
      default: 'normal',
      models: {
        normal: { apiKey: 'k1', baseUrl: 'https://n', model: 'normal', note: largeNote },
      },
    };

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(config));

    const { CliModelRouter } = await loadModule();
    const router = new CliModelRouter();

    expect(router.getAvailableModels()).toEqual(['normal']);
  });
});

describe('CliModelClient', () => {
  it('trims baseUrl and applies defaults', async () => {
    const { CliModelClient } = await loadModule();
    const client = new CliModelClient({ apiKey: 'k', baseUrl: 'https://api.example.com/v1/' });

    expect(client.baseUrl).toBe('https://api.example.com/v1');
    expect(client.model).toBe('deepseek-chat');
  });

  it('throws when apiKey is missing', async () => {
    const { CliModelClient } = await loadModule();
    const client = new CliModelClient();

    await expect(client.chat({ messages: [] })).rejects.toThrow('API Key 未设置');
  });

  it('handles null and empty option objects', async () => {
    fetchMock
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          jsonData: { choices: [{ message: { content: 'one' } }], model: 'm', usage: {} },
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          jsonData: { choices: [{ message: { content: 'two' } }], model: 'm', usage: {} },
        }),
      );

    const { CliModelClient } = await loadModule();
    const client = new CliModelClient({ apiKey: 'k' });

    await expect(client.chat(null)).resolves.toMatchObject({ content: 'one' });
    await expect(client.chat({})).resolves.toMatchObject({ content: 'two' });

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(bodies[0].messages).toBeUndefined();
    expect(bodies[1].messages).toBeUndefined();
  });

  it('sends requests with defaults and parses responses', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        ok: true,
        jsonData: {
          choices: [{ message: { content: 'hello' } }],
          model: 'm1',
          usage: { total_tokens: 10 },
        },
      }),
    );

    const { CliModelClient } = await loadModule();
    const client = new CliModelClient({
      apiKey: 'k',
      baseUrl: 'https://api.example.com/v1/',
      model: 'm1',
      maxOutputTokens: 128,
    });

    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }], temperature: 0.2 });

    expect(result).toEqual({
      content: 'hello',
      model: 'm1',
      usage: { total_tokens: 10 },
    });

    expect(mockedOverflow.executeWithOverflowRecovery).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        initialMaxTokens: 128,
        minTokens: 256,
        bufferTokens: 128,
        maxRetries: 2,
      }),
    );

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);

    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(body).toMatchObject({
      model: 'm1',
      temperature: 0.2,
      max_tokens: 128,
    });
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(init.signal).toBeTruthy();
    expect(typeof init.signal.aborted).toBe('boolean');
  });

  it('handles error responses with json payloads', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        ok: false,
        status: 429,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'retry-after': '10',
        },
        jsonData: { error: { message: 'Rate limit exceeded' } },
      }),
    );

    const { CliModelClient } = await loadModule();
    const client = new CliModelClient({ apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm' });

    let error;
    try {
      await client.chat({ messages: [] });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Rate limit exceeded');
    expect(error.message).toContain('/chat/completions');
    expect(error.status).toBe(429);
    expect(error.data).toEqual({ error: { message: 'Rate limit exceeded' } });
    expect(error.retryAfter).toBe('10');
  });

  it('honors string timeoutMs and ignores string maxTokens', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        ok: true,
        jsonData: { choices: [{ message: { content: 'ok' } }], model: 'm', usage: {} },
      }),
    );

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { CliModelClient } = await loadModule();
    const client = new CliModelClient({ apiKey: 'k', maxOutputTokens: 100 });

    await client.chat({ messages: [], maxTokens: '256', timeoutMs: '1200' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(100);
    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 1200)).toBe(true);
  });

  it('falls back to default timeout for 0 and -1', async () => {
    fetchMock
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          jsonData: { choices: [{ message: { content: 'one' } }], model: 'm', usage: {} },
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          jsonData: { choices: [{ message: { content: 'two' } }], model: 'm', usage: {} },
        }),
      );

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { CliModelClient } = await loadModule();
    const client = new CliModelClient({ apiKey: 'k' });

    await client.chat({ messages: [], timeoutMs: 0 });
    await client.chat({ messages: [], timeoutMs: -1 });

    const timeoutValues = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(timeoutValues.filter((value) => value === 60000)).toHaveLength(2);
  });

  it('passes through non-array messages and preserves MAX_SAFE_INTEGER context', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        ok: true,
        jsonData: { choices: [{ message: { content: 'ok' } }], model: 'm', usage: {} },
      }),
    );

    const { CliModelClient } = await loadModule();
    const client = new CliModelClient({ apiKey: 'k', contextWindow: Number.MAX_SAFE_INTEGER });
    const messages = { role: 'user', content: '' };

    await client.chat({ messages, maxTokens: 1 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toEqual(messages);
  });

  it('builds ask messages with empty prompt and whitespace system prompt', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        ok: true,
        jsonData: { choices: [{ message: { content: 'answer' } }], model: 'm', usage: {} },
      }),
    );

    const { CliModelClient } = await loadModule();
    const client = new CliModelClient({ apiKey: 'k' });

    const result = await client.ask('', '   ');

    expect(result).toBe('answer');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toEqual([
      { role: 'system', content: '   ' },
      { role: 'user', content: '' },
    ]);
  });

  it('truncates tool-call sequences when over budget', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        ok: true,
        jsonData: { choices: [{ message: { content: 'ok' } }], model: 'm', usage: {} },
      }),
    );

    const { CliModelClient } = await loadModule();
    const client = new CliModelClient({
      apiKey: 'k',
      contextWindow: 600,
      maxOutputTokens: 50,
    });

    const longText = 'x'.repeat(200);
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: longText, tool_calls: [{ id: 'call1' }] },
      { role: 'tool', tool_call_id: 'call1', content: longText },
      { role: 'user', content: 'short-user' },
      { role: 'assistant', content: 'final' },
    ];

    await client.chat({ messages });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const roles = body.messages.map((msg) => msg.role);
    expect(roles).toEqual(['system', 'user', 'assistant']);
    expect(body.messages.some((msg) => msg.role === 'tool')).toBe(false);
  });

  it('removes orphan tool outputs while keeping referenced ones', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        ok: true,
        jsonData: { choices: [{ message: { content: 'ok' } }], model: 'm', usage: {} },
      }),
    );

    const { CliModelClient } = await loadModule();
    const client = new CliModelClient({
      apiKey: 'k',
      contextWindow: 600,
      maxOutputTokens: 50,
    });

    const messages = [
      { role: 'system', content: 's' },
      { role: 'assistant', content: 'a', tool_calls: [{ id: 'call1' }] },
      { role: 'tool', tool_call_id: 'call1', content: 'ok' },
      { role: 'assistant', content: 'done' },
      { role: 'tool', tool_call_id: 'call2', content: 'orphan' },
    ];

    await client.chat({ messages });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const toolIds = body.messages
      .filter((msg) => msg.role === 'tool')
      .map((msg) => msg.tool_call_id || msg.toolCallId || msg.call_id || msg.callId);

    expect(toolIds).toEqual(['call1']);
  });

  it('handles deep nested content', async () => {
    fetchMock.mockResolvedValue(
      makeResponse({
        ok: true,
        jsonData: { choices: [{ message: { content: 'nested' } }], model: 'm', usage: {} },
      }),
    );

    const { CliModelClient } = await loadModule();
    const client = new CliModelClient({ apiKey: 'k', contextWindow: 600, maxOutputTokens: 50 });

    const deep = makeDeepNested(20);
    await client.chat({ messages: [{ role: 'user', content: deep }] });

    const calledWithNested = mockedShared.estimateTokensCached.mock.calls.some((call) =>
      String(call[0]).includes('level_0'),
    );

    expect(calledWithNested).toBe(true);
  });

  it('rejects circular message content while still estimating tokens', async () => {
    const { CliModelClient } = await loadModule();
    const client = new CliModelClient({ apiKey: 'k', contextWindow: 600, maxOutputTokens: 50 });

    const circular = {};
    circular.self = circular;

    await expect(client.chat({ messages: [{ role: 'user', content: circular }] })).rejects.toBeInstanceOf(TypeError);

    const calledWithCircular = mockedShared.estimateTokensCached.mock.calls.some((call) => call[0] === '[object Object]');
    expect(calledWithCircular).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('supports concurrent chat calls', async () => {
    fetchMock
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          jsonData: { choices: [{ message: { content: 'one' } }], model: 'm', usage: {} },
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          jsonData: { choices: [{ message: { content: 'two' } }], model: 'm', usage: {} },
        }),
      );

    const { CliModelClient } = await loadModule();
    const client = new CliModelClient({ apiKey: 'k' });

    const [first, second] = await Promise.all([
      client.chat({ messages: [{ role: 'user', content: 'first' }] }),
      client.chat({ messages: [{ role: 'user', content: 'second' }] }),
    ]);

    expect(first.content).toBe('one');
    expect(second.content).toBe('two');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const sent = fetchMock.mock.calls
      .map((call) => JSON.parse(call[1].body))
      .map((body) => body.messages[0].content)
      .sort();
    expect(sent).toEqual(['first', 'second']);
  });
});

describe('createAiApiServiceAdapter', () => {
  it('routes chat to router client and maps models', async () => {
    const client = { chat: vi.fn(async () => ({ content: 'ok', model: 'm', usage: {} })) };
    const router = {
      getClient: vi.fn(() => client),
      getAvailableModels: vi.fn(() => ['fast', 'normal']),
    };

    const { createAiApiServiceAdapter } = await loadModule();
    const adapter = createAiApiServiceAdapter(router);

    const result = await adapter.chat({ messages: [], usage: '' });

    expect(router.getClient).toHaveBeenCalledWith('worker');
    expect(client.chat).toHaveBeenCalledWith({ messages: [], usage: '' });
    expect(result).toEqual({ content: 'ok', model: 'm', usage: {} });

    expect(adapter.getAvailableModels()).toEqual([
      { id: 'fast', name: 'fast', type: 'cli' },
      { id: 'normal', name: 'normal', type: 'cli' },
    ]);
  });

  it('returns empty model list when router has none', async () => {
    const router = {
      getClient: vi.fn(() => ({ chat: vi.fn() })),
      getAvailableModels: vi.fn(() => []),
    };

    const { createAiApiServiceAdapter } = await loadModule();
    const adapter = createAiApiServiceAdapter(router);

    expect(adapter.getAvailableModels()).toEqual([]);
  });
});
