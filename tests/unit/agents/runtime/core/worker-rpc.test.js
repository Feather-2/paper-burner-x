import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", () => {
  return {
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
    validateRpcResponse: vi.fn((msg) => ({ ok: true, value: msg })),
  };
});

import { WorkerRpcClient, createRpcHandler } from "../../../../../js/agents/runtime/core/worker-rpc.js";
import { validateRpcResponse } from "../../../../../js/agents/shared/index.js";

function createBrowserWorker() {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();

  function add(type, handler) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(handler);
  }

  function remove(type, handler) {
    listeners.get(type)?.delete(handler);
  }

  return {
    __mode: "dom",
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: vi.fn((type, handler) => add(type, handler)),
    removeEventListener: vi.fn((type, handler) => remove(type, handler)),
    __emit(type, payload) {
      const handlers = listeners.get(type);
      if (!handlers) return;
      for (const handler of handlers) handler(payload);
    },
  };
}

function createNodeWorker() {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();

  function add(type, handler) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(handler);
  }

  function remove(type, handler) {
    listeners.get(type)?.delete(handler);
  }

  return {
    __mode: "node",
    postMessage: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn((type, handler) => add(type, handler)),
    off: vi.fn((type, handler) => remove(type, handler)),
    __emit(type, payload) {
      const handlers = listeners.get(type);
      if (!handlers) return;
      for (const handler of handlers) handler(payload);
    },
  };
}

function emitWorker(worker, type, payload) {
  if (worker.__mode === "dom") {
    if (type === "message") {
      worker.__emit(type, { data: payload });
      return;
    }
    worker.__emit(type, payload);
    return;
  }
  worker.__emit(type, payload);
}

async function flushMicrotasks(count = 5) {
  for (let i = 0; i < count; i++) await Promise.resolve();
}

function getRpcCallMethodCandidates(client) {
  const preferred = ["call", "invoke", "request", "rpc", "exec", "send"];
  const candidates = [];

  for (const name of preferred) {
    if (typeof client[name] === "function") candidates.push(name);
  }

  const proto = Object.getPrototypeOf(client);
  const names = Object.getOwnPropertyNames(proto).filter(
    (name) => name !== "constructor" && typeof client[name] === "function",
  );

  for (const name of names) {
    if (candidates.includes(name)) continue;
    if (
      name === "_getWorker" ||
      name === "_attachListeners" ||
      name === "_onMessage" ||
      name === "_onError" ||
      name === "_onExit"
    ) {
      continue;
    }
    if (/call|invoke|request|rpc|send/i.test(name)) candidates.push(name);
  }

  for (const name of names) {
    if (candidates.includes(name)) continue;
    if (!/^_/.test(name)) continue;
    if (/call|invoke|request|rpc|send/i.test(name) && name !== "_getWorker") candidates.push(name);
  }

  return candidates;
}

function deriveTypeCandidatesFromRequest(requestMsg) {
  const result = new Set([
    undefined,
    "rpc_response",
    "rpc:response",
    "rpcResponse",
    "rpc-response",
    "response",
    "rpc",
    "result",
  ]);

  if (!requestMsg || typeof requestMsg !== "object") return [...result];

  const requestTypes = [];
  for (const key of ["type", "kind", "action", "op"]) {
    if (typeof requestMsg[key] === "string") requestTypes.push(requestMsg[key]);
  }

  for (const t of requestTypes) {
    result.add(t);
    result.add(t.replace(/request/gi, "response"));
    result.add(t.replace(/request/gi, "result"));
    result.add(t.replace(/call/gi, "response"));
    result.add(t.replace(/call/gi, "result"));
  }

  return [...result].filter((v) => v !== "");
}

async function startRpcCall(
  client,
  { method = "echo", params = [], options = {} } = {},
) {
  const candidates = getRpcCallMethodCandidates(client);
  if (candidates.length === 0) {
    throw new Error("No RPC call-like method found on WorkerRpcClient");
  }

  const beforeIds = new Set([...client._pending.keys()]);
  const optionBag = {
    ...options,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    transfer: options.transfer ?? options.transferables ?? options.transferList,
    transferables: options.transferables ?? options.transfer ?? options.transferList,
    transferList: options.transferList ?? options.transfer ?? options.transferables,
  };

  const argVariants = [
    [method, params, optionBag],
    [method, params],
    [method, { params, ...optionBag }],
    [{ method, params, ...optionBag }],
    [{ method, args: params, ...optionBag }],
  ];

  for (const fnName of candidates) {
    for (const args of argVariants) {
      let promise;
      try {
        promise = client[fnName](...args);
      } catch {
        continue;
      }

      await flushMicrotasks(25);

      const afterIds = [...client._pending.keys()];
      const newIds = afterIds.filter((id) => !beforeIds.has(id));
      if (newIds.length === 1) {
        await flushMicrotasks(25);
        return { promise, id: newIds[0], fnName };
      }

      await flushMicrotasks(25);
      const afterIds2 = [...client._pending.keys()];
      const newIds2 = afterIds2.filter((id) => !beforeIds.has(id));
      if (newIds2.length === 1) {
        await flushMicrotasks(25);
        return { promise, id: newIds2[0], fnName };
      }

      const quickSettle = await Promise.race([
        Promise.resolve(promise).then(
          () => "resolved",
          () => "rejected",
        ),
        flushMicrotasks(2).then(() => "pending"),
      ]);
      if (quickSettle === "rejected") continue;
    }
  }

  throw new Error("Unable to start RPC call (no signature matched)");
}

async function deliverResponse({ client, worker, id, result, requestMsg }) {
  const types = deriveTypeCandidatesFromRequest(requestMsg);

  const base = {
    id,
    ok: true,
    success: true,
    result,
    data: result,
    value: result,
    error: null,
  };

  const variants = [];
  for (const type of types) {
    const msg = { ...base };
    if (typeof type === "string") {
      msg.type = type;
      msg.kind = type;
      msg.action = type;
      msg.op = type;
    }
    variants.push(msg);
  }

  variants.push({ ...base, payload: { ...base } });

  for (const msg of variants) {
    if (!client._pending.has(id)) break;
    emitWorker(worker, "message", msg);
    await flushMicrotasks(4);
  }
}

async function deliverError({ client, worker, id, error, requestMsg }) {
  const types = deriveTypeCandidatesFromRequest(requestMsg);

  const base = {
    id,
    ok: false,
    success: false,
    error,
    err: error,
    result: null,
    data: null,
  };

  const variants = [];
  for (const type of types) {
    const msg = { ...base };
    if (typeof type === "string") {
      msg.type = type;
      msg.kind = type;
      msg.action = type;
      msg.op = type;
    }
    variants.push(msg);
  }

  variants.push({ ...base, payload: { ...base } });

  for (const msg of variants) {
    if (!client._pending.has(id)) break;
    emitWorker(worker, "message", msg);
    await flushMicrotasks(4);
  }
}

function containsValue(root, target) {
  const seen = new Set();
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === target) return true;

    if (typeof current !== "object" || current === null) continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    for (const value of Object.values(current)) stack.push(value);
  }

  return false;
}

function makeDeepObject(depth) {
  const root = { level: 0 };
  let cursor = root;
  for (let i = 1; i <= depth; i++) {
    cursor.next = { level: i };
    cursor = cursor.next;
  }
  return root;
}

describe("WorkerRpcClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses provided worker and attaches listeners (DOM style)", () => {
    const worker = createBrowserWorker();
    const client = new WorkerRpcClient({ worker });

    expect(client.worker).toBe(worker);
    expect(worker.addEventListener).toHaveBeenCalledWith("message", expect.any(Function));
    expect(worker.addEventListener).toHaveBeenCalledWith("error", expect.any(Function));
    expect(worker.addEventListener).toHaveBeenCalledWith("exit", expect.any(Function));
  });

  it("uses provided worker and attaches listeners (Node style)", () => {
    const worker = createNodeWorker();
    const client = new WorkerRpcClient({ worker });

    expect(client.worker).toBe(worker);
    expect(worker.on).toHaveBeenCalledWith("message", expect.any(Function));
    expect(worker.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(worker.on).toHaveBeenCalledWith("exit", expect.any(Function));
  });

  it("_getWorker rejects when no worker available", async () => {
    const client = new WorkerRpcClient();
    await expect(client._getWorker()).rejects.toThrow(/No worker available/);
  });

  it("_getWorker creates worker once for concurrent calls", async () => {
    const worker = createBrowserWorker();
    const createWorker = vi.fn(async () => worker);

    const client = new WorkerRpcClient({ createWorker });
    const [w1, w2] = await Promise.all([client._getWorker(), client._getWorker()]);

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(w1).toBe(worker);
    expect(w2).toBe(worker);
    expect(client.worker).toBe(worker);
  });

  it("_getWorker rejects when createWorker returns no worker (null/undefined/empty string)", async () => {
    const clientNull = new WorkerRpcClient({ createWorker: vi.fn(() => null) });
    await expect(clientNull._getWorker()).rejects.toThrow(/returned no worker/i);

    const clientUndef = new WorkerRpcClient({ createWorker: vi.fn(() => undefined) });
    await expect(clientUndef._getWorker()).rejects.toThrow(/returned no worker/i);

    const clientEmpty = new WorkerRpcClient({ createWorker: vi.fn(() => "") });
    await expect(clientEmpty._getWorker()).rejects.toThrow(/returned no worker/i);
  });

  it("_getWorker terminates created worker if disposed during creation", async () => {
    /** @type {{ promise: Promise<any>, resolve: (v: any) => void }} */
    const deferred = (() => {
      /** @type {(v: any) => void} */
      let resolve;
      const promise = new Promise((r) => {
        resolve = r;
      });
      return { promise, resolve };
    })();

    const worker = createBrowserWorker();
    const createWorker = vi.fn(() => deferred.promise);

    const client = new WorkerRpcClient({ createWorker });
    const p = client._getWorker();

    client._disposed = true;
    deferred.resolve(worker);

    await expect(p).rejects.toThrow(/disposed/i);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(client.worker).toBe(null);
  });

  it("performs an RPC call and resolves matching response", async () => {
    const worker = createBrowserWorker();
    const createWorker = vi.fn(async () => worker);
    const client = new WorkerRpcClient({ createWorker, timeoutMs: 500 });

    const { promise, id } = await startRpcCall(client, {
      method: "sum",
      params: [1, 2],
      options: { timeoutMs: 200 },
    });

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(typeof id).toBe("string");

    const requestMsg = worker.postMessage.mock.calls[0]?.[0];
    await deliverResponse({ client, worker, id, result: 3, requestMsg });

    await expect(promise).resolves.toBe(3);
    expect(vi.mocked(validateRpcResponse)).toHaveBeenCalled();
    expect(client._pending.size).toBe(0);
  });

  it("propagates remote error payloads with name/code/stack", async () => {
    const worker = createBrowserWorker();
    const client = new WorkerRpcClient({ createWorker: async () => worker, timeoutMs: 500 });

    const { promise, id } = await startRpcCall(client, {
      method: "fail",
      params: [{ a: 1 }],
    });

    const requestMsg = worker.postMessage.mock.calls[0]?.[0];
    await deliverError({
      client,
      worker,
      id,
      requestMsg,
      error: {
        name: "RemoteError",
        message: "boom",
        code: "E_REMOTE",
        stack: "remote-stack",
      },
    });

    await expect(promise).rejects.toMatchObject({
      name: "RemoteError",
      message: "boom",
      code: "E_REMOTE",
    });
    expect(client._pending.size).toBe(0);
  });

  it("times out with TimeoutError (string timeoutMs allowed)", async () => {
    vi.useFakeTimers();

    const worker = createBrowserWorker();
    const client = new WorkerRpcClient({
      createWorker: async () => worker,
      timeoutMs: "10",
    });

    const { promise, id } = await startRpcCall(client, {
      method: "neverResponds",
      params: [],
    });

    expect(client._pending.has(id)).toBe(true);

    // Attach rejection handler before advancing fake timers to avoid unhandled rejections.
    const asserted = expect(promise).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(25);
    await asserted;
    expect(client._pending.size).toBe(0);
  });

  it("normalizes invalid timeout values to fallback timeout", async () => {
    vi.useFakeTimers();
    const worker = createBrowserWorker();
    const client = new WorkerRpcClient({ createWorker: async () => worker, timeoutMs: 5 });

    const invalidTimeouts = [0, -1, NaN, Infinity];
    for (const timeoutMs of invalidTimeouts) {
      const { promise, id } = await startRpcCall(client, {
        method: "neverResponds",
        params: [],
        options: { timeoutMs },
      });

      await vi.advanceTimersByTimeAsync(4);
      expect(client._pending.has(id)).toBe(true);
      const asserted = expect(promise).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(2);
      await asserted;
      expect(client._pending.has(id)).toBe(false);
    }
  });

  it("normalizes constructor timeoutMs when non-positive", () => {
    const client = new WorkerRpcClient({ worker: createBrowserWorker(), timeoutMs: 0 });
    expect(client._timeoutMs).toBe(30000);
  });

  it("cancels with AbortError via AbortSignal", async () => {
    const worker = createBrowserWorker();
    const client = new WorkerRpcClient({ createWorker: async () => worker, timeoutMs: 500 });

    const controller = new AbortController();

    const { promise, id } = await startRpcCall(client, {
      method: "wait",
      params: [],
      options: { signal: controller.signal },
    });

    expect(client._pending.has(id)).toBe(true);

    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(client._pending.size).toBe(0);
  });

  it("cleans AbortSignal listeners on successful completion", async () => {
    const worker = createBrowserWorker();
    const client = new WorkerRpcClient({ createWorker: async () => worker, timeoutMs: 500 });

    /** @type {{ aborted: boolean, reason: any, addEventListener: ReturnType<typeof vi.fn>, removeEventListener: ReturnType<typeof vi.fn> }} */
    const signal = {
      aborted: false,
      reason: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const { promise, id } = await startRpcCall(client, {
      method: "echo",
      params: [],
      options: { signal },
    });

    const requestMsg = worker.postMessage.mock.calls[0]?.[0];
    await deliverResponse({ client, worker, id, result: "ok", requestMsg });

    await expect(promise).resolves.toBe("ok");
    expect(signal.addEventListener).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(signal.removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("passes Transferables as postMessage transferList", async () => {
    const worker = createBrowserWorker();
    const client = new WorkerRpcClient({ createWorker: async () => worker, timeoutMs: 500 });

    const buf = new ArrayBuffer(16);
    const transferList = [buf];

    const { promise, id } = await startRpcCall(client, {
      method: "xfer",
      params: [{ buf }],
      options: { transfer: transferList, transferables: transferList, transferList },
    });

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const [, secondArg] = worker.postMessage.mock.calls[0];
    expect(Array.isArray(secondArg)).toBe(true);
    expect(secondArg).toEqual(expect.arrayContaining([buf]));

    const requestMsg = worker.postMessage.mock.calls[0]?.[0];
    await deliverResponse({ client, worker, id, result: "ok", requestMsg });

    await expect(promise).resolves.toBe("ok");
    expect(client._pending.size).toBe(0);
  });

  it("cleans up pending when postMessage throws", async () => {
    const worker = createBrowserWorker();
    worker.postMessage.mockImplementation(() => {
      throw new Error("DataCloneError");
    });

    const client = new WorkerRpcClient({ createWorker: async () => worker, timeoutMs: 500 });
    const callMethods = getRpcCallMethodCandidates(client);
    expect(callMethods.length).toBeGreaterThan(0);

    const callName = callMethods[0];

    let p;
    try {
      p = client[callName]("boom", { a: 1 });
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(String(err.message)).toContain("DataCloneError");
      expect(client._pending.size).toBe(0);
      return;
    }

    await expect(p).rejects.toThrow(/DataCloneError/);
    expect(client._pending.size).toBe(0);
  });

  it("destroy() detaches listeners and rejects pending calls", async () => {
    const worker = createBrowserWorker();
    const client = new WorkerRpcClient({ worker, timeoutMs: 500 });

    const { promise } = await startRpcCall(client, { method: "hang", params: [] });
    client.destroy("destroyed");

    await expect(promise).rejects.toThrow(/destroyed/i);
    expect(worker.removeEventListener).toHaveBeenCalledWith("message", expect.any(Function));
    expect(worker.removeEventListener).toHaveBeenCalledWith("error", expect.any(Function));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(client.worker).toBe(null);
  });

  it("rejects pending calls on worker error and recreates worker on next call", async () => {
    const worker1 = createBrowserWorker();
    const worker2 = createBrowserWorker();
    const createWorker = vi.fn().mockResolvedValueOnce(worker1).mockResolvedValueOnce(worker2);

    const client = new WorkerRpcClient({ createWorker, timeoutMs: 500 });

    const first = await startRpcCall(client, { method: "first", params: [] });
    expect(client.worker).toBe(worker1);

    emitWorker(worker1, "error", new Error("crash"));
    await expect(first.promise).rejects.toBeInstanceOf(Error);

    const second = await startRpcCall(client, { method: "second", params: [] });
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(client.worker).toBe(worker2);

    const requestMsg = worker2.postMessage.mock.calls[0]?.[0];
    await deliverResponse({ client, worker: worker2, id: second.id, result: "recovered", requestMsg });
    await expect(second.promise).resolves.toBe("recovered");
  });

  it("supports concurrent calls and resolves out of order", async () => {
    const worker = createBrowserWorker();
    const client = new WorkerRpcClient({ createWorker: async () => worker, timeoutMs: 500 });

    const a = await startRpcCall(client, { method: "a", params: [0] });
    const b = await startRpcCall(client, { method: "b", params: [-1] });
    const c = await startRpcCall(client, { method: "c", params: [Number.MAX_SAFE_INTEGER] });

    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(client._pending.size).toBe(3);

    const requestMsg = worker.postMessage.mock.calls[0]?.[0];

    await deliverResponse({ client, worker, id: c.id, result: "C", requestMsg });
    await deliverResponse({ client, worker, id: a.id, result: "A", requestMsg });
    await deliverResponse({ client, worker, id: b.id, result: "B", requestMsg });

    await expect(a.promise).resolves.toBe("A");
    await expect(b.promise).resolves.toBe("B");
    await expect(c.promise).resolves.toBe("C");
    expect(client._pending.size).toBe(0);
  });

  it("ignores malformed/unrelated messages (null/undefined/empty) without breaking pending calls", async () => {
    const worker = createBrowserWorker();
    const client = new WorkerRpcClient({ createWorker: async () => worker, timeoutMs: 500 });

    const { promise, id } = await startRpcCall(client, { method: "echo", params: [] });
    expect(client._pending.has(id)).toBe(true);

    emitWorker(worker, "message", null);
    emitWorker(worker, "message", undefined);
    emitWorker(worker, "message", "");
    emitWorker(worker, "message", []);
    emitWorker(worker, "message", {});
    emitWorker(worker, "message", { id: "not_this_one", ok: true, result: "wrong" });
    await flushMicrotasks(6);

    expect(client._pending.has(id)).toBe(true);

    const requestMsg = worker.postMessage.mock.calls[0]?.[0];
    await deliverResponse({ client, worker, id, result: "ok", requestMsg });

    await expect(promise).resolves.toBe("ok");
    expect(client._pending.size).toBe(0);
  });

  it("handles large/deep payloads and edge values without throwing", async () => {
    const worker = createBrowserWorker();
    const client = new WorkerRpcClient({ createWorker: async () => worker, timeoutMs: 500 });

    const hugeString = "x".repeat(200_000);
    const deepObj = makeDeepObject(80);
    const bigBuffer = new Uint8Array(1_000_000).buffer;

    const payload = {
      emptyStr: "",
      whitespace: "   ",
      emptyArr: [],
      emptyObj: {},
      nil: null,
      undef: undefined,
      zero: 0,
      neg: -1,
      max: Number.MAX_SAFE_INTEGER,
      hugeString,
      deepObj,
      bigBuffer,
    };

    const { promise, id } = await startRpcCall(client, {
      method: "echo",
      params: payload,
      options: {
        timeoutMs: "50",
        transferables: {},
      },
    });

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const [requestMsg] = worker.postMessage.mock.calls[0];

    expect(containsValue(requestMsg, hugeString)).toBe(true);
    expect(containsValue(requestMsg, deepObj)).toBe(true);
    expect(containsValue(requestMsg, bigBuffer)).toBe(true);
    expect(containsValue(requestMsg, 0)).toBe(true);
    expect(containsValue(requestMsg, -1)).toBe(true);
    expect(containsValue(requestMsg, Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(containsValue(requestMsg, "   ")).toBe(true);
    expect(containsValue(requestMsg, "")).toBe(true);
    expect(containsValue(requestMsg, null)).toBe(true);
    expect(containsValue(requestMsg, undefined)).toBe(true);

    await deliverResponse({ client, worker, id, result: payload, requestMsg });
    await expect(promise).resolves.toEqual(payload);
    expect(client._pending.size).toBe(0);
  });

  it("treats invalid response as non-fatal and still times out when validateRpcResponse throws", async () => {
    vi.useFakeTimers();

    const worker = createBrowserWorker();
    const client = new WorkerRpcClient({ createWorker: async () => worker, timeoutMs: 10 });

    vi.mocked(validateRpcResponse).mockImplementation(() => {
      throw new Error("invalid rpc response");
    });

    const { promise, id } = await startRpcCall(client, { method: "x", params: [] });
    expect(client._pending.has(id)).toBe(true);

    expect(() => {
      emitWorker(worker, "message", { type: "rpc:response", id, ok: true, result: "should_not_pass" });
    }).not.toThrow();

    // Attach rejection handler before advancing fake timers to avoid unhandled rejections.
    const asserted = expect(promise).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(25);
    await asserted;
    expect(vi.mocked(validateRpcResponse)).toHaveBeenCalled();
    expect(client._pending.size).toBe(0);
  });
});

describe("createRpcHandler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("supports injected postMessage target (portable across runtimes)", async () => {
    const postMessage = vi.fn();
    const methods = {
      echo: vi.fn(async (params) => params),
    };
    const handler = createRpcHandler(methods, { postMessage });

    await handler({ type: "rpc:request", id: "req-1", method: "echo", params: { ok: true } });

    expect(methods.echo).toHaveBeenCalledWith({ ok: true }, expect.objectContaining({
      id: "req-1",
      method: "echo",
      signal: expect.any(Object),
    }));
    expect(postMessage).toHaveBeenCalledWith({
      type: "rpc:response",
      id: "req-1",
      ok: true,
      result: { ok: true },
    });
  });

  it("emits noncooperative cancellation signal when task ignores abort", async () => {
    vi.useFakeTimers();
    const postMessage = vi.fn();
    const methods = {
      busy: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve("done"), 50))),
    };
    const handler = createRpcHandler(methods, {
      postMessage,
      cancelWatchdogMs: 10,
    });

    const requestPromise = handler({ data: { type: "rpc:request", id: "req-2", method: "busy", params: null } });
    await Promise.resolve();
    await handler({ data: { type: "rpc:cancel", id: "req-2", reason: "user" } });

    await vi.advanceTimersByTimeAsync(15);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "rpc:cancel:noncooperative",
      id: "req-2",
      method: "busy",
    }));

    await vi.advanceTimersByTimeAsync(60);
    await requestPromise;
    expect(postMessage.mock.calls.some((call) => call[0]?.type === "rpc:response" && call[0]?.id === "req-2")).toBe(false);
  });
});
