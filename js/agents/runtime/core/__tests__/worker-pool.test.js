import { afterEach, describe, expect, it } from 'vitest';
import { TaskPriority, WorkerPool } from '../worker-pool.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(5);
  }
  throw new Error('Timed out waiting for condition');
}

let mockWorkerSeq = 0;

class MockWorker {
  constructor(options = {}) {
    this._options = options;
    this._listeners = new Map();
    this._inFlight = new Map();
    this._workerId = `mock-worker-${++mockWorkerSeq}`;
    this.terminated = false;
  }

  addEventListener(type, listener) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this._listeners.get(type);
    if (listeners) listeners.delete(listener);
  }

  postMessage(message) {
    if (this.terminated || !message || typeof message !== 'object') return;

    if (message.type === 'rpc:cancel') {
      const timer = this._inFlight.get(message.id);
      if (timer) {
        clearTimeout(timer);
        this._inFlight.delete(message.id);
      }
      this._options.onCancel?.({ id: message.id, workerId: this._workerId });
      return;
    }

    if (message.type !== 'rpc:request') return;

    const context = {
      id: message.id,
      method: message.method,
      params: message.params,
      workerId: this._workerId,
    };
    this._options.onRequest?.(context);

    const behavior = this._resolveBehavior(context);
    if (behavior.hang) return;

    const delayMs = Number.isFinite(behavior.delayMs) ? behavior.delayMs : 0;
    const timer = setTimeout(() => {
      this._inFlight.delete(message.id);
      if (this.terminated) return;

      if (behavior.error) {
        const error = typeof behavior.error === 'string'
          ? { message: behavior.error, name: 'Error' }
          : behavior.error;
        this._emit('message', {
          data: {
            type: 'rpc:response',
            id: message.id,
            ok: false,
            error,
          },
        });
        this._options.onResponse?.({ ...context, ok: false, error });
        return;
      }

      const result = Object.prototype.hasOwnProperty.call(behavior, 'result')
        ? behavior.result
        : context.params;
      this._emit('message', {
        data: {
          type: 'rpc:response',
          id: message.id,
          ok: true,
          result,
        },
      });
      this._options.onResponse?.({ ...context, ok: true, result });
    }, delayMs);

    this._inFlight.set(message.id, timer);
  }

  terminate() {
    this.terminated = true;
    for (const timer of this._inFlight.values()) {
      clearTimeout(timer);
    }
    this._inFlight.clear();
    this._options.onTerminate?.({ workerId: this._workerId });
  }

  _resolveBehavior(context) {
    if (typeof this._options.handleRequest === 'function') {
      const custom = this._options.handleRequest(context);
      if (custom && typeof custom === 'object') {
        return custom;
      }
    }

    const delayMs = Number.isFinite(context.params?.delayMs) ? context.params.delayMs : 0;
    if (context.params?.fail) {
      return {
        delayMs,
        error: context.params.failMessage || 'mock worker error',
      };
    }

    return {
      delayMs,
      result: context.params?.result ?? context.params?.id ?? context.params,
    };
  }

  _emit(type, event) {
    const listeners = this._listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(event);
    }
  }
}

describe('WorkerPool', () => {
  /** @type {WorkerPool | null} */
  let pool = null;

  afterEach(() => {
    if (pool) {
      pool.close();
      pool = null;
    }
  });

  it('creates worker pool with defaults and custom maxWorkers', () => {
    pool = new WorkerPool({
      createWorker: () => new MockWorker(),
      maxWorkers: 3,
    });

    expect(pool.stats.maxWorkers).toBe(3);
    expect(pool.stats.total).toBe(0);
    expect(pool.stats.busy).toBe(0);
    expect(pool.stats.idle).toBe(0);
    expect(pool.stats.queued).toBe(0);
  });

  it('submits and executes tasks', async () => {
    pool = new WorkerPool({
      createWorker: () => new MockWorker(),
    });

    const result = await pool.exec('test', { id: 'task-1' });
    expect(result).toBe('task-1');
    await waitFor(() => pool.stats.total === 1 && pool.stats.busy === 0 && pool.stats.idle === 1);
  });

  it('closes pool and terminates workers', async () => {
    const workers = [];
    pool = new WorkerPool({
      createWorker: () => {
        const worker = new MockWorker();
        workers.push(worker);
        return worker;
      },
      maxWorkers: 2,
    });

    const task1 = pool.exec('job', { id: 'a', delayMs: 80 }).catch((err) => err);
    const task2 = pool.exec('job', { id: 'b', delayMs: 80 }).catch((err) => err);

    await waitFor(() => pool.stats.total === 2 && pool.stats.busy === 2);
    await waitFor(() => workers.length === 2);
    pool.close();

    const [result1, result2] = await Promise.all([task1, task2]);
    expect(result1).toBeInstanceOf(Error);
    expect(result2).toBeInstanceOf(Error);
    expect(result1.message).toContain('pool closed');
    expect(result2.message).toContain('pool closed');
    expect(pool.stats.total).toBe(0);
    expect(workers.every((w) => w.terminated)).toBe(true);
  });

  it('drains gracefully: running tasks finish, queued tasks are rejected', async () => {
    const workers = [];
    pool = new WorkerPool({
      createWorker: () => {
        const worker = new MockWorker();
        workers.push(worker);
        return worker;
      },
      maxWorkers: 1,
    });

    const running = pool.exec('job', { id: 'running', delayMs: 80 });
    await waitFor(() => pool.stats.busy === 1);
    const queued = pool.exec('job', { id: 'queued', delayMs: 1 }).catch((err) => err);
    await waitFor(() => pool.stats.queued === 1);

    await pool.drain(500);

    await expect(running).resolves.toBe('running');
    const queuedError = await queued;
    expect(queuedError).toBeInstanceOf(Error);
    expect(queuedError.message).toContain('WorkerPool draining');
    expect(pool.stats.total).toBe(0);
    expect(workers.every((w) => w.terminated)).toBe(true);
  });

  it('schedules high-priority tasks before low-priority tasks', async () => {
    const startedOrder = [];
    pool = new WorkerPool({
      createWorker: () => new MockWorker({
        onRequest: ({ params }) => {
          startedOrder.push(params.id);
        },
      }),
      maxWorkers: 1,
    });

    const first = pool.exec('job', { id: 'first', delayMs: 80 });
    await waitFor(() => pool.stats.busy === 1);
    const low = pool.exec('job', { id: 'low', delayMs: 5 }, { priority: TaskPriority.LOW });
    const high = pool.exec('job', { id: 'high', delayMs: 5 }, { priority: TaskPriority.HIGH });

    expect(pool.stats.queued).toBe(2);

    await Promise.all([first, low, high]);
    expect(startedOrder).toEqual(['first', 'high', 'low']);
    expect(pool.stats.queued).toBe(0);
  });

  it('recycles idle workers after idle timeout', async () => {
    const workers = [];
    pool = new WorkerPool({
      createWorker: () => {
        const worker = new MockWorker();
        workers.push(worker);
        return worker;
      },
      maxWorkers: 1,
      idleTimeoutMs: 30,
    });

    await pool.exec('job', { id: 'once', delayMs: 5 });
    expect(pool.stats.total).toBe(1);

    await waitFor(() => pool.stats.total === 0, 1000);
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(true);
  });

  it('enforces max concurrency and queues overflow tasks', async () => {
    let active = 0;
    let maxActive = 0;

    pool = new WorkerPool({
      createWorker: () => new MockWorker({
        onRequest: () => {
          active += 1;
          if (active > maxActive) maxActive = active;
        },
        onResponse: () => {
          active -= 1;
        },
      }),
      maxWorkers: 2,
    });

    const tasks = [1, 2, 3, 4].map((id) => pool.exec('job', { id, delayMs: 80 }));

    await waitFor(() => (
      pool.stats.total === 2
      && pool.stats.busy === 2
      && pool.stats.queued === 2
    ));

    await Promise.all(tasks);

    expect(maxActive).toBe(2);
    expect(pool.stats.queued).toBe(0);
  });

  it('handles default and custom task timeouts', async () => {
    pool = new WorkerPool({
      createWorker: () => new MockWorker(),
      taskTimeoutMs: 30,
    });

    await expect(
      pool.exec('slow', { id: 'default-timeout', delayMs: 100 })
    ).rejects.toThrow(/RPC timeout after 30ms/);

    await expect(
      pool.exec('slow', { id: 'custom-timeout', delayMs: 100 }, { timeoutMs: 10 })
    ).rejects.toThrow(/RPC timeout after 10ms/);
  });

  it('returns accurate stats for total/busy/idle/queued', async () => {
    pool = new WorkerPool({
      createWorker: () => new MockWorker(),
      maxWorkers: 1,
      idleTimeoutMs: 1000,
    });

    const running = pool.exec('job', { id: 'running', delayMs: 80 });
    await waitFor(() => pool.stats.total === 1 && pool.stats.busy === 1);

    const queued = pool.exec('job', { id: 'queued', delayMs: 5 });
    await waitFor(() => pool.stats.queued === 1);

    expect(pool.stats.total).toBe(1);
    expect(pool.stats.busy).toBe(1);
    expect(pool.stats.idle).toBe(0);
    expect(pool.stats.queued).toBe(1);
    expect(pool.stats.maxWorkers).toBe(1);

    await Promise.all([running, queued]);

    await waitFor(() => (
      pool.stats.total === 1
      && pool.stats.busy === 0
      && pool.stats.idle === 1
      && pool.stats.queued === 0
    ));
  });

  it('handles worker execution errors and rejects submits after close', async () => {
    pool = new WorkerPool({
      createWorker: () => new MockWorker({
        handleRequest: ({ method }) => {
          if (method === 'explode') {
            return { error: { message: 'boom', name: 'Error' } };
          }
          return { result: 'ok' };
        },
      }),
    });

    await expect(pool.exec('explode', { id: 'bad' })).rejects.toThrow('boom');

    pool.close();
    await expect(pool.exec('ok', { id: 'after-close' })).rejects.toThrow('WorkerPool is closed');
  });
});
