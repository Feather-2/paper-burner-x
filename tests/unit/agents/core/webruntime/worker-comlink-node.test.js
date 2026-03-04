import { describe, expect, it, vi } from 'vitest';
import { createWorkerAdapter, wrapNodeWorker } from '../../../../../js/agents/core/webruntime/worker-comlink-node.js';
import { MSG_CALL, MSG_CONSOLE, MSG_RETURN } from '../../../../../js/agents/core/webruntime/worker-comlink.js';

class MockNodeWorker {
  constructor({ supportsOff = true, supportsRemoveListener = true } = {}) {
    /** @type {Map<string, Set<Function>>} */
    this.handlers = new Map();
    /** @type {any[]} */
    this.posted = [];
    /** @type {Array<{ event: string, handler: Function }>} */
    this.offCalls = [];
    /** @type {Array<{ event: string, handler: Function }>} */
    this.removeListenerCalls = [];
    this.terminate = vi.fn(() => Promise.resolve(0));

    if (!supportsOff) this.off = undefined;
    if (!supportsRemoveListener) this.removeListener = undefined;
  }

  on(event, handler) {
    const set = this.handlers.get(event) || new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }

  off(event, handler) {
    this.offCalls.push({ event, handler });
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler);
  }

  removeListener(event, handler) {
    this.removeListenerCalls.push({ event, handler });
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler);
  }

  postMessage(payload) {
    this.posted.push(payload);
    this.lastPosted = payload;
  }

  emit(event, payload) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      handler(payload);
    }
  }

  listenerCount(event) {
    return this.handlers.get(event)?.size || 0;
  }
}

describe('worker-comlink-node', () => {
  describe('translateOutgoingMessage via adapter.postMessage', () => {
    it('translates MSG_CALL execute with object args to legacy execute payload', () => {
      const worker = new MockNodeWorker();
      const adapter = createWorkerAdapter(worker);

      adapter.postMessage({
        type: MSG_CALL,
        id: 11,
        method: 'execute',
        args: [{
          code: 'return 1;',
          filename: 'entry.js',
          state: { count: 1 },
          globals: { answer: 42 },
          timeout: 321,
        }],
      });

      expect(worker.lastPosted).toEqual({
        type: 'execute',
        id: 11,
        code: 'return 1;',
        filename: 'entry.js',
        state: { count: 1 },
        globals: { answer: 42 },
        timeout: 321,
      });
    });

    it('translates MSG_CALL execute with array args to legacy execute payload', () => {
      const worker = new MockNodeWorker();
      const adapter = createWorkerAdapter(worker);

      adapter.postMessage({
        type: MSG_CALL,
        id: 12,
        method: 'execute',
        args: ['return 2;', 'legacy.js', { count: 2 }, { answer: 84 }, 654],
      });

      expect(worker.lastPosted).toEqual({
        type: 'execute',
        id: 12,
        code: 'return 2;',
        filename: 'legacy.js',
        state: { count: 2 },
        globals: { answer: 84 },
        timeout: 654,
      });
    });
  });

  describe('translateIncomingMessage via adapter message listener', () => {
    it('translates legacy result to MSG_RETURN', () => {
      const worker = new MockNodeWorker();
      const adapter = createWorkerAdapter(worker);
      const onMessage = vi.fn();

      adapter.addEventListener('message', onMessage);
      worker.emit('message', {
        type: 'result',
        id: 21,
        success: true,
        data: { ok: true },
        error: null,
      });

      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledWith({
        data: {
          type: MSG_RETURN,
          id: 21,
          ok: true,
          value: { ok: true },
          error: null,
        },
      });
    });

    it('translates legacy log to MSG_CONSOLE log payload', () => {
      const worker = new MockNodeWorker();
      const adapter = createWorkerAdapter(worker);
      const onMessage = vi.fn();

      adapter.addEventListener('message', onMessage);
      worker.emit('message', {
        type: 'log',
        level: 'warn',
        args: ['slow-path'],
      });

      expect(onMessage).toHaveBeenCalledWith({
        data: {
          type: MSG_CONSOLE,
          method: 'log',
          args: ['warn', ['slow-path']],
        },
      });
    });

    it('translates legacy emit to MSG_CONSOLE emit payload', () => {
      const worker = new MockNodeWorker();
      const adapter = createWorkerAdapter(worker);
      const onMessage = vi.fn();

      adapter.addEventListener('message', onMessage);
      worker.emit('message', {
        type: 'emit',
        name: 'worker:tick',
        payload: { step: 1 },
      });

      expect(onMessage).toHaveBeenCalledWith({
        data: {
          type: MSG_CONSOLE,
          method: 'emit',
          args: ['worker:tick', { step: 1 }],
        },
      });
    });

    it('translates legacy audit to MSG_CONSOLE audit payload', () => {
      const worker = new MockNodeWorker();
      const adapter = createWorkerAdapter(worker);
      const onMessage = vi.fn();

      adapter.addEventListener('message', onMessage);
      worker.emit('message', {
        type: 'audit',
        event: 'execution:start',
        payload: { id: 99 },
      });

      expect(onMessage).toHaveBeenCalledWith({
        data: {
          type: MSG_CONSOLE,
          method: 'audit',
          args: ['execution:start', { id: 99 }],
        },
      });
    });
  });

  describe('createWorkerAdapter event wiring', () => {
    it('supports add/removeEventListener for message using off()', () => {
      const worker = new MockNodeWorker();
      const adapter = createWorkerAdapter(worker);
      const onMessage = vi.fn();

      adapter.addEventListener('message', onMessage);
      expect(worker.listenerCount('message')).toBe(1);

      worker.emit('message', {
        type: 'result',
        id: 1,
        success: true,
        data: 'before-remove',
      });
      expect(onMessage).toHaveBeenCalledTimes(1);

      adapter.removeEventListener('message', onMessage);
      expect(worker.listenerCount('message')).toBe(0);
      expect(worker.offCalls).toHaveLength(1);

      worker.emit('message', {
        type: 'result',
        id: 2,
        success: true,
        data: 'after-remove',
      });
      expect(onMessage).toHaveBeenCalledTimes(1);
    });

    it('supports add/removeEventListener for error', () => {
      const worker = new MockNodeWorker();
      const adapter = createWorkerAdapter(worker);
      const onError = vi.fn();

      adapter.addEventListener('error', onError);
      expect(worker.listenerCount('error')).toBe(1);

      const err = new Error('worker-fault');
      worker.emit('error', err);
      expect(onError).toHaveBeenCalledWith({ error: err });

      adapter.removeEventListener('error', onError);
      expect(worker.listenerCount('error')).toBe(0);
      expect(worker.offCalls).toHaveLength(1);
    });

    it('supports add/removeEventListener for exit', () => {
      const worker = new MockNodeWorker();
      const adapter = createWorkerAdapter(worker);
      const onExit = vi.fn();

      adapter.addEventListener('exit', onExit);
      expect(worker.listenerCount('exit')).toBe(1);

      worker.emit('exit', 7);
      expect(onExit).toHaveBeenCalledWith({ code: 7 });

      adapter.removeEventListener('exit', onExit);
      expect(worker.listenerCount('exit')).toBe(0);
      expect(worker.offCalls).toHaveLength(1);
    });

    it('replaces existing message listener when the same handler is re-added', () => {
      const worker = new MockNodeWorker();
      const adapter = createWorkerAdapter(worker);
      const onMessage = vi.fn();

      adapter.addEventListener('message', onMessage);
      expect(worker.listenerCount('message')).toBe(1);

      adapter.addEventListener('message', onMessage);
      expect(worker.listenerCount('message')).toBe(1);
      expect(worker.offCalls).toHaveLength(1);
      expect(worker.offCalls[0].event).toBe('message');

      worker.emit('message', {
        type: 'result',
        id: 3,
        success: true,
        data: 'single-fire',
      });
      expect(onMessage).toHaveBeenCalledTimes(1);

      adapter.removeEventListener('message', onMessage);
      expect(worker.listenerCount('message')).toBe(0);
    });

    it('replaces existing error listener when the same handler is re-added', () => {
      const worker = new MockNodeWorker();
      const adapter = createWorkerAdapter(worker);
      const onError = vi.fn();

      adapter.addEventListener('error', onError);
      expect(worker.listenerCount('error')).toBe(1);

      adapter.addEventListener('error', onError);
      expect(worker.listenerCount('error')).toBe(1);
      expect(worker.offCalls).toHaveLength(1);
      expect(worker.offCalls[0].event).toBe('error');

      const err = new Error('only-once');
      worker.emit('error', err);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith({ error: err });

      adapter.removeEventListener('error', onError);
      expect(worker.listenerCount('error')).toBe(0);
    });

    it('replaces existing exit listener when the same handler is re-added', () => {
      const worker = new MockNodeWorker();
      const adapter = createWorkerAdapter(worker);
      const onExit = vi.fn();

      adapter.addEventListener('exit', onExit);
      expect(worker.listenerCount('exit')).toBe(1);

      adapter.addEventListener('exit', onExit);
      expect(worker.listenerCount('exit')).toBe(1);
      expect(worker.offCalls).toHaveLength(1);
      expect(worker.offCalls[0].event).toBe('exit');

      worker.emit('exit', 13);
      expect(onExit).toHaveBeenCalledTimes(1);
      expect(onExit).toHaveBeenCalledWith({ code: 13 });

      adapter.removeEventListener('exit', onExit);
      expect(worker.listenerCount('exit')).toBe(0);
    });

    it('falls back to removeListener when off is unavailable', () => {
      const worker = new MockNodeWorker({ supportsOff: false, supportsRemoveListener: true });
      const adapter = createWorkerAdapter(worker);
      const onMessage = vi.fn();

      adapter.addEventListener('message', onMessage);
      adapter.addEventListener('message', onMessage);
      expect(worker.listenerCount('message')).toBe(1);
      expect(worker.removeListenerCalls).toHaveLength(1);

      adapter.removeEventListener('message', onMessage);

      expect(worker.removeListenerCalls).toHaveLength(2);
      expect(worker.listenerCount('message')).toBe(0);
    });
  });

  describe('wrapNodeWorker integration', () => {
    it('integrates with wrapWorker and bridges legacy execute/result/log flow', async () => {
      const worker = new MockNodeWorker();
      const onConsole = vi.fn();
      const api = wrapNodeWorker(worker, { timeout: 100, onConsole });

      const runFilePromise = api.runFile('/tmp/task.js');
      const runFileCall = worker.lastPosted;
      expect(runFileCall).toEqual({
        type: MSG_CALL,
        id: 1,
        method: 'runFile',
        args: ['/tmp/task.js'],
      });
      worker.emit('message', {
        type: MSG_RETURN,
        id: runFileCall.id,
        ok: true,
        value: 'runfile-ok',
      });
      await expect(runFilePromise).resolves.toBe('runfile-ok');

      const executePromise = api.execute({
        code: 'return 42;',
        filename: 'sandbox.js',
        state: { x: 1 },
        globals: { y: 2 },
        timeout: 250,
      });
      const executeCall = worker.lastPosted;
      expect(executeCall).toEqual({
        type: 'execute',
        id: 2,
        code: 'return 42;',
        filename: 'sandbox.js',
        state: { x: 1 },
        globals: { y: 2 },
        timeout: 250,
      });

      worker.emit('message', { type: 'log', level: 'info', args: ['executing'] });
      expect(onConsole).toHaveBeenCalledWith('log', ['info', ['executing']]);

      worker.emit('message', {
        type: 'result',
        id: executeCall.id,
        success: true,
        data: 42,
      });

      await expect(executePromise).resolves.toBe(42);

      api.terminate();
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('rejects pending execute when worker exits before response', async () => {
      const worker = new MockNodeWorker();
      const api = wrapNodeWorker(worker, { timeout: 1000 });

      const executePromise = api.execute({ code: 'return 1;' });
      expect(worker.lastPosted).toMatchObject({
        type: 'execute',
        code: 'return 1;',
      });

      worker.emit('exit', 9);
      await expect(executePromise).rejects.toThrow('Worker exited with code 9');
      expect(api.terminated).toBe(true);
    });
  });
});
