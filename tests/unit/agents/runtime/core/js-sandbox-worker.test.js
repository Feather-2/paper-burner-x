import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fixtures = vi.hoisted(() => ({
  getLargeString: vi.fn((length = 100000) => 'X'.repeat(length)),
  getDeepState: vi.fn((depth = 40) => {
    let node = { value: 'leaf' };
    for (let i = 0; i < depth; i += 1) {
      node = { level: i, child: node };
    }
    return node;
  }),
}));

vi.mock('virtual:js-sandbox-worker-fixtures', () => fixtures, { virtual: true });

import { getLargeString, getDeepState } from 'virtual:js-sandbox-worker-fixtures';

const MODULE_PATH = '../../../../../js/agents/runtime/core/js-sandbox-worker.js';

let restoreSelf = null;

async function setupWorker(options = {}) {
  const { postMessageImpl, selfOverrides } = options;
  if (restoreSelf) {
    restoreSelf();
    restoreSelf = null;
  }

  const originalSelf = globalThis.self;
  const postMessage = Object.prototype.hasOwnProperty.call(options, 'postMessageImpl')
    ? postMessageImpl
    : vi.fn();
  const selfStub = { ...(selfOverrides ?? {}), postMessage };
  globalThis.self = selfStub;

  vi.resetModules();
  await import(MODULE_PATH);

  restoreSelf = () => {
    if (originalSelf === undefined) {
      delete globalThis.self;
    } else {
      globalThis.self = originalSelf;
    }
  };

  return { self: selfStub, postMessage };
}

function collectMessages(postMessage) {
  return postMessage.mock.calls.map(([message]) => message);
}

function findResult(messages, id) {
  return messages.find((msg) => msg.type === 'result' && msg.id === id);
}

function findAudit(messages, id, event) {
  return messages.find((msg) => msg.type === 'audit' && msg.id === id && msg.event === event);
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  if (restoreSelf) {
    restoreSelf();
    restoreSelf = null;
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('self.onmessage', () => {
  it('best-effort hardens high-risk Worker globals but still communicates with host', async () => {
    const fetchMock = vi.fn();
    const xhrMock = vi.fn();
    const webSocketMock = vi.fn();
    const importScriptsMock = vi.fn();

    const { self, postMessage } = await setupWorker({
      selfOverrides: {
        fetch: fetchMock,
        XMLHttpRequest: xhrMock,
        WebSocket: webSocketMock,
        importScripts: importScriptsMock,
      },
    });

    expect(self.fetch).toBeUndefined();
    expect(self.XMLHttpRequest).toBeUndefined();
    expect(self.WebSocket).toBeUndefined();
    expect(self.importScripts).toBeUndefined();
    expect(self.postMessage).toBeUndefined();

    await self.onmessage({
      data: {
        type: 'execute',
        id: 'hardening',
        code: 'return 1',
      },
    });

    const messages = collectMessages(postMessage);
    expect(findResult(messages, 'hardening')).toMatchObject({ success: true, data: 1 });
  });

  it('ignores non-execute messages', async () => {
    const { self, postMessage } = await setupWorker();

    await self.onmessage({ data: { type: 'noop', id: 'noop' } });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('executes code with state/globals and posts audit events', async () => {
    const { self, postMessage } = await setupWorker();

    const code = `
      state.mutated = 1;
      return Object.isFrozen(state) && state.mutated === undefined && state.value + extra;
    `;

    await self.onmessage({
      data: {
        type: 'execute',
        id: 'ok',
        code,
        state: { value: 2 },
        globals: { extra: 3 },
      },
    });

    const messages = collectMessages(postMessage);
    const start = findAudit(messages, 'ok', 'start');
    expect(start).toMatchObject({
      type: 'audit',
      id: 'ok',
      event: 'start',
      payload: { codeLength: code.length, timeoutMs: 30000 },
    });

    const result = findResult(messages, 'ok');
    expect(result).toMatchObject({
      type: 'result',
      id: 'ok',
      success: true,
      data: 5,
    });
    expect(result.metrics.duration).toEqual(expect.any(Number));

    const end = findAudit(messages, 'ok', 'end');
    expect(end.payload.blockedGlobals).toEqual([]);
  });

  it('posts console logs and emit events', async () => {
    const { self, postMessage } = await setupWorker();

    const code = `
      console.log("hi", 1);
      console.warn("warn");
      console.error({ err: true });
      console.info("info");
      console.debug("dbg");
      emit("evt", { ok: true });
      return "done";
    `;

    await self.onmessage({ data: { type: 'execute', id: 'logs', code } });

    const messages = collectMessages(postMessage);
    expect(messages).toContainEqual({ type: 'log', level: 'log', args: ['hi', '1'] });
    expect(messages).toContainEqual({ type: 'log', level: 'warn', args: ['warn'] });
    expect(messages).toContainEqual({ type: 'log', level: 'error', args: ['[object Object]'] });
    expect(messages).toContainEqual({ type: 'log', level: 'info', args: ['info'] });
    expect(messages).toContainEqual({ type: 'log', level: 'debug', args: ['dbg'] });
    expect(messages).toContainEqual({ type: 'emit', name: 'evt', payload: { ok: true } });

    const result = findResult(messages, 'logs');
    expect(result).toMatchObject({ success: true, data: 'done' });
  });

  it('provides sandboxed globalThis/self references without exposing host globals', async () => {
    const { self, postMessage } = await setupWorker();

    await self.onmessage({
      data: {
        type: 'execute',
        id: 'sandbox-global',
        code: 'return globalThis === self && typeof globalThis.setTimeout === "undefined";',
      },
    });

    const messages = collectMessages(postMessage);
    expect(findResult(messages, 'sandbox-global')).toMatchObject({ success: true, data: true });
  });

  it('blocks unsafe patterns before execution (dynamic import)', async () => {
    const { self, postMessage } = await setupWorker();

    await self.onmessage({
      data: {
        type: 'execute',
        id: 'blocked-import',
        code: 'return import("x")',
      },
    });

    const messages = collectMessages(postMessage);
    const blocked = findAudit(messages, 'blocked-import', 'blocked');
    expect(blocked).toMatchObject({
      type: 'audit',
      id: 'blocked-import',
      event: 'blocked',
    });
    expect(blocked.payload.reason).toMatch(/Blocked pattern/);

    const result = findResult(messages, 'blocked-import');
    expect(result).toMatchObject({
      type: 'result',
      id: 'blocked-import',
      success: false,
    });
    expect(result.error).toMatch(/Security: Blocked pattern/);
    expect(result.metrics.blocked).toBe(true);
  });

  it('blocks unsafe patterns before execution (constructor.constructor)', async () => {
    const { self, postMessage } = await setupWorker();

    await self.onmessage({
      data: {
        type: 'execute',
        id: 'blocked-ctor-chain',
        code: 'return constructor.constructor("return 1")()',
      },
    });

    const messages = collectMessages(postMessage);
    const result = findResult(messages, 'blocked-ctor-chain');
    expect(result).toMatchObject({ success: false });
    expect(result.error).toMatch(/Security: Blocked pattern/);

    const blocked = findAudit(messages, 'blocked-ctor-chain', 'blocked');
    expect(blocked.payload.reason).toMatch(/constructor/);
  });

  it('hides blocked globals and records accesses', async () => {
    const { self, postMessage } = await setupWorker();

    const code = 'return [typeof fetch, typeof postMessage, typeof constructor, typeof notReal].join("|")';

    await self.onmessage({
      data: {
        type: 'execute',
        id: 'blocked-globals',
        code,
        globals: { fetch: () => 'nope', extra: 1 },
      },
    });

    const messages = collectMessages(postMessage);
    const result = findResult(messages, 'blocked-globals');
    expect(result).toMatchObject({ success: true, data: 'undefined|undefined|undefined|undefined' });

    const end = findAudit(messages, 'blocked-globals', 'end');
    expect(end.payload.blockedGlobals).toEqual(
      expect.arrayContaining(['fetch', 'postMessage', 'constructor'])
    );
    expect(end.payload.blockedGlobals).not.toContain('notReal');
  });

  it('prevents setting blocked globals (set trap) and records audit data', async () => {
    const { self, postMessage } = await setupWorker();

    await self.onmessage({
      data: {
        type: 'execute',
        id: 'blocked-set',
        code: 'fetch = 123; return typeof fetch;',
      },
    });

    const messages = collectMessages(postMessage);
    expect(findResult(messages, 'blocked-set')).toMatchObject({ success: true, data: 'undefined' });

    const end = findAudit(messages, 'blocked-set', 'end');
    expect(end.payload.blockedGlobals).toEqual(expect.arrayContaining(['fetch']));
  });

  it('prevents defining blocked globals (defineProperty trap) and reports errors', async () => {
    const { self, postMessage } = await setupWorker();

    await self.onmessage({
      data: {
        type: 'execute',
        id: 'blocked-define',
        code: `
          "use strict";
          Object.defineProperty(self, "fetch", { value: 1 });
          return "unreachable";
        `,
      },
    });

    const messages = collectMessages(postMessage);
    const result = findResult(messages, 'blocked-define');
    expect(result).toMatchObject({ success: false });
    expect(result.error).toMatch(/fetch|defineProperty/i);

    const end = findAudit(messages, 'blocked-define', 'end');
    expect(end.payload.blockedGlobals).toEqual(expect.arrayContaining(['fetch']));
  });

  it('reports runtime errors', async () => {
    const { self, postMessage } = await setupWorker();

    await self.onmessage({
      data: {
        type: 'execute',
        id: 'boom',
        code: 'throw new Error("boom")',
      },
    });

    const messages = collectMessages(postMessage);
    const result = findResult(messages, 'boom');
    expect(result).toMatchObject({ success: false, error: 'boom' });

    const end = findAudit(messages, 'boom', 'end');
    expect(end).toBeTruthy();
  });

  it('does not crash if host postMessage throws', async () => {
    const throwingPostMessage = vi.fn(() => {
      throw new Error('postMessage failed');
    });

    const { self } = await setupWorker({ postMessageImpl: throwingPostMessage });

    await expect(
      self.onmessage({
        data: {
          type: 'execute',
          id: 'postMessage-throws',
          code: 'return 1',
        },
      })
    ).resolves.toBeUndefined();
  });

  it('times out long-running code', async () => {
    vi.useFakeTimers();
    const { self, postMessage } = await setupWorker();

    const execPromise = self.onmessage({
      data: {
        type: 'execute',
        id: 'timeout',
        code: 'await new Promise(() => {})',
        timeout: 10,
      },
    });

    await vi.advanceTimersByTimeAsync(10);
    await execPromise;

    const messages = collectMessages(postMessage);
    const result = findResult(messages, 'timeout');
    expect(result).toMatchObject({ success: false, error: 'Execution timeout' });
  });

  it('handles timeout boundary values and string coercion', async () => {
    vi.useFakeTimers();
    const { self, postMessage } = await setupWorker();

    const cases = [
      { id: 'timeout-0', timeout: 0 },
      { id: 'timeout-neg', timeout: -1 },
      { id: 'timeout-max', timeout: Number.MAX_SAFE_INTEGER },
      { id: 'timeout-string', timeout: '5' },
    ];

    for (const testCase of cases) {
      await self.onmessage({
        data: {
          type: 'execute',
          id: testCase.id,
          code: 'return 42',
          timeout: testCase.timeout,
        },
      });
    }

    const messages = collectMessages(postMessage);
    for (const testCase of cases) {
      const result = findResult(messages, testCase.id);
      expect(result).toMatchObject({ success: true, data: 42 });
    }
  });

  it('handles empty values and array-like objects', async () => {
    const { self, postMessage } = await setupWorker();

    const cases = [
      { id: 'null-code', code: null, state: null, globals: undefined, expected: undefined },
      { id: 'undefined-code', code: undefined, state: undefined, globals: {}, expected: undefined },
      { id: 'empty-code', code: '', state: {}, globals: null, expected: undefined },
      { id: 'whitespace-code', code: '   ', state: {}, globals: [], expected: undefined },
      {
        id: 'primitive-state',
        code: 'return Object.keys(state).length',
        state: 0,
        globals: {},
        expected: 0,
      },
      {
        id: 'array-state',
        code: 'return Array.isArray(state) && state.length === 0',
        state: [],
        globals: {},
        expected: true,
      },
      {
        id: 'object-state',
        code: 'return !Array.isArray(state) && Object.keys(state).length === 0',
        state: {},
        globals: {},
        expected: true,
      },
      {
        id: 'array-like-object',
        code: 'return Array.isArray(state)',
        state: { 0: 'x', length: 1 },
        globals: {},
        expected: false,
      },
      {
        id: 'object-as-array',
        code: 'return Array.isArray(items) ? items.length : -1',
        state: {},
        globals: { items: {} },
        expected: -1,
      },
    ];

    for (const testCase of cases) {
      await self.onmessage({
        data: {
          type: 'execute',
          id: testCase.id,
          code: testCase.code,
          state: testCase.state,
          globals: testCase.globals,
        },
      });
    }

    const messages = collectMessages(postMessage);
    for (const testCase of cases) {
      const result = findResult(messages, testCase.id);
      expect(result).toMatchObject({ success: true, data: testCase.expected });
    }
  });

  it('handles large code, long strings, and deep nested state', async () => {
    const { self, postMessage } = await setupWorker();

    const large = getLargeString(100000);
    const depth = 60;
    const deep = getDeepState(depth);
    const code = `/*${large}*/
      let node = state.deep;
      for (let i = 0; i < ${depth}; i += 1) {
        node = node.child;
      }
      return [state.payload.length, node.value].join(':');
    `;

    await self.onmessage({
      data: {
        type: 'execute',
        id: 'resource',
        code,
        state: { payload: large, deep },
        globals: {},
      },
    });

    const messages = collectMessages(postMessage);
    const start = findAudit(messages, 'resource', 'start');
    expect(start.payload.codeLength).toBe(code.length);

    const result = findResult(messages, 'resource');
    expect(result).toMatchObject({ success: true, data: `${large.length}:leaf` });
  });

  it('handles concurrent executions', async () => {
    const { self, postMessage } = await setupWorker();

    const first = self.onmessage({
      data: { type: 'execute', id: 'c1', code: 'return state.value', state: { value: 1 } },
    });
    const second = self.onmessage({
      data: { type: 'execute', id: 'c2', code: 'return state.value', state: { value: 2 } },
    });

    await Promise.all([first, second]);

    const messages = collectMessages(postMessage);
    expect(findResult(messages, 'c1')).toMatchObject({ success: true, data: 1 });
    expect(findResult(messages, 'c2')).toMatchObject({ success: true, data: 2 });
  });

  it('handles rapid sequential executions', async () => {
    const { self, postMessage } = await setupWorker();

    for (let i = 0; i < 5; i += 1) {
      await self.onmessage({
        data: {
          type: 'execute',
          id: `s${i}`,
          code: 'return state.value',
          state: { value: i },
        },
      });
    }

    const messages = collectMessages(postMessage);
    for (let i = 0; i < 5; i += 1) {
      expect(findResult(messages, `s${i}`)).toMatchObject({ success: true, data: i });
    }
  });
});
