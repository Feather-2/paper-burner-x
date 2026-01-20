import { describe, it, expect, afterEach, vi } from "vitest";

import { FileWatcher } from "../../../../../js/agents/shared/utils/file-watcher.js";

describe("shared/utils/file-watcher", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("requires a path and onChange handler", () => {
    expect(() => new FileWatcher({ path: "", onChange: () => {} })).toThrow(/path is required/);
    expect(() => new FileWatcher({ path: "file.txt", onChange: null })).toThrow(/onChange must be a function/);
  });

  it("falls back to polling and emits change/rename events", async () => {
    vi.useFakeTimers();

    const events = [];
    const responses = [
      { type: "ok", stat: { mtimeMs: 1, size: 10, isFile: () => true } },
      { type: "ok", stat: { mtimeMs: 2, size: 10, isFile: () => true } },
      { type: "err", err: Object.assign(new Error("missing"), { code: "ENOENT" }) },
    ];

    const vfs = {
      stat: vi.fn(async () => {
        const next = responses.shift();
        if (next?.type === "err") throw next.err;
        return next?.stat || { mtimeMs: 2, size: 10, isFile: () => true };
      }),
    };

    const watcher = new FileWatcher({
      path: "/tmp/test.txt",
      onChange: (event) => events.push(event),
      pollIntervalMs: 10,
      vfs,
    });

    vi.spyOn(watcher, "_startNativeWatch").mockResolvedValue(false);

    await watcher.start();
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(10);

    const types = events.map((event) => event.type);
    expect(types).toContain("change");
    expect(types).toContain("rename");

    watcher.stop();
  });

  it("emits error events when stat fails", async () => {
    vi.useFakeTimers();

    const events = [];
    const vfs = {
      stat: vi.fn(async () => {
        const err = new Error("stat failed");
        err.code = "EACCES";
        throw err;
      }),
    };

    const watcher = new FileWatcher({
      path: "/tmp/denied.txt",
      onChange: (event) => events.push(event),
      pollIntervalMs: 10,
      vfs,
    });

    vi.spyOn(watcher, "_startNativeWatch").mockResolvedValue(false);

    await watcher.start();

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe("error");
    expect(events[0].error?.message).toContain("stat failed");

    watcher.stop();
  });

  it("coalesces concurrent starts and clears timers on stop", async () => {
    vi.useFakeTimers();

    const events = [];
    let counter = 0;
    const vfs = {
      stat: vi.fn(async () => {
        counter += 1;
        return { mtimeMs: counter, size: 1, isFile: () => true };
      }),
    };

    const watcher = new FileWatcher({
      path: "/tmp/once.txt",
      onChange: (event) => events.push(event),
      pollIntervalMs: 10,
      vfs,
    });

    vi.spyOn(watcher, "_startNativeWatch").mockResolvedValue(false);

    const initialSession = watcher._sessionId;
    const first = watcher.start();
    const second = watcher.start();
    await Promise.all([first, second]);
    expect(watcher._sessionId).toBe(initialSession + 1);
    await vi.advanceTimersByTimeAsync(10);

    watcher.stop();
    const countAfterStop = events.length;
    await vi.advanceTimersByTimeAsync(50);

    expect(events.length).toBe(countAfterStop);
    expect(watcher._pollTimer).toBe(null);
    expect(watcher._running).toBe(false);
  });
});
