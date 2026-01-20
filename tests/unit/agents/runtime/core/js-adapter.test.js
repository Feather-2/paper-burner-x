import { describe, it, expect, vi, beforeEach } from "vitest";

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: vi.fn(() => ({
    debug: loggerMocks.debug,
    info: loggerMocks.info,
    warn: loggerMocks.warn,
    error: loggerMocks.error,
  })),
}));

import { JSRuntimeAdapter } from "../../../../../js/agents/runtime/core/js-adapter.js";
import { RuntimeType } from "../../../../../js/agents/runtime/core/runtime-adapter.js";

const originalWorker = globalThis.Worker;

const workerState = {
  instances: [],
  nextPostMessageHandler: null,
  throwOnConstruct: false,
};

class MockWorker {
  constructor(url, options) {
    if (workerState.throwOnConstruct) {
      throw new Error("Worker unavailable");
    }
    this.url = url;
    this.options = options;
    this.onmessage = null;
    this.onerror = null;
    this._terminated = false;
    this._throwOnPostMessage = false;
    this._postMessageHandler = workerState.nextPostMessageHandler;

    this.postMessage = vi.fn((message) => {
      if (this._throwOnPostMessage) {
        throw new Error("postMessage failed");
      }
      if (typeof this._postMessageHandler === "function") {
        this._postMessageHandler(message, this);
      }
    });

    this.terminate = vi.fn(() => {
      this._terminated = true;
    });

    workerState.instances.push(this);
  }

  __setPostMessageHandler(handler) {
    this._postMessageHandler = handler;
  }

  __setThrowOnPostMessage(value) {
    this._throwOnPostMessage = value;
  }
}

const restoreWorker = () => {
  if (originalWorker === undefined) {
    if ("Worker" in globalThis) delete globalThis.Worker;
    return;
  }
  globalThis.Worker = originalWorker;
};

const installMockWorker = () => {
  globalThis.Worker = MockWorker;
};

const createAdapterWithWorker = async (options = {}, handler = null) => {
  installMockWorker();
  workerState.nextPostMessageHandler = handler;
  const adapter = new JSRuntimeAdapter(options);
  await adapter.initialize();
  const worker = workerState.instances[0];
  if (!worker) throw new Error("Mock worker was not created");
  return { adapter, worker };
};

const buildDeepState = (depth = 32) => {
  const root = {};
  let current = root;
  for (let i = 0; i < depth; i += 1) {
    current.next = { level: i };
    current = current.next;
  }
  return root;
};

beforeEach(() => {
  loggerMocks.debug.mockReset();
  loggerMocks.info.mockReset();
  loggerMocks.warn.mockReset();
  loggerMocks.error.mockReset();

  workerState.instances = [];
  workerState.nextPostMessageHandler = null;
  workerState.throwOnConstruct = false;

  vi.useRealTimers();
  restoreWorker();
});

describe("JSRuntimeAdapter", () => {
  it("constructs with defaults and runtime metadata", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(12345);
    const adapter = new JSRuntimeAdapter();

    expect(adapter.type).toBe(RuntimeType.JS);
    expect(adapter.id).toBe("js_12345");
    expect(adapter.skipValidation).toBe(false);
    expect(adapter.useWorkerSandbox).toBe(true);
    expect(adapter.mainThreadFallback).toBe("trustedOnly");
    expect(adapter.timeout).toBe(30000);
    expect(adapter._worker).toBe(null);
    expect(adapter._pendingRequests.size).toBe(0);
    expect(adapter._requestId).toBe(0);

    nowSpy.mockRestore();
  });

  it("normalizes options and handles timeout boundary values", () => {
    const allow = new JSRuntimeAdapter({ mainThreadFallback: " allow " });
    expect(allow.mainThreadFallback).toBe("allow");

    const deny = new JSRuntimeAdapter({ mainThreadFallback: "OFF" });
    expect(deny.mainThreadFallback).toBe("deny");

    const trusted = new JSRuntimeAdapter({ mainThreadFallback: "trusted_only" });
    expect(trusted.mainThreadFallback).toBe("trustedOnly");

    const whitespace = new JSRuntimeAdapter({ mainThreadFallback: "   " });
    expect(whitespace.mainThreadFallback).toBe("trustedOnly");

    const nullValue = new JSRuntimeAdapter({ mainThreadFallback: null });
    expect(nullValue.mainThreadFallback).toBe("trustedOnly");

    const custom = new JSRuntimeAdapter({
      skipValidation: true,
      useWorkerSandbox: false,
      timeout: -1,
    });
    expect(custom.skipValidation).toBe(true);
    expect(custom.useWorkerSandbox).toBe(false);
    expect(custom.timeout).toBe(-1);

    const zeroTimeout = new JSRuntimeAdapter({ timeout: 0 });
    expect(zeroTimeout.timeout).toBe(30000);

    const maxTimeout = new JSRuntimeAdapter({ timeout: Number.MAX_SAFE_INTEGER });
    expect(maxTimeout.timeout).toBe(Number.MAX_SAFE_INTEGER);

    const stringTimeout = new JSRuntimeAdapter({ timeout: "500" });
    expect(stringTimeout.timeout).toBe("500");
  });

  it("initialize skips worker when disabled", async () => {
    if ("Worker" in globalThis) delete globalThis.Worker;
    const adapter = new JSRuntimeAdapter({ useWorkerSandbox: false });
    const result = await adapter.initialize();

    expect(result).toBe(true);
    expect(adapter._worker).toBe(null);
    expect(adapter.useWorkerSandbox).toBe(false);
  });

  it("initialize no-ops when worker already exists", async () => {
    const workerSpy = vi.fn(function Worker() {});
    globalThis.Worker = workerSpy;

    const adapter = new JSRuntimeAdapter();
    const existing = { existing: true };
    adapter._worker = existing;

    const result = await adapter.initialize();

    expect(result).toBe(true);
    expect(adapter._worker).toBe(existing);
    expect(workerSpy).not.toHaveBeenCalled();
  });

  it("initialize handles worker constructor failure", async () => {
    workerState.throwOnConstruct = true;
    installMockWorker();

    const adapter = new JSRuntimeAdapter();
    const result = await adapter.initialize();

    expect(result).toBe(true);
    expect(adapter.useWorkerSandbox).toBe(false);
    expect(adapter._worker).toBe(null);
    expect(loggerMocks.warn).toHaveBeenCalled();
  });

  it("initialize wires worker handlers and logs sandbox messages", async () => {
    const { worker } = await createAdapterWithWorker();

    worker.onmessage?.({
      data: {
        type: "log",
        level: "info",
        args: ["hello", { detail: true }],
      },
    });

    expect(loggerMocks.info).toHaveBeenCalled();
    expect(loggerMocks.info.mock.calls[0][0]).toBe("[JSSandbox]");
  });

  it("execute routes to worker when available", async () => {
    const adapter = new JSRuntimeAdapter();
    const initSpy = vi.spyOn(adapter, "initialize").mockResolvedValue(true);
    adapter.useWorkerSandbox = true;
    adapter._worker = { postMessage: vi.fn(), terminate: vi.fn() };

    const workerSpy = vi.spyOn(adapter, "_executeInWorker").mockResolvedValue({ success: true });
    const mainSpy = vi.spyOn(adapter, "_executeInMainThread").mockResolvedValue({ success: false });

    const result = await adapter.execute("code", { state: {} });

    expect(result.success).toBe(true);
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(workerSpy).toHaveBeenCalledTimes(1);
    expect(mainSpy).not.toHaveBeenCalled();
  });

  it("execute uses main-thread fallback when worker is disabled", async () => {
    const adapter = new JSRuntimeAdapter({ useWorkerSandbox: false });
    const initSpy = vi.spyOn(adapter, "initialize").mockResolvedValue(true);

    const workerSpy = vi.spyOn(adapter, "_executeInWorker").mockResolvedValue({ success: true });
    const mainSpy = vi.spyOn(adapter, "_executeInMainThread").mockResolvedValue({ success: false });

    const result = await adapter.execute("code", { state: {} });

    expect(result.success).toBe(false);
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(mainSpy).toHaveBeenCalledTimes(1);
    expect(workerSpy).not.toHaveBeenCalled();
  });

  it("_executeInWorker returns aborted when signal is already aborted", async () => {
    const { adapter, worker } = await createAdapterWithWorker();
    const ac = new AbortController();
    ac.abort();

    const result = await adapter._executeInWorker("code", { signal: ac.signal });

    expect(result).toEqual({
      success: false,
      error: "Aborted",
      metrics: { duration: 0, aborted: true },
    });
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(adapter._pendingRequests.size).toBe(0);
  });

  it("_executeInWorker resolves results and passes large payloads", async () => {
    const largeCode = "x".repeat(200000);
    const deepState = buildDeepState(48);
    const arrayState = [];

    const { adapter, worker } = await createAdapterWithWorker({}, (message, instance) => {
      expect(message.code.length).toBe(200000);
      expect(message.state).toBe(deepState);
      expect(message.timeout).toBe(adapter.timeout);
      instance.onmessage?.({
        data: {
          type: "result",
          id: message.id,
          success: true,
          data: { ok: true, code: message.code.slice(0, 3) },
          metrics: { duration: 5 },
        },
      });
    });

    const result = await adapter._executeInWorker(largeCode, { state: deepState });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: true, code: "xxx" });
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "execute",
      code: largeCode,
      state: deepState,
    }));
    expect(adapter._pendingRequests.size).toBe(0);

    worker.__setPostMessageHandler((message, instance) => {
      instance.onmessage?.({
        data: {
          type: "result",
          id: message.id,
          success: true,
          data: { list: Array.isArray(message.state) },
          metrics: { duration: 1 },
        },
      });
    });

    const arrayResult = await adapter._executeInWorker("list", { state: arrayState });
    expect(arrayResult.data).toEqual({ list: true });
  });

  it("_executeInWorker surfaces postMessage errors", async () => {
    const { adapter, worker } = await createAdapterWithWorker();
    worker.__setThrowOnPostMessage(true);

    const result = await adapter._executeInWorker("code", { state: {} });

    expect(result.success).toBe(false);
    expect(result.error).toContain("postMessage failed");
    expect(result.metrics?.duration).toEqual(expect.any(Number));
    expect(adapter._pendingRequests.size).toBe(0);
  });

  it("_executeInWorker aborts on signal and terminates worker", async () => {
    const emit = vi.fn();
    const { adapter, worker } = await createAdapterWithWorker();

    const ac = new AbortController();
    const promise = adapter._executeInWorker("code", { signal: ac.signal, emit });

    ac.abort();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("Aborted");
    expect(result.metrics?.aborted).toBe(true);
    expect(emit).toHaveBeenCalledWith("runtime.worker_aborted", { runtime: "js" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(adapter._worker).toBe(null);
    expect(adapter._pendingRequests.size).toBe(0);
  });

  it("_executeInWorker times out and terminates worker", async () => {
    vi.useFakeTimers();
    const emit = vi.fn();

    const { adapter, worker } = await createAdapterWithWorker({ timeout: 5 });

    const promise = adapter._executeInWorker("code", { emit });

    await vi.advanceTimersByTimeAsync(1005);
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("Worker execution timeout");
    expect(result.metrics?.timedOut).toBe(true);
    expect(result.metrics?.duration).toBe(5);
    expect(emit).toHaveBeenCalledWith("runtime.worker_timeout", { runtime: "js", timeoutMs: 5 });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(adapter._worker).toBe(null);
    expect(adapter._pendingRequests.size).toBe(0);
  });

  it("_executeInWorker resolves concurrent requests out of order", async () => {
    const posted = [];

    const { adapter } = await createAdapterWithWorker({}, (message, instance) => {
      posted.push(message);
      if (posted.length === 2) {
        instance.onmessage?.({
          data: {
            type: "result",
            id: posted[1].id,
            success: true,
            data: "second",
            metrics: { duration: 1 },
          },
        });
        instance.onmessage?.({
          data: {
            type: "result",
            id: posted[0].id,
            success: true,
            data: "first",
            metrics: { duration: 1 },
          },
        });
      }
    });

    const first = adapter._executeInWorker("code-1", { state: {} });
    const second = adapter._executeInWorker("code-2", { state: {} });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.data).toBe("first");
    expect(secondResult.data).toBe("second");
    expect(adapter._pendingRequests.size).toBe(0);
  });

  it("_executeInWorker handles rapid consecutive calls", async () => {
    const { adapter } = await createAdapterWithWorker({}, (message, instance) => {
      instance.onmessage?.({
        data: {
          type: "result",
          id: message.id,
          success: true,
          data: message.code,
          metrics: { duration: 1 },
        },
      });
    });

    const outputs = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await adapter._executeInWorker(`code-${i}`, { state: {} });
      outputs.push(result.data);
    }

    expect(outputs).toEqual(["code-0", "code-1", "code-2"]);
    expect(adapter._requestId).toBe(3);
    expect(adapter._pendingRequests.size).toBe(0);
  });

  it("_executeInMainThread blocks untrusted contexts and handles emit errors", async () => {
    const adapter = new JSRuntimeAdapter({ mainThreadFallback: "allow" });

    const emit = vi.fn(() => {
      throw new Error("emit blocked");
    });

    const result = await adapter._executeInMainThread("code", { emit, trusted: false });

    expect(result.success).toBe(false);
    expect(result.error).toContain("policy=allow");
    expect(result.error).toContain("trusted=false");
    expect(result.metrics?.blocked).toBe(true);
  });

  it("_executeInMainThread reports disabled fallback for trusted contexts", async () => {
    const adapter = new JSRuntimeAdapter({ mainThreadFallback: "allow" });
    const emit = vi.fn();

    const result = await adapter._executeInMainThread("code", { emit, trusted: true });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Main-thread fallback disabled; worker sandbox required");
    expect(result.metrics?.blocked).toBe(true);
    expect(emit).toHaveBeenCalledWith("runtime.fallback_blocked", expect.objectContaining({
      runtime: "js",
      mode: "main_thread",
      policy: "allow",
      trusted: true,
      reason: "disabled",
    }));
  });

  it("_executeInMainThread returns aborted for aborted signal", async () => {
    const adapter = new JSRuntimeAdapter({ mainThreadFallback: "deny" });
    const ac = new AbortController();
    ac.abort();

    const result = await adapter._executeInMainThread("code", { signal: ac.signal });

    expect(result).toEqual({
      success: false,
      error: "Aborted",
      metrics: { duration: 0, aborted: true },
    });
  });

  it("execute handles empty values and context variants", async () => {
    const adapter = new JSRuntimeAdapter({ useWorkerSandbox: false, mainThreadFallback: "deny" });

    const results = await Promise.all([
      adapter.execute("", null),
      adapter.execute("   ", undefined),
      adapter.execute("", {}),
      adapter.execute("", []),
    ]);

    for (const result of results) {
      expect(result.success).toBe(false);
      expect(result.metrics?.blocked).toBe(true);
    }
  });

  it("terminate clears worker and pending requests", async () => {
    const { adapter, worker } = await createAdapterWithWorker();
    adapter._pendingRequests.set(1, { resolve: vi.fn() });

    await adapter.terminate();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(adapter._worker).toBe(null);
    expect(adapter._pendingRequests.size).toBe(0);
  });
});
