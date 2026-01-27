import { describe, it, expect, vi, beforeEach } from "vitest";

const modulePath = "../../../../../js/agents/shared/utils/file-watcher.js";

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function importFreshModule(fsMockFactory) {
  vi.resetModules();
  vi.doMock("node:fs", fsMockFactory ?? (() => ({})));
  return await import(modulePath);
}

async function flushMicrotasks(count = 10) {
  for (let i = 0; i < count; i += 1) await Promise.resolve();
}

async function disposeWatcher(instance) {
  if (!instance || typeof instance.dispose !== "function") return;
  const result = instance.dispose();
  if (result && typeof result.then === "function") await result;
}

function createFsWatchHarness() {
  let eventListener = null;
  let errorListener = null;
  let closed = false;

  const watcher = {
    close: vi.fn(() => {
      closed = true;
    }),
    on: vi.fn((eventName, handler) => {
      if (eventName === "error" && typeof handler === "function") errorListener = handler;
      return watcher;
    }),
  };

  const fsWatchMock = vi.fn((...args) => {
    eventListener = args.find((arg) => typeof arg === "function") ?? null;
    return watcher;
  });

  return {
    fsWatchMock,
    watcher,
    triggerEvent(eventType, filename) {
      if (closed) return;
      if (eventListener) eventListener(eventType, filename);
    },
    triggerError(err) {
      if (closed) return;
      if (errorListener) errorListener(err);
    },
  };
}

describe("isNativeWatchSupported", () => {
  it("returns true when node:fs exposes watch; concurrent calls share the same pending promise and cache result", async () => {
    let factoryCalls = 0;
    const fsWatchMock = vi.fn();

    const mod = await importFreshModule(() => {
      factoryCalls += 1;
      return { watch: fsWatchMock };
    });

    const p1 = mod.isNativeWatchSupported();
    const p2 = mod.isNativeWatchSupported();

    expect(p1).toBe(p2);
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(true);

    await expect(mod.isNativeWatchSupported()).resolves.toBe(true);
    expect(factoryCalls).toBe(1);
  });

  it("returns false when node:fs exists but has no watch", async () => {
    const mod = await importFreshModule(() => ({ promises: { stat: vi.fn() } }));
    await expect(mod.isNativeWatchSupported()).resolves.toBe(false);
  });

  it("returns false when importing node:fs fails", async () => {
    const mod = await importFreshModule(() => {
      throw new Error("boom");
    });
    await expect(mod.isNativeWatchSupported()).resolves.toBe(false);
  });
});

describe("FileWatcher", () => {
  it("throws for invalid options.path (null/undefined/empty/whitespace/empty array/object)", async () => {
    const { FileWatcher } = await importFreshModule(() => ({}));
    const onChange = vi.fn();

    const invalidPaths = [null, undefined, "", "   ", [], {}];
    for (const path of invalidPaths) {
      expect(() => new FileWatcher({ path, onChange })).toThrow();
    }
  });

  it("throws for invalid options.onChange (null/undefined/non-function)", async () => {
    const { FileWatcher } = await importFreshModule(() => ({}));

    const invalidOnChange = [null, undefined, "", "fn", 0, -1, {}, [], true];
    for (const onChange of invalidOnChange) {
      expect(() => new FileWatcher({ path: "/tmp/x", onChange })).toThrow();
    }
  });

  it("native mode: uses fs.watch and forwards change/rename events with the watched path", async () => {
    const harness = createFsWatchHarness();
    const { FileWatcher } = await importFreshModule(() => ({ watch: harness.fsWatchMock }));

    const onChange = vi.fn();
    const path = "/tmp/native-watch.txt";
    const fw = new FileWatcher({ path, onChange });

    try {
      await flushMicrotasks();

      expect(harness.fsWatchMock).toHaveBeenCalled();
      expect(harness.fsWatchMock.mock.calls[0][0]).toBe(path);

      harness.triggerEvent("change");
      harness.triggerEvent("rename");
      await flushMicrotasks();

      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: "change", path }));
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: "rename", path }));
    } finally {
      await disposeWatcher(fw);
    }
  });

  it("native mode: forwards FSWatcher error events as { type: 'error', error: Error }", async () => {
    const harness = createFsWatchHarness();
    const { FileWatcher } = await importFreshModule(() => ({ watch: harness.fsWatchMock }));

    const onChange = vi.fn();
    const path = "/tmp/native-error.txt";
    const fw = new FileWatcher({ path, onChange });

    try {
      await flushMicrotasks();

      harness.triggerError({ code: "EACCES", message: "denied" });
      await flushMicrotasks();

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", path, error: expect.any(Error) }),
      );
    } finally {
      await disposeWatcher(fw);
    }
  });

  it("native mode: dispose closes underlying watcher and stops forwarding", async () => {
    const harness = createFsWatchHarness();
    const { FileWatcher } = await importFreshModule(() => ({ watch: harness.fsWatchMock }));

    const onChange = vi.fn();
    const path = "/tmp/native-dispose.txt";
    const fw = new FileWatcher({ path, onChange });

    await flushMicrotasks();
    await disposeWatcher(fw);

    expect(harness.watcher.close).toHaveBeenCalledTimes(1);

    onChange.mockClear();
    harness.triggerEvent("change");
    harness.triggerError(new Error("late"));
    await flushMicrotasks();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("polling mode: emits change when stat signature changes (handles huge sizes, deep paths, and numeric-as-string fields)", async () => {
    vi.useFakeTimers();

    const { FileWatcher } = await importFreshModule(() => ({}));
    const onChange = vi.fn();

    const deepPath = `/${"deep/".repeat(60)}${"x".repeat(2000)}.txt`;
    let call = 0;

    const vfs = {
      stat: vi.fn(async () => {
        call += 1;
        if (call < 3) {
          return {
            mtimeMs: 0,
            size: "9007199254740991",
            isFile: () => true,
          };
        }
        return {
          mtimeMs: Number.MAX_SAFE_INTEGER,
          size: Number.MAX_SAFE_INTEGER,
          isFile: () => true,
        };
      }),
    };

    const fw = new FileWatcher({ path: deepPath, onChange, pollIntervalMs: 10, vfs });

    try {
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(80);

      const sawChange = onChange.mock.calls.some(([e]) => e?.type === "change");
      expect(sawChange).toBe(true);
    } finally {
      await disposeWatcher(fw);
      vi.useRealTimers();
    }
  });

  it("polling mode: emits rename when a previously-stat'able path becomes ENOENT/ENOTDIR (0/-1 edge mtime/size included)", async () => {
    vi.useFakeTimers();

    const { FileWatcher } = await importFreshModule(() => ({}));
    const onChange = vi.fn();
    const path = "/tmp/polling-rename.txt";

    const notFoundErr = Object.assign(new Error("ENOENT: no such file or directory"), {
      code: "ENOENT",
    });

    const vfs = {
      stat: vi
        .fn()
        .mockResolvedValueOnce({
          mtimeMs: -1,
          size: 0,
          isFile: () => true,
        })
        .mockRejectedValueOnce(notFoundErr),
    };

    const fw = new FileWatcher({ path, onChange, pollIntervalMs: 10, vfs });

    try {
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(60);

      const sawRename = onChange.mock.calls.some(([e]) => e?.type === "rename");
      expect(sawRename).toBe(true);
    } finally {
      await disposeWatcher(fw);
      vi.useRealTimers();
    }
  });

  it("polling mode: emits error for unexpected stat failures", async () => {
    vi.useFakeTimers();

    const { FileWatcher } = await importFreshModule(() => ({}));
    const onChange = vi.fn();
    const path = "/tmp/polling-error.txt";

    const vfs = {
      stat: vi.fn().mockRejectedValueOnce(new Error("boom")),
    };

    const fw = new FileWatcher({ path, onChange, pollIntervalMs: 10, vfs });

    try {
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(40);

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", path, error: expect.any(Error) }),
      );
    } finally {
      await disposeWatcher(fw);
      vi.useRealTimers();
    }
  });

  it("polling mode: handles empty/nullish/odd stat shapes without throwing and still detects changes when signature becomes known", async () => {
    vi.useFakeTimers();

    const { FileWatcher } = await importFreshModule(() => ({}));
    const onChange = vi.fn();
    const path = "/tmp/polling-odd-stat.txt";

    const vfs = {
      stat: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          mtimeMs: 1,
          size: 1,
          isFile: [],
          isDirectory: {},
        })
        .mockResolvedValueOnce({
          mtimeMs: 2,
          size: 1,
          isFile: () => true,
        }),
    };

    const fw = new FileWatcher({ path, onChange, pollIntervalMs: 10, vfs });

    try {
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(120);

      const sawError = onChange.mock.calls.some(([e]) => e?.type === "error");
      expect(sawError).toBe(false);

      const sawChangeOrRename = onChange.mock.calls.some(
        ([e]) => e?.type === "change" || e?.type === "rename",
      );
      expect(sawChangeOrRename).toBe(true);
    } finally {
      await disposeWatcher(fw);
      vi.useRealTimers();
    }
  });
});