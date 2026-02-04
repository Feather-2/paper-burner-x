import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolvers as concurrencyResolvers } from "../../../../fixtures/tool-executor/concurrency.mjs";

const argLengthHandler = vi.hoisted(() => vi.fn((...args) => args.length));
const boundaryHandler = vi.hoisted(() => vi.fn((...args) => args));
const namedHandler = vi.hoisted(() => vi.fn((...args) => args));
const throwingHandler = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Boom");
  })
);
const typeCheckHandler = vi.hoisted(() =>
  vi.fn((value) => {
    if (typeof value !== "number") {
      throw new TypeError("Expected number");
    }
    return value + 1;
  })
);
const resourcesHandler = vi.hoisted(() =>
  vi.fn((fileContent, longText, deepObj) => {
    let depth = 0;
    let node = deepObj;
    while (node?.next) {
      depth += 1;
      node = node.next;
      if (depth > 10000) break;
    }
    return {
      fileSize: fileContent?.length ?? 0,
      longSize: longText?.length ?? 0,
      depth,
      leafValue: node?.value,
    };
  })
);

const concurrencyModuleUrl = new URL(
  "../../../../fixtures/tool-executor/concurrency.mjs",
  import.meta.url
).href;
const rapidModuleUrl = new URL("../../../../fixtures/tool-executor/rapid.mjs", import.meta.url).href;

vi.mock("virtual:arg-length", () => ({ default: argLengthHandler }), { virtual: true });
vi.mock("virtual:boundary", () => ({ default: boundaryHandler }), { virtual: true });
vi.mock("virtual:named", () => ({ run: namedHandler }), { virtual: true });
vi.mock("virtual:not-function", () => ({ default: { ok: true } }), { virtual: true });
vi.mock("virtual:throws", () => ({ default: throwingHandler }), { virtual: true });
vi.mock("virtual:type-check", () => ({ default: typeCheckHandler }), { virtual: true });
vi.mock("virtual:resources", () => ({ default: resourcesHandler }), { virtual: true });

import { createToolExecutorHandler } from "../../../../../js/agents/runtime/tools/tool-executor-worker-shared.js";

function setupAdapter() {
  let onMessageHandler;
  const adapter = {
    postMessage: vi.fn(),
    onMessage: vi.fn((cb) => {
      onMessageHandler = cb;
    }),
    close: vi.fn(),
  };
  const handler = createToolExecutorHandler(adapter);
  if (!onMessageHandler) {
    throw new Error("Message handler not registered");
  }
  return {
    adapter,
    handler,
    send: (data) => onMessageHandler(data),
  };
}

function mapResultsById(adapter) {
  const map = new Map();
  for (const [msg] of adapter.postMessage.mock.calls) {
    map.set(msg.id, msg);
  }
  return map;
}

function makeDeepObject(depth) {
  let node = { value: "leaf" };
  for (let i = 0; i < depth; i += 1) {
    node = { next: node };
  }
  return node;
}

async function flushMicrotasks(times = 2) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe("createToolExecutorHandler", () => {
  beforeEach(() => {
    argLengthHandler.mockClear();
    boundaryHandler.mockClear();
    namedHandler.mockClear();
    throwingHandler.mockClear();
    typeCheckHandler.mockClear();
    resourcesHandler.mockClear();
    concurrencyResolvers.length = 0;
  });

  it("ignores non-execute messages and empty payloads", async () => {
    const { adapter, send } = setupAdapter();

    await send(null);
    await send(undefined);
    await send("");
    await send([]);
    await send({});
    await send({ type: "noop" });

    expect(adapter.postMessage).not.toHaveBeenCalled();
  });

  it("executes default handler with boundary values", async () => {
    const { adapter, send } = setupAdapter();
    const args = [0, -1, Number.MAX_SAFE_INTEGER, "   "];

    await send({
      type: "execute",
      id: "boundary",
      moduleUrl: "virtual:boundary",
      args,
    });

    expect(adapter.postMessage).toHaveBeenCalledTimes(1);
    expect(adapter.postMessage.mock.calls[0][0]).toEqual({
      type: "result",
      id: "boundary",
      result: args,
    });
  });

  it("treats nullish or empty args as no-args", async () => {
    const { adapter, send } = setupAdapter();
    const payloads = [
      { id: "undefined", args: undefined },
      { id: "null", args: null },
      { id: "empty-string", args: "" },
      { id: "empty-array", args: [] },
    ];

    for (const payload of payloads) {
      await send({
        type: "execute",
        id: payload.id,
        moduleUrl: "virtual:arg-length",
        args: payload.args,
      });
    }

    const results = mapResultsById(adapter);
    for (const payload of payloads) {
      expect(results.get(payload.id)).toMatchObject({
        type: "result",
        id: payload.id,
        result: 0,
      });
    }
  });

  it("uses named handler when handlerName is provided", async () => {
    const { adapter, send } = setupAdapter();

    await send({
      type: "execute",
      id: "named",
      moduleUrl: "virtual:named",
      handlerName: "run",
      args: ["a", "b"],
    });

    expect(adapter.postMessage).toHaveBeenCalledTimes(1);
    expect(adapter.postMessage.mock.calls[0][0]).toEqual({
      type: "result",
      id: "named",
      result: ["a", "b"],
    });
  });

  it("returns error when handler is not a function", async () => {
    const { adapter, send } = setupAdapter();

    await send({
      type: "execute",
      id: "bad-handler",
      moduleUrl: "virtual:not-function",
    });

    expect(adapter.postMessage).toHaveBeenCalledTimes(1);
    expect(adapter.postMessage.mock.calls[0][0]).toMatchObject({
      type: "error",
      id: "bad-handler",
      error: {
        message: 'Handler "default" is not a function',
      },
    });
  });

  it("returns error details when handler throws", async () => {
    const { adapter, send } = setupAdapter();

    await send({
      type: "execute",
      id: "boom",
      moduleUrl: "virtual:throws",
    });

    expect(adapter.postMessage).toHaveBeenCalledTimes(1);
    const message = adapter.postMessage.mock.calls[0][0];
    expect(message.type).toBe("error");
    expect(message.id).toBe("boom");
    expect(message.error.message).toBe("Boom");
    expect(message.error.name).toBe("Error");
    expect(message.error.stack).toEqual(expect.any(String));
  });

  it("returns error when string is passed where a number is expected", async () => {
    const { adapter, send } = setupAdapter();

    await send({
      type: "execute",
      id: "type-check",
      moduleUrl: "virtual:type-check",
      args: ["123"],
    });

    expect(adapter.postMessage).toHaveBeenCalledTimes(1);
    const message = adapter.postMessage.mock.calls[0][0];
    expect(message.type).toBe("error");
    expect(message.id).toBe("type-check");
    expect(message.error.name).toBe("TypeError");
    expect(message.error.message).toBe("Expected number");
  });

  it("returns error when args is a non-iterable object", async () => {
    const { adapter, send } = setupAdapter();

    await send({
      type: "execute",
      id: "object-args",
      moduleUrl: "virtual:arg-length",
      args: {},
    });

    expect(adapter.postMessage).toHaveBeenCalledTimes(1);
    const message = adapter.postMessage.mock.calls[0][0];
    expect(message.type).toBe("error");
    expect(message.id).toBe("object-args");
    expect(message.error.name).toBe("TypeError");
    expect(message.error.message).toMatch(/iterable|@@iterator/i);
  });

  it("handles large payloads and deep nesting", async () => {
    const { adapter, send } = setupAdapter();
    const largeFile = "a".repeat(1024 * 1024);
    const longString = "b".repeat(200000);
    const depth = 40;
    const deepObj = makeDeepObject(depth);

    await send({
      type: "execute",
      id: "resources",
      moduleUrl: "virtual:resources",
      args: [largeFile, longString, deepObj],
    });

    expect(adapter.postMessage).toHaveBeenCalledTimes(1);
    const message = adapter.postMessage.mock.calls[0][0];
    expect(message).toMatchObject({
      type: "result",
      id: "resources",
      result: {
        fileSize: largeFile.length,
        longSize: longString.length,
        depth,
        leafValue: "leaf",
      },
    });
  });

  it("handles simultaneous calls", async () => {
    const { adapter, send } = setupAdapter();

    const p1 = send({
      type: "execute",
      id: "c1",
      moduleUrl: concurrencyModuleUrl,
    });
    const p2 = send({
      type: "execute",
      id: "c2",
      moduleUrl: concurrencyModuleUrl,
    });

    await vi.waitFor(() => expect(concurrencyResolvers.length).toBe(2));
    expect(adapter.postMessage).not.toHaveBeenCalled();

    concurrencyResolvers[1]("second");
    concurrencyResolvers[0]("first");

    await Promise.all([p1, p2]);

    const results = mapResultsById(adapter);
    expect(results.get("c1")).toMatchObject({
      type: "result",
      id: "c1",
      result: "first",
    });
    expect(results.get("c2")).toMatchObject({
      type: "result",
      id: "c2",
      result: "second",
    });
  });

  it("handles rapid sequential calls", async () => {
    const { adapter, send } = setupAdapter();
    const calls = [];

    for (let i = 0; i < 5; i += 1) {
      calls.push(
        send({
          type: "execute",
          id: `r${i}`,
          moduleUrl: rapidModuleUrl,
          args: [i],
        })
      );
    }

    await Promise.all(calls);

    expect(adapter.postMessage).toHaveBeenCalledTimes(5);
    const results = mapResultsById(adapter);
    for (let i = 0; i < 5; i += 1) {
      expect(results.get(`r${i}`)).toMatchObject({
        type: "result",
        id: `r${i}`,
        result: i,
      });
    }
  });

  it("close delegates to adapter.close when available", () => {
    const { handler, adapter } = setupAdapter();

    handler.close();

    expect(adapter.close).toHaveBeenCalledTimes(1);
  });
});
