import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedEventBus = vi.hoisted(() => {
  const instances = [];

  class EventBus {
    constructor(options = {}) {
      this.runId = options.runId || null;
      this._handlers = new Map();
      instances.push(this);
    }

    emit(type, payload) {
      const name = String(type ?? '');
      const handlers = this._handlers.get(name);
      if (!handlers) return;
      const event = { name, payload };
      for (const handler of Array.from(handlers)) {
        handler(event);
      }
    }

    on(type, handler) {
      const name = String(type ?? '');
      let bucket = this._handlers.get(name);
      if (!bucket) {
        bucket = new Set();
        this._handlers.set(name, bucket);
      }
      bucket.add(handler);
      return () => {
        bucket.delete(handler);
        if (bucket.size === 0) this._handlers.delete(name);
      };
    }
  }

  return { EventBus, instances };
});

const mockedHooks = vi.hoisted(() => ({
  enhanceEventBusWithHooks: vi.fn(),
}));

const mockedServiceIds = vi.hoisted(() => ({
  ServiceId: { KERNEL: 'SERVICE_KERNEL', EVENT_BUS: 'SERVICE_EVENT_BUS' },
}));

vi.mock('../../../../../js/agents/core/event-bus.js', () => ({
  EventBus: mockedEventBus.EventBus,
}));

vi.mock('../../../../../js/agents/core/di/defaults.js', () => ({
  ServiceId: mockedServiceIds.ServiceId,
}));

vi.mock('../../../../../js/agents/runtime/hooks/event-bus-hooks.js', () => ({
  enhanceEventBusWithHooks: mockedHooks.enhanceEventBusWithHooks,
}));

const MAX_TASK_CODE_LENGTH = 1_000_000;
const TOO_LONG_CODE = 'a'.repeat(MAX_TASK_CODE_LENGTH + 1);
const LARGE_FILE_CONTENT = 'b'.repeat(MAX_TASK_CODE_LENGTH);

async function loadMicroKernelModule() {
  return await import('../../../../../js/agents/runtime/core/micro-kernel.js');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.clearAllMocks();
  mockedEventBus.instances.length = 0;
});

describe('MicroKernelConfigError', () => {
  it('sets name and message', async () => {
    const { MicroKernelConfigError } = await loadMicroKernelModule();
    const err = new MicroKernelConfigError('bad config');

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('MicroKernelConfigError');
    expect(err.message).toBe('bad config');
  });
});

describe('MicroKernelError', () => {
  it('defaults code to null', async () => {
    const { MicroKernelError } = await loadMicroKernelModule();
    const err = new MicroKernelError('boom');

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('MicroKernelError');
    expect(err.code).toBeNull();
  });

  it('sets code when provided', async () => {
    const { MicroKernelError } = await loadMicroKernelModule();
    const err = new MicroKernelError('boom', { code: 'E_CUSTOM' });

    expect(err.code).toBe('E_CUSTOM');
  });

  it('normalizes undefined code to null', async () => {
    const { MicroKernelError } = await loadMicroKernelModule();
    const err = new MicroKernelError('boom', { code: undefined });

    expect(err.code).toBeNull();
  });
});

describe('MicroKernel', () => {
  it('constructs with non-object options and registers built-ins', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel('not-an-object');

    expect(kernel.eventBus.runId).toBeNull();
    expect(kernel.scheduler).toBeNull();
    expect(kernel.providers).toEqual([]);
    expect(kernel.getService(mockedServiceIds.ServiceId.KERNEL)).toBe(kernel);
    expect(kernel.getService(mockedServiceIds.ServiceId.EVENT_BUS)).toBe(kernel.eventBus);
  });

  it('constructs with whitespace runId, registers built-ins, and enhances event bus', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel({ runId: '   ' });

    expect(kernel.eventBus.runId).toBe('   ');
    expect(mockedHooks.enhanceEventBusWithHooks).toHaveBeenCalledWith(kernel.eventBus);
    expect(kernel.getService(mockedServiceIds.ServiceId.KERNEL)).toBe(kernel);
    expect(kernel.getService('kernel')).toBe(kernel);
    expect(kernel.getService(mockedServiceIds.ServiceId.EVENT_BUS)).toBe(kernel.eventBus);
  });

  it('handles null/undefined options, empty runId, and non-array providers', async () => {
    const { MicroKernel } = await loadMicroKernelModule();

    const kernelNull = new MicroKernel(null);
    const kernelUndefined = new MicroKernel(undefined);
    const kernelEmptyRun = new MicroKernel({ runId: '' });
    const kernelProvidersObject = new MicroKernel({ providers: {} });
    const kernelProvidersEmpty = new MicroKernel({ providers: [] });

    expect(kernelNull.eventBus.runId).toBeNull();
    expect(kernelUndefined.eventBus.runId).toBeNull();
    expect(kernelEmptyRun.eventBus.runId).toBeNull();
    expect(kernelProvidersObject.providers).toEqual([]);
    expect(kernelProvidersEmpty.providers).toEqual([]);
  });

  it('register rejects empty ids', async () => {
    const { MicroKernel, MicroKernelConfigError } = await loadMicroKernelModule();
    const kernel = new MicroKernel();

    const invalidIds = [null, undefined, '', []];
    for (const id of invalidIds) {
      expect(() => kernel.register(id, 1)).toThrow(MicroKernelConfigError);
    }
  });

  it('register accepts whitespace and object ids', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel();

    const objId = {};
    kernel.register('   ', 42);
    kernel.register(objId, 'object-id');

    expect(kernel.getService('   ')).toBe(42);
    expect(kernel.getService(objId)).toBe('object-id');
  });

  it('register resolves factories once and overrides instances', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel();
    const factory = vi.fn(() => ({ value: 2 }));

    kernel.register('svc', { value: 1 });
    kernel.register('svc', factory);

    const first = kernel.getService('svc');
    const second = kernel.getService('svc');

    expect(factory).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first).toEqual({ value: 2 });
  });

  it('register overrides factories with values', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel();
    const factory = vi.fn(() => ({ value: 'from-factory' }));

    kernel.register('svc', factory);
    kernel.register('svc', { value: 'from-value' });

    expect(kernel.getService('svc')).toEqual({ value: 'from-value' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('getService returns null for unknown non-empty ids', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel();

    expect(kernel.getService('missing')).toBeNull();
    expect(kernel.getService(0)).toBeNull();
    expect(kernel.getService(-1)).toBeNull();
  });

  it('getService caches factories even when they return undefined', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel();
    const factory = vi.fn(() => undefined);

    kernel.register('maybe', factory);

    expect(kernel.getService('maybe')).toBeUndefined();
    expect(kernel.getService('maybe')).toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('getService returns null for empty ids', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel();

    expect(kernel.getService(null)).toBeNull();
    expect(kernel.getService(undefined)).toBeNull();
    expect(kernel.getService('')).toBeNull();
    expect(kernel.getService([])).toBeNull();
  });

  it('emit stringifies types and forwards payloads to EventBus.emit', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel();
    const spy = vi.spyOn(kernel.eventBus, 'emit');

    const payload = { ok: true };
    kernel.emit(null, payload);
    kernel.emit(123, 'hello');

    expect(spy).toHaveBeenNthCalledWith(1, '', payload);
    expect(spy).toHaveBeenNthCalledWith(2, '123', 'hello');
  });

  it('on emits payloads for rapid successive emits and cleans up on unsubscribe', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel();
    const handler = vi.fn();

    const off = kernel.on('ping', handler);
    kernel.emit('ping', 0);
    kernel.emit('ping', 1);
    kernel.emit('ping', 2);

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenNthCalledWith(1, 0);
    expect(kernel._handlerWrappers.has('ping')).toBe(true);

    off();
    kernel.emit('ping', 3);

    expect(handler).toHaveBeenCalledTimes(3);
    expect(kernel._handlerWrappers.has('ping')).toBe(false);
  });

  it('on keeps wrapper bookkeeping until the last handler unsubscribes', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel();
    const a = vi.fn();
    const b = vi.fn();

    const offA = kernel.on('topic', a);
    const offB = kernel.on('topic', b);

    expect(kernel._handlerWrappers.get('topic')?.size).toBe(2);

    offA();
    expect(kernel._handlerWrappers.get('topic')?.size).toBe(1);

    offB();
    expect(kernel._handlerWrappers.has('topic')).toBe(false);
  });

  it('on validates type and handler', async () => {
    const { MicroKernel, MicroKernelConfigError } = await loadMicroKernelModule();
    const kernel = new MicroKernel();

    expect(() => kernel.on('', () => {})).toThrow(MicroKernelConfigError);
    expect(() => kernel.on('evt', null)).toThrow(MicroKernelConfigError);
  });

  it('request returns handler result with timeout 0', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel();
    const handler = vi.fn((payload) => ({ ok: payload }));

    kernel.on('reply', handler);

    const result = await kernel.request('reply', { value: 1 }, { timeoutMs: 0 });

    expect(result).toEqual({ ok: { value: 1 } });
    expect(handler).toHaveBeenCalledWith({ value: 1 });
  });

  it('request rejects empty types immediately', async () => {
    const { MicroKernel, MicroKernelConfigError } = await loadMicroKernelModule();
    const kernel = new MicroKernel();

    await expect(kernel.request('', null)).rejects.toBeInstanceOf(MicroKernelConfigError);
    await expect(kernel.request(null, null)).rejects.toBeInstanceOf(MicroKernelConfigError);
    await expect(kernel.request(undefined, null)).rejects.toBeInstanceOf(MicroKernelConfigError);
    await expect(kernel.request([], null)).rejects.toBeInstanceOf(MicroKernelConfigError);
  });

  it('request uses the first registered handler when multiple are present', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel();
    const first = vi.fn(() => 'first');
    const second = vi.fn(() => 'second');

    kernel.on('multi', first);
    kernel.on('multi', second);

    await expect(kernel.request('multi', { x: 1 }, { timeoutMs: 0 })).resolves.toBe('first');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('request times out with string timeout values', async () => {
    const { MicroKernel, MicroKernelError } = await loadMicroKernelModule();
    const kernel = new MicroKernel();

    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const promise = kernel.request('missing', { value: true }, { timeoutMs: '5' });
    const handled = promise.catch((err) => err);

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5);

    await vi.runAllTimersAsync();

    const err = await handled;
    expect(err).toBeInstanceOf(MicroKernelError);
    expect(err).toMatchObject({ code: 'TIMEOUT' });

    setTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });

  it('request falls back to default timeout for non-finite values', async () => {
    const { MicroKernel, MicroKernelError } = await loadMicroKernelModule();
    const kernel = new MicroKernel();

    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const promise = kernel.request('missing', null, { timeout: 'not-a-number' });
    const handled = promise.catch((err) => err);

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);

    await vi.runAllTimersAsync();

    const err = await handled;
    expect(err).toBeInstanceOf(MicroKernelError);
    expect(err).toMatchObject({ code: 'TIMEOUT' });

    setTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });

  it('request uses fallback timeout for negative values', async () => {
    const { MicroKernel, MicroKernelError } = await loadMicroKernelModule();
    const kernel = new MicroKernel();

    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const promise = kernel.request('missing', null, { timeoutMs: -1 });
    const handled = promise.catch((err) => err);

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);

    await vi.runAllTimersAsync();

    const err = await handled;
    expect(err).toBeInstanceOf(MicroKernelError);
    expect(err).toMatchObject({ code: 'TIMEOUT' });

    setTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });

  it('request times out when a handler never resolves and clears its timer', async () => {
    const { MicroKernel, MicroKernelError } = await loadMicroKernelModule();
    const kernel = new MicroKernel();
    const never = deferred();
    const handler = vi.fn(() => never.promise);

    kernel.on('hang', handler);

    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const promise = kernel.request('hang', { slow: true }, { timeoutMs: 5 });
    const handled = promise.catch((err) => err);

    await vi.advanceTimersByTimeAsync(5);

    const err = await handled;
    expect(err).toBeInstanceOf(MicroKernelError);
    expect(err).toMatchObject({ code: 'TIMEOUT' });
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    clearTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });

  it('request propagates handler errors and clears its timer', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel();
    const handler = vi.fn(() => {
      throw new Error('handler failed');
    });

    kernel.on('boom', handler);

    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    await expect(kernel.request('boom', { ok: false }, { timeoutMs: 10 })).rejects.toThrow('handler failed');
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    clearTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });

  it('request handles concurrent calls', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel();
    const first = deferred();
    const second = deferred();
    const handler = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    kernel.on('work', handler);

    const promiseA = kernel.request('work', { id: 1 });
    const promiseB = kernel.request('work', { id: 2 });

    first.resolve('done-a');
    second.resolve('done-b');

    await expect(Promise.all([promiseA, promiseB])).resolves.toEqual(['done-a', 'done-b']);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('schedule executes function tasks', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const kernel = new MicroKernel();

    const result = await kernel.schedule(() => 'ok');

    expect(result).toBe('ok');
  });

  it('schedule rejects invalid tasks and missing scheduler', async () => {
    const { MicroKernel, MicroKernelConfigError, MicroKernelError } = await loadMicroKernelModule();
    const kernel = new MicroKernel();

    await expect(kernel.schedule(null)).rejects.toBeInstanceOf(MicroKernelConfigError);
    await expect(kernel.schedule(undefined)).rejects.toBeInstanceOf(MicroKernelConfigError);
    await expect(kernel.schedule('')).rejects.toBeInstanceOf(MicroKernelConfigError);
    await expect(kernel.schedule(0)).rejects.toBeInstanceOf(MicroKernelConfigError);
    await expect(kernel.schedule({})).rejects.toMatchObject({ code: 'SCHEDULER_UNAVAILABLE' });

    await expect(kernel.schedule({ runtimeType: 'js', code: 'return 1' }))
      .rejects.toMatchObject({ code: 'SCHEDULER_UNAVAILABLE' });
    await expect(kernel.schedule({ runtimeType: 'js', code: 'return 1' }))
      .rejects.toBeInstanceOf(MicroKernelError);
  });

  it('schedule allows empty runtimeType and dispatches with normalized inputs', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const scheduler = { dispatch: vi.fn(async (...args) => args) };
    const kernel = new MicroKernel({ scheduler });

    const result = await kernel.schedule({ code: 'return 1' });

    expect(result[0]).toBe('');
    expect(result[1]).toBe('return 1');
    expect(Object.getPrototypeOf(result[2])).toBeNull();
    expect(Object.getPrototypeOf(result[3])).toBe(Object.prototype);
  });

  it('schedule prefers runtimeType over type when both are provided', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const scheduler = { dispatch: vi.fn(async (...args) => args[0]) };
    const kernel = new MicroKernel({ scheduler });

    await expect(kernel.schedule({ runtimeType: 'python', type: 'js', code: 'print(1)' })).resolves.toBe('python');
  });

  it('schedule validates runtime type and max code length', async () => {
    const { MicroKernel, MicroKernelConfigError } = await loadMicroKernelModule();
    const scheduler = { dispatch: vi.fn(async () => 'ok') };
    const kernel = new MicroKernel({ scheduler });

    await expect(kernel.schedule({ runtimeType: 'ruby', code: 'puts' }))
      .rejects.toBeInstanceOf(MicroKernelConfigError);

    await expect(kernel.schedule({ runtimeType: 'js', code: TOO_LONG_CODE }))
      .rejects.toBeInstanceOf(MicroKernelConfigError);
  });

  it('schedule accepts code length at MAX_TASK_CODE_LENGTH', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const scheduler = { dispatch: vi.fn(async () => 'ok') };
    const kernel = new MicroKernel({ scheduler });

    await expect(kernel.schedule({ runtimeType: 'js', code: LARGE_FILE_CONTENT })).resolves.toBe('ok');
    expect(scheduler.dispatch).toHaveBeenCalledTimes(1);
    const [runtimeType, code, inputState, options] = scheduler.dispatch.mock.calls[0];
    expect(runtimeType).toBe('js');
    expect(code).toBe(LARGE_FILE_CONTENT);
    expect(Object.getPrototypeOf(inputState)).toBeNull();
    expect(Object.getPrototypeOf(options)).toBe(Object.prototype);
  });

  it('schedule forwards deep nested state, large payloads, and priority', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const scheduler = {
      dispatch: vi.fn(async (runtimeType, code, inputState, options) => ({
        runtimeType,
        code,
        inputState,
        options,
      })),
    };
    const kernel = new MicroKernel({ scheduler });

    const deepState = {
      level1: {
        level2: {
          level3: {
            file: {
              name: 'huge.bin',
              size: Number.MAX_SAFE_INTEGER,
              contents: LARGE_FILE_CONTENT,
            },
          },
        },
      },
    };

    const result = await kernel.schedule(
      {
        type: 'js',
        code: 'return 1',
        inputState: deepState,
        options: { trace: true },
      },
      0,
    );

    expect(result.runtimeType).toBe('js');
    expect(result.inputState).toBe(deepState);
    expect(result.options).toMatchObject({ trace: true, priority: 0 });
  });

  it('schedule normalizes non-object inputs and respects finite priorities', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const scheduler = {
      dispatch: vi.fn(async (...args) => args),
    };
    const kernel = new MicroKernel({ scheduler });

    const priorities = [0, -1, Number.MAX_SAFE_INTEGER];
    for (const priority of priorities) {
      const result = await kernel.schedule(
        { runtimeType: 'js', code: 'return 1', inputState: 'bad', options: 0 },
        priority,
      );

      const inputState = result[2];
      const options = result[3];

      expect(Object.getPrototypeOf(inputState)).toBeNull();
      expect(Object.getPrototypeOf(options)).toBe(Object.prototype);
      expect(options.priority).toBe(priority);
    }
  });

  it('schedule falls back to task options.priority when priority is not finite', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const scheduler = { dispatch: vi.fn(async (...args) => args[3].priority) };
    const kernel = new MicroKernel({ scheduler });

    await expect(
      kernel.schedule({ runtimeType: 'js', code: 'return 1', options: { priority: 7 } }, Number.NaN),
    ).resolves.toBe(7);
    await expect(
      kernel.schedule({ runtimeType: 'js', code: 'return 1', options: { priority: 9 } }, 'not-a-number'),
    ).resolves.toBe(9);
  });

  it('schedule propagates scheduler dispatch errors', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const scheduler = {
      dispatch: vi.fn(async () => {
        throw new Error('dispatch failed');
      }),
    };
    const kernel = new MicroKernel({ scheduler });

    await expect(kernel.schedule({ runtimeType: 'js', code: 'return 1' })).rejects.toThrow('dispatch failed');
  });

  it('start and stop call providers once in order', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const calls = [];
    const providers = [
      {
        register: vi.fn(async () => calls.push('register-1')),
        start: vi.fn(async () => calls.push('start-1')),
        stop: vi.fn(async () => calls.push('stop-1')),
      },
      {
        register: vi.fn(async () => calls.push('register-2')),
        start: vi.fn(async () => calls.push('start-2')),
        stop: vi.fn(async () => calls.push('stop-2')),
      },
    ];

    const kernel = new MicroKernel({ providers });

    await Promise.all([kernel.start(), kernel.start()]);
    await kernel.stop();
    await kernel.stop();

    expect(calls).toEqual(['register-1', 'register-2', 'start-1', 'start-2', 'stop-1', 'stop-2']);
  });

  it('start/stop ignore nullish providers and missing lifecycle functions', async () => {
    const { MicroKernel } = await loadMicroKernelModule();
    const calls = [];
    const providers = [
      null,
      undefined,
      {},
      {
        register: vi.fn(() => calls.push('register')),
        start: vi.fn(() => calls.push('start')),
        stop: vi.fn(() => calls.push('stop')),
      },
    ];

    const kernel = new MicroKernel({ providers });

    await kernel.stop();
    await kernel.start();
    await kernel.stop();

    expect(calls).toEqual(['register', 'start', 'stop']);
  });
});
