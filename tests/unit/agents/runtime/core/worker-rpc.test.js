import { describe, it, expect, vi, beforeEach } from "vitest";

const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
}));
const createLoggerMock = vi.hoisted(() => vi.fn(() => loggerMock));
const validateRpcResponseMock = vi.hoisted(() => vi.fn(() => ({ ok: true })));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: createLoggerMock,
  validateRpcResponse: validateRpcResponseMock,
}));

import { WorkerRpcClient, createRpcHandler } from "../../../../../js/agents/runtime/core/worker-rpc.js";

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

class FakeWorker {
  constructor({ handlers = {}, mode = "eventTarget", autoRespond = true } = {}) {
    this.handlers = handlers;
    this.mode = mode;
    this.autoRespond = autoRespond;

    this.onmessage = null;
    this.onerror = null;

    this.postMessageCalls = [];
    this.cancelCalls = [];
    this.requests = [];
    this.lastRequestId = null;
    this.throwOnPostMessage = false;
    this.terminated = false;

    this._listeners = {
      message: new Set(),
      error: new Set(),
      exit: new Set(),
    };

    if (mode === "eventTarget") {
      this.addEventListener = (type, fn) => {
        if (!this._listeners[type]) return;
        this._listeners[type].add(fn);
      };
      this.removeEventListener = (type, fn) => {
        if (!this._listeners[type]) return;
        this._listeners[type].delete(fn);
      };
    } else if (mode === "eventEmitter") {
      this.on = (type, fn) => {
        if (!this._listeners[type]) return;
        this._listeners[type].add(fn);
      };
      this.off = (type, fn) => {
        if (!this._listeners[type]) return;
        this._listeners[type].delete(fn);
      };
      this.removeListener = this.off;
    }
  }

  postMessage(message, transferables) {
    if (this.throwOnPostMessage) throw new Error("postMessage boom");
    if (this.terminated) throw new Error("Worker is terminated");

    this.postMessageCalls.push([message, transferables]);

    if (!message || typeof message !== "object") return;

    if (message.type === "rpc:cancel") {
      this.cancelCalls.push(message);
      return;
    }

    if (message.type !== "rpc:request") return;

    const { id, method, params } = message;
    this.lastRequestId = id;
    this.requests.push(message);

    if (!this.autoRespond) return;

    const handler = this.handlers[method];
    if (typeof handler !== "function") {
      Promise.resolve().then(() => {
        this._emit("message", {
          type: "rpc:response",
          id,
          ok: false,
          error: `No handler: ${method}`,
        });
      });
      return;
    }

    Promise.resolve()
      .then(() => handler(params))
      .then(
        (result) => {
          this._emit("message", { type: "rpc:response", id, ok: true, result });
        },
        (err) => {
          let errorPayload = err;
          if (typeof err === "string") {
            errorPayload = err;
          } else if (err && typeof err === "object") {
            errorPayload = err;
          } else {
            errorPayload = String(err);
          }
          this._emit("message", { type: "rpc:response", id, ok: false, error: errorPayload });
        }
      );
  }

  respond(id, payload) {
    this._emit("message", { type: "rpc:response", id, ...payload });
  }

  crash(err = new Error("crash")) {
    this.terminated = true;
    this._emit("error", err);
  }

  exit(code = 0) {
    this.terminated = true;
    this._emit("exit", code);
  }

  terminate() {
    this.terminated = true;
  }

  listenerCount(type) {
    return this._listeners[type] ? this._listeners[type].size : 0;
  }

  _emit(type, payload) {
    if (type === "message") {
      const event = { data: payload };
      try {
        this.onmessage?.(event);
      } catch {
        // ignore
      }
      for (const fn of this._listeners.message) {
        try {
          fn(event);
        } catch {
          // ignore
        }
      }
      return;
    }

    if (type === "error") {
      try {
        this.onerror?.(payload);
      } catch {
        // ignore
      }
      for (const fn of this._listeners.error) {
        try {
          fn(payload);
        } catch {
          // ignore
        }
      }
      return;
    }

    if (type === "exit") {
      for (const fn of this._listeners.exit) {
        try {
          fn(payload);
        } catch {
          // ignore
        }
      }
    }
  }
}

const makeDeepObject = (depth) => {
  let current = { value: "leaf" };
  for (let i = 0; i < depth; i += 1) {
    current = { level: i, child: current };
  }
  return current;
};

const setupWorkerGlobal = () => {
  const original = globalThis.self;
  const postMessage = vi.fn();
  globalThis.self = { postMessage };
  return {
    postMessage,
    restore: () => {
      globalThis.self = original;
    },
  };
};

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  validateRpcResponseMock.mockReturnValue({ ok: true });
});

describe("WorkerRpcClient", () => {
  it("resolves call using EventTarget listeners", async () => {
    const worker = new FakeWorker({
      mode: "eventTarget",
      handlers: {
        sum: ({ a, b }) => a + b,
      },
    });

    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });
    const result = await client.call("sum", { a: 1, b: 2 });

    expect(result).toBe(3);
    expect(worker.postMessageCalls).toHaveLength(1);
    expect(worker.postMessageCalls[0][0].type).toBe("rpc:request");
    expect(worker.postMessageCalls[0][1]).toBeUndefined();
    expect(validateRpcResponseMock).toHaveBeenCalled();
  });

  it("falls back to onmessage when addEventListener/on are missing", async () => {
    const worker = new FakeWorker({
      mode: "fallback",
      handlers: { echo: (value) => value },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    expect(typeof worker.onmessage).toBe("function");

    const result = await client.call("echo", { ok: true });
    expect(result).toEqual({ ok: true });

    client.dispose();
    expect(worker.onmessage).toBeNull();
  });

  it("rejects when method is missing", async () => {
    const worker = new FakeWorker({ handlers: {} });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const invalidMethods = [null, undefined, ""];
    for (const method of invalidMethods) {
      await expect(client.call(method, {})).rejects.toThrow(/method is required/i);
    }
  });

  it("throws when no worker available and no factory", () => {
    const client = new WorkerRpcClient();
    expect(() => client.call("echo", null)).toThrow(/no worker available/i);
  });

  it("handles empty/edge/type boundary params with concurrent calls", async () => {
    const worker = new FakeWorker({ handlers: { echo: (value) => value } });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const emptyArray = [];
    const emptyObject = {};
    const whitespace = "   ";
    const arrayLike = { 0: "a", length: 1 };

    const promises = [
      client.call("echo", null),
      client.call("echo", undefined),
      client.call("echo", ""),
      client.call("echo", whitespace),
      client.call("echo", emptyArray),
      client.call("echo", emptyObject),
      client.call("echo", 0),
      client.call("echo", -1),
      client.call("echo", Number.MAX_SAFE_INTEGER),
      client.call("echo", "123"),
      client.call("echo", arrayLike),
      client.call("echo", "empty-transfer", { transferables: [] }),
    ];

    const results = await Promise.all(promises);

    expect(results[0]).toBeNull();
    expect(results[1]).toBeUndefined();
    expect(results[2]).toBe("");
    expect(results[3]).toBe(whitespace);
    expect(results[4]).toEqual([]);
    expect(results[5]).toEqual({});
    expect(results[6]).toBe(0);
    expect(results[7]).toBe(-1);
    expect(results[8]).toBe(Number.MAX_SAFE_INTEGER);
    expect(results[9]).toBe("123");
    expect(results[10]).toEqual(arrayLike);
    expect(results[11]).toBe("empty-transfer");

    expect(worker.postMessageCalls.at(-1)[1]).toBeUndefined();
  });

  it("handles large payloads and deep nesting", async () => {
    const largeBuffer = new ArrayBuffer(1024 * 1024);
    const longString = "x".repeat(100000);
    const deepObject = makeDeepObject(25);

    const worker = new FakeWorker({
      handlers: {
        byteLength: (buf) => buf.byteLength,
        length: (str) => str.length,
        readDeep: (obj) => {
          let current = obj;
          while (current && current.child) current = current.child;
          return current.value;
        },
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const [bufferLength, stringLength, deepValue] = await Promise.all([
      client.call("byteLength", largeBuffer, { transferables: [largeBuffer] }),
      client.call("length", longString),
      client.call("readDeep", deepObject),
    ]);

    expect(bufferLength).toBe(largeBuffer.byteLength);
    expect(stringLength).toBe(longString.length);
    expect(deepValue).toBe("leaf");
    expect(worker.postMessageCalls[0][1][0]).toBe(largeBuffer);
  });

  it("matches out-of-order responses to the correct calls", async () => {
    const worker = new FakeWorker({ autoRespond: false });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const first = client.call("first", { value: 1 });
    const second = client.call("second", { value: 2 });

    const firstId = worker.requests[0].id;
    const secondId = worker.requests[1].id;

    worker.respond(secondId, { ok: true, result: "two" });
    worker.respond(firstId, { ok: true, result: "one" });

    await expect(second).resolves.toBe("two");
    await expect(first).resolves.toBe("one");
  });

  it("times out and sends cancel message", async () => {
    vi.useFakeTimers();

    const worker = new FakeWorker({
      handlers: {
        hang: () => new Promise(() => {}),
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const promise = client.call("hang", null, { timeoutMs: 20 });
    const rejection = expect(promise).rejects.toMatchObject({ name: "TimeoutError" });

    await vi.advanceTimersByTimeAsync(20);
    await flushMicrotasks();

    await rejection;
    expect(worker.cancelCalls).toHaveLength(1);
    expect(worker.cancelCalls[0].reason).toBe("timeout");
    expect(worker.cancelCalls[0].id).toBe(worker.lastRequestId);
  });

  it("rejects immediately when signal already aborted and does not create worker", async () => {
    const createWorker = vi.fn(() => new FakeWorker({ handlers: { echo: (v) => v } }));
    const client = new WorkerRpcClient({ createWorker, timeoutMs: 200 });

    const controller = new AbortController();
    controller.abort("nope");

    await expect(client.call("echo", "x", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("aborts after send and sends cancel message", async () => {
    const worker = new FakeWorker({
      handlers: {
        hang: () => new Promise(() => {}),
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const controller = new AbortController();
    const promise = client.call("hang", null, { signal: controller.signal });
    controller.abort("stop");

    await expect(promise).rejects.toMatchObject({
      name: "AbortError",
      message: expect.stringMatching(/stop|aborted/i),
    });

    expect(worker.cancelCalls).toHaveLength(1);
    expect(worker.cancelCalls[0].reason).toBe("aborted");
    expect(worker.cancelCalls[0].id).toBe(worker.lastRequestId);
  });

  it("rejects invalid response payloads and logs warning", async () => {
    validateRpcResponseMock.mockReturnValue({ ok: false, error: "bad response" });

    const worker = new FakeWorker({
      handlers: {
        ok: () => "ok",
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    await expect(client.call("ok", null)).rejects.toThrow(/bad response/i);
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it("normalizes remote errors from string and object", async () => {
    const worker = new FakeWorker({
      handlers: {
        failObject: () => {
          throw { message: "nope", name: "RemoteError", code: "E_NOPE" };
        },
        failString: () => {
          throw "bad";
        },
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    await expect(client.call("failObject", null)).rejects.toMatchObject({
      message: "nope",
      name: "RemoteError",
      code: "E_NOPE",
    });
    await expect(client.call("failString", null)).rejects.toThrow(/bad/);
  });

  it("rejects pending calls on worker error and clears instance", async () => {
    const worker = new FakeWorker({
      handlers: {
        hang: () => new Promise(() => {}),
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const promise = client.call("hang", null);
    worker.crash(new Error("boom"));

    await expect(promise).rejects.toThrow(/boom/);
    expect(client.worker).toBeNull();
  });

  it("rejects pending calls on worker exit and clears instance", async () => {
    const worker = new FakeWorker({
      mode: "eventEmitter",
      handlers: {
        hang: () => new Promise(() => {}),
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const promise = client.call("hang", null);
    worker.exit(2);

    await expect(promise).rejects.toThrow(/code 2/i);
    expect(client.worker).toBeNull();
  });

  it("creates worker once for concurrent calls", async () => {
    const worker = new FakeWorker({ handlers: { echo: (value) => value } });
    let resolveWorker;
    const createWorker = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveWorker = resolve;
        })
    );

    const client = new WorkerRpcClient({ createWorker, timeoutMs: 200 });
    const p1 = client.call("echo", "a");
    const p2 = client.call("echo", "b");

    await flushMicrotasks();
    expect(createWorker).toHaveBeenCalledTimes(1);

    resolveWorker(worker);

    await expect(Promise.all([p1, p2])).resolves.toEqual(["a", "b"]);
  });

  it("rejects when createWorker returns no worker", async () => {
    const createWorker = vi.fn(() => null);
    const client = new WorkerRpcClient({ createWorker, timeoutMs: 200 });

    await expect(client.call("echo", "x")).rejects.toThrow(/returned no worker/i);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it("dispose rejects pending calls and prevents reuse", async () => {
    const worker = new FakeWorker({
      handlers: {
        hang: () => new Promise(() => {}),
        echo: (v) => v,
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const pending = client.call("hang", null);
    client.dispose();

    await expect(pending).rejects.toThrow(/disposed/i);
    await expect(client.call("echo", "x")).rejects.toThrow(/disposed/i);
    expect(worker.terminated).toBe(true);
  });

  it("dispose during creation terminates worker and rejects call", async () => {
    const worker = new FakeWorker({ handlers: { echo: (v) => v } });
    let resolveWorker;
    const createWorker = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveWorker = resolve;
        })
    );

    const client = new WorkerRpcClient({ createWorker, timeoutMs: 200 });
    const pending = client.call("echo", "x");

    await flushMicrotasks();
    client.dispose();

    resolveWorker(worker);

    await expect(pending).rejects.toThrow(/disposed/i);
    expect(worker.terminated).toBe(true);
  });

  it("rejects if postMessage throws", async () => {
    const worker = new FakeWorker({ handlers: {} });
    worker.throwOnPostMessage = true;
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    await expect(client.call("boom", null)).rejects.toThrow(/postMessage boom/i);
  });
});

describe("createRpcHandler", () => {
  it("handles requests and posts successful responses", async () => {
    const { postMessage, restore } = setupWorkerGlobal();
    try {
      let receivedContext;
      const methods = {
        sum: vi.fn((params, ctx) => {
          receivedContext = ctx;
          return params.a + params.b;
        }),
      };

      const handler = createRpcHandler(methods);
      await handler({
        data: {
          type: "rpc:request",
          id: "req_1",
          method: "sum",
          params: { a: 2, b: 3 },
        },
      });

      expect(methods.sum).toHaveBeenCalledWith({ a: 2, b: 3 }, expect.any(Object));
      expect(receivedContext).toMatchObject({ id: "req_1", method: "sum" });
      expect(receivedContext.signal).toBeInstanceOf(AbortSignal);
      expect(postMessage).toHaveBeenCalledWith({
        type: "rpc:response",
        id: "req_1",
        ok: true,
        result: 5,
      });
    } finally {
      restore();
    }
  });

  it("returns errors for unknown methods", async () => {
    const { postMessage, restore } = setupWorkerGlobal();
    try {
      const handler = createRpcHandler({});
      await handler({
        data: {
          type: "rpc:request",
          id: "req_2",
          method: "missing",
          params: null,
        },
      });

      expect(postMessage).toHaveBeenCalledWith({
        type: "rpc:response",
        id: "req_2",
        ok: false,
        error: expect.stringMatching(/unknown method/i),
      });
    } finally {
      restore();
    }
  });

  it("posts error responses when handler throws", async () => {
    const { postMessage, restore } = setupWorkerGlobal();
    try {
      const handler = createRpcHandler({
        fail: () => {
          throw new Error("boom");
        },
      });

      await handler({
        data: {
          type: "rpc:request",
          id: "req_3",
          method: "fail",
          params: null,
        },
      });

      expect(postMessage).toHaveBeenCalledWith({
        type: "rpc:response",
        id: "req_3",
        ok: false,
        error: "boom",
      });
    } finally {
      restore();
    }
  });

  it("aborts in-flight calls on cancel messages", async () => {
    const { postMessage, restore } = setupWorkerGlobal();
    try {
      const abortStates = [];
      const handler = createRpcHandler({
        wait: (_params, { signal }) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => {
              abortStates.push(signal.aborted);
              resolve("done");
            });
          }),
      });

      const pending = handler({
        data: {
          type: "rpc:request",
          id: "req_4",
          method: "wait",
          params: null,
        },
      });

      await flushMicrotasks();

      await handler({
        data: {
          type: "rpc:cancel",
          id: "req_4",
          reason: "stop",
        },
      });

      await pending;

      expect(abortStates).toEqual([true]);
      expect(postMessage).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
