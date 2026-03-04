import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wrapNodeWorker } from '../../webruntime/worker-comlink-node.js';

function createSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

class FakeNodeWorker {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.handlers = new Map();
    /** @type {any[]} */
    this.sent = [];
  }

  on(event, handler) {
    const set = this.handlers.get(event) || new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }

  off(event, handler) {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler);
  }

  emit(event, payload) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      handler(payload);
    }
  }

  postMessage(payload) {
    this.sent.push(payload);
  }

  terminate() {
    return Promise.resolve(0);
  }
}

describe('skill-sandbox unified comlink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('node:worker_threads');
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('keeps Comlink RPC behavior for Node workers', async () => {
    const nodeWorker = new FakeNodeWorker();
    const wrapper = wrapNodeWorker(nodeWorker, { timeout: 100 });

    const runFilePromise = wrapper.runFile('/tmp/a.js');
    const runFileMsg = nodeWorker.sent[0];
    expect(runFileMsg?.type).toBe('comlink:call');
    expect(runFileMsg?.method).toBe('runFile');

    nodeWorker.emit('message', {
      type: 'comlink:return',
      id: runFileMsg.id,
      ok: true,
      value: 'ok',
    });
    await expect(runFilePromise).resolves.toBe('ok');

    wrapper.terminate();
  });

  it('bridges legacy execute/result messages through wrapNodeWorker', async () => {
    const nodeWorker = new FakeNodeWorker();
    const onConsole = vi.fn();
    const wrapper = wrapNodeWorker(nodeWorker, { timeout: 100, onConsole });

    const executePromise = wrapper.execute({ code: 'return 42;' });
    const executeMsg = nodeWorker.sent[0];
    expect(executeMsg?.type).toBe('execute');
    expect(typeof executeMsg?.id).toBe('number');
    expect(executeMsg?.code).toBe('return 42;');

    nodeWorker.emit('message', { type: 'log', level: 'info', args: ['from-worker'] });
    nodeWorker.emit('message', {
      type: 'result',
      id: executeMsg.id,
      success: true,
      data: 42,
    });

    await expect(executePromise).resolves.toBe(42);
    expect(onConsole).toHaveBeenCalledWith('log', ['info', ['from-worker']]);

    wrapper.terminate();
  });

  it('handles RPC timeout via worker-comlink timeout flow', async () => {
    const nodeWorker = new FakeNodeWorker();
    const wrapper = wrapNodeWorker(nodeWorker, { timeout: 20 });

    await expect(wrapper.execute({ code: 'while(true){}' })).rejects.toThrow('Worker call timeout: execute');

    wrapper.terminate();
  });

  it('returns worker error when Node worker emits error event', async () => {
    /** @type {{ payload?: any }} */
    const captured = {};

    vi.doMock('node:worker_threads', () => {
      class MockWorker extends FakeNodeWorker {
        postMessage(payload) {
          captured.payload = payload;
          setTimeout(() => {
            this.emit('error', new Error('worker crash'));
          }, 0);
        }
      }

      return { Worker: MockWorker };
    });

    const { executeFallbackInNodeWorker } = await import('../skill-sandbox.js');
    const result = await executeFallbackInNodeWorker(
      {
        code: 'return 1;',
        timeoutMs: 5000,
      },
      createSilentLogger()
    );

    expect(captured.payload?.type).toBe('execute');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('worker crash');
    expect(result.mode).toBe('node-worker');
  });

  it('returns worker exit error when Node worker exits before response', async () => {
    /** @type {{ payload?: any }} */
    const captured = {};

    vi.doMock('node:worker_threads', () => {
      class MockWorker extends FakeNodeWorker {
        postMessage(payload) {
          captured.payload = payload;
          setTimeout(() => {
            this.emit('exit', 3);
          }, 0);
        }
      }

      return { Worker: MockWorker };
    });

    const { executeFallbackInNodeWorker } = await import('../skill-sandbox.js');
    const result = await executeFallbackInNodeWorker(
      {
        code: 'return 1;',
        timeoutMs: 5000,
      },
      createSilentLogger()
    );

    expect(captured.payload?.type).toBe('execute');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Worker exited with code 3');
    expect(result.mode).toBe('node-worker');
  });
});
