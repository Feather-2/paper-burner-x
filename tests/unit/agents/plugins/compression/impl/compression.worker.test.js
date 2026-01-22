import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedShared = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
}));

const mockedWorkerRpc = vi.hoisted(() => {
  const captured = { methods: null, handler: null };
  return {
    captured,
    createRpcHandler: vi.fn((methods) => {
      captured.methods = methods;
      captured.handler = vi.fn();
      return captured.handler;
    }),
  };
});

vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  isPlainObject: mockedShared.isPlainObject,
}));

vi.mock('../../../../../../js/agents/runtime/core/worker-rpc.js', () => ({
  createRpcHandler: mockedWorkerRpc.createRpcHandler,
}));

const WORKER_MODULE_PATH = '../../../../../../js/agents/plugins/compression/impl/compression.worker.js';

let selfMock;
let handleCompress;
let rpcHandlerSpy;
let workerModuleNamespace;

async function importWorkerModule() {
  const mod = await import(WORKER_MODULE_PATH);
  return {
    mod,
    handleCompress: mockedWorkerRpc.captured.methods?.compress,
    rpcHandlerSpy: mockedWorkerRpc.captured.handler,
  };
}

function makePlainObjectCheck(value) {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();

  mockedWorkerRpc.captured.methods = null;
  mockedWorkerRpc.captured.handler = null;

  selfMock = { postMessage: vi.fn() };
  vi.stubGlobal('self', selfMock);

  mockedShared.isPlainObject.mockImplementation(makePlainObjectCheck);

  const loaded = await importWorkerModule();
  workerModuleNamespace = loaded.mod;
  handleCompress = loaded.handleCompress;
  rpcHandlerSpy = loaded.rpcHandlerSpy;
});

describe('compression.worker.js (module init)', () => {
  it('registers WorkerRpc handler and installs self.onmessage', () => {
    expect(Object.keys(workerModuleNamespace)).toEqual([]);
    expect(mockedWorkerRpc.createRpcHandler).toHaveBeenCalledTimes(1);
    expect(mockedWorkerRpc.createRpcHandler).toHaveBeenCalledWith(
      expect.objectContaining({ compress: expect.any(Function) }),
    );
    expect(typeof handleCompress).toBe('function');
    expect(typeof globalThis.self.onmessage).toBe('function');
  });
});

describe('compression.worker.js rpc method: compress (handleCompress)', () => {
  it('throws when messages is not an array (empty/type boundaries)', () => {
    expect(() => handleCompress()).toThrow('messages must be an array');
    expect(() => handleCompress(null)).toThrow('messages must be an array');
    expect(() => handleCompress({})).toThrow('messages must be an array');
    expect(() => handleCompress({ messages: undefined })).toThrow('messages must be an array');
    expect(() => handleCompress({ messages: null })).toThrow('messages must be an array');
    expect(() => handleCompress({ messages: '' })).toThrow('messages must be an array');
    expect(() => handleCompress({ messages: 0 })).toThrow('messages must be an array');
    expect(() => handleCompress({ messages: -1 })).toThrow('messages must be an array');
    expect(() => handleCompress({ messages: Number.MAX_SAFE_INTEGER })).toThrow('messages must be an array');
    expect(() => handleCompress({ messages: { 0: 'x', length: 1 } })).toThrow('messages must be an array');
    expect(() => handleCompress({ messages: {} })).toThrow('messages must be an array');
  });

  it('returns empty results for empty messages and preserves explicit sessionSummary', () => {
    const empty = handleCompress({ messages: [] });
    expect(empty.messages).toEqual([]);
    expect(empty.sessionSummary).toBeNull();
    expect(empty.afterTokens).toBe(0);
    expect(empty.stats).toEqual({
      totalMessages: 0,
      mergedMessages: 0,
      removedThinking: 0,
      keptMessages: 0,
      summarizedMessages: 0,
    });

    const withExisting = handleCompress({ messages: [], options: { sessionSummary: 'Prev' } });
    expect(withExisting.messages).toEqual([]);
    expect(withExisting.sessionSummary).toBe('Prev');
    expect(withExisting.afterTokens).toBe(0);
  });

  it('removes thinking messages across supported markers and merges only merge-safe non-system/non-tool', () => {
    const result = handleCompress({
      messages: [
        { role: 'system', content: 'S1' },
        { role: 'system', content: 'S2' },
        { role: 'assistant', content: 'Hello' },
        { role: 'assistant', content: 'World' },
        { role: 'assistant', content: 'analysis: drop-me' },
        { role: 'assistant', thinking: true, content: 'drop-me-2' },
        { role: 'assistant', meta: { type: 'thinking' }, content: 'drop-me-3' },
        { role: 'assistant', content: '<think>drop-me-4</think>' },
        { role: 'user', content: 'Q1', extra: true },
        { role: 'user', content: 'Q2' },
        { role: 'tool', content: 'T1' },
        { role: 'tool', content: 'T2' },
        { role: 'assistant', content: 'A1' },
        { role: 'assistant', content: 'A2' },
      ],
      options: { keepLastTurns: Number.MAX_SAFE_INTEGER },
    });

    expect(result.stats.totalMessages).toBe(14);
    expect(result.stats.removedThinking).toBe(4);
    expect(result.stats.mergedMessages).toBe(2);
    expect(result.stats.summarizedMessages).toBe(0);
    expect(result.messages.map((m) => m.role)).toEqual([
      'system',
      'system',
      'assistant',
      'user',
      'user',
      'tool',
      'tool',
      'assistant',
    ]);
    expect(result.messages).toHaveLength(8);
    expect(result.messages[2].content).toContain('Hello');
    expect(result.messages[2].content).toContain('World');
    expect(result.messages[3]).toMatchObject({ role: 'user', content: 'Q1', extra: true });
    expect(result.messages[4]).toMatchObject({ role: 'user', content: 'Q2' });
    expect(result.messages[7].content).toContain('A1');
    expect(result.messages[7].content).toContain('A2');
  });

  it('summarizes all compressible messages when keepLastTurns is negative', () => {
    const result = handleCompress({
      messages: [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Second' },
      ],
      options: { keepLastTurns: -1 },
    });

    expect(result.messages).toEqual([]);
    expect(result.sessionSummary).toBe('user: First\nassistant: Second');
    expect(result.stats.summarizedMessages).toBe(2);
    expect(result.stats.keptMessages).toBe(0);
  });

  it('treats leading system context summary as non-anchor and summarizes it when it falls into older slice', () => {
    const result = handleCompress({
      messages: [
        { role: 'system', content: '[Context Summary] prior' },
        { role: 'user', content: 'Hi' },
      ],
      options: { keepLastTurns: 1 },
    });

    expect(result.messages).toEqual([{ role: 'user', content: 'Hi' }]);
    expect(result.sessionSummary).toBe('system: [Context Summary] prior');
    expect(result.stats.keptMessages).toBe(1);
    expect(result.stats.summarizedMessages).toBe(1);
  });

  it('appends summary to existing sessionSummary and skips empty/whitespace-only message contents', () => {
    const result = handleCompress({
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'assistant', content: 'Hello' },
        { role: 'assistant', content: 'World' },
        { role: 'assistant', content: 'internal: should drop' },
        { role: 'user', content: 'Question 1' },
        { role: 'assistant', content: '   ' },
        { role: 'assistant', content: '' },
        { role: 'user', content: 'Question 2', id: 1 },
        { role: 'assistant', content: 'Answer 1' },
        { role: 'assistant', content: 'Answer 2' },
        { role: 'system', content: '[Context Summary] previous summary' },
        { role: 'assistant', content: 'Final' },
      ],
      options: { keepLastTurns: 2, sessionSummary: 'Prev summary' },
    });

    expect(result.messages).toEqual([
      { role: 'system', content: 'You are helpful' },
      { role: 'system', content: '[Context Summary] previous summary' },
      { role: 'assistant', content: 'Final' },
    ]);
    expect(result.sessionSummary).toBe(
      'Prev summary\nassistant: Hello World\nuser: Question 1\nuser: Question 2\nassistant: Answer 1 Answer 2',
    );
    expect(result.stats).toEqual({
      totalMessages: 12,
      mergedMessages: 3,
      removedThinking: 1,
      keptMessages: 3,
      summarizedMessages: 5,
    });
    expect(result.afterTokens).toBe(15);
  });

  it('creates title-only summaries and clamps titleMaxWords/titleMaxChars (0/-1 boundaries)', () => {
    const result = handleCompress({
      messages: [
        { role: 'user', content: 'one two three four' },
        { role: 'assistant', content: '你好世界你好世界你好世界' },
      ],
      options: { keepLastTurns: 0, titleOnly: true, titleMaxWords: 0, titleMaxChars: -1 },
    });

    expect(result.messages).toEqual([]);
    expect(result.sessionSummary).toBe('user: one...\nassistant: 你好世界你好世界你好...');
  });

  it('ignores numeric strings in options and falls back to defaults (type boundaries)', () => {
    const messages = [
      { role: 'user', content: 'msg1' },
      { role: 'assistant', content: 'msg2' },
      { role: 'user', content: 'msg3' },
      { role: 'assistant', content: 'msg4' },
      { role: 'user', content: 'msg5' },
      { role: 'assistant', content: 'msg6' },
      { role: 'user', content: 'msg7' },
    ];

    const result = handleCompress({
      messages,
      options: { keepLastTurns: '2', summaryLineChars: '3', titleMaxWords: '1', titleMaxChars: '10' },
    });

    expect(result.messages).toHaveLength(6);
    expect(result.messages[0]).toEqual({ role: 'assistant', content: 'msg2' });
    expect(result.sessionSummary).toBe('user: msg1');
  });

  it('handles summaryLineChars boundaries (<=3 and 0) without crashing', () => {
    const max3 = handleCompress({
      messages: [{ role: 'user', content: 'abcdef' }],
      options: { keepLastTurns: 0, summaryLineChars: 3 },
    });
    expect(max3.messages).toEqual([]);
    expect(max3.sessionSummary).toBe('user: abc');

    const zero = handleCompress({
      messages: [{ role: 'user', content: 'abcdef' }],
      options: { keepLastTurns: 0, summaryLineChars: 0 },
    });
    expect(zero.messages).toEqual([]);
    expect(zero.sessionSummary).toBe('user: ');
  });

  it('keeps all messages for MAX_SAFE_INTEGER and handles deep nested content + super long strings', () => {
    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 60; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    const hugeText = 'x'.repeat(120_000);

    const result = handleCompress({
      messages: [
        { role: 'assistant', content: deep, extra: true },
        { role: 'assistant', content: hugeText },
      ],
      options: { keepLastTurns: Number.MAX_SAFE_INTEGER },
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toBe('[object Object]');
    expect(result.messages[1].content).toBe(hugeText);
    const expectedTokens =
      Math.ceil(result.messages[0].content.length * 0.25) + Math.ceil(result.messages[1].content.length * 0.25);
    expect(result.afterTokens).toBe(expectedTokens);
  });

  it('estimates tokens with CJK weighting', () => {
    const result = handleCompress({
      messages: [
        { role: 'assistant', content: '汉字', extra: true },
        { role: 'assistant', content: 'abc' },
      ],
    });

    expect(result.afterTokens).toBe(5);
  });

  it('supports concurrent calls without state bleed (concurrency boundary)', async () => {
    const inputs = [
      { messages: ['hello'] },
      { messages: [{ role: 'assistant', text: 'from text' }] },
      { messages: [{ role: 'assistant', content: 42 }] },
      { messages: [{ role: 'assistant', content: 'msg-3' }] },
    ];

    const results = await Promise.all(inputs.map((input) => Promise.resolve().then(() => handleCompress(input))));

    expect(results).toHaveLength(4);
    expect(results[0].messages[0]).toEqual({ role: 'assistant', content: 'hello' });
    expect(results[1].messages[0].content).toBe('from text');
    expect(results[2].messages[0].content).toBe('42');
    expect(results[3].messages[0].content).toBe('msg-3');
  });

  it('throws when options.sessionSummary getter throws (error boundary)', () => {
    const options = {};
    Object.defineProperty(options, 'sessionSummary', {
      get() {
        throw new Error('boom');
      },
    });
    expect(() => handleCompress({ messages: [], options })).toThrow('boom');
  });
});

describe('compression.worker.js self.onmessage', () => {
  it('routes rpc:request messages to the rpc handler and does not call postMessage', () => {
    const event = { data: { type: 'rpc:request', id: 'rpc1' } };
    globalThis.self.onmessage(event);

    expect(rpcHandlerSpy).toHaveBeenCalledTimes(1);
    expect(rpcHandlerSpy).toHaveBeenCalledWith(event);
    expect(globalThis.self.postMessage).not.toHaveBeenCalled();
  });

  it('rejects invalid message formats (null/undefined/empty string/array) and includes id when present', () => {
    mockedShared.isPlainObject.mockReturnValue(false);
    globalThis.self.onmessage(undefined);
    globalThis.self.onmessage({ data: null });
    globalThis.self.onmessage({ data: '' });
    globalThis.self.onmessage({ data: [] });
    globalThis.self.onmessage({ data: { id: 0 } });

    expect(globalThis.self.postMessage).toHaveBeenNthCalledWith(1, {
      id: undefined,
      ok: false,
      error: 'Invalid message format',
    });
    expect(globalThis.self.postMessage).toHaveBeenNthCalledWith(2, {
      id: undefined,
      ok: false,
      error: 'Invalid message format',
    });
    expect(globalThis.self.postMessage).toHaveBeenNthCalledWith(3, {
      id: undefined,
      ok: false,
      error: 'Invalid message format',
    });
    expect(globalThis.self.postMessage).toHaveBeenNthCalledWith(4, {
      id: undefined,
      ok: false,
      error: 'Invalid message format',
    });
    expect(globalThis.self.postMessage).toHaveBeenNthCalledWith(5, {
      id: 0,
      ok: false,
      error: 'Invalid message format',
    });
  });

  it('rejects non-array messages including empty objects and array-like objects', () => {
    mockedShared.isPlainObject.mockReturnValue(true);
    globalThis.self.onmessage({ data: {} });
    globalThis.self.onmessage({ data: { id: 'nope', messages: {} } });
    globalThis.self.onmessage({ data: { id: 'array-like', messages: { 0: 'x', length: 1 } } });

    expect(globalThis.self.postMessage).toHaveBeenNthCalledWith(1, {
      id: undefined,
      ok: false,
      error: 'messages must be an array',
    });
    expect(globalThis.self.postMessage).toHaveBeenNthCalledWith(2, {
      id: 'nope',
      ok: false,
      error: 'messages must be an array',
    });
    expect(globalThis.self.postMessage).toHaveBeenNthCalledWith(3, {
      id: 'array-like',
      ok: false,
      error: 'messages must be an array',
    });
  });

  it('posts success responses for valid requests and preserves id edge values', () => {
    mockedShared.isPlainObject.mockReturnValue(true);
    const ids = [0, -1, Number.MAX_SAFE_INTEGER];
    for (const id of ids) {
      globalThis.self.onmessage({
        data: { id, messages: [{ role: 'assistant', content: 'Hi' }], options: {} },
      });
    }

    expect(globalThis.self.postMessage).toHaveBeenCalledTimes(3);
    const postedIds = globalThis.self.postMessage.mock.calls.map((call) => call[0].id);
    expect(postedIds).toEqual(ids);

    for (const call of globalThis.self.postMessage.mock.calls) {
      expect(call[0]).toMatchObject({
        ok: true,
        messages: [{ role: 'assistant', content: 'Hi' }],
        sessionSummary: null,
      });
      expect(call[0].stats.totalMessages).toBe(1);
      expect(call[0].afterTokens).toBe(1);
    }
  });

  it('returns errors when handleCompress throws (options getter throws)', () => {
    mockedShared.isPlainObject.mockReturnValue(true);
    const options = {};
    Object.defineProperty(options, 'sessionSummary', {
      get() {
        throw new Error('boom');
      },
    });
    globalThis.self.onmessage({ data: { id: 'err', messages: [], options } });

    expect(globalThis.self.postMessage).toHaveBeenCalledWith({
      id: 'err',
      ok: false,
      error: 'boom',
    });
  });

  it('handles rapid consecutive calls (concurrency boundary)', () => {
    mockedShared.isPlainObject.mockReturnValue(true);
    for (let i = 0; i < 5; i += 1) {
      globalThis.self.onmessage({
        data: { id: `msg-${i}`, messages: [{ role: 'assistant', content: `m${i}` }] },
      });
    }

    expect(globalThis.self.postMessage).toHaveBeenCalledTimes(5);
    const ids = globalThis.self.postMessage.mock.calls.map((call) => call[0].id);
    expect(ids).toEqual(['msg-0', 'msg-1', 'msg-2', 'msg-3', 'msg-4']);
  });

  it('supports interleaved rpc and legacy messages without cross-contamination', () => {
    mockedShared.isPlainObject.mockReturnValue(true);

    globalThis.self.onmessage({ data: { type: 'rpc:request', id: 'rpc-a' } });
    globalThis.self.onmessage({
      data: { id: 'legacy-1', messages: [{ role: 'assistant', content: 'x' }] },
    });
    globalThis.self.onmessage({ data: { type: 'rpc:request', id: 'rpc-b' } });
    globalThis.self.onmessage({
      data: { id: 'legacy-2', messages: [{ role: 'assistant', content: 'y' }] },
    });

    expect(rpcHandlerSpy).toHaveBeenCalledTimes(2);
    expect(globalThis.self.postMessage).toHaveBeenCalledTimes(2);
    const legacyIds = globalThis.self.postMessage.mock.calls.map((call) => call[0].id);
    expect(legacyIds).toEqual(['legacy-1', 'legacy-2']);
  });
});
