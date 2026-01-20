import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  workerRpcInstances,
  callQueue,
  loggerInfo,
  loggerWarn,
  loggerError,
  createDefaultWorker,
} = vi.hoisted(() => ({
  workerRpcInstances: [],
  callQueue: [],
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  createDefaultWorker: vi.fn(),
}));

vi.mock("../../../../../js/agents/runtime/core/worker-rpc.js", () => {
  class WorkerRpcClient {
    constructor(options) {
      this.options = options;
      this.call = vi.fn((method, params, opts) => {
        const impl = callQueue.shift();
        if (impl) {
          return impl(method, params, opts, this);
        }
        return Promise.resolve(undefined);
      });
      this.terminate = vi.fn();
      workerRpcInstances.push(this);
    }
  }

  return { WorkerRpcClient };
});

vi.mock("../../../../../js/agents/runtime/core/worker-factory.js", () => ({
  createWorker: createDefaultWorker,
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: vi.fn(() => ({
    info: loggerInfo,
    warn: loggerWarn,
    error: loggerError,
  })),
}));

import { TaskPriority, WorkerPool } from "../../../../../js/agents/runtime/core/worker-pool.js";

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const totalCallCount = () => workerRpcInstances.reduce((sum, instance) => sum + instance.call.mock.calls.length, 0);

beforeEach(() => {
  workerRpcInstances.length = 0;
  callQueue.length = 0;
  loggerInfo.mockClear();
  loggerWarn.mockClear();
  loggerError.mockClear();
  createDefaultWorker.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TaskPriority", () => {
  it("exposes expected numeric priorities", () => {
    expect(TaskPriority).toEqual({
      HIGH: 0,
      NORMAL: 1,
      LOW: 2,
    });
  });
});

describe("WorkerPool", () => {
  it("requires a createWorker function or scriptUrl", () => {
    expect(() => new WorkerPool()).toThrow("WorkerPool requires createWorker function or scriptUrl");
    expect(() => new WorkerPool({ scriptUrl: "worker.js" })).not.toThrow();
    expect(() => new WorkerPool({ createWorker: vi.fn() })).not.toThrow();
  });

  it("uses default worker factory when scriptUrl is provided", async () => {
    createDefaultWorker.mockReturnValue({ id: "default-worker" });
    const pool = new WorkerPool({
      scriptUrl: "worker.js",
      workerOptions: { type: "module" },
      maxWorkers: 1,
      taskTimeoutMs: 123,
    });

    await pool.exec("ping", null);

    expect(workerRpcInstances).toHaveLength(1);
    const { options } = workerRpcInstances[0];
    expect(options.timeoutMs).toBe(123);
    expect(typeof options.createWorker).toBe("function");

    options.createWorker();
    expect(createDefaultWorker).toHaveBeenCalledWith("worker.js", { type: "module" });

    pool.close();
  });

  it("passes through a custom createWorker implementation", async () => {
    const customCreateWorker = vi.fn(() => ({ id: "custom-worker" }));
    const pool = new WorkerPool({
      createWorker: customCreateWorker,
      maxWorkers: 1,
    });

    await pool.exec("ping", { ok: true });

    expect(workerRpcInstances).toHaveLength(1);
    expect(workerRpcInstances[0].options.createWorker).toBe(customCreateWorker);
    expect(createDefaultWorker).not.toHaveBeenCalled();

    pool.close();
  });

  it("reports stats for busy, idle, and queued tasks", async () => {
    const pool = new WorkerPool({ createWorker: vi.fn(), maxWorkers: 1 });
    pool.warmup(1);

    expect(pool.stats).toEqual({
      total: 1,
      busy: 0,
      idle: 1,
      queued: 0,
      maxWorkers: 1,
    });

    const deferred = createDeferred();
    callQueue.push(() => deferred.promise);

    const runningPromise = pool.exec("work", { value: 1 });
    expect(pool.stats.busy).toBe(1);
    expect(pool.stats.queued).toBe(0);

    const queuedPromise = pool.exec("queued", { value: 2 });
    expect(pool.stats.queued).toBe(1);

    deferred.resolve("done");
    await runningPromise;
    await queuedPromise;
    await flushPromises();

    expect(pool.stats.busy).toBe(0);
    expect(pool.stats.idle).toBe(1);
    expect(pool.stats.queued).toBe(0);

    pool.close();
  });

  it("rejects exec calls when closed", async () => {
    const pool = new WorkerPool({ createWorker: vi.fn() });
    pool.close();
    await expect(pool.exec("method", {})).rejects.toThrow("WorkerPool is closed");
  });

  it("treats a second-argument options object as options only", async () => {
    const pool = new WorkerPool({ createWorker: vi.fn(), maxWorkers: 1 });

    await pool.exec("method", { timeoutMs: 321, priority: TaskPriority.HIGH });

    expect(workerRpcInstances).toHaveLength(1);
    const [method, params, opts] = workerRpcInstances[0].call.mock.calls[0];
    expect(method).toBe("method");
    expect(params).toBeUndefined();
    expect(opts).toEqual({ timeoutMs: 321, signal: undefined });

    pool.close();
  });

  it("passes boundary values through to the worker client", async () => {
    const pool = new WorkerPool({ createWorker: vi.fn(), maxWorkers: 1 });
    const deepNested = { level1: { level2: { level3: { value: "x" } } } };
    const longString = "a".repeat(10000);
    const largeFileLike = {
      name: "",
      size: Number.MAX_SAFE_INTEGER,
      content: "b".repeat(2048),
    };

    const cases = [
      { method: "", params: null },
      { method: "   ", params: undefined },
      { method: "empty-param", params: "" },
      { method: "whitespace-param", params: "   " },
      { method: "empty-array", params: [] },
      { method: "empty-object", params: {} },
      { method: "zero", params: 0 },
      { method: "negative", params: -1 },
      { method: "max-safe", params: Number.MAX_SAFE_INTEGER },
      { method: "string-number", params: "123" },
      { method: "object-array", params: { 0: "x", length: 1 } },
      { method: "mixed-option-keys", params: { priority: TaskPriority.HIGH, payload: "x" } },
      { method: "long-string", params: longString },
      { method: "deep-nested", params: deepNested },
      { method: "large-file", params: largeFileLike },
    ];

    for (const testCase of cases) {
      await pool.exec(testCase.method, testCase.params);
    }

    expect(workerRpcInstances).toHaveLength(1);
    const calls = workerRpcInstances[0].call.mock.calls;
    expect(calls).toHaveLength(cases.length);

    cases.forEach((testCase, index) => {
      expect(calls[index][0]).toBe(testCase.method);
      expect(calls[index][1]).toBe(testCase.params);
      expect(calls[index][2]).toEqual({ timeoutMs: 60000, signal: undefined });
    });

    pool.close();
  });

  it("prioritizes queued tasks by priority value", async () => {
    const pool = new WorkerPool({ createWorker: vi.fn(), maxWorkers: 1 });
    const deferred = createDeferred();
    callQueue.push(() => deferred.promise);

    const first = pool.exec("first", { value: 1 });
    const low = pool.exec("low", { value: 2 }, { priority: TaskPriority.LOW });
    const high = pool.exec("high", { value: 3 }, { priority: TaskPriority.HIGH });

    deferred.resolve("done");
    await first;
    await Promise.all([low, high]);

    const methods = workerRpcInstances[0].call.mock.calls.map((call) => call[0]);
    expect(methods).toEqual(["first", "high", "low"]);

    pool.close();
  });

  it("limits concurrency and queues tasks beyond maxWorkers", async () => {
    const pool = new WorkerPool({ createWorker: vi.fn(), maxWorkers: 2 });
    const deferred1 = createDeferred();
    const deferred2 = createDeferred();
    callQueue.push(() => deferred1.promise);
    callQueue.push(() => deferred2.promise);

    const task1 = pool.exec("task-1", { value: 1 });
    const task2 = pool.exec("task-2", { value: 2 });
    const task3 = pool.exec("task-3", { value: 3 });

    expect(workerRpcInstances).toHaveLength(2);
    expect(totalCallCount()).toBe(2);
    expect(pool.stats.queued).toBe(1);

    deferred1.resolve("one");
    await flushPromises();
    expect(totalCallCount()).toBe(3);

    deferred2.resolve("two");
    await Promise.all([task1, task2, task3]);

    pool.close();
  });

  it("rejects when the abort signal is already aborted", async () => {
    const pool = new WorkerPool({ createWorker: vi.fn() });
    const controller = new AbortController();
    controller.abort();

    await expect(pool.exec("method", {}, { signal: controller.signal })).rejects.toThrow("Aborted");
    expect(workerRpcInstances).toHaveLength(0);
  });

  it("aborts queued tasks when the signal fires", async () => {
    const pool = new WorkerPool({ createWorker: vi.fn(), maxWorkers: 1 });
    const deferred = createDeferred();
    callQueue.push(() => deferred.promise);

    const first = pool.exec("first", { value: 1 });
    const controller = new AbortController();
    const second = pool.exec("second", { value: 2 }, { signal: controller.signal });

    controller.abort();

    await expect(second).rejects.toThrow("Aborted");
    expect(pool.stats.queued).toBe(0);
    expect(workerRpcInstances[0].call).toHaveBeenCalledTimes(1);

    deferred.resolve("done");
    await first;

    pool.close();
  });

  it("propagates worker call errors", async () => {
    const pool = new WorkerPool({ createWorker: vi.fn(), maxWorkers: 1 });
    callQueue.push(() => Promise.reject(new Error("boom")));

    await expect(pool.exec("explode", {})).rejects.toThrow("boom");

    pool.close();
  });

  it("cleans up idle workers and reschedules idle checks", () => {
    vi.useFakeTimers();
    const pool = new WorkerPool({
      createWorker: vi.fn(),
      maxWorkers: 2,
      idleTimeoutMs: 1000,
    });
    pool.warmup(2);

    const ids = [...pool._workers.keys()];
    const idleWorker = pool._workers.get(ids[0]);
    const busyWorker = pool._workers.get(ids[1]);

    idleWorker.lastUsed = 0;
    idleWorker.busy = false;
    busyWorker.lastUsed = 0;
    busyWorker.busy = true;

    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(2001);
    pool._cleanupIdleWorkers();
    dateNowSpy.mockRestore();

    expect(idleWorker.client.terminate).toHaveBeenCalledWith("idle timeout");
    expect(pool._workers.has(ids[0])).toBe(false);
    expect(pool._workers.has(ids[1])).toBe(true);
    expect(pool._idleCheckTimer).not.toBeNull();

    pool.close();
  });

  it("closes workers and rejects queued tasks", async () => {
    const pool = new WorkerPool({ createWorker: vi.fn(), maxWorkers: 1 });
    const deferred = createDeferred();
    callQueue.push(() => deferred.promise);

    const running = pool.exec("running", { value: 1 });
    const signal = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const queued = pool.exec("queued", { value: 2 }, { signal });

    expect(signal.addEventListener).toHaveBeenCalled();

    pool.close();

    await expect(queued).rejects.toThrow("WorkerPool closed");
    expect(signal.removeEventListener).toHaveBeenCalled();
    expect(workerRpcInstances[0].terminate).toHaveBeenCalledWith("pool closed");
    expect(pool.stats.total).toBe(0);

    deferred.resolve("done");
    await running;

    await expect(pool.exec("after-close", {})).rejects.toThrow("WorkerPool is closed");
  });
});
