import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Kernel } from '../../../../../js/agents/core/index.js';
import llmPlugin from '../../../../../js/agents/plugins/services/llm.js';

let createProviderImpl = null;

// NOTE: Under Vitest/Vite, this dynamic import resolves to a Vite root-relative id.
// The source file is intentionally absent in some builds; we provide a virtual mock.
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

describe('service/llm plugin', () => {
  /** @type {Kernel | null} */
  let kernel = null;

  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    createProviderImpl = null;
  });

  afterEach(async () => {
    if (kernel) {
      await kernel.stop().catch(() => {});
      kernel = null;
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('registers llm service; chat merges config, updates tokens, emits response; provider is cached', async () => {
    const provider = {
      chat: vi.fn(async (_messages, options) => ({
        model: options.model,
        usage: { input_tokens: 2, output_tokens: 3 },
      })),
      stream: vi.fn(async () => 'stream-ok'),
    };

    const createProvider = vi.fn(async (config) => ({ ...provider, _createdWith: config }));
    createProviderImpl = createProvider;

    kernel = await createKernel();
    await kernel.use(llmPlugin, { provider: 'mock', model: 'unit-test', maxTokens: 123, temperature: 0.9 });
    await kernel.start();

    kernel.state.set('runtime.tokens', { input: 5, output: 6 });

    const llmEvents = [];
    kernel.events.on('llm.response', (evt) => llmEvents.push(evt.payload));

    const messages = [{ role: 'user', content: 'hi' }];
    const result = await kernel.services.call('llm', 'chat', [messages, { temperature: 0.1, extra: true }]);

    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'mock', model: 'unit-test', maxTokens: 123, temperature: 0.9 })
    );

    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(provider.chat).toHaveBeenCalledWith(
      messages,
      expect.objectContaining({
        provider: 'mock',
        model: 'unit-test',
        maxTokens: 123,
        temperature: 0.1, // options override ctx.config
        extra: true,
      })
    );

    expect(result).toEqual(expect.objectContaining({ model: 'unit-test', usage: { input_tokens: 2, output_tokens: 3 } }));

    expect(kernel.state.get('plugins.service/llm.tokens')).toEqual({ input: 7, output: 9 });

    expect(llmEvents).toEqual([{ model: 'unit-test', tokens: { input_tokens: 2, output_tokens: 3 } }]);

    const streamResult = await kernel.services.call('llm', 'stream', [messages, { temperature: 0.2 }]);
    expect(streamResult).toBe('stream-ok');

    // Provider should be created once and reused for subsequent calls.
    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(provider.stream).toHaveBeenCalledTimes(1);

    // getConfig returns a defensive copy.
    const config1 = await kernel.services.call('llm', 'getConfig', []);
    const config2 = await kernel.services.call('llm', 'getConfig', []);
    expect(config1).toEqual(expect.objectContaining({ provider: 'mock', model: 'unit-test', maxTokens: 123, temperature: 0.9 }));
    expect(config2).toEqual(config1);
    expect(config2).not.toBe(config1);

    // getStats reflects scoped plugin state.
    const stats = await kernel.services.call('llm', 'getStats', []);
    expect(stats).toEqual(expect.objectContaining({ tokens: { input: 7, output: 9 } }));
  });

  it('does not update token stats when provider returns no usage', async () => {
    const provider = {
      chat: vi.fn(async () => ({ model: 'unit-test-no-usage' })),
      stream: vi.fn(async () => 'stream-ok'),
    };
    createProviderImpl = vi.fn(async () => provider);

    kernel = await createKernel();
    await kernel.use(llmPlugin, { provider: 'mock', model: 'unit-test-no-usage' });
    await kernel.start();

    const llmEvents = [];
    kernel.events.on('llm.response', (evt) => llmEvents.push(evt.payload));

    const messages = [{ role: 'user', content: 'hello' }];
    await kernel.services.call('llm', 'chat', [messages]);

    expect(kernel.state.get('plugins.service/llm.tokens')).toBeUndefined();
    expect(llmEvents).toEqual([{ model: 'unit-test-no-usage', tokens: undefined }]);

    // Still returns something sensible before any plugin-scoped state exists.
    await expect(kernel.services.call('llm', 'getStats', [])).resolves.toEqual({});
  });

  it('falls back to default runtime token stats and handles zero-usage tokens', async () => {
    const provider = {
      chat: vi.fn(async () => ({
        model: 'unit-test-zero-tokens',
        usage: { input_tokens: 0, output_tokens: 0 },
      })),
      stream: vi.fn(async () => 'stream-ok'),
    };
    createProviderImpl = vi.fn(async () => provider);

    kernel = await createKernel();
    await kernel.use(llmPlugin, { provider: 'mock', model: 'unit-test-zero-tokens' });
    await kernel.start();

    // Force the "no global tokens" branch for coverage (StateBus normally initializes runtime.tokens).
    kernel.state.set('runtime.tokens', null);

    const messages = [{ role: 'user', content: 'hello' }];
    await kernel.services.call('llm', 'chat', [messages]);

    expect(kernel.state.get('plugins.service/llm.tokens')).toEqual({ input: 0, output: 0 });
  });
});
