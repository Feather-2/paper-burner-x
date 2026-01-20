import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}));

const mockedShared = vi.hoisted(() => ({
  createLogger: vi.fn(() => mockedLogger),
}));

vi.mock('../../../../../js/agents/shared/index.js', () => mockedShared);

async function loadResourceGuardModule() {
  return await import('../../../../../js/agents/runtime/core/resource-guard.js');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ResourceGuard', () => {
  it('uses defaults for undefined, empty object, and empty array options', async () => {
    const { ResourceGuard } = await loadResourceGuardModule();

    const guards = [
      new ResourceGuard(),
      new ResourceGuard(undefined),
      new ResourceGuard({}),
      new ResourceGuard([]),
    ];

    for (const guard of guards) {
      const stats = guard.stats;
      expect(stats.maxConcurrent).toBe(8);
      expect(stats.maxTasksPerSecond).toBe(100);
      expect(stats.maxMemoryMB).toBe(512);
      expect(stats.concurrent).toBe(0);
      expect(stats.tasksPerSecond).toBe(0);
      expect(stats.paused).toBe(false);
      expect(typeof stats.memoryMB).toBe('number');
    }
  });

  it('throws when constructed with null options', async () => {
    const { ResourceGuard } = await loadResourceGuardModule();

    expect(() => new ResourceGuard(null)).toThrow(TypeError);
  });

  it('reports recent tasks and memory usage with array-like task window', async () => {
    const { ResourceGuard } = await loadResourceGuardModule();
    const now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.stubGlobal('performance', { memory: { usedJSHeapSize: 12 * 1024 * 1024 } });

    const guard = new ResourceGuard();
    guard._taskCountWindow = {
      filter: (predicate) => [now - 100, now - 1500].filter(predicate),
    };

    const stats = guard.stats;
    expect(stats.tasksPerSecond).toBe(1);
    expect(stats.memoryMB).toBe(12);

    nowSpy.mockRestore();
  });

  it('pause/resume toggles availability and logs', async () => {
    const { ResourceGuard } = await loadResourceGuardModule();
    const guard = new ResourceGuard();

    guard.pause();
    expect(guard.canAcquire()).toEqual({ allowed: false, reason: 'paused' });

    guard.resume();
    expect(guard.canAcquire()).toEqual({ allowed: true });

    expect(mockedLogger.info).toHaveBeenCalledTimes(2);
    expect(mockedLogger.info).toHaveBeenNthCalledWith(1, 'ResourceGuard paused');
    expect(mockedLogger.info).toHaveBeenNthCalledWith(2, 'ResourceGuard resumed');
  });

  it('applies boundary values and type coercion for limits', async () => {
    const { ResourceGuard } = await loadResourceGuardModule();

    const zeroConcurrent = new ResourceGuard({ maxConcurrent: 0 });
    expect(zeroConcurrent.canAcquire()).toMatchObject({ allowed: false, reason: 'max_concurrent' });

    const negativeMemory = new ResourceGuard({ maxMemoryMB: -1 });
    negativeMemory._getMemoryUsageMB = vi.fn(() => 0);
    expect(negativeMemory.canAcquire()).toMatchObject({ allowed: false, reason: 'memory_limit' });

    const hugeConcurrent = new ResourceGuard({ maxConcurrent: Number.MAX_SAFE_INTEGER });
    expect(hugeConcurrent.canAcquire()).toEqual({ allowed: true });

    const emptyStringConcurrent = new ResourceGuard({ maxConcurrent: '' });
    expect(emptyStringConcurrent.canAcquire()).toMatchObject({ allowed: false, reason: 'max_concurrent' });

    const whitespaceRate = new ResourceGuard({ maxTasksPerSecond: ' ' });
    expect(whitespaceRate.canAcquire()).toMatchObject({ allowed: false, reason: 'rate_limit' });

    const stringRate = new ResourceGuard({ maxTasksPerSecond: '1' });
    const now = Date.now();
    stringRate._taskCountWindow = [now - 10];
    expect(stringRate.canAcquire()).toMatchObject({ allowed: false, reason: 'rate_limit' });
  });

  it('acquire/release handles fast consecutive calls and triggers quota callback', async () => {
    const { ResourceGuard } = await loadResourceGuardModule();
    const onQuotaExceeded = vi.fn();
    const guard = new ResourceGuard({ maxConcurrent: 2, onQuotaExceeded });

    const results = [guard.acquire(), guard.acquire(), guard.acquire()];
    expect(results).toEqual([true, true, false]);
    expect(guard.stats.concurrent).toBe(2);

    expect(onQuotaExceeded).toHaveBeenCalledTimes(1);
    expect(onQuotaExceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'max_concurrent',
        stats: expect.objectContaining({ maxConcurrent: 2 }),
      })
    );

    guard.release();
    guard.release();
    guard.release();
    expect(guard.stats.concurrent).toBe(0);
  });

  it('logs when onQuotaExceeded callback throws', async () => {
    const { ResourceGuard } = await loadResourceGuardModule();
    const guard = new ResourceGuard({
      maxConcurrent: 0,
      onQuotaExceeded: () => {
        throw new Error('boom');
      },
    });

    expect(guard.acquire()).toBe(false);
    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'onQuotaExceeded callback error',
      { error: 'boom' }
    );
  });

  it('waitForSlot resolves after release with simultaneous requests', async () => {
    vi.useFakeTimers();
    try {
      const { ResourceGuard } = await loadResourceGuardModule();
      const guard = new ResourceGuard({ maxConcurrent: 1 });

      const first = guard.waitForSlot({ timeoutMs: 500 });
      const second = guard.waitForSlot({ timeoutMs: 500 });

      await first;
      expect(guard.stats.concurrent).toBe(1);

      setTimeout(() => guard.release(), 120);

      await vi.advanceTimersByTimeAsync(200);
      await expect(second).resolves.toBeUndefined();
      expect(guard.stats.concurrent).toBe(1);
      guard.release();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('waitForSlot throws when aborted', async () => {
    const { ResourceGuard } = await loadResourceGuardModule();
    const guard = new ResourceGuard({ maxConcurrent: 1 });
    const controller = new AbortController();
    controller.abort();

    await expect(guard.waitForSlot({ signal: controller.signal })).rejects.toThrow('Aborted');
  });

  it('waitForSlot times out when no slot is available', async () => {
    vi.useFakeTimers();
    try {
      const { ResourceGuard } = await loadResourceGuardModule();
      const guard = new ResourceGuard({ maxConcurrent: 0 });

      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
      const waitPromise = guard.waitForSlot({ timeoutMs: 100 });
      const assertion = expect(waitPromise).rejects.toThrow('ResourceGuard timeout waiting for slot');

      await vi.advanceTimersByTimeAsync(200);
      await assertion;
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('run releases slot when task throws', async () => {
    const { ResourceGuard } = await loadResourceGuardModule();
    const guard = new ResourceGuard({ maxConcurrent: 1 });

    await expect(
      guard.run(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(guard.stats.concurrent).toBe(0);
  });

  it('run passes through large payloads and deep objects', async () => {
    const { ResourceGuard } = await loadResourceGuardModule();
    const guard = new ResourceGuard({ maxConcurrent: 3 });

    const largeBuffer = Buffer.alloc(2 * 1024 * 1024);
    const longString = 'x'.repeat(200000);
    const deepObject = {};
    let cursor = deepObject;
    for (let i = 0; i < 25; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }

    const [bufferResult, stringResult, objectResult] = await Promise.all([
      guard.run(() => largeBuffer),
      guard.run(() => longString),
      guard.run(() => deepObject),
    ]);

    expect(bufferResult).toBe(largeBuffer);
    expect(stringResult).toBe(longString);
    expect(objectResult).toBe(deepObject);
    expect(guard.stats.concurrent).toBe(0);
  });
});

describe('ResourceGuard default export', () => {
  it('matches the named export', async () => {
    const module = await loadResourceGuardModule();

    expect(module.default).toBe(module.ResourceGuard);
  });
});
