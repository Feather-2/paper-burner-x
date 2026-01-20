import { describe, it, expect, vi, beforeEach } from "vitest";
import { VFS_REQUEST, VFS_RESPONSE, VFS_OPS } from "../../../../../js/agents/runtime/core/vfs-proxy-protocol.js";

const mockedLogger = vi.hoisted(() => {
  const warn = vi.fn();
  const createLogger = vi.fn(() => ({ warn }));
  return { warn, createLogger };
});

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: mockedLogger.createLogger,
}));

const MODULE_PATH = "../../../../../js/agents/runtime/core/vfs-proxy-host.js";
const textDecoder = new TextDecoder();

function readSharedResponse(sharedBuffer) {
  const header = new Int32Array(sharedBuffer, 0, 4);
  const payloadLength = Math.max(0, Math.min(header[1], sharedBuffer.byteLength - 16));
  const payload = new Uint8Array(sharedBuffer, 16, payloadLength);
  return {
    status: header[0],
    byteLength: header[1],
    requiredBytes: header[2],
    payload,
    text: textDecoder.decode(payload),
  };
}

function createWorker() {
  const listeners = new Map();
  return {
    postMessage: vi.fn(),
    addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
    removeEventListener: vi.fn((type, handler) => {
      const existing = listeners.get(type);
      if (existing === handler) listeners.delete(type);
    }),
    _listeners: listeners,
  };
}

function buildRequest(overrides = {}) {
  return {
    type: VFS_REQUEST,
    id: 1,
    op: VFS_OPS.EXISTS,
    path: "file.txt",
    ...overrides,
  };
}

function getPostedMessages(worker) {
  return worker.postMessage.mock.calls.map(([message]) => message);
}

let VfsProxyHost;
let DefaultExport;

beforeEach(async () => {
  vi.resetModules();
  mockedLogger.warn.mockReset();
  mockedLogger.createLogger.mockReset();
  const mod = await import(MODULE_PATH);
  VfsProxyHost = mod.VfsProxyHost;
  DefaultExport = mod.default;
});

describe("VfsProxyHost", () => {
  it("creates logger and registers message handler when supported", () => {
    const worker = createWorker();
    const host = new VfsProxyHost({}, worker);

    expect(mockedLogger.createLogger).toHaveBeenCalledWith("runtime/core/vfs-proxy-host");
    expect(worker.addEventListener).toHaveBeenCalledWith("message", expect.any(Function));
    expect(mockedLogger.warn).not.toHaveBeenCalled();

    host.dispose();
  });

  it("warns when worker lacks addEventListener", () => {
    const worker = { postMessage: vi.fn() };

    new VfsProxyHost({}, worker);

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      "[VfsProxyHost] Worker does not support addEventListener; proxy disabled"
    );
  });

  it("setVfs updates the underlying VFS", () => {
    const worker = createWorker();
    const vfsA = { readFile: vi.fn() };
    const vfsB = { exists: vi.fn() };
    const host = new VfsProxyHost(vfsA, worker);

    expect(host.vfs).toBe(vfsA);
    host.setVfs(null);
    expect(host.vfs).toBeNull();
    host.setVfs(vfsB);
    expect(host.vfs).toBe(vfsB);
  });

  it("handleMessage ignores non-request payloads and forwards valid requests", () => {
    const worker = createWorker();
    const host = new VfsProxyHost({ exists: vi.fn() }, worker);
    const spy = vi.spyOn(host, "_handleRequest").mockResolvedValue();

    host.handleMessage({ data: null });
    host.handleMessage({ data: "nope" });
    host.handleMessage({ data: { type: "other" } });

    expect(spy).not.toHaveBeenCalled();

    const msg = buildRequest({ id: 3, op: VFS_OPS.EXISTS, path: "a" });
    host.handleMessage({ data: msg });

    expect(spy).toHaveBeenCalledWith(msg);
  });

  it("dispose removes listener and prevents further handling", async () => {
    const worker = createWorker();
    const vfs = { exists: vi.fn(async () => true) };
    const host = new VfsProxyHost(vfs, worker);

    host.dispose();

    expect(worker.removeEventListener).toHaveBeenCalledWith("message", expect.any(Function));

    await host._handleRequest(buildRequest({ op: VFS_OPS.EXISTS, path: "a" }));
    expect(vfs.exists).not.toHaveBeenCalled();
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it("logs warning when dispose fails", () => {
    const worker = {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    const host = new VfsProxyHost({}, worker);

    host.dispose();

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      "[VfsProxyHost] dispose() failed",
      expect.objectContaining({ error: "boom" })
    );
  });

  it("responds with error when VFS is missing in async mode", async () => {
    const worker = createWorker();
    const host = new VfsProxyHost(null, worker);

    await host._handleRequest(buildRequest({ id: "0", op: VFS_OPS.EXISTS, path: "a" }));

    expect(worker.postMessage).toHaveBeenCalledWith({
      type: VFS_RESPONSE,
      id: 0,
      ok: false,
      error: "VFS unavailable (host not configured)",
    });
  });

  it("responds with error when VFS is missing in sync mode", async () => {
    const worker = createWorker();
    const host = new VfsProxyHost(undefined, worker);
    const buffer = new SharedArrayBuffer(64);

    await host._handleRequest(
      buildRequest({ id: -1, op: VFS_OPS.EXISTS, path: "a", buffer })
    );

    const response = readSharedResponse(buffer);
    expect(response.status).toBe(-1);
    expect(response.text).toContain("VFS unavailable");

    expect(worker.postMessage).toHaveBeenCalledWith({
      type: VFS_RESPONSE,
      id: -1,
      ok: false,
      error: "VFS unavailable (host not configured)",
    });
  });

  it("rejects invalid VFS paths", async () => {
    const worker = createWorker();
    const vfs = { exists: vi.fn(async () => true) };
    const host = new VfsProxyHost(vfs, worker);

    await host._handleRequest(
      buildRequest({ id: 2, op: VFS_OPS.EXISTS, path: "C:\\temp\\file" })
    );

    expect(vfs.exists).not.toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: "Invalid VFS path" })
    );
  });

  it("handles READ in async mode", async () => {
    const worker = createWorker();
    const bytes = new Uint8Array([1, 2, 3]);
    const vfs = { readFile: vi.fn(async () => bytes) };
    const host = new VfsProxyHost(vfs, worker);

    await host._handleRequest(buildRequest({ id: 4, op: VFS_OPS.READ, path: "a.bin" }));

    expect(vfs.readFile).toHaveBeenCalledWith("a.bin");
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: VFS_RESPONSE,
      id: 4,
      ok: true,
      data: { bytes },
    });
  });

  it("handles READ in sync mode", async () => {
    const worker = createWorker();
    const bytes = new Uint8Array([4, 5, 6]);
    const vfs = { readFile: vi.fn(async () => bytes) };
    const host = new VfsProxyHost(vfs, worker);
    const buffer = new SharedArrayBuffer(32);

    await host._handleRequest(
      buildRequest({ id: 5, op: VFS_OPS.READ, path: "b.bin", buffer })
    );

    const response = readSharedResponse(buffer);
    expect(response.status).toBe(1);
    expect(response.byteLength).toBe(bytes.byteLength);
    expect(response.requiredBytes).toBe(0);
    expect([...response.payload]).toEqual([...bytes]);

    expect(worker.postMessage).toHaveBeenCalledWith({
      type: VFS_RESPONSE,
      id: 5,
      ok: true,
    });
  });

  it("reports overflow when READ response exceeds shared buffer", async () => {
    const worker = createWorker();
    const largeBytes = new Uint8Array(64 * 1024);
    const vfs = { readFile: vi.fn(async () => largeBytes) };
    const host = new VfsProxyHost(vfs, worker);
    const buffer = new SharedArrayBuffer(32);

    await host._handleRequest(
      buildRequest({ id: 6, op: VFS_OPS.READ, path: "big.bin", buffer })
    );

    const response = readSharedResponse(buffer);
    expect(response.status).toBe(-1);
    expect(response.requiredBytes).toBe(largeBytes.byteLength);
    expect(response.text).toContain("EOVERFLOW");

    expect(worker.postMessage).toHaveBeenCalledWith({
      type: VFS_RESPONSE,
      id: 6,
      ok: true,
    });
  });

  it("writes data from args, supports deep paths, and ignores non-object args", async () => {
    const worker = createWorker();
    const vfs = { writeFile: vi.fn(async () => {}) };
    const host = new VfsProxyHost(vfs, worker);
    const deepPath = Array.from({ length: 64 }, (_, i) => `dir${i}`).join("/");
    const longData = "x".repeat(10000);

    await host._handleRequest(
      buildRequest({ id: 10, op: VFS_OPS.WRITE, path: `./${deepPath}`, args: { data: longData } })
    );
    await host._handleRequest(
      buildRequest({ id: 11, op: VFS_OPS.WRITE, path: "file.txt", args: [] })
    );

    expect(vfs.writeFile).toHaveBeenNthCalledWith(1, deepPath, longData);
    expect(vfs.writeFile).toHaveBeenNthCalledWith(2, "file.txt", undefined);

    const messages = getPostedMessages(worker);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 10, ok: true, data: { ok: true } }),
        expect.objectContaining({ id: 11, ok: true, data: { ok: true } }),
      ])
    );
  });

  it("lists entries via readdir and normalizes entry kinds", async () => {
    const worker = createWorker();
    const entries = [
      "alpha",
      { name: "bravo", kind: "dir" },
      { name: "charlie", kind: "file" },
      { name: "delta", isDirectory: () => true },
      { name: "echo", isFile: () => true },
      { name: "", kind: "file" },
      { name: 42, kind: "directory" },
    ];
    const vfs = { readdir: vi.fn(async () => entries) };
    const host = new VfsProxyHost(vfs, worker);

    await host._handleRequest(buildRequest({ op: VFS_OPS.LIST, path: "root" }));

    expect(vfs.readdir).toHaveBeenCalledWith("root", { withFileTypes: true });
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: VFS_RESPONSE,
      id: 1,
      ok: true,
      data: {
        exists: true,
        entries: [
          { name: "alpha", kind: "unknown" },
          { name: "bravo", kind: "directory" },
          { name: "charlie", kind: "file" },
          { name: "delta", kind: "directory" },
          { name: "echo", kind: "file" },
          { name: "42", kind: "directory" },
        ],
      },
    });
  });

  it("returns exists=false when list path is missing", async () => {
    const worker = createWorker();
    const error = new Error("ENOENT: missing");
    error.code = "ENOENT";
    const vfs = { readdir: vi.fn(async () => { throw error; }) };
    const host = new VfsProxyHost(vfs, worker);

    await host._handleRequest(buildRequest({ op: VFS_OPS.LIST, path: "missing" }));

    expect(worker.postMessage).toHaveBeenCalledWith({
      type: VFS_RESPONSE,
      id: 1,
      ok: true,
      data: { exists: false, entries: [] },
    });
  });

  it("falls back to list() and ignores non-array entries", async () => {
    const worker = createWorker();
    const vfs = { list: vi.fn(async () => ({ name: "solo" })) };
    const host = new VfsProxyHost(vfs, worker);

    await host._handleRequest(buildRequest({ op: VFS_OPS.LIST, path: "root" }));

    expect(vfs.list).toHaveBeenCalledWith("root");
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: VFS_RESPONSE,
      id: 1,
      ok: true,
      data: { exists: true, entries: [] },
    });
  });

  it("returns stat payload with size and flags", async () => {
    const worker = createWorker();
    const vfs = {
      stat: vi.fn(async () => ({
        size: Number.MAX_SAFE_INTEGER,
        mtimeMs: 0,
        isFile: () => true,
        isDirectory: () => false,
      })),
    };
    const host = new VfsProxyHost(vfs, worker);

    await host._handleRequest(buildRequest({ op: VFS_OPS.STAT, path: "file" }));

    expect(worker.postMessage).toHaveBeenCalledWith({
      type: VFS_RESPONSE,
      id: 1,
      ok: true,
      data: {
        exists: true,
        size: Number.MAX_SAFE_INTEGER,
        mtimeMs: 0,
        isFile: true,
        isDirectory: false,
      },
    });
  });

  it("returns exists=false for stat when path is missing", async () => {
    const worker = createWorker();
    const vfs = {
      stat: vi.fn(async () => {
        throw new Error("NotFoundError");
      }),
    };
    const host = new VfsProxyHost(vfs, worker);

    await host._handleRequest(buildRequest({ op: VFS_OPS.STAT, path: "missing" }));

    expect(worker.postMessage).toHaveBeenCalledWith({
      type: VFS_RESPONSE,
      id: 1,
      ok: true,
      data: { exists: false },
    });
  });

  it("creates directories with recursive defaults", async () => {
    const worker = createWorker();
    const vfs = { mkdir: vi.fn(async () => {}) };
    const host = new VfsProxyHost(vfs, worker);

    await host._handleRequest(buildRequest({ op: VFS_OPS.MKDIR, path: "a/b", args: {} }));
    await host._handleRequest(
      buildRequest({ id: 2, op: VFS_OPS.MKDIR, path: "a/b", args: { recursive: false } })
    );

    expect(vfs.mkdir).toHaveBeenNthCalledWith(1, "a/b", { recursive: true });
    expect(vfs.mkdir).toHaveBeenNthCalledWith(2, "a/b", { recursive: false });
  });

  it("deletes directories or files based on stat results", async () => {
    const worker = createWorker();
    const vfs = {
      stat: vi.fn(async (path) => ({
        isDirectory: () => path === "dir",
      })),
      rmdir: vi.fn(async () => {}),
      unlink: vi.fn(async () => {}),
    };
    const host = new VfsProxyHost(vfs, worker);

    await host._handleRequest(
      buildRequest({ id: 1, op: VFS_OPS.DELETE, path: "dir", args: { recursive: true } })
    );
    await host._handleRequest(
      buildRequest({ id: 2, op: VFS_OPS.DELETE, path: "file", args: { recursive: false } })
    );

    expect(vfs.rmdir).toHaveBeenCalledWith("dir", { recursive: true });
    expect(vfs.unlink).toHaveBeenCalledWith("file");
  });

  it("treats missing delete paths as ok", async () => {
    const worker = createWorker();
    const error = new Error("ENOENT");
    error.code = "ENOENT";
    const vfs = { stat: vi.fn(async () => { throw error; }) };
    const host = new VfsProxyHost(vfs, worker);

    await host._handleRequest(buildRequest({ op: VFS_OPS.DELETE, path: "missing" }));

    expect(worker.postMessage).toHaveBeenCalledWith({
      type: VFS_RESPONSE,
      id: 1,
      ok: true,
      data: { ok: true },
    });
  });

  it("falls back to unlink/rmdir when stat is unavailable and errors with no delete ops", async () => {
    const worker = createWorker();
    const vfs = { unlink: vi.fn(async () => {}) };
    const host = new VfsProxyHost(vfs, worker);

    await host._handleRequest(buildRequest({ op: VFS_OPS.DELETE, path: "file" }));

    expect(vfs.unlink).toHaveBeenCalledWith("file");

    const worker2 = createWorker();
    const host2 = new VfsProxyHost({}, worker2);

    await host2._handleRequest(buildRequest({ id: 2, op: VFS_OPS.DELETE, path: "file" }));

    expect(worker2.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: expect.stringContaining("delete operations") })
    );
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      "[VfsProxyHost] request failed",
      expect.objectContaining({ error: expect.stringContaining("delete operations") })
    );
  });

  it("uses exists() and normalizes boundary paths with concurrent requests", async () => {
    const worker = createWorker();
    const vfs = { exists: vi.fn(async (path) => path === "ok") };
    const host = new VfsProxyHost(vfs, worker);

    const paths = [0, -1, Number.MAX_SAFE_INTEGER, "   ", "", null, undefined];
    const ids = ["0", 1, 2, 3, 4, 5, 6];

    await Promise.all(
      paths.map((path, index) =>
        host._handleRequest(buildRequest({ id: ids[index], op: VFS_OPS.EXISTS, path }))
      )
    );

    expect(vfs.exists.mock.calls.map((call) => call[0])).toEqual([
      "",
      "-1",
      String(Number.MAX_SAFE_INTEGER),
      "   ",
      "",
      "",
      "",
    ]);

    const messages = getPostedMessages(worker);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 0, ok: true }),
        expect.objectContaining({ id: 1, ok: true }),
        expect.objectContaining({ id: 2, ok: true }),
      ])
    );
  });

  it("falls back to stat when exists is unavailable", async () => {
    const worker = createWorker();
    const error = new Error("ENOENT: missing");
    error.code = "ENOENT";
    const vfs = { stat: vi.fn(async () => { throw error; }) };
    const host = new VfsProxyHost(vfs, worker);

    await host._handleRequest(buildRequest({ op: VFS_OPS.EXISTS, path: "missing" }));

    expect(worker.postMessage).toHaveBeenCalledWith({
      type: VFS_RESPONSE,
      id: 1,
      ok: true,
      data: { exists: false },
    });
  });

  it("returns error for unsupported ops and logs warning", async () => {
    const worker = createWorker();
    const host = new VfsProxyHost({ exists: vi.fn() }, worker);

    await host._handleRequest(buildRequest({ op: "nope", path: "file" }));

    const message = worker.postMessage.mock.calls[0][0];
    expect(message.ok).toBe(false);
    expect(message.error).toContain("Unsupported VFS op");

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      "[VfsProxyHost] request failed",
      expect.objectContaining({ op: "nope", error: expect.stringContaining("Unsupported VFS op") })
    );
  });

  it("includes error codes in responses when VFS operation fails", async () => {
    const worker = createWorker();
    const err = new Error("Permission denied");
    err.code = "EACCES";
    const vfs = { writeFile: vi.fn(async () => { throw err; }) };
    const host = new VfsProxyHost(vfs, worker);

    await host._handleRequest(
      buildRequest({ op: VFS_OPS.WRITE, path: "file", args: { data: "x" } })
    );

    const message = worker.postMessage.mock.calls[0][0];
    expect(message.ok).toBe(false);
    expect(message.error).toBe("EACCES: Permission denied");
  });

  it("logs when postMessage throws", async () => {
    const worker = createWorker();
    worker.postMessage.mockImplementation(() => {
      throw new Error("boom");
    });
    const vfs = { exists: vi.fn(async () => true) };
    const host = new VfsProxyHost(vfs, worker);

    await host._handleRequest(buildRequest({ op: VFS_OPS.EXISTS, path: "ok" }));

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      "[VfsProxyHost] postMessage failed",
      expect.objectContaining({ error: "boom" })
    );
  });
});

describe("default export", () => {
  it("exports VfsProxyHost as default", () => {
    expect(DefaultExport).toBe(VfsProxyHost);
  });
});
