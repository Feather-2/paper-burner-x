import { describe, it, expect, vi, beforeEach } from 'vitest';

const MODULE_PATH = '../../../../../js/agents/runtime/tools/tool-executor-worker.js';

const workerThreadsState = vi.hoisted(() => ({
  parentPort: null,
}));

const sharedState = vi.hoisted(() => ({
  createToolExecutorHandler: vi.fn(),
}));

vi.mock('node:worker_threads', () => workerThreadsState);
vi.mock('../../../../../js/agents/runtime/tools/tool-executor-worker-shared.js', () => ({
  createToolExecutorHandler: sharedState.createToolExecutorHandler,
}));

const makeParentPort = (overrides = {}) => {
  const handlers = new Map();
  const parentPort = {
    postMessage: vi.fn(),
    on: vi.fn((event, handler) => {
      handlers.set(event, handler);
    }),
    close: vi.fn(),
    ...overrides,
  };

  return { parentPort, handlers };
};

const loadWorker = async (parentPort) => {
  vi.resetModules();
  sharedState.createToolExecutorHandler.mockReset();
  workerThreadsState.parentPort = parentPort;

  await import(MODULE_PATH);

  const [options] = sharedState.createToolExecutorHandler.mock.calls[0] || [];
  return options;
};

const setupHandler = async (overrides) => {
  const { parentPort, handlers } = makeParentPort(overrides);
  const options = await loadWorker(parentPort);
  const cb = vi.fn();

  options.onMessage(cb);

  return { cb, handler: handlers.get('message'), parentPort, options };
};

beforeEach(() => {
  sharedState.createToolExecutorHandler.mockReset();
});

describe('tool-executor-worker.js', () => {
  it('throws when parentPort is missing', async () => {
    vi.resetModules();
    sharedState.createToolExecutorHandler.mockReset();
    workerThreadsState.parentPort = null;

    await expect(import(MODULE_PATH)).rejects.toThrow('tool-executor-worker: missing parentPort');
    expect(sharedState.createToolExecutorHandler).not.toHaveBeenCalled();
  });

  it('wires createToolExecutorHandler to parentPort', async () => {
    const { parentPort, handlers } = makeParentPort();
    const options = await loadWorker(parentPort);

    expect(sharedState.createToolExecutorHandler).toHaveBeenCalledTimes(1);
    expect(options).toMatchObject({
      postMessage: expect.any(Function),
      onMessage: expect.any(Function),
      close: expect.any(Function),
    });

    const payload = { type: 'ping', value: 0 };
    options.postMessage(payload);
    expect(parentPort.postMessage).toHaveBeenCalledWith(payload);

    const cb = vi.fn();
    options.onMessage(cb);
    expect(parentPort.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(typeof handlers.get('message')).toBe('function');

    options.close();
    expect(parentPort.close).toHaveBeenCalledTimes(1);
  });

  it('does not throw when parentPort.close is missing', async () => {
    const { parentPort } = makeParentPort();
    delete parentPort.close;

    const options = await loadWorker(parentPort);
    expect(() => options.close()).not.toThrow();
  });
});

describe('normalizeMessage (via onMessage)', () => {
  it('passes through non-object values and boundary numbers', async () => {
    const { cb, handler } = await setupHandler();

    const values = [null, undefined, '', '   ', 0, -1, Number.MAX_SAFE_INTEGER, '42'];
    values.forEach((value) => handler(value));

    expect(cb).toHaveBeenCalledTimes(values.length);
    values.forEach((value, index) => {
      expect(cb).toHaveBeenNthCalledWith(index + 1, value);
    });
  });

  it('passes through non-execute objects and empty collections', async () => {
    const { cb, handler } = await setupHandler();

    const emptyArray = [];
    const emptyObject = {};
    const noop = { type: 'noop', value: 'x' };

    handler(emptyArray);
    handler(emptyObject);
    handler(noop);

    expect(cb).toHaveBeenCalledTimes(3);
    expect(cb.mock.calls[0][0]).toBe(emptyArray);
    expect(cb.mock.calls[1][0]).toBe(emptyObject);
    expect(cb.mock.calls[2][0]).toBe(noop);
  });

  it('normalizes legacy execute messages with large payloads and deep context', async () => {
    const { cb, handler } = await setupHandler();

    const longString = 'x'.repeat(100000);
    const largeFile = { name: 'huge.bin', size: 1024 * 1024 * 128, content: longString };
    const deepContext = {};
    let cursor = deepContext;
    for (let i = 0; i < 8; i += 1) {
      cursor[`level${i}`] = {};
      cursor = cursor[`level${i}`];
    }
    cursor.value = 'end';

    const message = {
      type: 'execute',
      id: 0,
      moduleUrl: 'file://tools/worker',
      exportName: 'run',
      args: largeFile,
      context: deepContext,
    };

    handler(message);

    expect(cb).toHaveBeenCalledTimes(1);
    const normalized = cb.mock.calls[0][0];
    expect(normalized).toEqual({
      type: 'execute',
      id: 0,
      moduleUrl: 'file://tools/worker',
      handlerName: 'run',
      args: [largeFile, deepContext],
    });
    expect(normalized.args[0]).toBe(largeFile);
    expect(normalized.args[1]).toBe(deepContext);
    expect(normalized.args[0].content.length).toBe(longString.length);
  });

  it('defaults legacy handlerName when exportName is empty and preserves whitespace', async () => {
    const { cb, handler } = await setupHandler();

    const contextOnly = { depth: { inner: true } };
    const whitespaceContext = {};
    const missingContext = { nested: { value: 1 } };
    const missingArgs = { not: 'array' };

    const emptyExport = {
      type: 'execute',
      id: -1,
      moduleUrl: '',
      exportName: '',
      args: 0,
      context: contextOnly,
    };
    const whitespaceExport = {
      type: 'execute',
      id: Number.MAX_SAFE_INTEGER,
      moduleUrl: 'mod',
      exportName: '   ',
      args: null,
      context: whitespaceContext,
    };
    const missingExport = {
      type: 'execute',
      id: '123',
      moduleUrl: 'mod',
      args: missingArgs,
      context: missingContext,
    };

    handler(emptyExport);
    handler(whitespaceExport);
    handler(missingExport);

    const normalizedEmpty = cb.mock.calls[0][0];
    expect(normalizedEmpty.handlerName).toBe('handler');
    expect(normalizedEmpty.args).toEqual([0, contextOnly]);

    const normalizedWhitespace = cb.mock.calls[1][0];
    expect(normalizedWhitespace.handlerName).toBe('   ');
    expect(normalizedWhitespace.args).toEqual([null, whitespaceContext]);

    const normalizedMissing = cb.mock.calls[2][0];
    expect(normalizedMissing.handlerName).toBe('handler');
    expect(normalizedMissing.id).toBe('123');
    expect(normalizedMissing.args[0]).toBe(missingArgs);
    expect(normalizedMissing.args[1]).toBe(missingContext);
  });

  it('normalizes modern execute messages and enforces args array', async () => {
    const { cb, handler } = await setupHandler();

    const emptyArgs = [];
    const modernWithArray = {
      type: 'execute',
      id: Number.MAX_SAFE_INTEGER,
      moduleUrl: 'mod',
      handlerName: 'modern',
      args: emptyArgs,
    };
    const modernWithObject = {
      type: 'execute',
      id: '42',
      moduleUrl: 'mod',
      handlerName: 'modern2',
      args: { not: 'array' },
    };

    handler(modernWithArray);
    handler(modernWithObject);

    const normalizedArray = cb.mock.calls[0][0];
    expect(normalizedArray.args).toBe(emptyArgs);

    const normalizedObject = cb.mock.calls[1][0];
    expect(normalizedObject.args).toEqual([]);
    expect(normalizedObject.handlerName).toBe('modern2');
    expect(normalizedObject.id).toBe('42');
  });

  it('handles rapid consecutive messages without cross-talk', async () => {
    const { cb, handler } = await setupHandler();

    const legacyContext = { ok: true };
    const messages = [
      { type: 'execute', id: 1, moduleUrl: 'm', handlerName: 'fast', args: [1, 2] },
      { type: 'noop', value: 'x' },
      null,
      { type: 'execute', id: 2, moduleUrl: 'm', exportName: 'legacy', args: 'x', context: legacyContext },
    ];

    messages.forEach((message) => handler(message));

    expect(cb).toHaveBeenCalledTimes(messages.length);
    const results = cb.mock.calls.map(([arg]) => arg);

    expect(results[0]).toEqual({
      type: 'execute',
      id: 1,
      moduleUrl: 'm',
      handlerName: 'fast',
      args: [1, 2],
    });
    expect(results[1]).toBe(messages[1]);
    expect(results[2]).toBe(null);
    expect(results[3].handlerName).toBe('legacy');
    expect(results[3].args[1]).toBe(legacyContext);
  });

  it('handles concurrent message delivery', async () => {
    const { cb, handler } = await setupHandler();

    const legacyContext = {};
    const messages = [
      { type: 'execute', id: 10, moduleUrl: 'm', handlerName: 'a', args: [] },
      'payload',
      { type: 'execute', id: 11, moduleUrl: 'm', exportName: '', args: 1, context: legacyContext },
    ];

    await Promise.all(messages.map((message) => Promise.resolve().then(() => handler(message))));

    expect(cb).toHaveBeenCalledTimes(messages.length);
    const results = cb.mock.calls.map(([arg]) => arg);
    expect(results).toEqual(
      expect.arrayContaining([
        { type: 'execute', id: 10, moduleUrl: 'm', handlerName: 'a', args: [] },
        'payload',
        { type: 'execute', id: 11, moduleUrl: 'm', handlerName: 'handler', args: [1, legacyContext] },
      ]),
    );
  });
});
