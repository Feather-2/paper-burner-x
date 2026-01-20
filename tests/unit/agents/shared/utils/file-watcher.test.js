import { describe, it, expect, vi, beforeEach } from 'vitest';

const MODULE_PATH = '../../../../../js/agents/shared/utils/file-watcher.js';
const DEFAULT_POLL_INTERVAL_MS = 2000;

const fsMockState = vi.hoisted(() => {
  const module = {
    watch: undefined,
    promises: { stat: vi.fn() },
    stat: vi.fn(),
  };

  return {
    module,
    reset() {
      module.watch = undefined;
      module.promises = { stat: vi.fn() };
      module.stat = vi.fn();
    },
  };
});

vi.mock('node:fs', () => fsMockState.module);

function makeNotFoundError(code = 'ENOENT', message = 'missing') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function makeDeepObject(depth) {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  fsMockState.reset();
  vi.resetModules();
});

describe('isNativeWatchSupported', () => {
  it('returns true when fs.watch exists and caches result', async () => {
    fsMockState.module.watch = vi.fn();

    const { isNativeWatchSupported } = await import(MODULE_PATH);

    const first = await isNativeWatchSupported();
    expect(first).toBe(true);

    fsMockState.module.watch = undefined;
    const second = await isNativeWatchSupported();
    expect(second).toBe(true);
  });

  it('returns false when fs.watch is missing', async () => {
    fsMockState.module.watch = undefined;

    const { isNativeWatchSupported } = await import(MODULE_PATH);

    const result = await isNativeWatchSupported();
    expect(result).toBe(false);
  });

  it('coalesces concurrent calls', async () => {
    fsMockState.module.watch = vi.fn();

    const { isNativeWatchSupported } = await import(MODULE_PATH);

    const first = isNativeWatchSupported();
    const second = isNativeWatchSupported();

    const results = await Promise.all([first, second]);
    expect(results).toEqual([true, true]);
  });
});

describe('FileWatcher', () => {
  it('validates required options and empty values', async () => {
    const { FileWatcher } = await import(MODULE_PATH);
    const noop = () => {};

    expect(() => new FileWatcher()).toThrow(/path is required/);
    expect(() => new FileWatcher(null)).toThrow(/path is required/);
    expect(() => new FileWatcher(undefined)).toThrow(/path is required/);
    expect(() => new FileWatcher({})).toThrow(/path is required/);
    expect(() => new FileWatcher([])).toThrow(/path is required/);
    expect(() => new FileWatcher({ path: '', onChange: noop })).toThrow(/path is required/);
    expect(() => new FileWatcher({ path: '   ', onChange: noop })).toThrow(/path is required/);
    expect(() => new FileWatcher({ path: [], onChange: noop })).toThrow(/path is required/);
    expect(() => new FileWatcher({ path: '/tmp/file', onChange: null })).toThrow(
      /onChange must be a function/
    );
  });

  it('normalizes pollIntervalMs and path type boundaries', async () => {
    const { FileWatcher } = await import(MODULE_PATH);
    const onChange = vi.fn();

    const watcherZero = new FileWatcher({ path: 0, onChange, pollIntervalMs: 0 });
    expect(watcherZero._path).toBe('0');
    expect(watcherZero._pollIntervalMs).toBe(DEFAULT_POLL_INTERVAL_MS);

    const watcherNegative = new FileWatcher({ path: '/tmp/x', onChange, pollIntervalMs: -1 });
    expect(watcherNegative._pollIntervalMs).toBe(DEFAULT_POLL_INTERVAL_MS);

    const watcherString = new FileWatcher({ path: '/tmp/x', onChange, pollIntervalMs: '15' });
    expect(watcherString._pollIntervalMs).toBe(15);

    const watcherMax = new FileWatcher({
      path: '/tmp/x',
      onChange,
      pollIntervalMs: Number.MAX_SAFE_INTEGER,
    });
    expect(watcherMax._pollIntervalMs).toBe(Number.MAX_SAFE_INTEGER);

    const watcherObjectPath = new FileWatcher({ path: { a: 1 }, onChange, pollIntervalMs: '  ' });
    expect(watcherObjectPath._path).toBe('[object Object]');
    expect(watcherObjectPath._pollIntervalMs).toBe(DEFAULT_POLL_INTERVAL_MS);
  });

  it('polls and emits change/rename events with large stats and long path', async () => {
    vi.useFakeTimers();
    fsMockState.module.watch = undefined;

    const events = [];
    const longPath = 'a'.repeat(10000);
    const responses = [
      {
        type: 'stat',
        value: {
          mtimeMs: 1,
          size: Number.MAX_SAFE_INTEGER,
          isFile: () => true,
          meta: makeDeepObject(25),
        },
      },
      { type: 'stat', value: { mtimeMs: 2, size: Number.MAX_SAFE_INTEGER, isFile: () => true } },
      { type: 'error', value: makeNotFoundError('ENOENT') },
      { type: 'stat', value: { mtimeMs: 3, size: Number.MAX_SAFE_INTEGER, isFile: () => true } },
    ];

    const vfs = {
      stat: vi.fn(async () => {
        const next = responses.shift();
        if (!next) {
          return { mtimeMs: 3, size: Number.MAX_SAFE_INTEGER, isFile: () => true };
        }
        if (next.type === 'error') throw next.value;
        return next.value;
      }),
    };

    const { FileWatcher } = await import(MODULE_PATH);

    const watcher = new FileWatcher({
      path: longPath,
      onChange: (event) => events.push(event),
      pollIntervalMs: 5,
      vfs,
    });

    await watcher.start();
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(5);

    expect(watcher._path.length).toBe(longPath.length);

    const types = events.map((event) => event.type);
    expect(types).toContain('change');
    expect(types).toContain('rename');

    watcher.stop();
  });

  it('emits error when no stat reader is available', async () => {
    fsMockState.module.watch = undefined;
    fsMockState.module.promises = undefined;
    fsMockState.module.stat = undefined;

    const events = [];

    const { FileWatcher } = await import(MODULE_PATH);

    const watcher = new FileWatcher({
      path: '/tmp/no-stat',
      onChange: (event) => events.push(event),
    });

    await watcher.start();

    expect(events[0]?.type).toBe('error');
    expect(events[0]?.error?.message).toContain('no stat reader');
    expect(watcher._running).toBe(false);

    watcher.stop();
  });

  it('emits error events when stat fails with non-notfound error', async () => {
    vi.useFakeTimers();
    fsMockState.module.watch = undefined;

    const err = new Error('stat denied');
    err.code = 'EACCES';

    const events = [];
    const vfs = {
      stat: vi.fn(async () => {
        throw err;
      }),
    };

    const { FileWatcher } = await import(MODULE_PATH);

    const watcher = new FileWatcher({
      path: '/tmp/denied',
      onChange: (event) => events.push(event),
      pollIntervalMs: 5,
      vfs,
    });

    await watcher.start();

    expect(events[0]?.type).toBe('error');
    expect(events[0]?.error).toBeInstanceOf(Error);
    expect(events[0]?.error?.message).toContain('stat denied');

    watcher.stop();
  });

  it('uses native watch and maps events to change/rename/error', async () => {
    const events = [];
    let watchCallback;
    let errorCallback;

    const watcherHandle = {
      on: vi.fn((event, cb) => {
        if (event === 'error') errorCallback = cb;
      }),
      close: vi.fn(),
    };

    fsMockState.module.watch = vi.fn((path, cb) => {
      watchCallback = cb;
      return watcherHandle;
    });

    const { FileWatcher } = await import(MODULE_PATH);

    const watcher = new FileWatcher({
      path: '/tmp/native',
      onChange: (event) => events.push(event),
    });

    await watcher.start();

    expect(watcher._mode).toBe('native');

    watchCallback('rename');
    watchCallback('change');
    errorCallback?.(new Error('native boom'));

    expect(events.map((event) => event.type)).toEqual(['rename', 'change', 'error']);
    expect(events[2]?.error).toBeInstanceOf(Error);

    watcher.stop();
    expect(watcherHandle.close).toHaveBeenCalled();
  });

  it('swallows watcher close errors on stop', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const watcherHandle = {
      on: vi.fn(),
      close: vi.fn(() => {
        throw new Error('close failed');
      }),
    };

    fsMockState.module.watch = vi.fn(() => watcherHandle);

    const { FileWatcher } = await import(MODULE_PATH);

    const watcher = new FileWatcher({
      path: '/tmp/close-error',
      onChange: vi.fn(),
    });

    await watcher.start();

    expect(() => watcher.stop()).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('falls back to polling when native watch fails', async () => {
    vi.useFakeTimers();

    fsMockState.module.watch = vi.fn(() => {
      throw new Error('watch failed');
    });

    const events = [];
    const vfs = {
      stat: vi
        .fn()
        .mockResolvedValueOnce({ mtimeMs: 1, size: 1, isFile: () => true })
        .mockResolvedValueOnce({ mtimeMs: 2, size: 1, isFile: () => true }),
    };

    const { FileWatcher } = await import(MODULE_PATH);

    const watcher = new FileWatcher({
      path: '/tmp/fallback',
      onChange: (event) => events.push(event),
      pollIntervalMs: 5,
      vfs,
    });

    await watcher.start();
    await vi.advanceTimersByTimeAsync(5);

    const types = events.map((event) => event.type);
    expect(types).toContain('error');
    expect(types).toContain('change');
    expect(watcher._mode).toBe('poll');

    watcher.stop();
  });

  it('swallows errors thrown by onChange handlers', async () => {
    vi.useFakeTimers();
    fsMockState.module.watch = undefined;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onChange = vi.fn(() => {
      throw new Error('handler broke');
    });

    const vfs = {
      stat: vi
        .fn()
        .mockResolvedValueOnce({ mtimeMs: 1, size: 1, isFile: () => true })
        .mockResolvedValueOnce({ mtimeMs: 2, size: 1, isFile: () => true }),
    };

    const { FileWatcher } = await import(MODULE_PATH);

    const watcher = new FileWatcher({
      path: '/tmp/change',
      onChange,
      pollIntervalMs: 5,
      vfs,
    });

    await watcher.start();
    await vi.advanceTimersByTimeAsync(5);

    expect(onChange).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    watcher.stop();
  });

  it('coalesces concurrent starts into a single session', async () => {
    vi.useFakeTimers();
    fsMockState.module.watch = undefined;

    const vfs = {
      stat: vi.fn(async () => ({ mtimeMs: 1, size: 1, isFile: () => true })),
    };

    const { FileWatcher } = await import(MODULE_PATH);

    const watcher = new FileWatcher({
      path: '/tmp/once',
      onChange: vi.fn(),
      pollIntervalMs: 5,
      vfs,
    });

    const startSpy = vi.spyOn(watcher, '_startInternal');

    const first = watcher.start();
    const second = watcher.start();
    await Promise.all([first, second]);

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(watcher._sessionId).toBe(1);

    watcher.stop();
  });

  it('rejects start after disposal', async () => {
    const { FileWatcher } = await import(MODULE_PATH);

    const watcher = new FileWatcher({
      path: '/tmp/disposed',
      onChange: vi.fn(),
    });

    await watcher.dispose();

    await expect(watcher.start()).rejects.toThrow(/disposed/);
  });
});
