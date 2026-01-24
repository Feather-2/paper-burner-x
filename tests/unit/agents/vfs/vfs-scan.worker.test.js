import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createMockOpfsRoot, MockDirectoryHandle, MockFileHandle } from "./opfs-mock.js";

const WORKER_PATH = "../../../../js/agents/vfs/vfs-scan.worker.js";

let restoreGlobals = null;

function collectMessages(postMessage) {
  return postMessage.mock.calls.map(([message]) => message);
}

async function waitForMessage(postMessage, predicate, { timeoutMs = 2000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = collectMessages(postMessage).find(predicate);
    if (found) return found;
    // Yield to allow the worker's async scanOpfs() to progress.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for worker postMessage (seen ${postMessage.mock.calls.length} messages).`);
}

function addManyFiles(dirHandle, count, { prefix = "f", pad = 4, ext = ".txt" } = {}) {
  for (let i = 1; i <= count; i += 1) {
    const name = `${prefix}${String(i).padStart(pad, "0")}${ext}`;
    dirHandle._entries.set(name, new MockFileHandle(name));
  }
}

async function setupWorker() {
  if (restoreGlobals) {
    restoreGlobals();
    restoreGlobals = null;
  }

  const originalSelf = globalThis.self;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  const postMessage = vi.fn();
  globalThis.self = { postMessage };

  const getDirectory = vi.fn();
  // Node.js provides a read-only `navigator` getter; replace it for tests.
  Object.defineProperty(globalThis, "navigator", {
    value: { storage: { getDirectory } },
    configurable: true,
  });

  vi.resetModules();
  const workerModule = await import(WORKER_PATH);

  restoreGlobals = () => {
    if (originalSelf === undefined) {
      delete globalThis.self;
    } else {
      globalThis.self = originalSelf;
    }

    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
  };

  return { workerModule, self: globalThis.self, postMessage, getDirectory };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  if (restoreGlobals) {
    restoreGlobals();
    restoreGlobals = null;
  }
  vi.restoreAllMocks();
});

describe("vfs-scan.worker (self.onmessage)", () => {
  it("registers a message handler on import", async () => {
    const { workerModule, self } = await setupWorker();

    expect(workerModule).toBeDefined();
    expect(typeof self.onmessage).toBe("function");
  });

  it("ignores events whose data is missing or not an object", async () => {
    const { self, postMessage } = await setupWorker();

    self.onmessage(undefined);
    self.onmessage({ data: null });
    self.onmessage({ data: undefined });
    self.onmessage({ data: "scan" });
    self.onmessage({ data: 123 });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("posts an error for unknown message types", async () => {
    const { self, postMessage } = await setupWorker();

    self.onmessage({ data: { type: "nope", id: "u1" } });

    expect(postMessage).toHaveBeenCalledWith({
      type: "error",
      id: "u1",
      error: "Unknown message type: nope",
    });
  });

  it("posts an error when OPFS is not available in the worker", async () => {
    const { self, postMessage } = await setupWorker();

    delete globalThis.navigator;
    self.onmessage({ data: { type: "scan", id: "no-opfs" } });

    const err = await waitForMessage(postMessage, (m) => m?.type === "error" && m?.id === "no-opfs");
    expect(err.error).toMatch(/OPFS not available/i);
  });

  it("returns an empty result when rootDirName does not exist (NotFound treated as empty)", async () => {
    const { self, postMessage, getDirectory } = await setupWorker();

    const storageRoot = createMockOpfsRoot();
    getDirectory.mockResolvedValue(storageRoot);

    self.onmessage({ data: { type: "scan", id: "missing-root", rootDirName: "does-not-exist" } });

    const result = await waitForMessage(postMessage, (m) => m?.type === "result" && m?.id === "missing-root");
    expect(result).toEqual({ type: "result", id: "missing-root", files: [], total: 0, done: true });
  });

  it("returns an empty result when prefix path does not exist (NotFound treated as empty)", async () => {
    const { self, postMessage, getDirectory } = await setupWorker();

    const storageRoot = createMockOpfsRoot();
    storageRoot._entries.set("exists", new MockDirectoryHandle("exists"));
    getDirectory.mockResolvedValue(storageRoot);

    self.onmessage({ data: { type: "scan", id: "missing-prefix", prefix: "missing/sub" } });

    const result = await waitForMessage(postMessage, (m) => m?.type === "result" && m?.id === "missing-prefix");
    expect(result.files).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.done).toBe(true);
  });

  it("posts an error when traversal hits a non-directory entry (TypeMismatch)", async () => {
    const { self, postMessage, getDirectory } = await setupWorker();

    const storageRoot = createMockOpfsRoot();
    storageRoot._entries.set("fileAsDir", new MockFileHandle("fileAsDir"));
    getDirectory.mockResolvedValue(storageRoot);

    self.onmessage({ data: { type: "scan", id: "type-mismatch", prefix: "fileAsDir" } });

    const err = await waitForMessage(postMessage, (m) => m?.type === "error" && m?.id === "type-mismatch");
    expect(err.error).toMatch(/Not a directory/i);
  });

  it("scans non-recursively and returns sorted files from the start directory", async () => {
    const { self, postMessage, getDirectory } = await setupWorker();

    const storageRoot = createMockOpfsRoot();
    const dir = storageRoot;
    // Deliberately insert in a non-sorted order to verify the worker sorts.
    dir._entries.set("z.txt", new MockFileHandle("z.txt"));
    dir._entries.set("dir", new MockDirectoryHandle("dir"));
    dir._entries.set("a.txt", new MockFileHandle("a.txt"));

    getDirectory.mockResolvedValue(storageRoot);

    self.onmessage({ data: { type: "scan", id: "non-rec", recursive: false } });

    const result = await waitForMessage(postMessage, (m) => m?.type === "result" && m?.id === "non-rec");
    expect(result.files).toEqual(["a.txt", "z.txt"]);
    expect(result.total).toBe(2);
    expect(result.done).toBe(true);
  });

  it("scans recursively with deterministic depth-first ordering and normalized paths", async () => {
    const { self, postMessage, getDirectory } = await setupWorker();

    const storageRoot = createMockOpfsRoot();
    // Root entries inserted unsorted on purpose.
    storageRoot._entries.set("z.txt", new MockFileHandle("z.txt"));
    storageRoot._entries.set("a", new MockDirectoryHandle("a"));
    storageRoot._entries.set("m.txt", new MockFileHandle("m.txt"));

    const dirA = storageRoot._entries.get("a");
    dirA._entries.set("c", new MockDirectoryHandle("c"));
    dirA._entries.set("b.txt", new MockFileHandle("b.txt"));

    const dirC = dirA._entries.get("c");
    dirC._entries.set("a.txt", new MockFileHandle("a.txt"));

    getDirectory.mockResolvedValue(storageRoot);

    self.onmessage({ data: { type: "scan", id: "rec" } });

    const result = await waitForMessage(postMessage, (m) => m?.type === "result" && m?.id === "rec");
    expect(result.files).toEqual(["a/b.txt", "a/c/a.txt", "m.txt", "z.txt"]);
    expect(result.total).toBe(4);
  });

  it("resolves rootDirName and prefix (backslash normalization and empty segment trimming)", async () => {
    const { self, postMessage, getDirectory } = await setupWorker();

    const storageRoot = createMockOpfsRoot();
    const namedRoot = new MockDirectoryHandle("named-root");
    storageRoot._entries.set("named-root", namedRoot);

    const p = new MockDirectoryHandle("p");
    const sub = new MockDirectoryHandle("sub");
    sub._entries.set("f.txt", new MockFileHandle("f.txt"));
    p._entries.set("sub", sub);
    namedRoot._entries.set("p", p);

    getDirectory.mockResolvedValue(storageRoot);

    self.onmessage({
      data: {
        type: "scan",
        id: "root+prefix",
        rootDirName: "named-root",
        prefix: "p\\sub//",
        recursive: false,
      },
    });

    const result = await waitForMessage(postMessage, (m) => m?.type === "result" && m?.id === "root+prefix");
    expect(result.files).toEqual(["p/sub/f.txt"]);
    expect(result.total).toBe(1);
  });

  it("respects maxFiles and stops traversal early (does not scan later siblings)", async () => {
    const { self, postMessage, getDirectory } = await setupWorker();

    const storageRoot = createMockOpfsRoot();
    const dirA = new MockDirectoryHandle("a");
    dirA._entries.set("a1.txt", new MockFileHandle("a1.txt"));
    dirA._entries.set("a2.txt", new MockFileHandle("a2.txt"));
    dirA._entries.set("a3.txt", new MockFileHandle("a3.txt"));
    storageRoot._entries.set("a", dirA);
    storageRoot._entries.set("z.txt", new MockFileHandle("z.txt"));

    getDirectory.mockResolvedValue(storageRoot);

    self.onmessage({ data: { type: "scan", id: "maxfiles", maxFiles: 2 } });

    const result = await waitForMessage(postMessage, (m) => m?.type === "result" && m?.id === "maxfiles");
    expect(result.files).toEqual(["a/a1.txt", "a/a2.txt"]);
    expect(result.total).toBe(2);
  });

  it("streams progress every 500 files and then posts the final result", async () => {
    const { self, postMessage, getDirectory } = await setupWorker();

    const storageRoot = createMockOpfsRoot();
    addManyFiles(storageRoot, 501);
    getDirectory.mockResolvedValue(storageRoot);

    self.onmessage({ data: { type: "scan", id: "stream" } });

    const progress = await waitForMessage(postMessage, (m) => m?.type === "progress" && m?.id === "stream");
    expect(progress.done).toBe(false);
    expect(progress.total).toBe(500);
    expect(progress.files).toHaveLength(500);
    expect(progress.files[0]).toBe("f0001.txt");
    expect(progress.files[progress.files.length - 1]).toBe("f0500.txt");

    const result = await waitForMessage(postMessage, (m) => m?.type === "result" && m?.id === "stream");
    expect(result.done).toBe(true);
    expect(result.total).toBe(501);
    expect(result.files).toHaveLength(501);
    expect(result.files[0]).toBe("f0001.txt");
    expect(result.files[result.files.length - 1]).toBe("f0501.txt");

    const messages = collectMessages(postMessage);
    const progressIndex = messages.findIndex((m) => m?.type === "progress" && m?.id === "stream");
    const resultIndex = messages.findIndex((m) => m?.type === "result" && m?.id === "stream");
    expect(progressIndex).toBeGreaterThanOrEqual(0);
    expect(resultIndex).toBeGreaterThan(progressIndex);
  });

  it("with maxFiles=500, posts one progress batch at 500 and a final result capped at 500", async () => {
    const { self, postMessage, getDirectory } = await setupWorker();

    const storageRoot = createMockOpfsRoot();
    addManyFiles(storageRoot, 600);
    getDirectory.mockResolvedValue(storageRoot);

    self.onmessage({ data: { type: "scan", id: "cap-500", maxFiles: 500 } });

    const progress = await waitForMessage(postMessage, (m) => m?.type === "progress" && m?.id === "cap-500");
    expect(progress.total).toBe(500);
    expect(progress.files).toHaveLength(500);

    const result = await waitForMessage(postMessage, (m) => m?.type === "result" && m?.id === "cap-500");
    expect(result.total).toBe(500);
    expect(result.files).toHaveLength(500);
    expect(result.files[result.files.length - 1]).toBe("f0500.txt");

    const progressMessages = collectMessages(postMessage).filter((m) => m?.type === "progress" && m?.id === "cap-500");
    expect(progressMessages).toHaveLength(1);
  });

  it("cancels an in-flight scan and posts a cancelled message (no result)", async () => {
    const { self, postMessage, getDirectory } = await setupWorker();

    const storageRoot = createMockOpfsRoot();
    let resolveGetDirectory;
    getDirectory.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGetDirectory = resolve;
        }),
    );

    self.onmessage({ data: { type: "scan", id: "cancel-1" } });
    self.onmessage({ data: { type: "cancel", id: "cancel-1" } });

    resolveGetDirectory(storageRoot);

    const cancelled = await waitForMessage(postMessage, (m) => m?.type === "cancelled" && m?.id === "cancel-1");
    expect(cancelled).toEqual({ type: "cancelled", id: "cancel-1" });

    const messages = collectMessages(postMessage);
    expect(messages.some((m) => m?.type === "result" && m?.id === "cancel-1")).toBe(false);
    expect(messages.some((m) => m?.type === "error" && m?.id === "cancel-1")).toBe(false);

    // After completion, cancelling again should be a no-op (active task is cleaned up).
    self.onmessage({ data: { type: "cancel", id: "cancel-1" } });
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("treats cancel for an unknown id as a no-op", async () => {
    const { self, postMessage } = await setupWorker();

    self.onmessage({ data: { type: "cancel", id: "unknown" } });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("cleans up completed tasks so later cancel messages do not affect them", async () => {
    const { self, postMessage, getDirectory } = await setupWorker();

    const storageRoot = createMockOpfsRoot();
    storageRoot._entries.set("a.txt", new MockFileHandle("a.txt"));
    getDirectory.mockResolvedValue(storageRoot);

    self.onmessage({ data: { type: "scan", id: "done-then-cancel" } });
    await waitForMessage(postMessage, (m) => m?.type === "result" && m?.id === "done-then-cancel");

    const callCountAfterResult = postMessage.mock.calls.length;
    self.onmessage({ data: { type: "cancel", id: "done-then-cancel" } });
    expect(postMessage.mock.calls.length).toBe(callCountAfterResult);
  });

  it("handles concurrent scans without id cross-talk", async () => {
    const { self, postMessage, getDirectory } = await setupWorker();

    const storageRoot = createMockOpfsRoot();
    const dirA = new MockDirectoryHandle("a");
    dirA._entries.set("a1.txt", new MockFileHandle("a1.txt"));
    storageRoot._entries.set("a", dirA);
    storageRoot._entries.set("root.txt", new MockFileHandle("root.txt"));

    getDirectory.mockResolvedValue(storageRoot);

    self.onmessage({ data: { type: "scan", id: "c1" } });
    self.onmessage({ data: { type: "scan", id: "c2", prefix: "a" } });

    const result1 = await waitForMessage(postMessage, (m) => m?.type === "result" && m?.id === "c1");
    const result2 = await waitForMessage(postMessage, (m) => m?.type === "result" && m?.id === "c2");

    expect(result1.files).toEqual(["a/a1.txt", "root.txt"]);
    expect(result2.files).toEqual(["a/a1.txt"]);
  });
});
