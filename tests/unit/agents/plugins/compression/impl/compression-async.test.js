import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const loggerState = vi.hoisted(() => ({ warn: vi.fn() }));
const nodeLikeState = vi.hoisted(() => ({ value: false }));
const workerRpcState = vi.hoisted(() => ({
  instances: [],
  shouldThrow: false,
  callImpl: null,
  terminateImpl: null,
}));

vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  createLogger: () => loggerState,
  isNodeLike: () => nodeLikeState.value,
}));

vi.mock('../../../../../../js/agents/runtime/core/worker-rpc.js', () => {
  class MockWorkerRpcClient {
    constructor(options) {
      if (workerRpcState.shouldThrow) {
        throw new Error('init failed');
      }
      this.options = options;
      this.call = vi.fn((method, params, runtime) => {
        if (workerRpcState.callImpl) {
          return workerRpcState.callImpl(method, params, runtime);
        }
        return Promise.resolve({
          messages: params?.messages ?? [],
          sessionSummary: null,
          stats: { fromWorker: true },
          afterTokens: 0,
        });
      });
      this.terminate = vi.fn((reason) => {
        if (workerRpcState.terminateImpl) {
          return workerRpcState.terminateImpl(reason);
        }
        return undefined;
      });
      workerRpcState.instances.push(this);
    }
  }

  return { WorkerRpcClient: MockWorkerRpcClient };
});

const modulePath = '../../../../../../js/agents/plugins/compression/impl/compression-async.js';

const loadModule = async () => import(modulePath);

const enableWorkerEnv = () => {
  vi.stubGlobal('Worker', class MockWorker {});
  vi.stubGlobal(
    'URL',
    class MockURL {
      constructor(path, base) {
        this.href = String(path);
        this.base = base;
      }
    }
  );
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  nodeLikeState.value = false;
  workerRpcState.instances = [];
  workerRpcState.shouldThrow = false;
  workerRpcState.callImpl = null;
  workerRpcState.terminateImpl = null;
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isCompressionWorkerAvailable', () => {
  it('returns false when running in node-like environment', async () => {
    nodeLikeState.value = true;
    enableWorkerEnv();
    const { isCompressionWorkerAvailable } = await loadModule();

    expect(isCompressionWorkerAvailable()).toBe(false);
  });

  it('returns false when Worker or URL is missing', async () => {
    nodeLikeState.value = false;
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('URL', undefined);

    const { isCompressionWorkerAvailable } = await loadModule();

    expect(isCompressionWorkerAvailable()).toBe(false);
  });

  it('returns true when Worker and URL are available', async () => {
    nodeLikeState.value = false;
    enableWorkerEnv();
    const { isCompressionWorkerAvailable } = await loadModule();

    expect(isCompressionWorkerAvailable()).toBe(true);
  });
});

describe('terminateCompressionWorker', () => {
  it('is a no-op when no worker exists', async () => {
    const { terminateCompressionWorker } = await loadModule();

    expect(() => {
      terminateCompressionWorker();
      terminateCompressionWorker();
    }).not.toThrow();
    expect(loggerState.warn).not.toHaveBeenCalled();
  });

  it('handles terminate errors and clears cached rpc', async () => {
    nodeLikeState.value = false;
    enableWorkerEnv();

    const { compressSessionHistoryAsync, terminateCompressionWorker } = await loadModule();

    workerRpcState.callImpl = vi.fn(async () => ({
      messages: [{ role: 'user', content: 'ok' }],
      sessionSummary: null,
      stats: { ok: true },
      afterTokens: 1,
    }));

    await compressSessionHistoryAsync(
      [{ role: 'user', content: 'hi' }],
      {},
      { useWorker: true, workerThresholdMessages: 1 }
    );

    workerRpcState.terminateImpl = () => {
      throw new Error('boom');
    };

    terminateCompressionWorker();

    expect(workerRpcState.instances).toHaveLength(1);
    expect(workerRpcState.instances[0].terminate).toHaveBeenCalledWith('cleanup');
    expect(loggerState.warn).toHaveBeenCalled();

    terminateCompressionWorker();
    expect(workerRpcState.instances[0].terminate).toHaveBeenCalledTimes(1);
  });
});

describe('compressSessionHistorySync', () => {
  it('normalizes empty-like entries and keeps stats consistent', async () => {
    const { compressSessionHistorySync } = await loadModule();

    const messages = [
      null,
      undefined,
      '',
      {},
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'There' },
    ];

    const result = compressSessionHistorySync(messages, { keepLastTurns: 2 });

    expect(result.stats.totalMessages).toBe(messages.length);
    expect(result.messages.every((msg) => msg && typeof msg.content === 'string')).toBe(true);
    expect(result.afterTokens).toBeTypeOf('number');
  });

  it('summarizes all when keepLastTurns is 0 or -1 and ignores whitespace summary', async () => {
    const { compressSessionHistorySync } = await loadModule();

    const messages = [
      { role: 'system', content: 'System anchor' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'World' },
    ];

    const zeroKeep = compressSessionHistorySync(messages, { keepLastTurns: 0, sessionSummary: '   ' });
    expect(zeroKeep.messages).toHaveLength(1);
    expect(zeroKeep.messages[0].role).toBe('system');
    expect(zeroKeep.sessionSummary).toContain('user:');
    expect(zeroKeep.sessionSummary).toContain('assistant:');

    const negativeKeep = compressSessionHistorySync(messages, { keepLastTurns: -1 });
    expect(negativeKeep.messages).toHaveLength(1);
    expect(negativeKeep.stats.summarizedMessages).toBe(2);
  });

  it('keeps all messages with MAX_SAFE_INTEGER and removes thinking messages', async () => {
    const { compressSessionHistorySync } = await loadModule();

    const messages = [
      { role: 'user', content: 'One' },
      { role: 'assistant', content: 'Hidden', thinking: true },
      { role: 'assistant', content: 'Two' },
    ];

    const result = compressSessionHistorySync(messages, { keepLastTurns: Number.MAX_SAFE_INTEGER });

    expect(result.sessionSummary).toBe(null);
    expect(result.stats.summarizedMessages).toBe(0);
    expect(result.stats.removedThinking).toBe(1);
    expect(result.messages).toHaveLength(2);
  });

  it('merges safe messages but skips merge with deep nested metadata', async () => {
    const { compressSessionHistorySync } = await loadModule();

    const messages = [
      { role: 'user', content: 'A' },
      { role: 'user', content: 'B' },
      { role: 'user', content: 'C', meta: { deep: { level: { value: 1 } } } },
      { role: 'assistant', content: 'Reply' },
    ];

    const result = compressSessionHistorySync(messages, { keepLastTurns: 10 });

    const userMessages = result.messages.filter((msg) => msg.role === 'user');
    expect(result.stats.mergedMessages).toBe(1);
    expect(userMessages).toHaveLength(2);
    expect(userMessages[0].content).toContain('A');
    expect(userMessages[0].content).toContain('B');
    expect(userMessages[1].content).toBe('C');
  });

  it('builds title-only summaries with CJK content and truncation', async () => {
    const { compressSessionHistorySync } = await loadModule();

    const messages = [
      { role: 'user', content: '你好世界这是一个很长的标题' },
      { role: 'assistant', content: 'OK' },
    ];

    const result = compressSessionHistorySync(messages, {
      keepLastTurns: 0,
      titleOnly: true,
      titleMaxChars: 10,
    });

    expect(result.sessionSummary).toContain('user:');
    expect(result.sessionSummary).toContain('...');
  });
});

describe('compressSessionHistoryAsync', () => {
  it('throws when aborted before start', async () => {
    const { compressSessionHistoryAsync } = await loadModule();
    const controller = new AbortController();
    controller.abort();

    await expect(
      compressSessionHistoryAsync([{ role: 'user', content: 'x' }], {}, { signal: controller.signal })
    ).rejects.toThrow(/aborted/i);
  });

  it('throws TypeError for non-array messages', async () => {
    const { compressSessionHistoryAsync } = await loadModule();

    await expect(compressSessionHistoryAsync({})).rejects.toThrow(TypeError);
  });

  it('uses sync when worker threshold is invalid (0)', async () => {
    nodeLikeState.value = false;
    enableWorkerEnv();

    const { compressSessionHistoryAsync } = await loadModule();

    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'World' },
    ];

    const result = await compressSessionHistoryAsync(messages, {}, { useWorker: true, workerThresholdMessages: 0 });

    expect(workerRpcState.instances).toHaveLength(1);
    expect(workerRpcState.instances[0].call).not.toHaveBeenCalled();
    expect(result.stats.totalMessages).toBe(messages.length);
  });

  it('uses worker when available and returns rpc result', async () => {
    nodeLikeState.value = false;
    enableWorkerEnv();

    workerRpcState.callImpl = vi.fn(async (method, params) => {
      expect(method).toBe('compress');
      expect(params.options.keepLastTurns).toBe(1);
      return {
        messages: [{ role: 'assistant', content: 'from worker' }],
        sessionSummary: 'worker summary',
        stats: { fromWorker: true },
        afterTokens: 42,
      };
    });

    const { compressSessionHistoryAsync } = await loadModule();

    const result = await compressSessionHistoryAsync(
      [{ role: 'user', content: 'hello' }],
      { keepLastTurns: 1 },
      { useWorker: true, workerThresholdMessages: 1 }
    );

    expect(workerRpcState.instances).toHaveLength(1);
    expect(workerRpcState.callImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      messages: [{ role: 'assistant', content: 'from worker' }],
      sessionSummary: 'worker summary',
      stats: { fromWorker: true },
      afterTokens: 42,
    });
  });

  it('falls back to sync when rpc call fails', async () => {
    nodeLikeState.value = false;
    enableWorkerEnv();
    workerRpcState.callImpl = vi.fn(() => {
      throw new Error('rpc failed');
    });

    const { compressSessionHistoryAsync } = await loadModule();

    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'World' },
    ];

    const result = await compressSessionHistoryAsync(messages, { keepLastTurns: 1 }, { useWorker: true, workerThresholdMessages: 1 });

    expect(workerRpcState.instances).toHaveLength(1);
    expect(loggerState.warn).toHaveBeenCalled();
    expect(result.stats.totalMessages).toBe(messages.length);
  });

  it('falls back to sync when worker initialization fails', async () => {
    nodeLikeState.value = false;
    enableWorkerEnv();
    workerRpcState.shouldThrow = true;

    const { compressSessionHistoryAsync } = await loadModule();

    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'World' },
    ];

    const result = await compressSessionHistoryAsync(messages, {}, { useWorker: true, workerThresholdMessages: 1 });

    expect(workerRpcState.instances).toHaveLength(0);
    expect(loggerState.warn).toHaveBeenCalled();
    expect(result.stats.totalMessages).toBe(messages.length);
  });

  it('supports concurrent worker calls', async () => {
    nodeLikeState.value = false;
    enableWorkerEnv();

    workerRpcState.callImpl = vi.fn(async (method, params) => ({
      messages: params.messages,
      sessionSummary: `summary:${params.messages.length}`,
      stats: { fromWorker: true },
      afterTokens: params.messages.length,
    }));

    const { compressSessionHistoryAsync } = await loadModule();

    const [first, second] = await Promise.all([
      compressSessionHistoryAsync([{ role: 'user', content: 'a' }], {}, { useWorker: true, workerThresholdMessages: 1 }),
      compressSessionHistoryAsync(
        [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
        {},
        { useWorker: true, workerThresholdMessages: 1 }
      ),
    ]);

    expect(workerRpcState.instances).toHaveLength(1);
    expect(workerRpcState.callImpl).toHaveBeenCalledTimes(2);
    expect(first.sessionSummary).toBe('summary:1');
    expect(second.sessionSummary).toBe('summary:2');
  });

  it('handles rapid consecutive calls without shared state', async () => {
    const { compressSessionHistoryAsync } = await loadModule();

    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'World' },
    ];

    const first = await compressSessionHistoryAsync(messages, { keepLastTurns: 1 }, { useWorker: false });
    const second = await compressSessionHistoryAsync(messages, { keepLastTurns: 2 }, { useWorker: false });

    expect(first.stats.totalMessages).toBe(messages.length);
    expect(second.stats.totalMessages).toBe(messages.length);
    expect(first.messages.length).not.toBe(0);
    expect(second.messages.length).not.toBe(0);
  });
});

describe('compressAgentLoopMessagesAsync', () => {
  it('handles null/undefined/empty inputs without throwing', async () => {
    const { compressAgentLoopMessagesAsync } = await loadModule();

    const results = await Promise.all([
      compressAgentLoopMessagesAsync(null),
      compressAgentLoopMessagesAsync(undefined),
      compressAgentLoopMessagesAsync({}),
      compressAgentLoopMessagesAsync([]),
    ]);

    for (const result of results) {
      expect(result.messages).toEqual([]);
      expect(result.sessionSummary).toBe(null);
      expect(result.stats).toBeTypeOf('object');
    }
  });

  it('appends summary at the end and preserves prior summary content', async () => {
    const { compressAgentLoopMessagesAsync } = await loadModule();

    const messages = [
      { role: 'system', content: '[Context Summary]\nPrior summary' },
      { role: 'user', content: 'Question one' },
      { role: 'assistant', content: 'Answer one' },
      { role: 'user', content: 'Question two' },
    ];

    const result = await compressAgentLoopMessagesAsync(
      messages,
      { keepLastTurns: 1, summaryLineChars: 200 },
      { useWorker: false }
    );

    const summaryMessages = result.messages.filter(
      (msg) => msg.role === 'system' && msg.content.startsWith('[Context Summary]')
    );

    expect(summaryMessages).toHaveLength(1);
    expect(result.messages[result.messages.length - 1]).toEqual(summaryMessages[0]);
    expect(summaryMessages[0].content).toContain('Prior summary');
    expect(summaryMessages[0].content).toContain('user: Question one');
  });

  it('sanitizes large kept messages and strips persistedOutput preview', async () => {
    const { compressAgentLoopMessagesAsync } = await loadModule();

    const longPreview = 'P'.repeat(3000);
    const longTail = 'T'.repeat(2000);
    const raw = `{\"persistedOutput\":{\"preview\":\"${longPreview}\"},\"other\":\"${longTail}\"}\nSecond line ${'X'.repeat(2000)}`;

    const messages = [
      { role: 'system', content: 'System message with \"persistedOutput\":{\"preview\":\"keep\"}' },
      { role: 'user', content: raw },
    ];

    const result = await compressAgentLoopMessagesAsync(
      messages,
      { keepLastTurns: 2, maxKeptMessageChars: '120' },
      { useWorker: false }
    );

    const userMsg = result.messages.find((msg) => msg.role === 'user');
    const systemMsg = result.messages.find((msg) => msg.role === 'system' && !msg.content.startsWith('[Context Summary]'));

    expect(userMsg.content).toContain('(omitted)');
    expect(userMsg.content).toContain('...(truncated)');
    expect(userMsg.content.length).toBeLessThan(raw.length);
    expect(systemMsg.content).toContain('preview');
  });

  it('skips sanitization when maxKeptMessageChars is 0', async () => {
    const { compressAgentLoopMessagesAsync } = await loadModule();

    const raw = '{\"persistedOutput\":{\"preview\":\"raw-preview\"},\"other\":\"data\"}';

    const result = await compressAgentLoopMessagesAsync(
      [{ role: 'user', content: raw }],
      { keepLastTurns: 1, maxKeptMessageChars: 0 },
      { useWorker: false }
    );

    expect(result.messages[0].content).toContain('\"preview\":\"raw-preview\"');
    expect(result.messages[0].content).not.toContain('(omitted)');
  });

  it('uses prior summary when compression returns empty summary', async () => {
    const { compressAgentLoopMessagesAsync } = await loadModule();

    const messages = [{ role: 'system', content: '[Context Summary]\nOnly summary' }];

    const result = await compressAgentLoopMessagesAsync(messages, {}, { useWorker: false });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toContain('Only summary');
    expect(result.sessionSummary).toBe('Only summary');
  });
});

describe('default export', () => {
  it('exports compressSessionHistoryAsync as default', async () => {
    const mod = await loadModule();

    expect(mod.default).toBe(mod.compressSessionHistoryAsync);
  });
});
