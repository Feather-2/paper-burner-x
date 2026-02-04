import { describe, it, expect, vi, beforeEach } from 'vitest';

const MODULE_PATH = '../../../../../js/agents/runtime/core/js-sandbox-worker.js';

function makeWorkerSelf() {
  const messages = [];
  const hostPostMessage = vi.fn((msg) => {
    messages.push(msg);
  });

  /** @type {any} */
  const self = {
    postMessage: hostPostMessage,
    fetch: vi.fn(),
    XMLHttpRequest: vi.fn(),
    WebSocket: vi.fn(),
    importScripts: vi.fn(),
  };

  return { self, messages, hostPostMessage };
}

async function importFresh(self) {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.stubGlobal('self', self);
  await import(MODULE_PATH);
}

function findAll(messages, type) {
  return messages.filter((m) => m?.type === type);
}

function findLast(messages, type) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.type === type) return messages[i];
  }
  return undefined;
}

async function execute(self, messages, payload) {
  messages.length = 0;
  await self.onmessage?.({ data: payload });
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('js-sandbox-worker (web worker entry script)', () => {
  it('best-effort undefines high-risk Worker globals and removes postMessage', async () => {
    const { self } = makeWorkerSelf();

    await importFresh(self);

    expect(self.fetch).toBeUndefined();
    expect(self.XMLHttpRequest).toBeUndefined();
    expect(self.WebSocket).toBeUndefined();
    expect(self.importScripts).toBeUndefined();
    expect(self.postMessage).toBeUndefined();
    expect(typeof self.onmessage).toBe('function');
  });

  it('executes benign code and returns a result', async () => {
    const { self, messages, hostPostMessage } = makeWorkerSelf();
    await importFresh(self);

    hostPostMessage.mockClear();
    await execute(self, messages, {
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
    expect(audits[0]).toMatchObject({ type: 'audit', event: 'start', id: 1 });
    expect(audits.at(-1)).toMatchObject({ type: 'audit', event: 'end', id: 1 });
  });

  it('blocks dangerous patterns via validation (import/constructor.constructor)', async () => {
    const { self, messages } = makeWorkerSelf();
    await importFresh(self);

    const cases = [
      { code: 'import("fs")', expectKeyword: 'import' },
      {
        code: 'constructor.constructor("return 1")()',
        expectKeyword: 'constructor',
      },
    ];

    for (const { code, expectKeyword } of cases) {
      await execute(self, messages, { type: 'execute', id: 1, code, state: {}, globals: {} });

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

  it('prevents fallback to host globals and blocks access to high-risk bindings (process)', async () => {
    expect(typeof process).toBe('object');

    const { self, messages } = makeWorkerSelf();
    await importFresh(self);

    await execute(self, messages, { type: 'execute', id: 1, code: 'return typeof process;' });

    const result = findLast(messages, 'result');
    expect(result).toMatchObject({
      type: 'result',
      id: 1,
      success: true,
      data: 'undefined',
    });

    const endAudit = findAll(messages, 'audit').at(-1);
    expect(endAudit?.event).toBe('end');
    expect(endAudit?.payload?.blockedGlobals).toContain('process');
  });

  it('prevents fallback for unknown identifiers (Buffer) without auditing', async () => {
    expect(typeof Buffer).toBe('function');

    const { self, messages } = makeWorkerSelf();
    await importFresh(self);

    await execute(self, messages, { type: 'execute', id: 1, code: 'return typeof Buffer;' });

    const result = findLast(messages, 'result');
    expect(result).toMatchObject({
      type: 'result',
      id: 1,
      success: true,
      data: 'undefined',
    });

    const endAudit = findAll(messages, 'audit').at(-1);
    expect(endAudit?.payload?.blockedGlobals).toEqual([]);
  });

  it('supports defineProperty and hardens prototype operations on the sandbox proxy', async () => {
    const { self, messages } = makeWorkerSelf();
    await importFresh(self);

    await execute(self, messages, {
      type: 'execute',
      id: 1,
      code: [
        'Object.defineProperty(globalThis, "defined", { value: 42, enumerable: true });',
        'return { proto: Object.getPrototypeOf(globalThis), setProto: Reflect.setPrototypeOf(globalThis, {}), defined };',
      ].join('\n'),
    });

    const result = findLast(messages, 'result');
    expect(result).toMatchObject({
      type: 'result',
      id: 1,
      success: true,
      data: { proto: null, setProto: false, defined: 42 },
    });
  });
});

