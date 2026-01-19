import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { WorkerRpcClient } from '../../../../../js/agents/runtime/core/worker-rpc.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FakeWorker {
  constructor({ handlers = {}, supportsEventTarget = true } = {}) {
    this.handlers = handlers;
    this.supportsEventTarget = supportsEventTarget;

    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;

    this.postMessageCalls = [];
    this.cancelCalls = [];
    this.lastRequestId = null;

    this.terminated = false;
    this.throwOnPostMessage = false;

    this._listeners = {
      message: new Set(),
      error: new Set(),
      messageerror: new Set(),
    };

    if (supportsEventTarget) {
      this.addEventListener = (type, fn) => {
        if (!this._listeners[type]) return;
        this._listeners[type].add(fn);
      };
      this.removeEventListener = (type, fn) => {
        if (!this._listeners[type]) return;
        this._listeners[type].delete(fn);
      };
    }
  }

  postMessage(message, transferables) {
    if (this.throwOnPostMessage) throw new Error('postMessage boom');
    if (this.terminated) throw new Error('Worker is terminated');

    this.postMessageCalls.push([message, transferables]);

    const msg = message && typeof message === 'object' ? message : null;
    if (!msg) return;

    if (msg.type === 'rpc:cancel') {
      this.cancelCalls.push(msg);
      return;
    }

    if (msg.type !== 'rpc:request') return;
    const { id, method, params } = msg;
    this.lastRequestId = id;

    const handler = this.handlers[method];
    if (typeof handler !== 'function') {
      queueMicrotask(() => {
        this._emit('message', { type: 'rpc:response', id, ok: false, error: `No handler: ${method}` });
      });
      return;
    }

    Promise.resolve()
      .then(() => handler(params))
      .then(
        (result) => this._emit('message', { type: 'rpc:response', id, ok: true, result }),
        (err) => {
          if (typeof err === 'string') {
            this._emit('message', { type: 'rpc:response', id, ok: false, error: err });
            return;
          }
          if (err && typeof err === 'object') {
            this._emit('message', { type: 'rpc:response', id, ok: false, error: err });
            return;
          }
          this._emit('message', { type: 'rpc:response', id, ok: false, message: String(err) });
        }
      );
  }

  terminate() {
    this.terminated = true;
  }

  crash(err = new Error('crash')) {
    this.terminated = true;
    this._emit('error', err);
  }

  _emit(type, payload) {
    if (type === 'message') {
      const evt = { data: payload };
      try {
        this.onmessage?.(evt);
      } catch {
        // ignore
      }
      for (const fn of this._listeners.message) {
        try {
          fn(evt);
        } catch {
          // ignore
        }
      }
      return;
    }

    if (type === 'error') {
      const evt = payload;
      try {
        this.onerror?.(evt);
      } catch {
        // ignore
      }
      for (const fn of this._listeners.error) {
        try {
          fn(evt);
        } catch {
          // ignore
        }
      }
      return;
    }

    if (type === 'messageerror') {
      const evt = payload;
      try {
        this.onmessageerror?.(evt);
      } catch {
        // ignore
      }
      for (const fn of this._listeners.messageerror) {
        try {
          fn(evt);
        } catch {
          // ignore
        }
      }
    }
  }
}

describe('WorkerRpcClient', () => {
  it('calls worker method and returns result (EventTarget path)', async () => {
    const worker = new FakeWorker({
      supportsEventTarget: true,
      handlers: {
        sum: ({ a, b }) => a + b,
      },
    });

    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });
    const result = await client.call('sum', { a: 1, b: 2 });

    expect(result).toBe(3);
    expect(worker.postMessageCalls.length).toBe(1);
    expect(worker.postMessageCalls[0][0].type).toBe('rpc:request');
    expect(worker.postMessageCalls[0][1]).toBe(undefined);
  });

  it('works without addEventListener (onmessage fallback path)', async () => {
    const worker = new FakeWorker({
      supportsEventTarget: false,
      handlers: { echo: (v) => v },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });
    const out = await client.call('echo', { ok: true });
    expect(out).toEqual({ ok: true });
  });

  it('rejects when method is missing', async () => {
    const worker = new FakeWorker({ handlers: {} });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });
    await expect(client.call('', {})).rejects.toThrow(/method is required/i);
  });

  it('throws when no worker factory is provided', () => {
    const client = new WorkerRpcClient();
    expect(() => client.call('x', {})).toThrow(/no worker available/i);
  });

  it('rejects with normalized remote error (object + code/name)', async () => {
    const worker = new FakeWorker({
      handlers: {
        fail: () => {
          throw { message: 'nope', name: 'RemoteError', code: 'E_NOPE' };
        },
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    await expect(client.call('fail', {})).rejects.toMatchObject({
      message: 'nope',
      name: 'RemoteError',
      code: 'E_NOPE',
    });
  });

  it('rejects with normalized remote error (string)', async () => {
    const worker = new FakeWorker({
      handlers: {
        fail: () => {
          throw 'bad';
        },
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });
    await expect(client.call('fail', {})).rejects.toThrow(/bad/);
  });

  it('supports timeout and sends cancel message', async () => {
    const worker = new FakeWorker({
      handlers: {
        hang: () => new Promise(() => {}),
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 50 });

    await expect(client.call('hang', null, { timeoutMs: 30 })).rejects.toThrow(/timeout/i);

    expect(worker.cancelCalls.length).toBe(1);
    expect(worker.cancelCalls[0].reason).toBe('timeout');
    expect(worker.cancelCalls[0].id).toBe(worker.lastRequestId);
  });

  it('supports AbortSignal: already aborted does not create worker', async () => {
    let created = 0;
    const client = new WorkerRpcClient({
      timeoutMs: 200,
      createWorker: () => {
        created += 1;
        return new FakeWorker({ handlers: { sum: ({ a, b }) => a + b } });
      },
    });

    const controller = new AbortController();
    controller.abort('nope');

    await expect(client.call('sum', { a: 1, b: 2 }, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(created).toBe(0);
  });

  it('supports AbortSignal: abort after send rejects and sends cancel', async () => {
    const worker = new FakeWorker({
      handlers: {
        delayed: async () => {
          await sleep(80);
          return 'ok';
        },
      },
    });

    const client = new WorkerRpcClient({ worker, timeoutMs: 500 });
    const controller = new AbortController();

    const promise = client.call('delayed', null, { signal: controller.signal });
    setTimeout(() => controller.abort('stop'), 10);

    await expect(promise).rejects.toMatchObject({
      name: 'AbortError',
      message: expect.stringMatching(/stop|aborted/i),
    });

    expect(worker.cancelCalls.length).toBe(1);
    expect(worker.cancelCalls[0].reason).toBe('aborted');
    expect(worker.cancelCalls[0].id).toBe(worker.lastRequestId);

    // Ensure late worker responses don't change outcome / cause flakiness.
    await sleep(120);
  });

  it('passes transferables to postMessage', async () => {
    const worker = new FakeWorker({
      handlers: {
        byteLength: (buf) => (buf instanceof ArrayBuffer ? buf.byteLength : -1),
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const buf = new ArrayBuffer(8);
    const result = await client.call('byteLength', buf, { transferables: [buf] });

    expect(result).toBe(8);
    expect(worker.postMessageCalls.length).toBe(1);
    expect(worker.postMessageCalls[0][1][0]).toBe(buf);
  });

  it('worker crash rejects pending calls and recreates on next call', async () => {
    let created = 0;
    let current = null;
    const createWorker = () => {
      created += 1;
      current = new FakeWorker({
        handlers: {
          hang: () => new Promise(() => {}),
          sum: ({ a, b }) => a + b,
        },
      });
      return current;
    };

    const client = new WorkerRpcClient({ createWorker, timeoutMs: 1_000 });

    const hanging = client.call('hang', null, { timeoutMs: 1_000 });
    await sleep(10);
    current.crash(new Error('crash!'));

    await expect(hanging).rejects.toThrow(/crash!/i);
    expect(client.worker).toBe(null);
    expect(created).toBe(1);

    const ok = await client.call('sum', { a: 2, b: 3 });
    expect(ok).toBe(5);
    expect(created).toBe(2);
  });

  it('terminate rejects pending calls and allows later reuse', async () => {
    let created = 0;
    const createWorker = () => {
      created += 1;
      return new FakeWorker({ handlers: { hang: () => new Promise(() => {}), ok: () => 'ok' } });
    };

    const client = new WorkerRpcClient({ createWorker, timeoutMs: 1_000 });

    const p = client.call('hang', null, { timeoutMs: 1_000 });
    await sleep(10);
    client.terminate('bye');

    await expect(p).rejects.toThrow(/bye/i);

    const out = await client.call('ok', null);
    expect(out).toBe('ok');
    expect(created).toBe(2);
  });

  it('rejects if postMessage throws', async () => {
    const worker = new FakeWorker({ handlers: {} });
    worker.throwOnPostMessage = true;
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });
    await expect(client.call('x', {})).rejects.toThrow(/postMessage boom/);
  });
});
