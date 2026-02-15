import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sharedMocks = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
  toNonEmptyString: vi.fn(),
}));

vi.mock("../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../js/agents/shared/index.js");
  sharedMocks.isPlainObject.mockImplementation(actual.isPlainObject);
  sharedMocks.toNonEmptyString.mockImplementation(actual.toNonEmptyString);
  return {
    ...actual,
    isPlainObject: sharedMocks.isPlainObject,
    toNonEmptyString: sharedMocks.toNonEmptyString,
  };
});

import HttpMcpTransportDefault, { HttpMcpTransport } from "../../../../js/agents/mcp/http-mcp-transport.js";

function makeTextResponse(text, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return String(text ?? "");
    },
  };
}

function makeJsonResponse(payload, { status = 200 } = {}) {
  return makeTextResponse(JSON.stringify(payload), { status });
}

function parseJsonBody(init) {
  if (!init?.body) return init?.body;
  try {
    return JSON.parse(String(init.body));
  } catch {
    return null;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createDeepObject(depth) {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = { level: i };
    cursor = cursor.next;
  }
  return root;
}

describe("HttpMcpTransport", () => {
  beforeEach(() => {
    sharedMocks.isPlainObject.mockClear();
    sharedMocks.toNonEmptyString.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([
    { label: "undefined", url: undefined },
    { label: "null", url: null },
    { label: "empty string", url: "" },
    { label: "whitespace string", url: "   " },
  ])("throws when url is $label", ({ url }) => {
    const fetchImpl = vi.fn();
    expect(() => new HttpMcpTransport({ url, fetchImpl })).toThrow(/requires url/i);
  });

  it("normalizes headers and clones plain objects", () => {
    const fetchImpl = vi.fn();
    const headers = { "X-Test": "1" };
    const transport = new HttpMcpTransport({ url: "http://example.test", headers, fetchImpl });
    expect(transport.headers).toEqual({ "X-Test": "1" });
    expect(transport.headers).not.toBe(headers);

    const t2 = new HttpMcpTransport({ url: "http://example.test", headers: [], fetchImpl });
    expect(t2.headers).toEqual({});

    const t3 = new HttpMcpTransport({ url: "http://example.test", headers: null, fetchImpl });
    expect(t3.headers).toEqual({});

    const t4 = new HttpMcpTransport({ url: "http://example.test", headers: undefined, fetchImpl });
    expect(t4.headers).toEqual({});

    const t5 = new HttpMcpTransport({ url: "http://example.test", headers: {}, fetchImpl });
    expect(t5.headers).toEqual({});
  });

  it("uses fetchImpl when provided", () => {
    const fetchImpl = vi.fn();
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl });
    expect(transport._fetch).toBe(fetchImpl);
  });

  it("uses global fetch when fetchImpl is missing", () => {
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    const transport = new HttpMcpTransport({ url: "http://example.test" });
    expect(transport._fetch).toBe(globalFetch);
  });

  it("throws when no fetch implementation is available", () => {
    vi.stubGlobal("fetch", undefined);
    expect(() => new HttpMcpTransport({ url: "http://example.test" })).toThrow(/requires global fetch/i);
  });

  it("connects once and emits connect", async () => {
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl: vi.fn() });
    const onConnect = vi.fn();
    transport.on("connect", onConnect);

    await transport.connect();
    await transport.connect();

    expect(transport.isConnected()).toBe(true);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("send throws when not connected", async () => {
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl: vi.fn() });
    await expect(transport.send({ jsonrpc: "2.0", method: "ping" })).rejects.toThrow(/not connected/i);
  });

  it("receive throws when not connected", async () => {
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl: vi.fn() });
    await expect(transport.receive()).rejects.toThrow(/not connected/i);
  });

  it("posts JSON with merged headers and preserves array-like params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeTextResponse(""));
    const transport = new HttpMcpTransport({
      url: "http://example.test",
      headers: { "X-Test": "1" },
      fetchImpl,
    });
    await transport.connect();

    const params = { 0: "a", length: 1 };
    await transport.send({ jsonrpc: "2.0", method: "test", params });

    const [calledUrl, init] = fetchImpl.mock.calls[0];
    expect(calledUrl).toBe("http://example.test");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Test": "1",
    });
    expect(parseJsonBody(init)).toEqual({ jsonrpc: "2.0", method: "test", params });
  });

  it("sends empty payload shapes and ignores empty responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeTextResponse(""));
    const transport = new HttpMcpTransport({
      url: "http://example.test",
      fetchImpl,
      signal: {},
    });
    await transport.connect();
    const onMessage = vi.fn();
    transport.on("message", onMessage);

    await transport.send(null);
    await transport.send(undefined);
    await transport.send("");
    await transport.send([]);
    await transport.send({});

    const bodies = fetchImpl.mock.calls.map(([, init]) => init.body);
    expect(bodies).toEqual(["null", undefined, "\"\"", "[]", "{}"]);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("handles JSON-RPC response with large payload and deep nesting", async () => {
    const largeText = "x".repeat(100000);
    const deep = createDeepObject(50);
    const message = { jsonrpc: "2.0", id: 1, method: "upload", params: { file: largeText, meta: deep } };

    const fetchImpl = vi.fn().mockResolvedValue(makeJsonResponse({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl });
    await transport.connect();

    const handleSpy = vi.spyOn(transport, "_handleMessage");
    await transport.send(message);

    const body = fetchImpl.mock.calls[0][1].body;
    expect(typeof body).toBe("string");
    expect(body.length).toBeGreaterThan(largeText.length);
    expect(handleSpy).toHaveBeenCalledTimes(1);
    expect(handleSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 1, result: { ok: true } }));
  });

  it("handles batch responses and skips non-objects", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeJsonResponse([
        { jsonrpc: "2.0", id: 1, result: "a" },
        "skip",
        null,
        { jsonrpc: "2.0", id: 2, result: "b" },
      ])
    );
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl });
    await transport.connect();

    const handleSpy = vi.spyOn(transport, "_handleMessage");
    await transport.send({ jsonrpc: "2.0", method: "batch" });

    expect(handleSpy).toHaveBeenCalledTimes(2);
  });

  it("wraps non-JSON-RPC response for request id (including 0)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeJsonResponse({ foo: "bar" }));
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl });
    await transport.connect();

    const handleSpy = vi.spyOn(transport, "_handleMessage");
    await transport.send({ jsonrpc: "2.0", id: 0, method: "wrap" });

    expect(handleSpy).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 0, result: { foo: "bar" } });
  });

  it("emits message for non-JSON-RPC response without id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeJsonResponse(123));
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl });
    await transport.connect();

    const onMessage = vi.fn();
    transport.on("message", onMessage);

    await transport.send({ jsonrpc: "2.0", method: "notify" });
    expect(onMessage).toHaveBeenCalledWith(123);
  });

  it("throws on invalid JSON response and emits error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeTextResponse("not-json"));
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl });
    await transport.connect();
    const onError = vi.fn();
    transport.on("error", onError);

    await expect(transport.send({ jsonrpc: "2.0", method: "ping" })).rejects.toThrow(/invalid JSON/i);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "error message object",
      status: 400,
      text: JSON.stringify({ error: { message: "bad" } }),
      expected: "HTTP MCP error: bad",
    },
    {
      label: "error string",
      status: 500,
      text: JSON.stringify({ error: "oops" }),
      expected: "HTTP MCP error: oops",
    },
    {
      label: "empty body",
      status: 503,
      text: "",
      expected: "HTTP MCP error: HTTP 503",
    },
  ])("throws HTTP MCP error for non-ok response: $label", async ({ status, text, expected }) => {
    const fetchImpl = vi.fn().mockResolvedValue(makeTextResponse(text, { status }));
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl });
    await transport.connect();
    const onError = vi.fn();
    transport.on("error", onError);

    await expect(transport.send({ jsonrpc: "2.0", method: "ping" })).rejects.toThrow(expected);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("emits error and rethrows when fetch rejects", async () => {
    const err = new Error("boom");
    const fetchImpl = vi.fn().mockRejectedValue(err);
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl });
    await transport.connect();
    const onError = vi.fn();
    transport.on("error", onError);

    await expect(transport.send({ jsonrpc: "2.0", method: "ping" })).rejects.toThrow("boom");
    expect(onError).toHaveBeenCalledWith(err);
  });

  it("skips timeout for 0, -1, and non-numeric string; schedules for MAX_SAFE_INTEGER", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation(() => 1);
    const fetchImpl = vi.fn().mockResolvedValue(makeTextResponse(""));
    const cases = [
      { timeout: 0, shouldSet: false },
      { timeout: -1, shouldSet: false },
      { timeout: "1000", shouldSet: false },
      { timeout: Number.MAX_SAFE_INTEGER, shouldSet: true },
    ];

    for (const { timeout, shouldSet } of cases) {
      setTimeoutSpy.mockClear();
      const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl, timeout });
      await transport.connect();
      await transport.send({ jsonrpc: "2.0", method: "ping", params: { timeout } });
      if (shouldSet) {
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      } else {
        expect(setTimeoutSpy).not.toHaveBeenCalled();
      }
      await transport.disconnect();
    }
  });

  it("aborts in-flight send when timeout elapses", async () => {
    vi.useFakeTimers();
    let abortReason;
    const fetchImpl = vi.fn((url, init) => {
      return new Promise((resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => {
            abortReason = init.signal?.reason;
            reject(new Error("aborted"));
          },
          { once: true }
        );
      });
    });
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl, timeout: 5 });
    await transport.connect();

    const sendPromise = transport.send({ jsonrpc: "2.0", method: "slow" });
    vi.advanceTimersByTime(5);

    await expect(sendPromise).rejects.toThrow(/aborted/i);
    if (abortReason !== undefined) {
      expect(abortReason).toBe("timeout");
    }
  });

  it("aborts immediately when parent signal is already aborted", async () => {
    const parent = new AbortController();
    parent.abort("parent");
    const fetchImpl = vi.fn((url, init) => {
      expect(init.signal?.aborted).toBe(true);
      if (init.signal?.reason !== undefined) {
        expect(init.signal.reason).toBe("parent");
      }
      return Promise.reject(new Error("aborted"));
    });
    const transport = new HttpMcpTransport({
      url: "http://example.test",
      fetchImpl,
      signal: parent.signal,
    });
    await transport.connect();

    await expect(transport.send({ jsonrpc: "2.0", method: "ping" })).rejects.toThrow(/aborted/i);
  });

  it("handles concurrent sends and clears inflight", async () => {
    const first = deferred();
    const second = deferred();
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl });
    await transport.connect();

    const p1 = transport.send({ jsonrpc: "2.0", method: "a" });
    const p2 = transport.send({ jsonrpc: "2.0", method: "b" });
    await Promise.resolve();
    expect(transport._inflight.size).toBe(2);

    first.resolve(makeTextResponse(""));
    second.resolve(makeTextResponse(""));
    await Promise.all([p1, p2]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(transport._inflight.size).toBe(0);
  });

  it("handles rapid successive sends", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeTextResponse(""));
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl });
    await transport.connect();

    await transport.send({ jsonrpc: "2.0", method: "first" });
    await transport.send({ jsonrpc: "2.0", method: "second" });
    await transport.send({ jsonrpc: "2.0", method: "third" });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("disconnect aborts inflight sends and clears inflight set", async () => {
    let lastSignal;
    const fetchImpl = vi.fn((url, init) => {
      lastSignal = init.signal;
      return new Promise((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });

    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl });
    await transport.connect();

    const sendPromise = transport.send({ jsonrpc: "2.0", method: "hang" });
    await Promise.resolve();
    expect(transport._inflight.size).toBe(1);

    await transport.disconnect();
    expect(lastSignal?.aborted).toBe(true);
    expect(transport._inflight.size).toBe(0);
    await expect(sendPromise).rejects.toThrow(/aborted/i);
  });

  it("disconnect rejects pending requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeTextResponse(""));
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl, timeout: 1000 });
    await transport.connect();

    const requestPromise = transport.request("method", { a: 1 });
    await transport.disconnect();

    await expect(requestPromise).rejects.toThrow(/transport disconnected/i);
  });

  it("receive resolves on message and cleans listeners", async () => {
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl: vi.fn() });
    await transport.connect();

    const receivePromise = transport.receive();
    transport.emit("message", { ok: true });

    await expect(receivePromise).resolves.toEqual({ ok: true });
    expect(transport._events?.get("message")?.size ?? 0).toBe(0);
    expect(transport._events?.get("error")?.size ?? 0).toBe(0);
    expect(transport._events?.get("disconnect")?.size ?? 0).toBe(0);
  });

  it.each([
    {
      label: "error event",
      trigger: (transport) => transport.emit("error", "boom"),
      expected: /boom/i,
    },
    {
      label: "disconnect event",
      trigger: (transport) => transport.emit("disconnect"),
      expected: /transport disconnected/i,
    },
  ])("receive rejects on $label", async ({ trigger, expected }) => {
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl: vi.fn() });
    await transport.connect();

    const receivePromise = transport.receive();
    trigger(transport);

    await expect(receivePromise).rejects.toThrow(expected);
  });

  it("close rejects pending receive and clears listeners", async () => {
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl: vi.fn() });
    await transport.connect();

    const receivePromise = transport.receive();
    await transport.close();

    await expect(receivePromise).rejects.toThrow(/transport disconnected/i);
    expect(transport._events?.size ?? 0).toBe(0);
  });

  it("dispose aliases close and clears listeners", async () => {
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl: vi.fn() });
    transport.on("message", vi.fn());
    await transport.connect();

    await transport.dispose();

    expect(transport.isConnected()).toBe(false);
    expect(transport._events?.size ?? 0).toBe(0);
  });

  it("close delegates to disconnect", async () => {
    const transport = new HttpMcpTransport({ url: "http://example.test", fetchImpl: vi.fn() });
    const onDisconnect = vi.fn();
    transport.on("disconnect", onDisconnect);

    await transport.connect();
    await transport.close();

    expect(transport.isConnected()).toBe(false);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });
});

describe("default export", () => {
  it("matches HttpMcpTransport", () => {
    expect(HttpMcpTransportDefault).toBe(HttpMcpTransport);
  });
});
