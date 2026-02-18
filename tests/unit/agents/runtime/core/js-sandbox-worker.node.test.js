import { describe, it, expect, vi, beforeEach } from 'vitest';

const SUBJECT_PATH = '../../../../../js/agents/runtime/core/js-sandbox-worker.node.js';

const workerThreadsState = vi.hoisted(() => ({
  parentPort: undefined,
  workerData: undefined,
}));

vi.mock('node:worker_threads', () => ({
  parentPort: workerThreadsState.parentPort,
  workerData: workerThreadsState.workerData,
}));

function makeParentPort() {
  const listeners = Object.create(null);
  const messages = [];
  const throwOnTypes = new Set();

  /** @type {any} */
  const port = {
    postMessage: vi.fn((msg) => {
      if (throwOnTypes.has(msg?.type)) throw new Error('boom');
      messages.push(msg);
    }),
    on: vi.fn((event, handler) => {
      listeners[event] = handler;
      return port;
    }),
  };

  return { port, listeners, messages, throwOnTypes };
}

const sharedPort = makeParentPort();

async function importFresh({ workerData = {} } = {}) {
  vi.resetModules();
  workerThreadsState.parentPort = sharedPort.port;
  workerThreadsState.workerData = workerData;
  await import(SUBJECT_PATH);
}

function findLast(messages, type) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.type === type) return messages[i];
  }
  return undefined;
}

function findAll(messages, type) {
  return messages.filter((m) => m?.type === type);
}

async function execute(listeners, payload) {
  await listeners.message?.(payload);
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  workerThreadsState.parentPort = undefined;
  workerThreadsState.workerData = undefined;
  sharedPort.messages.length = 0;
  sharedPort.throwOnTypes.clear();
});

describe('js-sandbox-worker.node (worker entry script)', () => {
  it('posts a ready message and registers a message handler on import', async () => {
    const { port, listeners, messages } = sharedPort;
    await importFresh();

    expect(typeof listeners.message).toBe('function');
    expect(messages.some((m) => m?.type === 'ready')).toBe(true);
  });

  it('executes benign code and returns a result', async () => {
    const { port, listeners, messages } = sharedPort;
    await importFresh();
    expect(typeof listeners.message).toBe('function');

    messages.length = 0;
    port.postMessage.mockClear();

    await execute(listeners, {
      type: 'execute',
      id: 1,
      code: 'return state.a + answer;',
      state: { a: 1 },
      globals: { answer: 42 },
      timeout: 1000,
    });

    const result = findLast(messages, 'result');
    expect(result).toMatchObject({
      type: 'result',
      id: 1,
      success: true,
      data: 43,
    });

    const audits = findAll(messages, 'audit');
    expect(audits[0]).toMatchObject({ event: 'start', id: 1 });
    expect(audits.at(-1)).toMatchObject({ event: 'end', id: 1 });
  });

  it('blocks dangerous patterns via validation (import/constructor/require/process)', async () => {
    const { port, listeners, messages } = sharedPort;
    await importFresh();
    expect(typeof listeners.message).toBe('function');

    const cases = [
      { code: 'import("fs")', expectKeyword: 'import' },
      {
        code: 'constructor.constructor("return 1")()',
        expectKeyword: 'constructor',
      },
      { code: 'require("fs")', expectKeyword: 'require' },
      { code: 'process.exit(0)', expectKeyword: 'process' },
    ];

    for (const { code, expectKeyword } of cases) {
      messages.length = 0;
      port.postMessage.mockClear();

      await execute(listeners, { type: 'execute', id: 1, code, state: {}, globals: {} });

      const result = findLast(messages, 'result');
      expect(result?.success).toBe(false);
      expect(result?.error).toContain('Security:');
      expect(result?.error).toContain('Blocked pattern:');
      expect(result?.error).toContain(expectKeyword);
      expect(result?.metrics?.blocked).toBe(true);

      const audits = findAll(messages, 'audit');
      expect(audits.some((m) => m?.event === 'blocked')).toBe(true);
      expect(audits.at(-1)?.event).toBe('end');
    }
  });

  it('prevents fallback to host globals (e.g. Buffer) and records blocked accesses', async () => {
    expect(typeof Buffer).toBe('function');

    const { port, listeners, messages } = sharedPort;
    await importFresh();
    expect(typeof listeners.message).toBe('function');

    messages.length = 0;
    port.postMessage.mockClear();

    await execute(listeners, { type: 'execute', id: 1, code: 'return typeof Buffer;' });

    const result = findLast(messages, 'result');
    expect(result).toMatchObject({
      type: 'result',
      id: 1,
      success: true,
      data: 'undefined',
    });

    const endAudit = findAll(messages, 'audit').at(-1);
    expect(endAudit?.event).toBe('end');
    expect(endAudit?.payload?.blockedGlobals).toContain('Buffer');
  });

  it('supports globals injection and provides a frozen state snapshot', async () => {
    const { port, listeners, messages } = sharedPort;
    await importFresh();
    expect(typeof listeners.message).toBe('function');

    messages.length = 0;
    port.postMessage.mockClear();

    await execute(listeners, {
      type: 'execute',
      id: 1,
      code: 'return { answer, stateFrozen: Object.isFrozen(state), stateA: state.a };',
      state: { a: 1 },
      globals: { answer: 42 },
    });

    const result = findLast(messages, 'result');
    expect(result).toMatchObject({
      type: 'result',
      id: 1,
      success: true,
      data: { answer: 42, stateFrozen: true, stateA: 1 },
    });
  });

  it('rejects strict-mode mutations of frozen state', async () => {
    const { port, listeners, messages } = sharedPort;
    await importFresh();
    expect(typeof listeners.message).toBe('function');

    messages.length = 0;
    port.postMessage.mockClear();

    await execute(listeners, {
      type: 'execute',
      id: 1,
      code: '"use strict"; state.a = 2; return state.a;',
      state: { a: 1 },
      globals: {},
    });

    const result = findLast(messages, 'result');
    expect(result?.success).toBe(false);
    expect(result?.error).toBeTypeOf('string');
  });

  it('enforces hard timeout for synchronous infinite loops', async () => {
    const { listeners, messages } = sharedPort;
    await importFresh();
    expect(typeof listeners.message).toBe('function');

    messages.length = 0;
    await execute(listeners, {
      type: 'execute',
      id: 7,
      code: 'while (true) {}',
      timeout: 5,
    });

    const result = findLast(messages, 'result');
    expect(result?.success).toBe(false);
    expect(result?.metrics?.timedOut).toBe(true);
    expect(String(result?.error || '')).toMatch(/timed?\s*out/i);
  });

  it('forwards console logs and emit events to the host', async () => {
    const { port, listeners, messages } = sharedPort;
    await importFresh();
    expect(typeof listeners.message).toBe('function');

    messages.length = 0;
    port.postMessage.mockClear();

    await execute(listeners, {
      type: 'execute',
      id: 1,
      code: 'console.log("hi", 123); emit("evt", { ok: true }); return "done";',
      state: {},
      globals: {},
    });

    const logs = findAll(messages, 'log');
    expect(logs.some((m) => m?.level === 'log' && m?.args?.includes('hi'))).toBe(true);
    expect(logs.some((m) => m?.args?.includes('123'))).toBe(true);

    const emits = findAll(messages, 'emit');
    expect(emits).toContainEqual({ type: 'emit', name: 'evt', payload: { ok: true } });

    const result = findLast(messages, 'result');
    expect(result).toMatchObject({ type: 'result', success: true, data: 'done' });
  });

  it('swallows parentPort.postMessage errors (emit path)', async () => {
    const { port, listeners, messages, throwOnTypes } = sharedPort;
    throwOnTypes.add('emit');
    await importFresh();
    expect(typeof listeners.message).toBe('function');

    messages.length = 0;
    port.postMessage.mockClear();

    await expect(
      execute(listeners, {
        type: 'execute',
        id: 1,
        code: 'emit("evt", { ok: true }); return 1;',
        state: {},
        globals: {},
      })
    ).resolves.toBeUndefined();

    const result = findLast(messages, 'result');
    expect(result).toMatchObject({ type: 'result', success: true, data: 1 });
  });
});
