import { describe, it, expect, vi, beforeEach } from 'vitest';

const MODULE_PATH = '../../../../../js/agents/runtime/core/js-sandbox-worker.node.js';

const workerThreadsState = vi.hoisted(() => ({
  parentPort: {
    postMessage: vi.fn(),
    on: vi.fn(),
  },
  workerData: {},
}));

vi.mock('node:worker_threads', () => workerThreadsState);

const getMessages = (postMessage) => postMessage.mock.calls.map(([msg]) => msg);

const findMessage = (messages, predicate) => messages.find(predicate);

const findResult = (messages, id) =>
  findMessage(messages, (msg) => msg?.type === 'result' && msg.id === id);

const findAudit = (messages, id, event) =>
  findMessage(messages, (msg) => msg?.type === 'audit' && msg.id === id && msg.event === event);

async function loadWorker() {
  vi.resetModules();
  const handlers = new Map();

  workerThreadsState.parentPort.postMessage = vi.fn();
  workerThreadsState.parentPort.on = vi.fn((event, handler) => {
    handlers.set(event, handler);
  });

  await import(MODULE_PATH);

  return {
    postMessage: workerThreadsState.parentPort.postMessage,
    on: workerThreadsState.parentPort.on,
    handler: handlers.get('message'),
  };
}

describe('js-sandbox-worker.node.js', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('posts ready and registers message handler on import', async () => {
    const { postMessage, on, handler } = await loadWorker();

    expect(on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(typeof handler).toBe('function');

    const messages = getMessages(postMessage);
    expect(messages).toContainEqual({ type: 'ready' });
  });

  it('executes code with state and globals and emits logs', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    const state = { value: 2, nested: { deep: { value: 3 } } };
    const globals = { custom: 5, list: [1, 2, 3] };
    const code = `
      state.value = 99;
      emit('ping', { value: state.value, size: list.length });
      console.info('info', custom);
      return custom + state.value + state.nested.deep.value;
    `;

    await handler({
      type: 'execute',
      id: 'basic',
      code,
      state,
      globals,
      timeout: 1000,
    });

    const messages = getMessages(postMessage);
    const result = findResult(messages, 'basic');
    expect(result).toMatchObject({ type: 'result', id: 'basic', success: true, data: 10 });

    const emitMessage = findMessage(messages, (msg) => msg?.type === 'emit' && msg.name === 'ping');
    expect(emitMessage?.payload).toEqual({ value: 2, size: 3 });

    const logMessage = findMessage(messages, (msg) => msg?.type === 'log' && msg.level === 'info');
    expect(logMessage?.args).toEqual(['info', '5']);

    const auditStart = findAudit(messages, 'basic', 'start');
    const auditEnd = findAudit(messages, 'basic', 'end');
    expect(auditStart?.payload.codeLength).toBe(code.length);
    expect(auditEnd?.payload.blockedGlobals).toEqual([]);

    expect(Object.isFrozen(state)).toBe(true);
    expect(state.value).toBe(2);
  });

  it('rejects blocked patterns and reports security errors', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    await handler({
      type: 'execute',
      id: 'blocked',
      code: 'const fs = require("fs");',
      state: null,
      globals: null,
      timeout: 1000,
    });

    const messages = getMessages(postMessage);
    const result = findResult(messages, 'blocked');
    expect(result?.success).toBe(false);
    expect(result?.error).toContain('Security:');
    expect(result?.error).toContain('Blocked pattern');
    expect(result?.metrics?.blocked).toBe(true);

    const auditBlocked = findAudit(messages, 'blocked', 'blocked');
    expect(auditBlocked?.payload?.reason).toContain('Blocked pattern');

    const auditEnd = findAudit(messages, 'blocked', 'end');
    expect(auditEnd).toBeTruthy();
  });

  it('tracks blocked global access without failing execution', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    await handler({
      type: 'execute',
      id: 'blocked-global',
      code: 'eval = 3; return typeof eval;',
      state: {},
      globals: {},
      timeout: 1000,
    });

    const messages = getMessages(postMessage);
    const result = findResult(messages, 'blocked-global');
    expect(result).toMatchObject({ type: 'result', id: 'blocked-global', success: true, data: 'undefined' });

    const auditEnd = findAudit(messages, 'blocked-global', 'end');
    expect(auditEnd?.payload?.blockedGlobals).toContain('eval');
  });

  it('returns errors for thrown exceptions', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    await handler({
      type: 'execute',
      id: 'throw',
      code: 'throw new Error("boom");',
      state: {},
      globals: {},
      timeout: 1000,
    });

    const messages = getMessages(postMessage);
    const result = findResult(messages, 'throw');
    expect(result?.success).toBe(false);
    expect(result?.error).toBe('boom');

    const auditEnd = findAudit(messages, 'throw', 'end');
    expect(auditEnd).toBeTruthy();
  });

  it('enforces execution timeouts', async () => {
    vi.useFakeTimers();
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    const run = handler({
      type: 'execute',
      id: 'timeout',
      code: 'await new Promise(() => {});',
      state: {},
      globals: {},
      timeout: '5',
    });

    await vi.advanceTimersByTimeAsync(5);
    await run;
    vi.useRealTimers();

    const messages = getMessages(postMessage);
    const result = findResult(messages, 'timeout');
    expect(result?.success).toBe(false);
    expect(result?.error).toBe('Execution timeout');
  });

  it('handles null/undefined/empty inputs and boundary timeout values', async () => {
    vi.useFakeTimers();
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    const cases = [
      { id: 'null-code', code: null, state: null, globals: null, timeout: 0 },
      { id: 'undefined-code', code: undefined, state: undefined, globals: undefined, timeout: -1 },
      { id: 'empty-code', code: '', state: [], globals: {}, timeout: Number.MAX_SAFE_INTEGER },
      { id: 'blank-code', code: '  \n\t', state: {}, globals: [], timeout: 0 },
      {
        id: 'object-as-array',
        code: 'return Array.isArray(items) ? items.length : -1;',
        state: {},
        globals: { items: {} },
        timeout: 0,
      },
    ];

    for (const entry of cases) {
      await handler({ type: 'execute', ...entry });
    }

    const messages = getMessages(postMessage);
    for (const entry of cases) {
      const result = findResult(messages, entry.id);
      expect(result?.success).toBe(true);
    }

    const objectAsArrayResult = findResult(messages, 'object-as-array');
    expect(objectAsArrayResult?.data).toBe(-1);
    vi.useRealTimers();
  });

  it('supports large inputs and deep state nesting', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    const depth = 40;
    const deepState = { value: 0 };
    let cursor = deepState;
    for (let i = 0; i < depth; i += 1) {
      cursor.child = {};
      cursor = cursor.child;
    }
    cursor.value = 7;

    const longValue = 'x'.repeat(100000);
    const padding = ' '.repeat(100000);
    const code = `
      ${padding}
      let cursor = state;
      for (let i = 0; i < depth; i += 1) {
        cursor = cursor.child;
      }
      return cursor.value + longValue.length;
    `;

    await handler({
      type: 'execute',
      id: 'large',
      code,
      state: deepState,
      globals: { depth, longValue },
      timeout: 1000,
    });

    const messages = getMessages(postMessage);
    const result = findResult(messages, 'large');
    expect(result?.success).toBe(true);
    expect(result?.data).toBe(7 + longValue.length);

    const auditStart = findAudit(messages, 'large', 'start');
    expect(auditStart?.payload?.codeLength).toBe(code.length);
  });

  it('handles concurrent and rapid sequential executions', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    const first = handler({
      type: 'execute',
      id: 'one',
      code: 'return 1;',
      state: {},
      globals: {},
      timeout: 1000,
    });

    const second = handler({
      type: 'execute',
      id: 'two',
      code: 'return 2;',
      state: {},
      globals: {},
      timeout: 1000,
    });

    await Promise.all([first, second]);

    const messages = getMessages(postMessage);
    const resultOne = findResult(messages, 'one');
    const resultTwo = findResult(messages, 'two');

    expect(resultOne?.data).toBe(1);
    expect(resultTwo?.data).toBe(2);

    const auditEndOne = findAudit(messages, 'one', 'end');
    const auditEndTwo = findAudit(messages, 'two', 'end');
    expect(auditEndOne).toBeTruthy();
    expect(auditEndTwo).toBeTruthy();
  });
});
