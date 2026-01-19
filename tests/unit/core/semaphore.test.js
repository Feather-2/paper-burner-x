import { describe, expect, it } from 'vitest';

import {
  Semaphore,
  acquire,
  createSemaphore,
  getStatus,
  release,
} from '../../../js/core/processing/semaphore.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate, timeoutMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error('waitUntil: timeout');
}

describe('core/processing/semaphore (functions)', () => {
  it('createSemaphore initializes limit/count/queue', () => {
    const s1 = createSemaphore();
    expect(s1).toMatchObject({ limit: 2, count: 0 });
    expect(Array.isArray(s1.queue)).toBe(true);
    expect(s1.queue).toHaveLength(0);

    const s2 = createSemaphore(5);
    expect(s2).toMatchObject({ limit: 5, count: 0 });
    expect(s2.queue).toHaveLength(0);
  });

  it('acquire queues when at limit and release wakes waiters in FIFO order', async () => {
    const s = createSemaphore(1);

    await acquire(s);
    expect(getStatus(s)).toEqual({ limit: 1, active: 1, waiting: 0 });

    const order = [];
    const p2 = acquire(s).then(() => order.push('p2'));
    const p3 = acquire(s).then(() => order.push('p3'));

    expect(getStatus(s)).toEqual({ limit: 1, active: 1, waiting: 2 });
    expect(order).toEqual([]);

    release(s);
    await p2;
    expect(order).toEqual(['p2']);
    expect(getStatus(s)).toEqual({ limit: 1, active: 1, waiting: 1 });

    release(s);
    await p3;
    expect(order).toEqual(['p2', 'p3']);
    expect(getStatus(s)).toEqual({ limit: 1, active: 1, waiting: 0 });

    release(s);
    expect(getStatus(s)).toEqual({ limit: 1, active: 0, waiting: 0 });
  });
});

describe('core/processing/semaphore (Semaphore class)', () => {
  it('constructor sets limit and starts idle', () => {
    const semDefault = new Semaphore();
    expect(semDefault.limit).toBe(2);
    expect(semDefault.active).toBe(0);
    expect(semDefault.waiting).toBe(0);
    expect(semDefault.getStatus()).toEqual({ limit: 2, active: 0, waiting: 0 });

    const sem = new Semaphore(3);
    expect(sem.limit).toBe(3);
    expect(sem.getStatus()).toEqual({ limit: 3, active: 0, waiting: 0 });
  });

  it('acquire/release perform basic accounting', async () => {
    const sem = new Semaphore(2);

    await sem.acquire();
    await sem.acquire();
    expect(sem.active).toBe(2);
    expect(sem.waiting).toBe(0);

    const waiter = sem.acquire();
    expect(sem.waiting).toBe(1);
    expect(sem.active).toBe(2);

    sem.release();
    await waiter;
    expect(sem.active).toBe(2);
    expect(sem.waiting).toBe(0);

    sem.release();
    sem.release();
    expect(sem.active).toBe(0);
    expect(sem.waiting).toBe(0);
  });

  it('queues tasks beyond limit (concurrency cap)', async () => {
    const sem = new Semaphore(1);
    const gate = deferred();

    let activeTasks = 0;
    let maxActiveTasks = 0;
    const started = [];

    const p1 = sem.run(async () => {
      started.push('t1');
      activeTasks++;
      maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
      await gate.promise;
      activeTasks--;
    });

    const p2 = sem.run(async () => {
      started.push('t2');
      activeTasks++;
      maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
      await gate.promise;
      activeTasks--;
    });

    await waitUntil(() => started.length === 1);
    expect(started).toEqual(['t1']);
    expect(sem.getStatus()).toEqual({ limit: 1, active: 1, waiting: 1 });
    expect(maxActiveTasks).toBe(1);

    gate.resolve();
    await Promise.all([p1, p2]);
    expect(sem.getStatus()).toEqual({ limit: 1, active: 0, waiting: 0 });
  });

  it('run() executes the function and returns its result', async () => {
    const sem = new Semaphore(1);
    const gate = deferred();
    const order = [];

    const p1 = sem.run(async () => {
      order.push('a:start');
      await gate.promise;
      order.push('a:end');
      return 'A';
    });

    const p2 = sem.run(async () => {
      order.push('b:start');
      return 'B';
    });

    await waitUntil(() => order.includes('a:start'));
    expect(order).toEqual(['a:start']);
    expect(sem.getStatus()).toEqual({ limit: 1, active: 1, waiting: 1 });

    gate.resolve();
    await expect(p1).resolves.toBe('A');
    await expect(p2).resolves.toBe('B');
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
    expect(sem.getStatus()).toEqual({ limit: 1, active: 0, waiting: 0 });
  });

  it('run() releases the slot even when the function throws', async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(sem.getStatus()).toEqual({ limit: 1, active: 0, waiting: 0 });
  });

  it('updateLimit clamps to >= 1 and can increase concurrency at runtime', async () => {
    const sem = new Semaphore(1);
    sem.limit = 0;
    expect(sem.limit).toBe(1);

    const gate = deferred();
    const started = [];

    const p1 = sem.run(async () => {
      started.push('t1');
      await gate.promise;
    });
    const p2 = sem.run(async () => {
      started.push('t2');
      await gate.promise;
    });
    const p3 = sem.run(async () => {
      started.push('t3');
      await gate.promise;
    });

    await waitUntil(() => started.length === 1);
    expect(sem.getStatus()).toEqual({ limit: 1, active: 1, waiting: 2 });

    sem.limit = 2;
    await waitUntil(() => started.length === 2);
    expect(started).toEqual(['t1', 't2']);
    expect(sem.getStatus()).toEqual({ limit: 2, active: 2, waiting: 1 });

    gate.resolve();
    await Promise.all([p1, p2, p3]);
    expect(sem.getStatus()).toEqual({ limit: 2, active: 0, waiting: 0 });
  });
});

