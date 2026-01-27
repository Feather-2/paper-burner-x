import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/vfs/vfs-scan.worker.js", async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod };
});

const WORKER_MODULE_PATH = "../../../../js/agents/vfs/vfs-scan.worker.js";

class FakeFileHandle {
  constructor(name) {
    this.kind = "file";
    this.name = name;
  }
}

class FakeDirectoryHandle {
  constructor(name) {
    this.kind = "directory";
    this.name = name;
    this._children = new Map();
  }

  addChild(name, handle) {
    this._children.set(name, handle);
    return this;
  }

  async getDirectoryHandle(name) {
    const key = String(name);
    const handle = this._children.get(key);
    if (!handle || handle.kind !== "directory") {
      throw new Error(`Directory not found: ${key}`);
    }
    return handle;
  }

  async *entries() {
    for (const entry of this._children.entries()) {
      yield entry;
    }
  }
}

function buildDirectory(structure, name = "root") {
  const dir = new FakeDirectoryHandle(name);

  for (const [entryName, value] of Object.entries(structure || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      dir.addChild(entryName, buildDirectory(value, entryName));
    } else {
      dir.addChild(entryName, new FakeFileHandle(entryName));
    }
  }

  return dir;
}

function createWorkerHarness({ storageRoot, getDirectoryImpl, navigatorValue } = {}) {
  const messages = [];
  const listeners = new Set();

  const postMessage = vi.fn((msg) => {
    messages.push(msg);
    for (const listener of Array.from(listeners)) listener(msg);
  });

  function waitForMessage(predicate) {
    const found = messages.find(predicate);
    if (found) return Promise.resolve(found);

    return new Promise((resolve) => {
      const listener = (msg) => {
        if (!predicate(msg)) return;
        listeners.delete(listener);
        resolve(msg);
      };
      listeners.add(listener);
    });
  }

  const self = { postMessage, onmessage: undefined };
  vi.stubGlobal("self", self);

  if (navigatorValue !== undefined) {
    vi.stubGlobal("navigator", navigatorValue);
  } else if (getDirectoryImpl) {
    vi.stubGlobal("navigator", { storage: { getDirectory: getDirectoryImpl } });
  } else {
    vi.stubGlobal("navigator", {
      storage: { getDirectory: vi.fn(async () => storageRoot) },
    });
  }

  return { self, messages, postMessage, waitForMessage };
}

async function importWorkerModule() {
  return import(WORKER_MODULE_PATH);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("scanOpfs", () => {
  it("scans recursively and returns stable, sorted paths", async () => {
    const storageRoot = buildDirectory({
      "b.txt": null,
      "a.txt": null,
      dir: { "c.txt": null, sub: { "d.txt": null } },
    });

    const harness = createWorkerHarness({ storageRoot });
    await importWorkerModule();

    const resultP = harness.waitForMessage((m) => m?.type === "result" && m.id === "t1");
    harness.self.onmessage({ data: { type: "scan", id: "t1" } });

    const result = await resultP;
    expect(result).toEqual(
      expect.objectContaining({ type: "result", id: "t1", done: true, total: 4 }),
    );
    expect(result.files).toEqual(["a.txt", "b.txt", "dir/c.txt", "dir/sub/d.txt"]);
  });

  it("normalizes prefix (backslashes, redundant slashes) and includes it in returned paths", async () => {
    const storageRoot = buildDirectory({
      foo: { bar: { "x.txt": null } },
    });

    const harness = createWorkerHarness({ storageRoot });
    await importWorkerModule();

    const resultP = harness.waitForMessage((m) => m?.type === "result" && m.id === "t2");
    harness.self.onmessage({ data: { type: "scan", id: "t2", prefix: "foo\\bar//" } });

    const result = await resultP;
    expect(result.files).toEqual(["foo/bar/x.txt"]);
    expect(result.total).toBe(1);
  });

  it("supports whitespace prefix segments and very long prefix segments", async () => {
    const whitespaceDir = "   ";
    const longSeg = "a".repeat(1024);

    const storageRoot = buildDirectory({
      [whitespaceDir]: { "w.txt": null },
      [longSeg]: { "l.txt": null },
    });

    const harness = createWorkerHarness({ storageRoot });
    await importWorkerModule();

    const resultWhitespaceP = harness.waitForMessage(
      (m) => m?.type === "result" && m.id === "t3a",
    );
    harness.self.onmessage({ data: { type: "scan", id: "t3a", prefix: whitespaceDir } });
    const resultWhitespace = await resultWhitespaceP;
    expect(resultWhitespace.files).toEqual([`${whitespaceDir}/w.txt`]);

    const resultLongP = harness.waitForMessage((m) => m?.type === "result" && m.id === "t3b");
    harness.self.onmessage({ data: { type: "scan", id: "t3b", prefix: longSeg } });
    const resultLong = await resultLongP;
    expect(resultLong.files).toEqual([`${longSeg}/l.txt`]);
  });

  it("scans within rootDirName and returns paths relative to that root", async () => {
    const storageRoot = buildDirectory({
      "root.txt": null,
      sandbox: { "x.txt": null, nested: { "y.txt": null } },
    });

    const harness = createWorkerHarness({ storageRoot });
    await importWorkerModule();

    const resultP = harness.waitForMessage((m) => m?.type === "result" && m.id === "t4");
    harness.self.onmessage({ data: { type: "scan", id: "t4", rootDirName: "sandbox" } });

    const result = await resultP;
    expect(result.files).toEqual(["nested/y.txt", "x.txt"]);
    expect(result.total).toBe(2);
  });

  it("skips subdirectories when recursive is false", async () => {
    const storageRoot = buildDirectory({
      "a.txt": null,
      dir: { "b.txt": null },
    });

    const harness = createWorkerHarness({ storageRoot });
    await importWorkerModule();

    const resultP = harness.waitForMessage((m) => m?.type === "result" && m.id === "t5");
    harness.self.onmessage({ data: { type: "scan", id: "t5", recursive: false } });

    const result = await resultP;
    expect(result.files).toEqual(["a.txt"]);
    expect(result.total).toBe(1);
  });

  it("honors maxFiles (including numeric strings), and treats 0/-1/MAX_SAFE_INTEGER as no-op limits", async () => {
    const storageRoot = buildDirectory({
      "c.txt": null,
      "b.txt": null,
      "a.txt": null,
    });

    const harness = createWorkerHarness({ storageRoot });
    await importWorkerModule();

    const limitedP = harness.waitForMessage((m) => m?.type === "result" && m.id === "t6a");
    harness.self.onmessage({ data: { type: "scan", id: "t6a", maxFiles: "2" } });
    const limited = await limitedP;
    expect(limited.files).toEqual(["a.txt", "b.txt"]);
    expect(limited.total).toBe(2);

    for (const [id, maxFiles] of [
      ["t6b", 0],
      ["t6c", -1],
      ["t6d", Number.MAX_SAFE_INTEGER],
    ]) {
      const resP = harness.waitForMessage((m) => m?.type === "result" && m.id === id);
      harness.self.onmessage({ data: { type: "scan", id, maxFiles } });
      const res = await resP;
      expect(res.files).toEqual(["a.txt", "b.txt", "c.txt"]);
      expect(res.total).toBe(3);
    }
  });

  it("streams progress in 500-file batches and returns full final result", async () => {
    const bigDir = {};
    for (let i = 0; i < 1001; i += 1) {
      const name = `f${String(i).padStart(4, "0")}.txt`;
      bigDir[name] = null;
    }

    const storageRoot = buildDirectory({ big: bigDir });

    const harness = createWorkerHarness({ storageRoot });
    await importWorkerModule();

    const p500 = harness.waitForMessage(
      (m) => m?.type === "progress" && m.id === "t7" && m.total === 500,
    );
    const p1000 = harness.waitForMessage(
      (m) => m?.type === "progress" && m.id === "t7" && m.total === 1000,
    );
    const resultP = harness.waitForMessage((m) => m?.type === "result" && m.id === "t7");

    harness.self.onmessage({ data: { type: "scan", id: "t7" } });

    const [msg500, msg1000, result] = await Promise.all([p500, p1000, resultP]);

    expect(msg500.done).toBe(false);
    expect(msg500.files).toHaveLength(500);
    expect(msg500.files[0]).toBe("big/f0000.txt");
    expect(msg500.files[499]).toBe("big/f0499.txt");

    expect(msg1000.done).toBe(false);
    expect(msg1000.files).toHaveLength(500);
    expect(msg1000.files[0]).toBe("big/f0500.txt");
    expect(msg1000.files[499]).toBe("big/f0999.txt");

    expect(result).toEqual(expect.objectContaining({ type: "result", id: "t7", done: true }));
    expect(result.total).toBe(1001);
    expect(result.files).toHaveLength(1001);
    expect(result.files[0]).toBe("big/f0000.txt");
    expect(result.files[1000]).toBe("big/f1000.txt");
  });

  it("handles deep nesting correctly", async () => {
    const depth = 20;
    let node = { "leaf.txt": null };
    for (let i = depth - 1; i >= 0; i -= 1) {
      node = { [`d${i}`]: node };
    }

    const storageRoot = buildDirectory(node);
    const harness = createWorkerHarness({ storageRoot });
    await importWorkerModule();

    const id = "t8";
    const resultP = harness.waitForMessage((m) => m?.type === "result" && m.id === id);
    harness.self.onmessage({ data: { type: "scan", id } });

    const result = await resultP;
    const expectedPath = Array.from({ length: depth }, (_, i) => `d${i}`).join("/") + "/leaf.txt";
    expect(result.files).toEqual([expectedPath]);
    expect(result.total).toBe(1);
  });

  it("supports cancellation while getDirectory is pending (no result posted)", async () => {
    let resolveGetDirectory;
    const pendingGetDirectory = new Promise((resolve) => {
      resolveGetDirectory = resolve;
    });

    const storageRoot = buildDirectory({ "a.txt": null, dir: { "b.txt": null } });
    const harness = createWorkerHarness({
      storageRoot,
      getDirectoryImpl: vi.fn(() => pendingGetDirectory),
    });
    await importWorkerModule();

    const cancelledP = harness.waitForMessage((m) => m?.type === "cancelled" && m.id === "t9");
    harness.self.onmessage({ data: { type: "scan", id: "t9" } });
    harness.self.onmessage({ data: { type: "cancel", id: "t9" } });

    resolveGetDirectory(storageRoot);

    const cancelled = await cancelledP;
    expect(cancelled).toEqual(expect.objectContaining({ type: "cancelled", id: "t9" }));
    expect(harness.messages.some((m) => m?.type === "result" && m.id === "t9")).toBe(false);
  });

  it("posts error when OPFS is unavailable (navigator missing)", async () => {
    const harness = createWorkerHarness({
      storageRoot: buildDirectory({ "a.txt": null }),
      navigatorValue: undefined,
    });
    await importWorkerModule();

    const errP = harness.waitForMessage((m) => m?.type === "error" && m.id === "t10");
    harness.self.onmessage({ data: { type: "scan", id: "t10" } });

    const err = await errP;
    expect(err).toEqual(expect.objectContaining({ type: "error", id: "t10" }));
    expect(String(err.error)).toMatch(/opfs/i);
  });

  it("posts error for invalid rootDirName / prefix type boundaries (empty array, empty object)", async () => {
    const storageRoot = buildDirectory({ safe: { "a.txt": null } });

    const harness = createWorkerHarness({ storageRoot });
    await importWorkerModule();

    const errRootP = harness.waitForMessage((m) => m?.type === "error" && m.id === "t11a");
    harness.self.onmessage({ data: { type: "scan", id: "t11a", rootDirName: [] } });
    const errRoot = await errRootP;
    expect(errRoot).toEqual(expect.objectContaining({ type: "error", id: "t11a" }));

    const errPrefixP = harness.waitForMessage((m) => m?.type === "error" && m.id === "t11b");
    harness.self.onmessage({ data: { type: "scan", id: "t11b", prefix: {} } });
    const errPrefix = await errPrefixP;
    expect(errPrefix).toEqual(expect.objectContaining({ type: "error", id: "t11b" }));
  });
});

describe("worker message handler", () => {
  it("ignores invalid/unknown messages without posting responses", async () => {
    const storageRoot = buildDirectory({ "a.txt": null });
    const harness = createWorkerHarness({ storageRoot });
    await importWorkerModule();

    const invalidPayloads = [null, undefined, "", 0, [], {}, { type: "unknown" }, { id: "x" }];
    for (const data of invalidPayloads) {
      await expect(
        (async () => {
          await harness.self.onmessage({ data });
        })(),
      ).resolves.toBeUndefined();
    }

    expect(harness.postMessage).not.toHaveBeenCalled();
    expect(harness.messages).toHaveLength(0);
  });

  it("handles concurrent scans with different ids independently", async () => {
    const storageRoot = buildDirectory({
      "c.txt": null,
      "a.txt": null,
      "b.txt": null,
    });

    const harness = createWorkerHarness({ storageRoot });
    await importWorkerModule();

    const res1P = harness.waitForMessage((m) => m?.type === "result" && m.id === "t12a");
    const res2P = harness.waitForMessage((m) => m?.type === "result" && m.id === "t12b");

    harness.self.onmessage({ data: { type: "scan", id: "t12a" } });
    harness.self.onmessage({ data: { type: "scan", id: "t12b", maxFiles: 1 } });

    const [res1, res2] = await Promise.all([res1P, res2P]);

    expect(res1.files).toEqual(["a.txt", "b.txt", "c.txt"]);
    expect(res1.total).toBe(3);

    expect(res2.files).toEqual(["a.txt"]);
    expect(res2.total).toBe(1);
  });

  it("treats null/undefined/empty values as defaults (including empty id)", async () => {
    const storageRoot = buildDirectory({
      "b.txt": null,
      "a.txt": null,
    });

    const harness = createWorkerHarness({ storageRoot });
    await importWorkerModule();

    const resP = harness.waitForMessage((m) => m?.type === "result" && m.id === "");
    harness.self.onmessage({
      data: {
        type: "scan",
        id: "",
        rootDirName: null,
        prefix: null,
        recursive: undefined,
        maxFiles: undefined,
      },
    });

    const res = await resP;
    expect(res.files).toEqual(["a.txt", "b.txt"]);
    expect(res.total).toBe(2);
  });
});