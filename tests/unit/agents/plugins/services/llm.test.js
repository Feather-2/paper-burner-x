import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Kernel } from '../../../../../js/agents/core/index.js';
import llmPlugin from '../../../../../js/agents/plugins/services/llm.js';

let createProviderImpl = null;

vi.mock(
  '/js/agents/llm/index.js',
  () => ({
    createProvider: (...args) => {
      if (typeof createProviderImpl !== 'function') {
        throw new Error('createProviderImpl not set');
      }
      return createProviderImpl(...args);
    },
  }),
  { virtual: true }
);

async function createKernel(options = {}) {
  return new Kernel({
    enableRetry: false,
    enableTimeout: false,
    keepHistory: true,
    keepLog: true,
    ...options,
  });
}

function createDeepObject(depth) {
  let current = { level: depth };
  for (let i = depth - 1; i >= 0; i -= 1) {
    current = { level: i, child: current };
  }
  return current;
}

async function setupKernel(pluginConfig = {}) {
  const kernel = await createKernel();
  await kernel.use(llmPlugin, pluginConfig);
  await kernel.start();
  return kernel;
}

async function cleanupKernel(kernel) {
  if (kernel) {
    await kernel.stop().catch(() => {});
  }
  vi.restoreAllMocks();
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  createProviderImpl = null;
});

describe('service/llm plugin', () => {
  it('registers llm service, merges config, updates tokens, emits events, and exposes config/stats', async () => {
    let callIndex = 0;
    const provider = {
      chat: vi.fn(async (_messages, options) => {
        callIndex += 1;
        const usage = callIndex === 1
          ? { input_tokens: 2, output_tokens: 3 }
          : { input_tokens: 1, output_tokens: 4 };
        return { model: options.model, usage };
      }),
      stream: vi.fn(async () => 'stream-ok'),
    };

    createProviderImpl = vi.fn(async (config) => ({ ...provider, _createdWith: config }));

    const kernel = await setupKernel({ provider: 'mock', model: 'unit-test', maxTokens: 123, temperature: 0.9 });

    try {
      kernel.state.set('runtime.tokens', { input: 5, output: 6 });

      const events = [];
      kernel.events.on('llm.response', (evt) => events.push(evt.payload));

      const messages = [{ role: 'user', content: 'hi' }];

      const result1 = await kernel.services.call('llm', 'chat', [messages, { temperature: 0.1, extra: true }]);
      const result2 = await kernel.services.call('llm', 'chat', [messages, { temperature: 0.2 }]);

      expect(createProviderImpl).toHaveBeenCalledTimes(1);
      expect(createProviderImpl).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'mock', model: 'unit-test', maxTokens: 123, temperature: 0.9 })
      );

      expect(provider.chat).toHaveBeenCalledTimes(2);
      expect(provider.chat.mock.calls[0][0]).toBe(messages);
      expect(provider.chat.mock.calls[0][1]).toEqual(expect.objectContaining({
        provider: 'mock',
        model: 'unit-test',
        maxTokens: 123,
        temperature: 0.1,
        extra: true,
      }));
      expect(provider.chat.mock.calls[1][1]).toEqual(expect.objectContaining({
        provider: 'mock',
        model: 'unit-test',
        maxTokens: 123,
        temperature: 0.2,
      }));

      expect(result1).toEqual(expect.objectContaining({ model: 'unit-test', usage: { input_tokens: 2, output_tokens: 3 } }));
      expect(result2).toEqual(expect.objectContaining({ model: 'unit-test', usage: { input_tokens: 1, output_tokens: 4 } }));

      expect(kernel.state.get('plugins.service/llm.tokens')).toEqual({ input: 6, output: 10 });

      expect(events).toEqual([
        { model: 'unit-test', tokens: { input_tokens: 2, output_tokens: 3 } },
        { model: 'unit-test', tokens: { input_tokens: 1, output_tokens: 4 } },
      ]);

      const streamResult = await kernel.services.call('llm', 'stream', [messages, { temperature: 0.3 }]);
      expect(streamResult).toBe('stream-ok');
      expect(provider.stream).toHaveBeenCalledWith(messages, expect.objectContaining({ temperature: 0.3 }));

      const config1 = await kernel.services.call('llm', 'getConfig', []);
      const config2 = await kernel.services.call('llm', 'getConfig', []);
      expect(config1).toEqual(expect.objectContaining({ provider: 'mock', model: 'unit-test', maxTokens: 123, temperature: 0.9 }));
      expect(config2).toEqual(config1);
      expect(config2).not.toBe(config1);

      const stats = await kernel.services.call('llm', 'getStats', []);
      expect(stats).toEqual(expect.objectContaining({ tokens: { input: 6, output: 10 } }));
    } finally {
      await cleanupKernel(kernel);
    }
  });

  it('passes through boundary inputs, types, and resource-sized payloads', async () => {
    const chatCalls = [];
    const streamCalls = [];
    const provider = {
      chat: vi.fn(async (messages, options) => {
        chatCalls.push({ messages, options });
        return { model: options.model, usage: { input_tokens: 0, output_tokens: 0 } };
      }),
      stream: vi.fn(async (messages, options) => {
        streamCalls.push({ messages, options });
        return { type: 'done' };
      }),
    };

    createProviderImpl = vi.fn(async () => provider);

    const kernel = await setupKernel({ model: 'edge-model' });

    try {
      const deepNested = createDeepObject(12);
      const longText = 'x'.repeat(50000);
      const largeFile = 'FILE:' + 'y'.repeat(60000);

      await kernel.services.call('llm', 'chat', [null, null]);
      await kernel.services.call('llm', 'chat', [undefined, undefined]);
      await kernel.services.call('llm', 'chat', [[], {}]);
      await kernel.services.call('llm', 'chat', [
        { role: 'user', content: 'object-not-array' },
        { maxTokens: '100', temperature: '0.5', system: '   ', tool_choice: '', tools: [deepNested] },
      ]);
      await kernel.services.call('llm', 'chat', [[
        { role: 'user', content: '' },
        { role: 'user', content: '   ' },
        { role: 'assistant', content: longText },
        { role: 'user', content: largeFile },
      ], { maxTokens: Number.MAX_SAFE_INTEGER, temperature: -1 }]);

      const streamResult = await kernel.services.call('llm', 'stream', [[], { maxTokens: 0 }]);

      expect(streamResult).toEqual({ type: 'done' });
      expect(chatCalls).toHaveLength(5);

      expect(chatCalls[0].messages).toBeNull();
      expect(chatCalls[0].options).toEqual(expect.objectContaining({ model: 'edge-model' }));

      expect(chatCalls[1].messages).toBeUndefined();
      expect(chatCalls[1].options).toEqual(expect.objectContaining({ model: 'edge-model' }));

      expect(chatCalls[2].messages).toEqual([]);
      expect(chatCalls[2].options).toEqual(expect.objectContaining({ model: 'edge-model' }));

      expect(chatCalls[3].messages).toEqual({ role: 'user', content: 'object-not-array' });
      expect(chatCalls[3].options).toEqual(expect.objectContaining({
        maxTokens: '100',
        temperature: '0.5',
        system: '   ',
        tool_choice: '',
      }));
      expect(chatCalls[3].options.tools[0]).toBe(deepNested);

      expect(chatCalls[4].messages[0].content).toBe('');
      expect(chatCalls[4].messages[1].content).toBe('   ');
      expect(chatCalls[4].messages[2].content.length).toBe(longText.length);
      expect(chatCalls[4].messages[3].content.length).toBe(largeFile.length);
      expect(chatCalls[4].options.maxTokens).toBe(Number.MAX_SAFE_INTEGER);
      expect(chatCalls[4].options.temperature).toBe(-1);

      expect(streamCalls).toHaveLength(1);
      expect(streamCalls[0].messages).toEqual([]);
      expect(streamCalls[0].options.maxTokens).toBe(0);
    } finally {
      await cleanupKernel(kernel);
    }
  });

  it('returns empty stats before usage and skips token updates when usage is missing', async () => {
    const provider = {
      chat: vi.fn(async () => ({ model: 'unit-test-no-usage' })),
      stream: vi.fn(async () => 'stream-ok'),
    };

    createProviderImpl = vi.fn(async () => provider);

    const kernel = await setupKernel({ model: 'unit-test-no-usage' });

    try {
      await expect(kernel.services.call('llm', 'getStats', [])).resolves.toEqual({});

      const events = [];
      kernel.events.on('llm.response', (evt) => events.push(evt.payload));

      const messages = [{ role: 'user', content: 'hello' }];
      await kernel.services.call('llm', 'chat', [messages]);

      expect(kernel.state.get('plugins.service/llm.tokens')).toBeUndefined();
      expect(events).toEqual([{ model: 'unit-test-no-usage', tokens: undefined }]);
    } finally {
      await cleanupKernel(kernel);
    }
  });

  it('falls back to default runtime tokens when global tokens are missing', async () => {
    const provider = {
      chat: vi.fn(async () => ({
        model: 'unit-test-zero-tokens',
        usage: { input_tokens: 0, output_tokens: 0 },
      })),
      stream: vi.fn(async () => 'stream-ok'),
    };

    createProviderImpl = vi.fn(async () => provider);

    const kernel = await setupKernel({ model: 'unit-test-zero-tokens' });

    try {
      kernel.state.set('runtime.tokens', null);

      const messages = [{ role: 'user', content: 'hello' }];
      await kernel.services.call('llm', 'chat', [messages]);

      expect(kernel.state.get('plugins.service/llm.tokens')).toEqual({ input: 0, output: 0 });
    } finally {
      await cleanupKernel(kernel);
    }
  });

  it('wraps provider creation errors with a descriptive message', async () => {
    createProviderImpl = vi.fn(() => {
      throw new Error('boom');
    });

    const kernel = await setupKernel();

    try {
      const messages = [{ role: 'user', content: 'hi' }];
      await expect(kernel.services.call('llm', 'chat', [messages, {}]))
        .rejects.toThrow('Failed to load LLM provider: boom');
    } finally {
      await cleanupKernel(kernel);
    }
  });

  it('propagates provider chat errors without emitting events or updating tokens', async () => {
    const provider = {
      chat: vi.fn(async () => {
        throw new Error('chat-fail');
      }),
      stream: vi.fn(async () => 'stream-ok'),
    };

    createProviderImpl = vi.fn(async () => provider);

    const kernel = await setupKernel();

    try {
      const events = [];
      kernel.events.on('llm.response', (evt) => events.push(evt.payload));

      const messages = [{ role: 'user', content: 'hi' }];
      await expect(kernel.services.call('llm', 'chat', [messages, {}]))
        .rejects.toThrow('chat-fail');

      expect(events).toEqual([]);
      expect(kernel.state.get('plugins.service/llm.tokens')).toBeUndefined();
    } finally {
      await cleanupKernel(kernel);
    }
  });

  it('supports concurrent calls after provider is cached and rapid sequential calls', async () => {
    const provider = {
      chat: vi.fn(async (_messages, options) => ({
        model: options.model,
        usage: { input_tokens: 1, output_tokens: 1 },
      })),
      stream: vi.fn(async () => 'stream-ok'),
    };

    createProviderImpl = vi.fn(async () => provider);

    const kernel = await setupKernel({ model: 'concurrent-model' });

    try {
      const messages = [{ role: 'user', content: 'hi' }];

      await kernel.services.call('llm', 'chat', [messages, { temperature: 0 }]);

      const [chatResult, streamResult] = await Promise.all([
        kernel.services.call('llm', 'chat', [messages, { temperature: 0.1 }]),
        kernel.services.call('llm', 'stream', [messages, { temperature: 0.2 }]),
      ]);

      expect(chatResult).toEqual(expect.objectContaining({ model: 'concurrent-model' }));
      expect(streamResult).toBe('stream-ok');

      await kernel.services.call('llm', 'chat', [messages, { temperature: 0.3 }]);

      expect(createProviderImpl).toHaveBeenCalledTimes(1);
      expect(provider.chat).toHaveBeenCalledTimes(3);
      expect(provider.stream).toHaveBeenCalledTimes(1);
    } finally {
      await cleanupKernel(kernel);
    }
  });
});
