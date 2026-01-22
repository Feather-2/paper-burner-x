import { describe, it, expect, vi, beforeEach } from 'vitest';

const MODULE_PATH = '../../../../../js/agents/runtime/core/js-sandbox-worker.node.js';

const workerThreadsState = vi.hoisted(() => ({
  parentPort: null,
  workerData: {},
}));

vi.mock('node:worker_threads', () => workerThreadsState);

function collectMessages(postMessage) {
  return postMessage.mock.calls.map(([message]) => message);
}

function findMessage(messages, predicate) {
  return messages.find(predicate);
}

function findResult(messages, id) {
  return findMessage(messages, (msg) => msg?.type === 'result' && msg.id === id);
}

function findAudit(messages, id, event) {
  return findMessage(messages, (msg) => msg?.type === 'audit' && msg.id === id && msg.event === event);
}

async function loadWorker(options = {}) {
  vi.resetModules();
  const handlers = new Map();

  const hasParentPort = Object.prototype.hasOwnProperty.call(options, 'parentPort');
  const parentPort = hasParentPort ? options.parentPort : null;
  const workerData = options.workerData ?? {};

  if (parentPort === null) {
    workerThreadsState.parentPort = {
      postMessage: vi.fn(),
      on: vi.fn((event, handler) => {
        handlers.set(event, handler);
      }),
    };
  } else {
    workerThreadsState.parentPort = parentPort;
    if (workerThreadsState.parentPort) {
      workerThreadsState.parentPort = {
        ...workerThreadsState.parentPort,
        postMessage: workerThreadsState.parentPort.postMessage ?? vi.fn(),
        on: vi.fn((event, handler) => {
          handlers.set(event, handler);
        }),
      };
    }
  }

  workerThreadsState.workerData = workerData;

  await import(MODULE_PATH);

  return {
    postMessage: workerThreadsState.parentPort?.postMessage,
    on: workerThreadsState.parentPort?.on,
    handler: handlers.get('message'),
  };
}

describe('js-sandbox-worker.node.js', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    workerThreadsState.parentPort = null;
    workerThreadsState.workerData = {};
  });

  it('posts ready and registers message handler on import', async () => {
    const { postMessage, on, handler } = await loadWorker();

    expect(on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(typeof handler).toBe('function');

    const messages = collectMessages(postMessage);
    expect(messages).toContainEqual({ type: 'ready' });
  });

  it('does not throw if parentPort is missing', async () => {
    await expect(loadWorker({ parentPort: undefined })).resolves.toMatchObject({
      postMessage: undefined,
      on: undefined,
      handler: undefined,
    });
  });

  it('swallows postMessage errors (ready signal does not crash import)', async () => {
    const throwingPostMessage = vi.fn(() => {
      throw new Error('postMessage failed');
    });

    const { postMessage } = await loadWorker({ parentPort: { postMessage: throwingPostMessage } });

    expect(postMessage).toHaveBeenCalledWith({ type: 'ready' });
  });

  it('ignores non-execute messages', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    await handler({ type: 'noop', id: 'noop' });

    const messages = collectMessages(postMessage);
    expect(messages).toContainEqual({ type: 'ready' });
    expect(messages.find((msg) => msg?.type === 'result')).toBeUndefined();
  });

  it('executes code with frozen state, injected globals, and posts emit/log events', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    const state = { value: 2, nested: { deep: { value: 3 } } };
    const globals = { custom: 5, list: [1, 2, 3], console: 'evil', emit: 'evil' };
    const code = `
      state.value = 99;
      emit('ping', { value: state.value, size: list.length });
      console.info('info', custom);
      return {
        sum: custom + state.value + state.nested.deep.value,
        frozen: Object.isFrozen(state),
        nestedFrozen: Object.isFrozen(state.nested),
      };
    `;

    await handler({
      type: 'execute',
      id: 'basic',
      code,
      state,
      globals,
      timeout: 1000,
    });

    const messages = collectMessages(postMessage);
    expect(findResult(messages, 'basic')).toMatchObject({
      type: 'result',
      id: 'basic',
      success: true,
      data: { sum: 10, frozen: true, nestedFrozen: false },
    });

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

  it('isolates host globals and maps globalThis/self/global to sandbox proxy', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    await handler({
      type: 'execute',
      id: 'isolation',
      code: `
        notDefined;
        return {
          math: Math.max(1, 2),
          setTimeoutType: typeof setTimeout,
          sameProxy: globalThis === self && self === global,
          proto: Object.getPrototypeOf(globalThis),
        };
      `,
      state: {},
      globals: {},
      timeout: 1000,
    });

    const messages = collectMessages(postMessage);
    expect(findResult(messages, 'isolation')).toMatchObject({
      type: 'result',
      id: 'isolation',
      success: true,
      data: { math: 2, setTimeoutType: 'undefined', sameProxy: true, proto: null },
    });
    expect(findAudit(messages, 'isolation', 'end')?.payload?.blockedGlobals).toEqual([]);
  });

  it('rejects blocked patterns and reports security errors', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    const cases = [
      { id: 'blocked-import', code: 'return import("x");' },
      { id: 'blocked-require', code: 'const fs = require("fs");' },
      { id: 'blocked-ctor', code: 'return constructor.constructor("return 1")();' },
      { id: 'blocked-process', code: 'return process;' },
    ];

    for (const entry of cases) {
      await handler({ type: 'execute', ...entry, state: null, globals: null, timeout: 1000 });
    }

    const messages = collectMessages(postMessage);
    for (const entry of cases) {
      const result = findResult(messages, entry.id);
      expect(result?.success).toBe(false);
      expect(result?.error).toContain('Security:');
      expect(result?.error).toContain('Blocked pattern');
      expect(result?.metrics?.blocked).toBe(true);
      expect(findAudit(messages, entry.id, 'blocked')?.payload?.reason).toContain('Blocked pattern');
      expect(findAudit(messages, entry.id, 'end')).toBeTruthy();
    }
  });

  it('treats near-miss patterns as allowed (word boundary check)', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    await handler({
      type: 'execute',
      id: 'near-miss',
      code: 'return "processes";',
      state: {},
      globals: {},
      timeout: 1000,
    });

    const messages = collectMessages(postMessage);
    expect(findResult(messages, 'near-miss')).toMatchObject({ success: true, data: 'processes' });
  });

  it('tracks blocked globals across get/set/defineProperty without failing execution', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    await handler({
      type: 'execute',
      id: 'blocked-globals',
      code: `
        eval = 3;
        const defined = Reflect.defineProperty(this, "Function", { value: 1 });
        return { evalType: typeof eval, functionType: typeof Function, defined };
      `,
      state: {},
      globals: {},
      timeout: 1000,
    });

    const messages = collectMessages(postMessage);
    expect(findResult(messages, 'blocked-globals')).toMatchObject({
      type: 'result',
      id: 'blocked-globals',
      success: true,
      data: { evalType: 'undefined', functionType: 'undefined', defined: false },
    });

    const auditEnd = findAudit(messages, 'blocked-globals', 'end');
    expect(auditEnd?.payload?.blockedGlobals).toEqual(expect.arrayContaining(['eval', 'Function']));
  });

  it('injects extra globals but refuses overriding reserved keys or blocked globals', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    await handler({
      type: 'execute',
      id: 'globals',
      code: `
        emit("evt", { ok: true });
        console.log("hi");
        return [typeof eval, custom].join("|");
      `,
      state: {},
      globals: { custom: 1, console: 'evil', emit: 'evil', eval: () => 2 },
      timeout: 1000,
    });

    const messages = collectMessages(postMessage);
    expect(findMessage(messages, (msg) => msg?.type === 'emit' && msg.name === 'evt')).toBeTruthy();
    expect(findMessage(messages, (msg) => msg?.type === 'log' && msg.level === 'log')).toBeTruthy();
    expect(findResult(messages, 'globals')).toMatchObject({ success: true, data: 'undefined|1' });

    const auditEnd = findAudit(messages, 'globals', 'end');
    expect(auditEnd?.payload?.blockedGlobals).toContain('eval');
  });

  it('reports runtime errors for thrown exceptions', async () => {
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

    const messages = collectMessages(postMessage);
    const result = findResult(messages, 'throw');
    expect(result?.success).toBe(false);
    expect(result?.error).toBe('boom');
    expect(findAudit(messages, 'throw', 'end')).toBeTruthy();
  });

  it('reports syntax errors during compilation', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    await handler({
      type: 'execute',
      id: 'syntax',
      code: 'return (',
      state: {},
      globals: {},
      timeout: 1000,
    });

    const messages = collectMessages(postMessage);
    const result = findResult(messages, 'syntax');
    expect(result?.success).toBe(false);
    expect(result?.error).toMatch(/unexpected|syntax|end of input/i);
    expect(findAudit(messages, 'syntax', 'end')).toBeTruthy();
  });

  it('enforces execution timeouts (including string coercion)', async () => {
    vi.useFakeTimers();
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    const execPromise = handler({
      type: 'execute',
      id: 'timeout',
      code: 'await new Promise(() => {});',
      state: {},
      globals: {},
      timeout: '5',
    });

    await vi.advanceTimersByTimeAsync(5);
    await execPromise;
    vi.useRealTimers();

    const messages = collectMessages(postMessage);
    const result = findResult(messages, 'timeout');
    expect(result?.success).toBe(false);
    expect(result?.error).toBe('Execution timeout');
  });

  it('handles empty values, type boundaries, and timeout boundary values', async () => {
    vi.useFakeTimers();
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    const cases = [
      { id: 'null-code', code: null, state: null, globals: null, timeout: 0, expected: undefined },
      { id: 'undefined-code', code: undefined, state: undefined, globals: undefined, timeout: -1, expected: undefined },
      { id: 'empty-code', code: '', state: [], globals: {}, timeout: Number.MAX_SAFE_INTEGER, expected: undefined },
      { id: 'blank-code', code: '  \n\t', state: {}, globals: [], timeout: 0, expected: undefined },
      { id: 'string-timeout', code: 'return 42;', state: {}, globals: {}, timeout: '5', expected: 42 },
      {
        id: 'object-as-array',
        code: 'return Array.isArray(items) ? items.length : -1;',
        state: {},
        globals: { items: {} },
        timeout: 0,
        expected: -1,
      },
      { id: 'state-as-string', code: 'return Object.keys(state).length;', state: 'not-an-object', globals: {}, timeout: 0, expected: 0 },
    ];

    for (const entry of cases) {
      await handler({ type: 'execute', ...entry });
    }

    const messages = collectMessages(postMessage);
    for (const entry of cases) {
      expect(findResult(messages, entry.id)).toMatchObject({
        type: 'result',
        id: entry.id,
        success: true,
        data: entry.expected,
      });
    }

    vi.useRealTimers();
  });

  it('supports large inputs and deep state nesting', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    const depth = 60;
    const deepState = { payload: 'x'.repeat(100000), next: null };
    let cursor = deepState;
    for (let i = 0; i < depth; i += 1) {
      cursor.next = { next: null };
      cursor = cursor.next;
    }
    cursor.value = 7;

    const padding = ' '.repeat(100000);
    const code = `
      ${padding}
      let node = state;
      for (let i = 0; i < depth; i += 1) node = node.next;
      return [state.payload.length, node.value, Object.isFrozen(state), Object.isFrozen(state.next)].join(":");
    `;

    await handler({
      type: 'execute',
      id: 'large',
      code,
      state: deepState,
      globals: { depth },
      timeout: 1000,
    });

    const messages = collectMessages(postMessage);
    expect(findResult(messages, 'large')).toMatchObject({
      type: 'result',
      id: 'large',
      success: true,
      data: `100000:7:true:false`,
    });

    const auditStart = findAudit(messages, 'large', 'start');
    expect(auditStart?.payload?.codeLength).toBe(code.length);
  });

  it('handles concurrent and rapid sequential executions', async () => {
    const { postMessage, handler } = await loadWorker();
    expect(typeof handler).toBe('function');

    await Promise.all([
      handler({
        type: 'execute',
        id: 'c1',
        code: 'return state.value;',
        state: { value: 1 },
        globals: {},
        timeout: 1000,
      }),
      handler({
        type: 'execute',
        id: 'c2',
        code: 'return state.value;',
        state: { value: 2 },
        globals: {},
        timeout: 1000,
      }),
    ]);

    for (let i = 0; i < 5; i += 1) {
      await handler({
        type: 'execute',
        id: `s${i}`,
        code: 'return state.value;',
        state: { value: i },
        globals: {},
        timeout: 1000,
      });
    }

    const messages = collectMessages(postMessage);
    expect(findResult(messages, 'c1')).toMatchObject({ success: true, data: 1 });
    expect(findResult(messages, 'c2')).toMatchObject({ success: true, data: 2 });
    for (let i = 0; i < 5; i += 1) {
      expect(findResult(messages, `s${i}`)).toMatchObject({ success: true, data: i });
      expect(findAudit(messages, `s${i}`, 'end')).toBeTruthy();
    }
  });
});
