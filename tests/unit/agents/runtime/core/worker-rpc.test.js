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

import WorkerRpcClientDefault, {
  WorkerRpcClient,
  createRpcHandler,
} from "../../../../../js/agents/runtime/core/worker-rpc.js";

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

describe("worker-rpc exports", () => {
  it("should_export_default_as_WorkerRpcClient", () => {
    expect(WorkerRpcClientDefault).toBe(WorkerRpcClient);
  });
});

describe("WorkerRpcClient", () => {
  it("should_resolve_with_handler_result_when_worker_responds_ok_true", async () => {
    const worker = new FakeWorker({
      mode: "eventTarget",
      handlers: {
        sum: ({ a, b }) => a + b,
      },
    });

    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });
    const result = await client.call("sum", { a: 1, b: 2 });

    expect(result).toBe(3);
  });

  it("should_send_rpc_request_message_when_call_invoked", async () => {
    const worker = new FakeWorker({
      mode: "eventTarget",
      handlers: {
        sum: ({ a, b }) => a + b,
      },
    });

    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });
    await client.call("sum", { a: 1, b: 2 });

    expect(worker.postMessageCalls[0][0]).toMatchObject({
      type: "rpc:request",
      id: expect.any(String),
      method: "sum",
      params: { a: 1, b: 2 },
    });
  });

  it("should_resolve_when_worker_uses_eventEmitter_listeners", async () => {
    const worker = new FakeWorker({
      mode: "eventEmitter",
      handlers: { echo: (value) => value },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const result = await client.call("echo", { ok: true });

    expect(result).toEqual({ ok: true });
  });

  it("should_set_onmessage_listener_when_worker_has_no_addEventListener_or_on", () => {
    const worker = new FakeWorker({
      mode: "fallback",
      handlers: { echo: (value) => value },
    });

    new WorkerRpcClient({ worker, timeoutMs: 200 });

    expect(typeof worker.onmessage).toBe("function");
  });

  it("should_clear_onmessage_listener_when_dispose_called_in_fallback_mode", () => {
    const worker = new FakeWorker({
      mode: "fallback",
      handlers: { echo: (value) => value },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    client.dispose();

    expect(worker.onmessage).toBeNull();
  });

  it.each([[null], [undefined], [""]])("should_reject_when_method_is_%s", async (method) => {
    const worker = new FakeWorker({ handlers: {} });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    await expect(client.call(method, {})).rejects.toThrow(/method is required/i);
  });

  it("should_throw_when_no_worker_available_and_no_factory", () => {
    const client = new WorkerRpcClient();

    expect(() => client.call("echo", null)).toThrow(/no worker available/i);
  });

  it("should_resolve_with_boundary_values_when_called_concurrently", async () => {
    const worker = new FakeWorker({ handlers: { echo: (value) => value } });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const emptyArray = [];
    const emptyObject = {};
    const whitespace = "   ";
    const arrayLike = { 0: "a", length: 1 };

    const results = await Promise.all([
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
    ]);

    expect(results).toEqual([
      null,
      undefined,
      "",
      whitespace,
      emptyArray,
      emptyObject,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "123",
      arrayLike,
      "empty-transfer",
    ]);
  });

  it("should_not_pass_transferables_argument_when_transferables_is_empty", async () => {
    const worker = new FakeWorker({ handlers: { echo: (value) => value } });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    await client.call("echo", "x", { transferables: [] });

    expect(worker.postMessageCalls[0][1]).toBeUndefined();
  });

  it("should_pass_transferables_argument_when_transferables_has_items", async () => {
    const buffer = new ArrayBuffer(8);
    const worker = new FakeWorker({
      handlers: { byteLength: (buf) => buf.byteLength },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    await client.call("byteLength", buffer, { transferables: [buffer] });

    expect(worker.postMessageCalls[0][1]).toEqual([buffer]);
  });

  it("should_handle_large_payloads_and_deep_nesting", async () => {
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

    const results = await Promise.all([
      client.call("byteLength", largeBuffer, { transferables: [largeBuffer] }),
      client.call("length", longString),
      client.call("readDeep", deepObject),
    ]);

    expect(results).toEqual([largeBuffer.byteLength, longString.length, "leaf"]);
  });

  it("should_match_out_of_order_responses_to_the_correct_calls", async () => {
    const worker = new FakeWorker({ autoRespond: false });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const first = client.call("first", { value: 1 });
    const second = client.call("second", { value: 2 });

    const firstId = worker.requests[0].id;
    const secondId = worker.requests[1].id;

    worker.respond(secondId, { ok: true, result: "two" });
    worker.respond(firstId, { ok: true, result: "one" });

    await expect(Promise.all([first, second])).resolves.toEqual(["one", "two"]);
  });

  it("should_reject_with_timeout_error_when_call_exceeds_timeout", async () => {
    vi.useFakeTimers();

    const worker = new FakeWorker({
      handlers: {
        hang: () => new Promise(() => {}),
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const promise = client.call("hang", null, { timeoutMs: 20 });
    const errorPromise = promise.catch((err) => err);

    await vi.advanceTimersByTimeAsync(20);
    await flushMicrotasks();

    const error = await errorPromise;
    expect(error).toMatchObject({ name: "TimeoutError" });
  });

  it("should_send_cancel_message_with_timeout_reason_when_timed_out", async () => {
    vi.useFakeTimers();

    const worker = new FakeWorker({
      handlers: {
        hang: () => new Promise(() => {}),
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const promise = client.call("hang", null, { timeoutMs: 20 });
    const settled = promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(20);
    await flushMicrotasks();
    await settled;

    expect(worker.cancelCalls[0]).toMatchObject({
      type: "rpc:cancel",
      id: worker.lastRequestId,
      reason: "timeout",
    });
  });

  it("should_not_create_worker_and_should_reject_with_AbortError_when_signal_already_aborted", async () => {
    const createWorker = vi.fn(() => new FakeWorker({ handlers: { echo: (v) => v } }));
    const client = new WorkerRpcClient({ createWorker, timeoutMs: 200 });

    const controller = new AbortController();
    controller.abort("nope");

    let error;
    try {
      await client.call("echo", "x", { signal: controller.signal });
    } catch (err) {
      error = err;
    }

    expect({
      name: error?.name,
      createWorkerCalls: createWorker.mock.calls.length,
    }).toEqual({
      name: "AbortError",
      createWorkerCalls: 0,
    });
  });

  it("should_send_cancel_message_when_aborted_after_request_is_sent", async () => {
    const worker = new FakeWorker({
      handlers: {
        hang: () => new Promise(() => {}),
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const controller = new AbortController();
    const promise = client.call("hang", null, { signal: controller.signal });

    controller.abort("stop");

    let error;
    try {
      await promise;
    } catch (err) {
      error = err;
    }

    expect({
      name: error?.name,
      cancel: worker.cancelCalls[0],
    }).toMatchObject({
      name: "AbortError",
      cancel: {
        type: "rpc:cancel",
        id: worker.lastRequestId,
        reason: "aborted",
      },
    });
  });

  it("should_reject_when_validateRpcResponse_returns_not_ok", async () => {
    validateRpcResponseMock.mockReturnValue({ ok: false, error: "bad response" });

    const worker = new FakeWorker({
      handlers: {
        ok: () => "ok",
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    let error;
    try {
      await client.call("ok", null);
    } catch (err) {
      error = err;
    }

    expect({
      message: error?.message,
      warnCalls: loggerMock.warn.mock.calls.length,
    }).toEqual({
      message: "bad response",
      warnCalls: 1,
    });
  });

  it("should_normalize_remote_error_objects", async () => {
    const worker = new FakeWorker({
      handlers: {
        failObject: () => {
          throw { message: "nope", name: "RemoteError", code: "E_NOPE" };
        },
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    await expect(client.call("failObject", null)).rejects.toMatchObject({
      message: "nope",
      name: "RemoteError",
      code: "E_NOPE",
    });
  });

  it("should_normalize_remote_error_strings", async () => {
    const worker = new FakeWorker({
      handlers: {
        failString: () => {
          throw "bad";
        },
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    await expect(client.call("failString", null)).rejects.toThrow(/bad/);
  });

  it("should_convert_falsy_remote_error_payloads_to_unknown_error", async () => {
    const worker = new FakeWorker({ autoRespond: false });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const promise = client.call("x", null);
    const id = worker.requests[0].id;

    worker.respond(id, { ok: false, error: null });

    await expect(promise).rejects.toThrow(/unknown error/i);
  });

  it("should_reject_pending_calls_and_clear_worker_when_worker_emits_error", async () => {
    const worker = new FakeWorker({
      handlers: {
        hang: () => new Promise(() => {}),
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const promise = client.call("hang", null);
    worker.crash(new Error("boom"));

    let error;
    try {
      await promise;
    } catch (err) {
      error = err;
    }

    expect({ message: error?.message, worker: client.worker }).toEqual({
      message: "boom",
      worker: null,
    });
  });

  it("should_reject_pending_calls_and_clear_worker_when_worker_exits", async () => {
    const worker = new FakeWorker({
      mode: "eventEmitter",
      handlers: {
        hang: () => new Promise(() => {}),
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const promise = client.call("hang", null);
    worker.exit(2);

    let error;
    try {
      await promise;
    } catch (err) {
      error = err;
    }

    expect({ message: error?.message, worker: client.worker }).toEqual({
      message: "Worker exited with code 2",
      worker: null,
    });
  });

  it("should_create_worker_once_for_concurrent_calls", async () => {
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
    resolveWorker(worker);

    const results = await Promise.all([p1, p2]);

    expect({ createCalls: createWorker.mock.calls.length, results }).toEqual({
      createCalls: 1,
      results: ["a", "b"],
    });
  });

  it("should_reject_when_createWorker_returns_no_worker", async () => {
    const createWorker = vi.fn(() => null);
    const client = new WorkerRpcClient({ createWorker, timeoutMs: 200 });

    let error;
    try {
      await client.call("echo", "x");
    } catch (err) {
      error = err;
    }

    expect({ message: error?.message, createCalls: createWorker.mock.calls.length }).toEqual({
      message: "createWorker returned no worker",
      createCalls: 1,
    });
  });

  it("should_reject_pending_calls_terminate_worker_and_prevent_reuse_when_disposed", async () => {
    const worker = new FakeWorker({
      handlers: {
        hang: () => new Promise(() => {}),
        echo: (v) => v,
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const pending = client.call("hang", null);
    client.dispose();

    let pendingMessage;
    try {
      await pending;
    } catch (err) {
      pendingMessage = err?.message;
    }

    let reuseMessage;
    try {
      await client.call("echo", "x");
    } catch (err) {
      reuseMessage = err?.message;
    }

    expect({
      pendingMessage,
      reuseMessage,
      terminated: worker.terminated,
    }).toMatchObject({
      pendingMessage: expect.stringMatching(/disposed/i),
      reuseMessage: expect.stringMatching(/disposed/i),
      terminated: true,
    });
  });

  it("should_terminate_worker_and_reject_call_when_disposed_during_worker_creation", async () => {
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
    await flushMicrotasks();

    let error;
    try {
      await pending;
    } catch (err) {
      error = err;
    }

    expect({ message: error?.message, terminated: worker.terminated }).toEqual({
      message: "WorkerRpcClient is disposed",
      terminated: true,
    });
  });

  it("should_reject_when_worker_postMessage_throws", async () => {
    const worker = new FakeWorker({ handlers: {} });
    worker.throwOnPostMessage = true;
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    await expect(client.call("boom", null)).rejects.toThrow(/postMessage boom/i);
  });

  it("should_reject_pending_calls_and_clear_worker_when_terminate_called", async () => {
    const worker = new FakeWorker({
      handlers: {
        hang: () => new Promise(() => {}),
      },
    });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    const pending = client.call("hang", null);
    client.terminate("bye");

    let error;
    try {
      await pending;
    } catch (err) {
      error = err;
    }

    expect({ message: error?.message, worker: client.worker }).toEqual({
      message: "bye",
      worker: null,
    });
  });

  it("should_throw_when_call_invoked_after_terminate_without_factory", () => {
    const worker = new FakeWorker({ handlers: { echo: (v) => v } });
    const client = new WorkerRpcClient({ worker, timeoutMs: 200 });

    client.terminate("bye");

    expect(() => client.call("echo", "x")).toThrow(/no worker available/i);
  });
});

describe("createRpcHandler", () => {
  it("should_ignore_when_event_data_is_missing", async () => {
    const { postMessage, restore } = setupWorkerGlobal();
    try {
      const handler = createRpcHandler({});

      await handler({ data: null });

      expect(postMessage).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("should_ignore_when_message_type_is_not_rpc_request_or_cancel", async () => {
    const { postMessage, restore } = setupWorkerGlobal();
    try {
      const handler = createRpcHandler({});

      await handler({ data: { type: "other", id: "x" } });

      expect(postMessage).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("should_call_method_with_params_and_context_when_request_received", async () => {
    const { restore } = setupWorkerGlobal();
    try {
      const methods = {
        sum: vi.fn((params) => params.a + params.b),
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

      expect(methods.sum).toHaveBeenCalledWith(
        { a: 2, b: 3 },
        expect.objectContaining({
          id: "req_1",
          method: "sum",
          signal: expect.any(AbortSignal),
        })
      );
    } finally {
      restore();
    }
  });

  it("should_post_success_response_when_method_resolves", async () => {
    const { postMessage, restore } = setupWorkerGlobal();
    try {
      const handler = createRpcHandler({
        sum: (params) => params.a + params.b,
      });

      await handler({
        data: {
          type: "rpc:request",
          id: "req_1",
          method: "sum",
          params: { a: 2, b: 3 },
        },
      });

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

  it("should_post_error_response_when_method_is_unknown", async () => {
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

  it("should_post_error_response_when_method_throws", async () => {
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

  it("should_abort_in_flight_request_and_not_post_response_when_cancel_received", async () => {
    const { postMessage, restore } = setupWorkerGlobal();
    try {
      let abortedAtResolve = false;
      const handler = createRpcHandler({
        wait: (_params, { signal }) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => {
              abortedAtResolve = signal.aborted;
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

      expect({ abortedAtResolve, postMessageCalls: postMessage.mock.calls.length }).toEqual({
        abortedAtResolve: true,
        postMessageCalls: 0,
      });
    } finally {
      restore();
    }
  });
});