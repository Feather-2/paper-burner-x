import { describe, it, expect, vi, beforeEach } from "vitest";

const MODULE_PATH = "../../../../../js/agents/runtime/tools/tool-executor-worker.js";

const mockState = vi.hoisted(() => ({
  parentPort: /** @type {any} */ (undefined),
  handlerOptions: /** @type {any} */ (undefined),
  createToolExecutorHandler: vi.fn(),
}));

vi.mock("node:worker_threads", () => {
  return {
    get parentPort() {
      return mockState.parentPort;
    },
  };
});

vi.mock(
  "../../../../../js/agents/runtime/tools/tool-executor-worker-shared.js",
  () => {
    return {
      createToolExecutorHandler: mockState.createToolExecutorHandler,
    };
  },
);

function makeParentPort({ withClose = true, closeValue } = {}) {
  /** @type {any} */
  let messageListener;

  const parentPort = {
    postMessage: vi.fn(),
    on: vi.fn((event, listener) => {
      if (event === "message") messageListener = listener;
    }),
    ...(withClose ? { close: closeValue ?? vi.fn() } : {}),
  };

  return {
    parentPort,
    emitMessage(data) {
      if (!messageListener) throw new Error("message listener not registered");
      messageListener(data);
    },
  };
}

async function importFreshWorker() {
  await import(MODULE_PATH);
  return mockState.handlerOptions;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  mockState.parentPort = undefined;
  mockState.handlerOptions = undefined;

  mockState.createToolExecutorHandler.mockReset();
  mockState.createToolExecutorHandler.mockImplementation((opts) => {
    mockState.handlerOptions = opts;
  });
});

describe("tool-executor-worker (module)", () => {
  it("throws a clear error when parentPort is missing", async () => {
    mockState.parentPort = null;

    await expect(import(MODULE_PATH)).rejects.toThrow(
      "tool-executor-worker: missing parentPort",
    );
    expect(mockState.createToolExecutorHandler).not.toHaveBeenCalled();
  });

  it("registers postMessage/onMessage/close with createToolExecutorHandler and wires them to parentPort", async () => {
    const { parentPort, emitMessage } = makeParentPort({ withClose: true });
    mockState.parentPort = parentPort;

    await importFreshWorker();

    expect(mockState.createToolExecutorHandler).toHaveBeenCalledTimes(1);
    expect(mockState.handlerOptions).toEqual({
      postMessage: expect.any(Function),
      onMessage: expect.any(Function),
      close: expect.any(Function),
    });

    const opts = mockState.handlerOptions;

    const outbound = { ok: true, n: 0, s: " " };
    opts.postMessage(outbound);
    expect(parentPort.postMessage).toHaveBeenCalledTimes(1);
    expect(parentPort.postMessage).toHaveBeenCalledWith(outbound);

    const cb = vi.fn();
    opts.onMessage(cb);
    expect(parentPort.on).toHaveBeenCalledTimes(1);
    expect(parentPort.on).toHaveBeenCalledWith("message", expect.any(Function));

    const inbound = { type: "ping", payload: { a: 1 } };
    emitMessage(inbound);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBe(inbound);

    opts.close();
    expect(parentPort.close).toHaveBeenCalledTimes(1);
  });

  it("close() is a no-op when parentPort.close is missing", async () => {
    const { parentPort } = makeParentPort({ withClose: false });
    mockState.parentPort = parentPort;

    await importFreshWorker();
    const opts = mockState.handlerOptions;

    expect(() => opts.close()).not.toThrow();
  });

  it("close() throws TypeError when parentPort.close is present but not callable (type boundary)", async () => {
    const { parentPort } = makeParentPort({ withClose: true, closeValue: "nope" });
    mockState.parentPort = parentPort;

    await importFreshWorker();
    const opts = mockState.handlerOptions;

    expect(() => opts.close()).toThrow(TypeError);
  });
});

describe("normalizeMessage (indirect via onMessage)", () => {
  it("passes through non-object inputs and non-execute objects unchanged (null/undefined/empty cases)", async () => {
    const { parentPort, emitMessage } = makeParentPort();
    mockState.parentPort = parentPort;

    await importFreshWorker();
    const opts = mockState.handlerOptions;

    const cb = vi.fn();
    opts.onMessage(cb);

    const emptyArr = [];
    const emptyObj = {};
    const ping = { type: "ping", id: -1, moduleUrl: "", payload: {} };
    const noType = { id: 0, moduleUrl: "m" };
    const typeZero = { type: 0, id: 0 };

    const inputs = [
      null,
      undefined,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "",
      "   ",
      emptyArr,
      emptyObj,
      ping,
      noType,
      typeZero,
    ];

    for (const input of inputs) emitMessage(input);

    expect(cb).toHaveBeenCalledTimes(inputs.length);
    for (let i = 0; i < inputs.length; i++) {
      expect(cb.mock.calls[i][0]).toBe(inputs[i]);
    }
  });

  it("normalizes legacy execute messages (exportName/context) into {handlerName,args:[args,context]} with correct defaults", async () => {
    const { parentPort, emitMessage } = makeParentPort();
    mockState.parentPort = parentPort;

    await importFreshWorker();
    const opts = mockState.handlerOptions;

    const cb = vi.fn();
    opts.onMessage(cb);

    // Resource boundaries: 1MB payload + deep nesting.
    const hugeString = "x".repeat(1024 * 1024);
    const deepContext = { a: { b: { c: { d: { e: { f: 1 } } } } } };

    const msg1 = {
      type: "execute",
      id: 0,
      moduleUrl: "",
      exportName: "",
      args: hugeString,
      context: deepContext,
    };

    const msg2 = {
      type: "execute",
      id: -1,
      moduleUrl: "   ",
      exportName: "   ", // whitespace string boundary (kept as-is)
      args: { not: "array" },
      context: null,
    };

    const msg3 = {
      type: "execute",
      id: Number.MAX_SAFE_INTEGER,
      moduleUrl: "mod",
      exportName: 123, // type boundary: non-string exportName
      args: undefined,
      context: undefined, // still legacy because key exists
    };

    const contextOnly = { legacy: true, nested: { x: { y: { z: 1 } } } };
    const msg4 = {
      type: "execute",
      id: 42,
      moduleUrl: "mod2",
      args: "arg",
      context: contextOnly, // legacy because "context" in data
    };

    emitMessage(msg1);
    emitMessage(msg2);
    emitMessage(msg3);
    emitMessage(msg4);

    expect(cb).toHaveBeenCalledTimes(4);

    expect(cb.mock.calls[0][0]).toEqual({
      type: "execute",
      id: 0,
      moduleUrl: "",
      handlerName: "handler",
      args: [hugeString, deepContext],
    });
    expect(cb.mock.calls[0][0]).not.toBe(msg1);
    expect(cb.mock.calls[0][0].args[1]).toBe(deepContext);

    expect(cb.mock.calls[1][0]).toEqual({
      type: "execute",
      id: -1,
      moduleUrl: "   ",
      handlerName: "   ",
      args: [msg2.args, null],
    });
    expect(cb.mock.calls[1][0]).not.toBe(msg2);

    expect(cb.mock.calls[2][0]).toEqual({
      type: "execute",
      id: Number.MAX_SAFE_INTEGER,
      moduleUrl: "mod",
      handlerName: "handler",
      args: [undefined, undefined],
    });
    expect(cb.mock.calls[2][0]).not.toBe(msg3);

    expect(cb.mock.calls[3][0]).toEqual({
      type: "execute",
      id: 42,
      moduleUrl: "mod2",
      handlerName: "handler",
      args: ["arg", contextOnly],
    });
    expect(cb.mock.calls[3][0]).not.toBe(msg4);
    expect(cb.mock.calls[3][0].args[1]).toBe(contextOnly);
  });

  it("normalizes modern execute messages and clamps non-array args to [] (type + empty boundaries)", async () => {
    const { parentPort, emitMessage } = makeParentPort();
    mockState.parentPort = parentPort;

    await importFreshWorker();
    const opts = mockState.handlerOptions;

    const cb = vi.fn();
    opts.onMessage(cb);

    const args1 = ["a", 0, -1, Number.MAX_SAFE_INTEGER];
    const msg1 = {
      type: "execute",
      id: "0", // type boundary: string as number
      moduleUrl: "mod",
      handlerName: "h",
      args: args1,
    };

    const msg2 = {
      type: "execute",
      id: 1,
      moduleUrl: "mod",
      handlerName: "",
      args: { 0: "not-an-array" }, // type boundary: object-as-array
    };

    const msg3 = {
      type: "execute",
      id: 2,
      moduleUrl: "mod",
      handlerName: "   ", // whitespace boundary
      args: undefined,
    };

    const args4 = [];
    const msg4 = {
      type: "execute",
      id: 3,
      moduleUrl: "mod",
      handlerName: undefined,
      args: args4,
    };

    emitMessage(msg1);
    emitMessage(msg2);
    emitMessage(msg3);
    emitMessage(msg4);

    expect(cb).toHaveBeenCalledTimes(4);

    expect(cb.mock.calls[0][0]).toEqual({
      type: "execute",
      id: "0",
      moduleUrl: "mod",
      handlerName: "h",
      args: args1,
    });
    expect(cb.mock.calls[0][0]).not.toBe(msg1);
    expect(cb.mock.calls[0][0].args).toBe(args1);

    expect(cb.mock.calls[1][0]).toEqual({
      type: "execute",
      id: 1,
      moduleUrl: "mod",
      handlerName: "",
      args: [],
    });
    expect(cb.mock.calls[1][0]).not.toBe(msg2);

    expect(cb.mock.calls[2][0]).toEqual({
      type: "execute",
      id: 2,
      moduleUrl: "mod",
      handlerName: "   ",
      args: [],
    });
    expect(cb.mock.calls[2][0]).not.toBe(msg3);

    expect(cb.mock.calls[3][0]).toEqual({
      type: "execute",
      id: 3,
      moduleUrl: "mod",
      handlerName: undefined,
      args: args4,
    });
    expect(cb.mock.calls[3][0]).not.toBe(msg4);
    expect(cb.mock.calls[3][0].args).toBe(args4);
  });

  it("handles rapid sequential + concurrent message bursts without dropping or cross-contaminating payloads (concurrency boundary)", async () => {
    const { parentPort, emitMessage } = makeParentPort();
    mockState.parentPort = parentPort;

    await importFreshWorker();
    const opts = mockState.handlerOptions;

    const cb = vi.fn();
    opts.onMessage(cb);

    const ping1 = { type: "ping", id: 81 };
    const ping2 = { type: "ping", id: 82 };

    // Rapid sequential calls.
    emitMessage(ping1);
    emitMessage(ping2);

    const newExec = Array.from({ length: 50 }, (_, i) => {
      const id = i + 1;
      return {
        type: "execute",
        id,
        moduleUrl: "m",
        handlerName: "h",
        args: [id],
      };
    });

    const legacyExec = Array.from({ length: 30 }, (_, i) => {
      const id = i + 51;
      return {
        type: "execute",
        id,
        moduleUrl: "m2",
        exportName: "legacy",
        args: id,
        context: { index: id },
      };
    });

    const burst = [...newExec, ...legacyExec];

    await Promise.all(
      burst.map((m) => Promise.resolve().then(() => emitMessage(m))),
    );

    expect(cb).toHaveBeenCalledTimes(2 + burst.length);

    const calls = cb.mock.calls.map(([m]) => m);
    expect(calls.some((m) => m === ping1)).toBe(true);
    expect(calls.some((m) => m === ping2)).toBe(true);

    const executeCalls = calls.filter((m) => m && m.type === "execute");
    expect(executeCalls).toHaveLength(burst.length);

    const byId = new Map(executeCalls.map((m) => [m.id, m]));
    expect(byId.size).toBe(burst.length);

    for (const m of newExec) {
      const out = byId.get(m.id);
      expect(out).toEqual({
        type: "execute",
        id: m.id,
        moduleUrl: "m",
        handlerName: "h",
        args: m.args,
      });
      expect(out.args).toBe(m.args);
    }

    for (const m of legacyExec) {
      const out = byId.get(m.id);
      expect(out).toEqual({
        type: "execute",
        id: m.id,
        moduleUrl: "m2",
        handlerName: "legacy",
        args: [m.id, m.context],
      });
      expect(out.args[1]).toBe(m.context);
    }
  });
});