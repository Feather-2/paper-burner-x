import { describe, it, expect, vi, beforeEach } from 'vitest';

const isDisposableMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../js/agents/core/contracts/disposable.js', () => ({
  isDisposable: isDisposableMock,
}));

import DisposableBaseDefault, {
  DisposableBase,
} from '../../../../../js/agents/shared/base/disposable-base.js';

describe('DisposableBase', () => {
  /** @type {DisposableBase} */
  let base;

  beforeEach(() => {
    isDisposableMock.mockReset();
    isDisposableMock.mockReturnValue(false);
    base = new DisposableBase();
  });

  describe('constructor', () => {
    it('initializes state', () => {
      expect(base.disposed).toBe(false);
      expect(base._disposables).toEqual([]);
    });
  });

  describe('_registerDisposable', () => {
    it('registers function cleanups without consulting isDisposable', () => {
      isDisposableMock.mockImplementation(() => {
        throw new Error('isDisposable should not be called');
      });

      const cleanup = vi.fn();
      base._registerDisposable(cleanup);

      expect(base._disposables).toEqual([cleanup]);
      expect(isDisposableMock).not.toHaveBeenCalled();
    });

    it('registers disposable objects when isDisposable returns true', async () => {
      const disposable = { dispose: vi.fn() };
      isDisposableMock.mockReturnValue(true);

      base._registerDisposable(disposable);

      expect(isDisposableMock).toHaveBeenCalledTimes(1);
      expect(isDisposableMock).toHaveBeenCalledWith(disposable);
      expect(base._disposables).toHaveLength(1);

      await base.dispose();
      expect(disposable.dispose).toHaveBeenCalledTimes(1);
    });

    it('awaits registered disposable.dispose() when it returns a Promise', async () => {
      const order = [];
      const disposable = {
        dispose: vi.fn(async () => {
          order.push('dispose:start');
          await Promise.resolve();
          order.push('dispose:done');
        }),
      };
      isDisposableMock.mockReturnValue(true);

      base._registerDisposable(disposable);
      base._registerDisposable(() => order.push('cleanup'));

      await base.dispose();
      expect(order).toEqual(['cleanup', 'dispose:start', 'dispose:done']);
    });

    it('warns and ignores registration after disposed (including non-function inputs)', async () => {
      await base.dispose();

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const cleanup = vi.fn();

      base._registerDisposable(cleanup);
      base._registerDisposable({ dispose: vi.fn() });

      expect(base._disposables).toHaveLength(0);
      expect(isDisposableMock).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(String(warnSpy.mock.calls[0][0])).toContain(
        'registering disposable after disposed'
      );

      warnSpy.mockRestore();
    });

    it('ignores non-function inputs (empty, boundary, type, and resource cases)', () => {
      const longString = 'x'.repeat(200_000);
      const deepNested = { a: { b: { c: { d: { e: { f: { g: { h: {} } } } } } } } };
      const largeFile = { name: 'large.bin', data: new Uint8Array(5 * 1024 * 1024) };

      const cases = [
        null,
        undefined,
        '',
        '   ',
        [],
        {},
        0,
        -1,
        Number.MAX_SAFE_INTEGER,
        '42', // string-as-number
        { 0: 'a', length: 1 }, // object-as-array
        deepNested,
        longString,
        largeFile,
      ];

      for (const value of cases) {
        base._registerDisposable(value);
      }

      expect(base._disposables).toHaveLength(0);
      expect(isDisposableMock).toHaveBeenCalledTimes(cases.length);
    });
  });

  describe('_registerSubscription', () => {
    it('registers unsubscribe functions', () => {
      const unsubscribe = vi.fn();

      base._registerSubscription(unsubscribe);

      expect(base._disposables).toEqual([unsubscribe]);
    });

    it('ignores non-function unsubscribe values (empty/boundary/type cases)', () => {
      const cases = [
        null,
        undefined,
        '',
        '   ',
        [],
        {},
        0,
        -1,
        Number.MAX_SAFE_INTEGER,
        '123', // string-as-number
        { 0: 'a', length: 1 }, // object-as-array
      ];

      for (const value of cases) {
        base._registerSubscription(value);
      }

      expect(base._disposables).toHaveLength(0);
      expect(isDisposableMock).not.toHaveBeenCalled();
    });
  });

  describe('_registerTimer', () => {
    it('registers interval timers by default and clears on dispose', async () => {
      const clearIntervalSpy = vi
        .spyOn(globalThis, 'clearInterval')
        .mockImplementation(() => {});
      const clearTimeoutSpy = vi
        .spyOn(globalThis, 'clearTimeout')
        .mockImplementation(() => {});

      const timerId = 123;
      base._registerTimer(timerId);
      await base.dispose();

      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
      expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);
      expect(clearTimeoutSpy).not.toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    });

    it('registers timeout timers and clears string ids', async () => {
      const clearIntervalSpy = vi
        .spyOn(globalThis, 'clearInterval')
        .mockImplementation(() => {});
      const clearTimeoutSpy = vi
        .spyOn(globalThis, 'clearTimeout')
        .mockImplementation(() => {});

      const timerId = '123'; // string-as-number
      base._registerTimer(timerId, 'timeout');
      await base.dispose();

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);
      expect(clearIntervalSpy).not.toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    });

    it('treats invalid/whitespace type values as interval (type boundary)', async () => {
      const clearIntervalSpy = vi
        .spyOn(globalThis, 'clearInterval')
        .mockImplementation(() => {});
      const clearTimeoutSpy = vi
        .spyOn(globalThis, 'clearTimeout')
        .mockImplementation(() => {});

      base._registerTimer(1, '   ');
      base._registerTimer(2, '');
      // @ts-expect-error runtime type boundary
      base._registerTimer(3, null);
      await base.dispose();

      expect(clearTimeoutSpy).not.toHaveBeenCalled();
      expect(clearIntervalSpy).toHaveBeenCalledTimes(3);
      expect(clearIntervalSpy.mock.calls.map(([id]) => id)).toEqual([3, 2, 1]);

      clearIntervalSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    });

    it('handles boundary timer ids for interval (0, -1, MAX_SAFE_INTEGER, object-as-array)', async () => {
      const clearIntervalSpy = vi
        .spyOn(globalThis, 'clearInterval')
        .mockImplementation(() => {});

      const timerIds = [0, -1, Number.MAX_SAFE_INTEGER, { 0: 'a', length: 1 }];
      for (const id of timerIds) {
        base._registerTimer(id, 'interval');
      }
      await base.dispose();

      expect(clearIntervalSpy).toHaveBeenCalledTimes(timerIds.length);
      expect(clearIntervalSpy.mock.calls.map(([id]) => id)).toEqual([...timerIds].reverse());

      clearIntervalSpy.mockRestore();
    });
  });

  describe('dispose', () => {
    it('marks disposed and clears registered disposables', async () => {
      const cleanup = vi.fn();
      base._registerDisposable(cleanup);

      await base.dispose();

      expect(base.disposed).toBe(true);
      expect(base._disposables).toHaveLength(0);
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('calls registered disposables in reverse order', async () => {
      const order = [];
      base._registerDisposable(() => order.push('first'));
      base._registerDisposable(() => order.push('second'));
      base._registerDisposable(() => order.push('third'));

      await base.dispose();

      expect(order).toEqual(['third', 'second', 'first']);
    });

    it('awaits async disposables', async () => {
      let finished = false;
      base._registerDisposable(async () => {
        await Promise.resolve();
        finished = true;
      });

      await base.dispose();

      expect(finished).toBe(true);
    });

    it('runs _onDispose before disposables', async () => {
      const order = [];
      base._onDispose = async () => {
        order.push('hook');
        await Promise.resolve();
      };
      base._registerDisposable(() => order.push('cleanup'));

      await base.dispose();

      expect(order).toEqual(['hook', 'cleanup']);
    });

    it('propagates _onDispose errors and does not run registered disposables', async () => {
      const cleanup = vi.fn();
      base._registerDisposable(cleanup);

      base._onDispose = () => {
        throw new Error('onDispose failed');
      };

      await expect(base.dispose()).rejects.toThrow('onDispose failed');
      expect(base.disposed).toBe(true);
      expect(cleanup).not.toHaveBeenCalled();
      expect(base._disposables).toHaveLength(1);
    });

    it('logs and continues when a disposable throws', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const order = [];

      base._registerDisposable(() => order.push('after'));
      base._registerDisposable(() => {
        throw new Error('boom');
      });

      await base.dispose();

      expect(order).toEqual(['after']);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain('dispose error');

      warnSpy.mockRestore();
    });

    it('handles concurrent dispose calls without double cleanup (concurrency boundary)', async () => {
      const cleanup = vi.fn();
      base._registerDisposable(cleanup);

      await Promise.all([base.dispose(), base.dispose(), base.dispose()]);

      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('warns and blocks registrations during an in-progress dispose (concurrency boundary)', async () => {
      let resolveHook;
      base._onDispose = () =>
        new Promise((resolve) => {
          resolveHook = resolve;
        });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const cleanup = vi.fn();

      const disposing = base.dispose();
      base._registerDisposable(cleanup);

      expect(base.disposed).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      resolveHook();
      await disposing;

      expect(cleanup).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('_ensureNotDisposed', () => {
    it('does not throw when not disposed', () => {
      expect(() => base._ensureNotDisposed()).not.toThrow();
    });

    it('throws when disposed (uses constructor.name in the message)', async () => {
      class MyThing extends DisposableBase {}
      const instance = new MyThing();
      await instance.dispose();
      expect(() => instance._ensureNotDisposed()).toThrow('MyThing has been disposed');
    });
  });
});

describe('default', () => {
  it('exports DisposableBase as default', () => {
    expect(DisposableBaseDefault).toBe(DisposableBase);
    expect(new DisposableBaseDefault()).toBeInstanceOf(DisposableBase);
  });
});
