import { beforeEach, describe, expect, it, vi } from 'vitest';

import ToolExecutor, { __test } from '../../../../js/agents/runtime/tools/tool-executor.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('runtime/tools/tool-executor: ToolExecutor error paths', () => {
  it('returns an error for unknown tools', async () => {
    const executor = new ToolExecutor({ tools: {} });

    const res = await executor.execute('missing', {}, {});

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/unknown tool/i);
  });

  it('returns an error when a tool has no handler', async () => {
    const executor = new ToolExecutor({ tools: { nope: { description: 'no handler' } } });

    const res = await executor.execute('nope', {}, {});

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/has no handler/i);
  });

  it('fails fast in strict validation mode and does not invoke the handler', async () => {
    const handler = vi.fn(async () => ({ ok: true, data: 1 }));
    const executor = new ToolExecutor({
      tools: {
        t: {
          parameters: { foo: { type: 'string', required: true } },
          handler,
        },
      },
      strictValidation: true,
    });

    const res = await executor.execute('t', {}, {}, { retries: 0 });

    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/validation failed/i);
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns Policy denied when policy rejects a mapped request', async () => {
    const handler = vi.fn(async () => 1);
    const policy = { authorize: vi.fn(async () => ({ allowed: false, reason: 'nope' })) };

    const executor = new ToolExecutor({
      tools: { t: { handler } },
      policy,
      policyMapper: () => ({ action: 'test' }),
    });

    const res = await executor.execute('t', {}, {}, { retries: 0 });

    expect(res.success).toBe(false);
    expect(res.error).toBe('Policy denied: nope');
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns Policy error when policy authorization throws', async () => {
    const handler = vi.fn(async () => 1);
    const policy = { authorize: vi.fn(async () => { throw new Error('boom'); }) };

    const executor = new ToolExecutor({
      tools: { t: { handler } },
      policy,
      policyMapper: () => ({ action: 'test' }),
    });

    const res = await executor.execute('t', {}, {}, { retries: 0 });

    expect(res.success).toBe(false);
    expect(res.error).toBe('Policy error: boom');
    expect(handler).not.toHaveBeenCalled();
  });

  it('supports before-hook skip results without invoking the handler', async () => {
    const handler = vi.fn(async () => 1);

    const executor = new ToolExecutor({
      tools: { t: { handler } },
      hooks: {
        before: [
          async () => ({
            skip: true,
            value: { success: true, data: 42 },
          }),
        ],
        after: [],
      },
    });

    const res = await executor.execute('t', {}, {}, { retries: 0 });

    expect(res.success).toBe(true);
    expect(res.data).toBe(42);
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns a timeout error when the handler exceeds timeoutMs', async () => {
    vi.useFakeTimers();

    const handler = vi.fn(async () => await new Promise(() => {}));
    const executor = new ToolExecutor({ tools: { t: { handler } } });

    const p = executor.execute('t', {}, {}, { timeoutMs: 5, retries: 0 });
    await vi.advanceTimersByTimeAsync(5);

    const res = await p;
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/timed out/i);
  });

  it('returns a blocked error when worker moduleUrl is disallowed in node', async () => {
    const handler = vi.fn(async () => 1);
    const executor = new ToolExecutor({
      tools: {
        t: {
          handler,
          worker: {
            moduleUrl: 'https://example.com/tool.js',
            exportName: 'default',
          },
        },
      },
    });

    const res = await executor.execute(
      't',
      {},
      {},
      { isolation: 'worker', retries: 0, timeoutMs: 1000 }
    );

    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/moduleurl blocked/i);
  });
});

describe('runtime/tools/tool-executor: WorkerPool destroy paths', () => {
  it('tries to replace a destroyed worker to satisfy a queued waiter', async () => {
    const { WorkerPool } = __test;

    const terminate1 = vi.fn(async () => { throw new Error('terminate failed'); });
    const worker1 = { terminate: terminate1, ref: vi.fn(), unref: vi.fn() };
    const worker2 = { terminate: vi.fn(async () => {}), ref: vi.fn(), unref: vi.fn() };

    const createWorker = vi.fn()
      .mockResolvedValueOnce(worker1)
      .mockResolvedValueOnce(worker2);

    const pool = new WorkerPool({ maxWorkers: 1, createWorker });

    const pooled1 = await pool.acquire();
    const p2 = pool.acquire(); // queued

    await pool.destroy(pooled1);

    const pooled2 = await p2;
    expect(pooled2.worker).toBe(worker2);
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(terminate1).toHaveBeenCalledTimes(1);
  });

  it('rejects a queued waiter if replacement worker creation fails', async () => {
    const { WorkerPool } = __test;

    const worker1 = { terminate: vi.fn(async () => {}), ref: vi.fn(), unref: vi.fn() };
    const createWorker = vi.fn()
      .mockResolvedValueOnce(worker1)
      .mockRejectedValueOnce(new Error('no worker'));

    const pool = new WorkerPool({ maxWorkers: 1, createWorker });

    const pooled1 = await pool.acquire();
    const p2 = pool.acquire(); // queued

    await pool.destroy(pooled1);

    await expect(p2).rejects.toThrow('no worker');
  });
});

