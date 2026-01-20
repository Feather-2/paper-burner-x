import { describe, it, expect, vi, beforeEach } from "vitest";

let createToolExecutorHandlerMock;
let capturedAdapter;

const MODULE_PATH = "../../../../../js/agents/runtime/tools/tool-executor-webworker.js";

vi.mock("../../../../../js/agents/runtime/tools/tool-executor-worker-shared.js", () => {
  createToolExecutorHandlerMock = vi.fn((adapter) => {
    capturedAdapter = adapter;
    return { close: adapter.close };
  });
  return { createToolExecutorHandler: createToolExecutorHandlerMock };
});

function buildDeepObject(depth) {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
}

async function loadModule({ includeClose = true } = {}) {
  vi.resetModules();
  capturedAdapter = null;
  const selfObj = {
    postMessage: vi.fn(),
    addEventListener: vi.fn(),
    ...(includeClose ? { close: vi.fn() } : {}),
  };
  globalThis.self = selfObj;
  await import(MODULE_PATH);
  return selfObj;
}

function registerMessageHandler(selfObj) {
  const cb = vi.fn();
  capturedAdapter.onMessage(cb);
  expect(selfObj.addEventListener).toHaveBeenCalledTimes(1);
  expect(selfObj.addEventListener.mock.calls[0][0]).toBe("message");
  const handler = selfObj.addEventListener.mock.calls[0][1];
  return { cb, handler };
}

beforeEach(() => {
  capturedAdapter = null;
});

describe("tool-executor-webworker adapter", () => {
  it("registers adapter with createToolExecutorHandler and proxies self methods", async () => {
    const selfObj = await loadModule();

    expect(createToolExecutorHandlerMock).toHaveBeenCalledTimes(1);
    expect(capturedAdapter).toEqual(
      expect.objectContaining({
        postMessage: expect.any(Function),
        onMessage: expect.any(Function),
        close: expect.any(Function),
      }),
    );

    const payload = { ok: true };
    capturedAdapter.postMessage(payload);
    expect(selfObj.postMessage).toHaveBeenCalledWith(payload);

    const cb = vi.fn();
    capturedAdapter.onMessage(cb);
    expect(selfObj.addEventListener).toHaveBeenCalledWith("message", expect.any(Function));

    capturedAdapter.close();
    expect(selfObj.close).toHaveBeenCalledTimes(1);
  });

  it("does not throw when self.close is missing", async () => {
    const selfObj = await loadModule({ includeClose: false });

    expect(selfObj.close).toBeUndefined();
    expect(capturedAdapter).toEqual(
      expect.objectContaining({ close: expect.any(Function) }),
    );
    expect(() => capturedAdapter.close()).not.toThrow();
  });
});

describe("normalizeMessage (indirect)", () => {
  it("passes through non-object or non-execute payloads with boundary values", async () => {
    const selfObj = await loadModule();
    const { cb, handler } = registerMessageHandler(selfObj);

    const emptyArray = [];
    const emptyObject = {};
    const nonExecute = { type: "noop", value: "x" };

    const inputs = [
      null,
      undefined,
      "",
      "   ",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      emptyArray,
      emptyObject,
      nonExecute,
    ];

    inputs.forEach((data) => handler({ data }));

    expect(cb).toHaveBeenCalledTimes(inputs.length);
    const received = cb.mock.calls.map((call) => call[0]);

    expect(received[0]).toBe(null);
    expect(received[1]).toBeUndefined();
    expect(received[2]).toBe("");
    expect(received[3]).toBe("   ");
    expect(received[4]).toBe(0);
    expect(received[5]).toBe(-1);
    expect(received[6]).toBe(Number.MAX_SAFE_INTEGER);
    expect(received[7]).toBe(emptyArray);
    expect(received[8]).toBe(emptyObject);
    expect(received[9]).toBe(nonExecute);
  });

  it("normalizes legacy execute payloads and defaults handlerName when exportName is invalid", async () => {
    const selfObj = await loadModule();
    const { cb, handler } = registerMessageHandler(selfObj);

    const legacy = {
      type: "execute",
      id: "job-1",
      moduleUrl: "mod",
      exportName: "legacyHandler",
      args: { a: 1 },
      context: { user: "u" },
    };

    handler({ data: legacy });

    const deep = buildDeepObject(40);
    const hugeText = "x".repeat(100000);
    const context = { nested: deep, value: -1 };

    const fallback = {
      type: "execute",
      id: 0,
      moduleUrl: "  ",
      exportName: "",
      args: hugeText,
      context,
    };

    handler({ data: fallback });

    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[0][0]).toEqual({
      type: "execute",
      id: "job-1",
      moduleUrl: "mod",
      handlerName: "legacyHandler",
      args: [legacy.args, legacy.context],
    });

    const normalizedFallback = cb.mock.calls[1][0];
    expect(normalizedFallback).toMatchObject({
      type: "execute",
      id: 0,
      moduleUrl: "  ",
      handlerName: "handler",
    });
    expect(normalizedFallback.args[0]).toBe(hugeText);
    expect(normalizedFallback.args[1]).toBe(context);
    expect(normalizedFallback.args[1].nested).toBe(deep);
    expect(normalizedFallback.args[1].value).toBe(-1);
  });

  it("normalizes non-legacy execute payloads with array args and preserves resources", async () => {
    const selfObj = await loadModule();
    const { cb, handler } = registerMessageHandler(selfObj);

    const deep = buildDeepObject(30);
    const hugeText = "y".repeat(120000);
    const hugeFile = { name: "big.bin", size: Number.MAX_SAFE_INTEGER, content: hugeText };
    const args = [0, -1, Number.MAX_SAFE_INTEGER, "", "   ", deep, hugeFile, "123"];

    const payload = {
      type: "execute",
      id: "42",
      moduleUrl: "module-url",
      handlerName: "run",
      args,
    };

    const emptyArgsPayload = {
      type: "execute",
      id: "empty",
      moduleUrl: "module-url",
      handlerName: "run",
      args: [],
    };

    handler({ data: payload });
    handler({ data: emptyArgsPayload });

    expect(cb).toHaveBeenCalledTimes(2);
    const normalized = cb.mock.calls[0][0];
    expect(normalized).toMatchObject({
      type: "execute",
      id: "42",
      moduleUrl: "module-url",
      handlerName: "run",
    });
    expect(normalized.args).toBe(args);
    expect(normalized.args[5]).toBe(deep);
    expect(normalized.args[6]).toBe(hugeFile);
    expect(normalized.args[7]).toBe("123");

    const normalizedEmpty = cb.mock.calls[1][0];
    expect(normalizedEmpty.args).toBe(emptyArgsPayload.args);
    expect(normalizedEmpty.args).toEqual([]);
  });

  it("defaults non-legacy args to [] when args is not an array", async () => {
    const selfObj = await loadModule();
    const { cb, handler } = registerMessageHandler(selfObj);

    const payloadObjectArgs = {
      type: "execute",
      id: "obj-args",
      moduleUrl: "mod",
      handlerName: "run",
      args: { not: "array" },
    };

    const payloadStringArgs = {
      type: "execute",
      id: "str-args",
      moduleUrl: "mod",
      handlerName: "run",
      args: "123",
    };

    handler({ data: payloadObjectArgs });
    handler({ data: payloadStringArgs });

    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[0][0].args).toEqual([]);
    expect(cb.mock.calls[1][0].args).toEqual([]);
  });

  it("handles rapid consecutive execute events", async () => {
    const selfObj = await loadModule();
    const { cb, handler } = registerMessageHandler(selfObj);

    for (let i = 0; i < 5; i += 1) {
      handler({
        data: {
          type: "execute",
          id: i,
          moduleUrl: "mod",
          handlerName: "h",
          args: [i],
        },
      });
    }

    expect(cb).toHaveBeenCalledTimes(5);
    const ids = cb.mock.calls.map((call) => call[0].id);
    expect(ids).toEqual([0, 1, 2, 3, 4]);
  });

  it("supports concurrent execute events without state bleed", async () => {
    const selfObj = await loadModule();
    const { cb, handler } = registerMessageHandler(selfObj);

    const payloads = [
      { type: "execute", id: "a", moduleUrl: "m1", handlerName: "h", args: [1] },
      { type: "execute", id: "b", moduleUrl: "m2", handlerName: "h", args: [2] },
      { type: "execute", id: "c", moduleUrl: "m3", handlerName: "h", args: [3] },
      { type: "execute", id: "d", moduleUrl: "m4", handlerName: "h", args: [4] },
    ];

    await Promise.all(
      payloads.map((data) => Promise.resolve().then(() => handler({ data }))),
    );

    expect(cb).toHaveBeenCalledTimes(payloads.length);
    const ids = cb.mock.calls.map((call) => call[0].id).sort();
    expect(ids).toEqual(payloads.map((payload) => payload.id).sort());
    cb.mock.calls.forEach((call) => {
      expect(call[0].type).toBe("execute");
    });
  });
});
