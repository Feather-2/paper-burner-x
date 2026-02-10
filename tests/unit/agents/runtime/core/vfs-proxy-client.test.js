import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const loggerMocks = vi.hoisted(() => {
  const log = vi.fn();
  const debug = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  return {
    log,
    debug,
    info,
    warn,
    error,
    createLogger: vi.fn(() => ({ log, debug, info, warn, error })),
  };
});

const protocolMocks = vi.hoisted(() => ({
  VFS_REQUEST: "vfs:request",
  VFS_RESPONSE: "vfs:response",
  VFS_OPS: Object.freeze({
    READ: "read",
    WRITE: "write",
    LIST: "list",
    STAT: "stat",
    MKDIR: "mkdir",
    DELETE: "delete",
    EXISTS: "exists",
  }),
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: loggerMocks.createLogger,
  protoSafeReviver: (_key, value) => value,
}));

vi.mock("../../../../../js/agents/runtime/core/vfs-proxy-protocol.js", () => protocolMocks);

import { VfsProxyClient } from "../../../../../js/agents/runtime/core/vfs-proxy-client.js";
import { VFS_OPS, VFS_REQUEST, VFS_RESPONSE } from "../../../../../js/agents/runtime/core/vfs-proxy-protocol.js";

const encoder = new TextEncoder();

class FakeTarget {
  constructor() {
    this.postMessageCalls = [];
    this.listeners = new Set();
    this.throwOnRemove = false;
    this.throwOnPost = false;
  }

  addEventListener(type, fn) {
    if (type === "message") this.listeners.add(fn);
  }

  removeEventListener(type, fn) {
    if (type !== "message") return;
    if (this.throwOnRemove) throw new Error("remove boom");
    this.listeners.delete(fn);
  }

  postMessage(msg, transfer) {
    if (this.throwOnPost) throw new Error("postMessage boom");
    this.postMessageCalls.push([msg, transfer]);
  }

  emitMessage(data) {
    const event = { data };
    for (const fn of this.listeners) {
      fn(event);
    }
  }
}

const buildDeepObject = (depth) => {
  let root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node.next = {};
    node = node.next;
  }
  node.value = "end";
  return root;
};

const createAtomicsStub = (onWait) => ({
  store: (arr, idx, val) => {
    arr[idx] = val;
    return val;
  },
  load: (arr, idx) => arr[idx],
  wait: vi.fn((arr, idx, val, timeout) => {
    if (onWait) onWait(arr, idx, val, timeout);
    return "ok";
  }),
});

const getThrown = (fn) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("Expected function to throw");
};

beforeEach(() => {
  loggerMocks.warn.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VfsProxyClient", () => {
  it("registers message listener and uses target postMessage", () => {
    const target = new FakeTarget();
    const client = new VfsProxyClient({ target });

    expect(target.listeners.size).toBe(1);

    client._postMessage({ hello: "world" });
    expect(target.postMessageCalls[0][0]).toEqual({ hello: "world" });

    const transfer = [new ArrayBuffer(1)];
    client._postMessage({ hi: true }, transfer);
    expect(target.postMessageCalls[1][1]).toBe(transfer);
  });

  it("reports supportsSync false when SharedArrayBuffer/Atomics are unavailable", () => {
    vi.stubGlobal("SharedArrayBuffer", undefined);
    vi.stubGlobal("Atomics", undefined);

    const client = new VfsProxyClient({ postMessage: vi.fn(), target: new FakeTarget() });
    expect(client.supportsSync).toBe(false);
  });

  it("normalizes falsy paths to '/' and preserves truthy paths", async () => {
    const postMessage = vi.fn();
    const client = new VfsProxyClient({ postMessage, target: new FakeTarget() });
    const cases = [
      { input: null, expected: "/" },
      { input: undefined, expected: "/" },
      { input: "", expected: "/" },
      { input: 0, expected: "/" },
      { input: "   ", expected: "   " },
      { input: -1, expected: "-1" },
    ];

    const promises = [];
    for (const testCase of cases) {
      const promise = client._requestAsync(VFS_OPS.READ, testCase.input, {});
      const msg = postMessage.mock.calls[postMessage.mock.calls.length - 1][0];
      expect(msg.path).toBe(testCase.expected);
      client._handleMessageEvent({ data: { type: VFS_RESPONSE, id: msg.id, ok: true, data: testCase.expected } });
      promises.push(promise);
    }

    const results = await Promise.all(promises);
    expect(results).toEqual(cases.map((item) => item.expected));
  });

  it("rejects async requests when postMessage throws", async () => {
    const err = new Error("boom");
    const postMessage = vi.fn(() => {
      throw err;
    });
    const client = new VfsProxyClient({ postMessage, target: new FakeTarget() });

    await expect(client._requestAsync(VFS_OPS.READ, "/file", {})).rejects.toBe(err);
    expect(client._pending.size).toBe(0);
  });

  it("handles concurrent async responses out of order", async () => {
    const postMessage = vi.fn();
    const client = new VfsProxyClient({ postMessage, target: new FakeTarget() });

    const p1 = client._requestAsync(VFS_OPS.READ, "/a", {});
    const p2 = client._requestAsync(VFS_OPS.WRITE, "/b", { data: [] });

    const id1 = postMessage.mock.calls[0][0].id;
    const id2 = postMessage.mock.calls[1][0].id;

    client._handleMessageEvent({ data: { type: VFS_RESPONSE, id: id2, ok: true, data: "second" } });
    client._handleMessageEvent({ data: { type: VFS_RESPONSE, id: id1, ok: true, data: "first" } });

    await expect(Promise.all([p1, p2])).resolves.toEqual(["first", "second"]);
  });

  it("ignores unrelated messages and rejects on error response", async () => {
    const postMessage = vi.fn();
    const client = new VfsProxyClient({ postMessage, target: new FakeTarget() });

    const pending = client._requestAsync(VFS_OPS.READ, "/data", {});
    expect(client._pending.size).toBe(1);

    client._handleMessageEvent({ data: null });
    client._handleMessageEvent({ data: { type: "other", id: 1 } });
    client._handleMessageEvent({ data: { type: VFS_RESPONSE, id: 999, ok: true, data: "noop" } });

    expect(client._pending.size).toBe(1);

    const id = postMessage.mock.calls[0][0].id;
    client._handleMessageEvent({ data: { type: VFS_RESPONSE, id, ok: false, error: "nope" } });

    await expect(pending).rejects.toThrow("nope");
    expect(client._pending.size).toBe(0);
  });

  it("dispose rejects pending requests and removes listeners", async () => {
    const target = new FakeTarget();
    const client = new VfsProxyClient({ target });

    const p1 = client._requestAsync(VFS_OPS.READ, "/a", {});
    const p2 = client._requestAsync(VFS_OPS.READ, "/b", {});

    client.dispose();

    const results = await Promise.allSettled([p1, p2]);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      expect(result.reason.message).toMatch(/disposed/);
    }
    expect(client._pending.size).toBe(0);
    expect(target.listeners.size).toBe(0);
  });

  it("dispose logs warnings when removeEventListener throws", () => {
    const target = new FakeTarget();
    target.throwOnRemove = true;

    const client = new VfsProxyClient({ target });
    client.dispose();

    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn.mock.calls[0][0]).toMatch(/dispose\(\) failed/);
  });

  it("readFile normalizes byte payloads", async () => {
    const client = new VfsProxyClient({ postMessage: vi.fn(), target: new FakeTarget() });

    const base = new Uint8Array([1, 2, 3, 4]);
    const view = new Uint8Array(base.buffer, 1, 2);
    const u16 = new Uint16Array([0x1234, 0x5678]);

    const cases = [
      { bytes: new Uint8Array([9, 8]), expected: [9, 8] },
      { bytes: base.buffer, expected: [1, 2, 3, 4] },
      { bytes: view, expected: [2, 3] },
      { bytes: u16, expected: Array.from(new Uint8Array(u16.buffer.slice(u16.byteOffset, u16.byteOffset + u16.byteLength))) },
      { bytes: null, expected: [] },
    ];

    for (const testCase of cases) {
      client._requestAsync = vi.fn().mockResolvedValueOnce({ bytes: testCase.bytes });
      const result = await client.readFile("/file");
      expect(Array.from(result)).toEqual(testCase.expected);
    }
  });

  it("writeFile forwards data payloads including empty/large/deep inputs", async () => {
    const client = new VfsProxyClient({ postMessage: vi.fn(), target: new FakeTarget() });
    const request = vi.fn().mockResolvedValue({ ok: true });
    client._requestAsync = request;

    const deep = buildDeepObject(40);
    const large = new Uint8Array(1024 * 1024);
    const longString = "x".repeat(10000);

    const cases = [
      { path: "", data: [] },
      { path: "/empty", data: {} },
      { path: "/deep", data: deep },
      { path: "/large", data: large },
      { path: "/long", data: longString },
    ];

    for (const testCase of cases) {
      const ok = await client.writeFile(testCase.path, testCase.data);
      expect(ok).toBe(true);
    }

    expect(request).toHaveBeenCalledTimes(cases.length);

    cases.forEach((testCase, idx) => {
      const call = request.mock.calls[idx];
      expect(call[0]).toBe(VFS_OPS.WRITE);
      expect(call[1]).toBe(testCase.path);
      expect(call[2].data).toBe(testCase.data);
    });
  });

  it("list/stat/mkdir/delete/exists forward ops and options", async () => {
    const client = new VfsProxyClient({ postMessage: vi.fn(), target: new FakeTarget() });
    const request = vi.fn()
      .mockResolvedValueOnce({ exists: true, entries: [] })
      .mockResolvedValueOnce({ exists: true, size: 1 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ exists: true })
      .mockResolvedValueOnce({ exists: 0 })
      .mockResolvedValueOnce(null);

    client._requestAsync = request;

    const listRes = await client.list("/dir");
    const statRes = await client.stat("/file");
    const mkdirDefault = await client.mkdir("/mkdir-default");
    const mkdirNoRec = await client.mkdir("/mkdir-norec", { recursive: false });
    const delDefault = await client.delete("/del-default");
    const delRec = await client.delete("/del-rec", { recursive: true });
    const existsTrue = await client.exists("/exists-true");
    const existsFalse = await client.exists("/exists-false");
    const existsMissing = await client.exists("/exists-missing");

    expect(listRes).toEqual({ exists: true, entries: [] });
    expect(statRes).toEqual({ exists: true, size: 1 });
    expect(mkdirDefault).toBe(true);
    expect(mkdirNoRec).toBe(true);
    expect(delDefault).toBe(true);
    expect(delRec).toBe(true);
    expect(existsTrue).toBe(true);
    expect(existsFalse).toBe(false);
    expect(existsMissing).toBe(false);

    expect(request.mock.calls[0]).toEqual([VFS_OPS.LIST, "/dir", {}]);
    expect(request.mock.calls[1]).toEqual([VFS_OPS.STAT, "/file", {}]);
    expect(request.mock.calls[2]).toEqual([VFS_OPS.MKDIR, "/mkdir-default", { recursive: true }]);
    expect(request.mock.calls[3]).toEqual([VFS_OPS.MKDIR, "/mkdir-norec", { recursive: false }]);
    expect(request.mock.calls[4]).toEqual([VFS_OPS.DELETE, "/del-default", { recursive: false }]);
    expect(request.mock.calls[5]).toEqual([VFS_OPS.DELETE, "/del-rec", { recursive: true }]);
    expect(request.mock.calls[6]).toEqual([VFS_OPS.EXISTS, "/exists-true", {}]);
    expect(request.mock.calls[7]).toEqual([VFS_OPS.EXISTS, "/exists-false", {}]);
    expect(request.mock.calls[8]).toEqual([VFS_OPS.EXISTS, "/exists-missing", {}]);
  });

  it("_assertSync throws when sync is unsupported", () => {
    const client = new VfsProxyClient({ postMessage: vi.fn(), target: new FakeTarget() });
    client._supportsSync = false;

    expect(() => client._assertSync()).toThrow(/sync mode requires/);
  });

  it("_ensureSharedBuffer enforces minimum capacity and reuses buffers", () => {
    const client = new VfsProxyClient({ postMessage: vi.fn(), target: new FakeTarget() });
    client._supportsSync = true;

    const buf1 = client._ensureSharedBuffer(-1);
    expect(buf1.byteLength).toBe(16 + 64);

    const buf2 = client._ensureSharedBuffer(8);
    expect(buf2).toBe(buf1);

    const buf3 = client._ensureSharedBuffer(100);
    expect(buf3.byteLength).toBe(16 + 100);
    expect(buf3).not.toBe(buf1);
  });

  it("_requestBytesSync posts sync request and returns bytes", () => {
    const payload = new Uint8Array([1, 2, 3]);
    const atomics = createAtomicsStub((header) => {
      const payloadView = new Uint8Array(header.buffer, 16);
      payloadView.set(payload);
      header[0] = 1;
      header[1] = payload.length;
      header[2] = 0;
    });
    vi.stubGlobal("Atomics", atomics);

    const target = new FakeTarget();
    const client = new VfsProxyClient({ target });
    client._supportsSync = true;

    const out = client._requestBytesSync(VFS_OPS.READ, "/file", {}, { payloadBytes: 8 });

    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(target.postMessageCalls).toHaveLength(1);
    expect(target.postMessageCalls[0][0]).toMatchObject({
      type: VFS_REQUEST,
      op: VFS_OPS.READ,
      path: "/file",
      mode: "sync",
    });
    expect(target.postMessageCalls[0][0].buffer).toBeInstanceOf(SharedArrayBuffer);
  });

  it("_requestBytesSync maps missing path errors to ENOENT", () => {
    const message = "ENOENT: NotFoundError";
    const msgBytes = encoder.encode(message);
    const atomics = createAtomicsStub((header) => {
      const payloadView = new Uint8Array(header.buffer, 16);
      payloadView.set(msgBytes);
      header[0] = -1;
      header[1] = msgBytes.length;
      header[2] = 0;
    });
    vi.stubGlobal("Atomics", atomics);

    const client = new VfsProxyClient({ postMessage: vi.fn(), target: new FakeTarget() });
    client._supportsSync = true;

    const err = getThrown(() => client._requestBytesSync(VFS_OPS.READ, "/missing", {}, { payloadBytes: 8 }));
    expect(err.code).toBe("ENOENT");
  });

  it("_requestBytesSync reports EOVERFLOW and requiredBytes", () => {
    const atomics = createAtomicsStub((header) => {
      header[0] = -1;
      header[1] = 0;
      header[2] = 256;
    });
    vi.stubGlobal("Atomics", atomics);

    const client = new VfsProxyClient({ postMessage: vi.fn(), target: new FakeTarget() });
    client._supportsSync = true;

    const err = getThrown(() => client._requestBytesSync(VFS_OPS.READ, "/big", {}, { payloadBytes: 8 }));
    expect(err.code).toBe("EOVERFLOW");
    expect(err.requiredBytes).toBe(256);
  });

  it("_requestBytesSync times out", () => {
    vi.stubGlobal("Atomics", {
      store: (arr, idx, val) => {
        arr[idx] = val;
        return val;
      },
      load: (arr, idx) => arr[idx],
      wait: vi.fn(() => "timed-out"),
    });

    const client = new VfsProxyClient({ postMessage: vi.fn(), target: new FakeTarget() });
    client._supportsSync = true;

    expect(() => client._requestBytesSync(VFS_OPS.READ, "/slow", {}, { payloadBytes: 8 })).toThrow(/timed out/);
  });

  it("readFileSync retries on overflow and honors sizeHint boundaries", () => {
    const client = new VfsProxyClient({ postMessage: vi.fn(), target: new FakeTarget() });

    const overflow = new Error("overflow");
    overflow.code = "EOVERFLOW";
    overflow.requiredBytes = 128;

    const spy = vi.fn()
      .mockImplementationOnce(() => { throw overflow; })
      .mockImplementationOnce((_op, _path, _args, options) => {
        expect(options.payloadBytes).toBe(128);
        return new Uint8Array([7, 8]);
      })
      .mockImplementation((_op, _path, _args, options) => new Uint8Array([options.payloadBytes === 4194304 ? 1 : 2]));

    client._requestBytesSync = spy;

    const out = client.readFileSync("/file", { sizeHint: 0 });
    expect(Array.from(out)).toEqual([7, 8]);

    client.readFileSync("/default", { sizeHint: "1" });
    client.readFileSync("/max", { sizeHint: Number.MAX_SAFE_INTEGER });

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[2][3].payloadBytes).toBe(4194304);
    expect(spy.mock.calls[3][3].payloadBytes).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("readFileSync fails after repeated overflow", () => {
    const client = new VfsProxyClient({ postMessage: vi.fn(), target: new FakeTarget() });

    const required = [128, 256, 512];
    client._requestBytesSync = vi.fn(() => {
      const overflow = new Error("overflow");
      overflow.code = "EOVERFLOW";
      overflow.requiredBytes = required.shift();
      throw overflow;
    });

    expect(() => client.readFileSync("/file", { sizeHint: 0 })).toThrow(/too many attempts/);
    expect(client._requestBytesSync).toHaveBeenCalledTimes(3);
  });

  it("_requestJsonSync rejects invalid JSON and invalid payloads", () => {
    const client = new VfsProxyClient({ postMessage: vi.fn(), target: new FakeTarget() });

    client._requestBytesSync = vi.fn()
      .mockReturnValueOnce(encoder.encode("{"))
      .mockReturnValueOnce(encoder.encode(JSON.stringify({ exists: "no" })))
      .mockReturnValueOnce(encoder.encode(JSON.stringify({ exists: true, entries: {} })))
      .mockReturnValueOnce(encoder.encode(JSON.stringify({ ok: false })));

    expect(() => client._requestJsonSync(VFS_OPS.STAT, "/bad-json", {})).toThrow(/invalid JSON response/);
    expect(() => client._requestJsonSync(VFS_OPS.STAT, "/bad-stat", {})).toThrow(/invalid stat payload/);
    expect(() => client._requestJsonSync(VFS_OPS.LIST, "/bad-list", {})).toThrow(/invalid list payload/);
    expect(() => client._requestJsonSync(VFS_OPS.WRITE, "/bad-write", {})).toThrow(/invalid write payload/);
  });

  it("_requestJsonSync returns validated payload", () => {
    const client = new VfsProxyClient({ postMessage: vi.fn(), target: new FakeTarget() });
    client._requestBytesSync = vi.fn().mockReturnValue(encoder.encode(JSON.stringify({ exists: true })));

    const payload = client._requestJsonSync(VFS_OPS.EXISTS, "/ok", {});
    expect(payload).toEqual({ exists: true });
  });

  it("sync wrappers forward ops and arguments", () => {
    const client = new VfsProxyClient({ postMessage: vi.fn(), target: new FakeTarget() });
    const request = vi.fn().mockReturnValue({ exists: true });
    client._requestJsonSync = request;

    expect(client.writeFileSync("/write", "data")).toBe(true);
    expect(client.statSync("/stat")).toEqual({ exists: true });
    expect(client.listSync("/list")).toEqual({ exists: true });
    expect(client.mkdirSync("/mkdir")).toBe(true);
    expect(client.mkdirSync("/mkdir-norec", { recursive: false })).toBe(true);
    expect(client.deleteSync("/delete")).toBe(true);
    expect(client.deleteSync("/delete-rec", { recursive: true })).toBe(true);
    expect(client.existsSync("/exists")).toBe(true);

    expect(request.mock.calls[0]).toEqual([VFS_OPS.WRITE, "/write", { data: "data" }]);
    expect(request.mock.calls[1]).toEqual([VFS_OPS.STAT, "/stat", {}]);
    expect(request.mock.calls[2]).toEqual([VFS_OPS.LIST, "/list", {}]);
    expect(request.mock.calls[3]).toEqual([VFS_OPS.MKDIR, "/mkdir", { recursive: true }]);
    expect(request.mock.calls[4]).toEqual([VFS_OPS.MKDIR, "/mkdir-norec", { recursive: false }]);
    expect(request.mock.calls[5]).toEqual([VFS_OPS.DELETE, "/delete", { recursive: false }]);
    expect(request.mock.calls[6]).toEqual([VFS_OPS.DELETE, "/delete-rec", { recursive: true }]);
    expect(request.mock.calls[7]).toEqual([VFS_OPS.EXISTS, "/exists", {}]);
  });
});
