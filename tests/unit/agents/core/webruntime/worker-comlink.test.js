import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  wrapWorker, exposeApi,
  MSG_CALL, MSG_RETURN, MSG_CONSOLE,
} from '../../../../../js/agents/core/webruntime/worker-comlink.js';

function createMockWorker() {
  const listeners = new Map();
  return {
    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    },
    removeEventListener(event, fn) {
      listeners.get(event)?.delete(fn);
    },
    postMessage(data) {
      this._lastMessage = data;
      this._messages.push(data);
    },
    _receive(data) {
      const fns = listeners.get('message');
      if (fns) for (const fn of fns) fn({ data });
    },
    terminate: vi.fn(),
    _messages: [],
    _lastMessage: null,
  };
}

function createMockSelf() {
  const listeners = new Map();
  const posted = [];
  return {
    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    },
    postMessage(data) { posted.push(data); },
    _receive(data) {
      const fns = listeners.get('message');
      if (fns) for (const fn of fns) fn({ data });
    },
    _posted: posted,
  };
}

describe('worker-comlink', () => {
  let worker;

  beforeEach(() => {
    worker = createMockWorker();
  });

  describe('wrapWorker', () => {
    it('returns execute, runFile, clearCache, terminate', () => {
      const api = wrapWorker({ worker });
      expect(typeof api.execute).toBe('function');
      expect(typeof api.runFile).toBe('function');
      expect(typeof api.clearCache).toBe('function');
      expect(typeof api.terminate).toBe('function');
      expect(api.terminated).toBe(false);
      api.terminate();
    });

    it('execute sends correct MSG_CALL message', async () => {
      const api = wrapWorker({ worker });
      const p = api.execute('console.log(1)', 'test.js').catch(() => {});
      expect(worker._lastMessage).toEqual({
        type: MSG_CALL, id: 1, method: 'execute', args: ['console.log(1)', 'test.js'],
      });
      api.terminate();
      await p;
    });

    it('resolves when MSG_RETURN ok:true', async () => {
      const api = wrapWorker({ worker });
      const p = api.execute('1+1');
      worker._receive({ type: MSG_RETURN, id: 1, ok: true, value: 2 });
      await expect(p).resolves.toBe(2);
      api.terminate();
    });

    it('rejects when MSG_RETURN ok:false', async () => {
      const api = wrapWorker({ worker });
      const p = api.execute('bad');
      worker._receive({ type: MSG_RETURN, id: 1, ok: false, error: 'syntax' });
      await expect(p).rejects.toThrow('syntax');
      api.terminate();
    });

    it('rejects after terminate', async () => {
      const api = wrapWorker({ worker });
      api.terminate();
      await expect(api.execute('x')).rejects.toThrow('Worker terminated');
    });

    it('calls worker.terminate()', () => {
      const api = wrapWorker({ worker });
      api.terminate();
      expect(worker.terminate).toHaveBeenCalled();
      expect(api.terminated).toBe(true);
    });

    it('rejects all pending on terminate', async () => {
      const api = wrapWorker({ worker });
      const p1 = api.execute('a').catch((e) => e);
      const p2 = api.runFile('b').catch((e) => e);
      api.terminate();
      const e1 = await p1;
      const e2 = await p2;
      expect(e1).toBeInstanceOf(Error);
      expect(e1.message).toBe('Worker terminated');
      expect(e2).toBeInstanceOf(Error);
      expect(e2.message).toBe('Worker terminated');
    });

    it('onConsole fires on MSG_CONSOLE', () => {
      const calls = [];
      const api = wrapWorker({ worker, onConsole: (m, a) => calls.push({ m, a }) });
      worker._receive({ type: MSG_CONSOLE, method: 'log', args: ['hi'] });
      expect(calls).toEqual([{ m: 'log', a: ['hi'] }]);
      api.terminate();
    });

    it('rejects on timeout', async () => {
      const api = wrapWorker({ worker, timeout: 50 });
      const p = api.execute('slow');
      await expect(p).rejects.toThrow('Worker call timeout');
      api.terminate();
    });
  });

  describe('exposeApi', () => {
    it('registers message listener and dispatches calls', async () => {
      const mockSelf = createMockSelf();
      const api = { add: vi.fn().mockResolvedValue(3) };
      exposeApi(api, mockSelf);
      mockSelf._receive({ type: MSG_CALL, id: 1, method: 'add', args: [1, 2] });
      await new Promise((r) => setTimeout(r, 10));
      expect(api.add).toHaveBeenCalledWith(1, 2);
      expect(mockSelf._posted).toEqual([
        { type: MSG_RETURN, id: 1, ok: true, value: 3 },
      ]);
    });

    it('returns error for unknown method', async () => {
      const mockSelf = createMockSelf();
      exposeApi({}, mockSelf);
      mockSelf._receive({ type: MSG_CALL, id: 1, method: 'nope', args: [] });
      await new Promise((r) => setTimeout(r, 10));
      expect(mockSelf._posted[0].ok).toBe(false);
      expect(mockSelf._posted[0].error).toContain('Unknown method');
    });
  });
});