import { describe, it, expect, vi, beforeEach } from "vitest";

const sseMocks = vi.hoisted(() => ({
  parseSseStream: vi.fn(),
}));

const sharedMocks = vi.hoisted(() => {
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    logger,
    createLogger: vi.fn(() => logger),
    isPlainObject: vi.fn(),
    toNonEmptyString: vi.fn(),
  };
});

vi.mock("../../../../js/agents/mcp/sse.js", () => ({
  parseSseStream: sseMocks.parseSseStream,
}));

vi.mock("../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../js/agents/shared/index.js");
  sharedMocks.isPlainObject.mockImplementation(actual.isPlainObject);
  sharedMocks.toNonEmptyString.mockImplementation(actual.toNonEmptyString);
  return {
    ...actual,
    createLogger: sharedMocks.createLogger,
    isPlainObject: sharedMocks.isPlainObject,
    toNonEmptyString: sharedMocks.toNonEmptyString,
  };
});

import SseMcpTransportDefault, { SseMcpTransport } from "../../../../js/agents/mcp/sse-mcp-transport.js";

function buildDeepObject(depth) {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
}

function makeResponse({ ok = true, status = 200, headers = {}, text = "", body = {} } = {}) {
  const headerMap = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok,
    status,
    headers: {
      get: (name) => headerMap.get(String(name).toLowerCase()) || "",
    },
    text: vi.fn(async () => text),
    body,
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeAsyncIterable(events, { signal, waitForAbort = false } = {}) {
  return (async function* () {
    for (const evt of events) {
      if (evt instanceof Error) throw evt;
      yield evt;
    }
    if (waitForAbort && signal) {
      if (signal.aborted) return;
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    }
  })();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  sseMocks.parseSseStream.mockReset();
});

describe("SseMcpTransport", () => {
  it("throws when url is empty or whitespace", () => {
    const cases = [null, undefined, "", "   "];
    for (const value of cases) {
      expect(() => new SseMcpTransport({ url: value, fetchImpl: vi.fn() })).toThrow(/requires url/i);
    }
  });

  it("requires fetch when no global fetch or fetchImpl is available", () => {
    vi.stubGlobal("fetch", undefined);
    expect(() => new SseMcpTransport({ url: "http://example.com" })).toThrow(/requires global fetch or fetchImpl/i);
  });

  it("normalizes options, preserves boundaries, and clones headers", () => {
    const headers = { "X-Test": "1" };
    const transport = new SseMcpTransport({
      url: "http://example.com",
      sseUrl: "   ",
      headers,
      fetchImpl: vi.fn(),
      connectTimeoutMs: -1,
      readTimeoutMs: "5",
      maxLineBytes: 0,
      maxBufferBytes: 1024,
      maxEventChars: Number.MAX_SAFE_INTEGER,
    });

    headers["X-Test"] = "2";

    expect(transport.url).toBe("http://example.com");
    expect(transport.sseUrl).toBe("http://example.com");
    expect(transport.headers).toEqual({ "X-Test": "1" });
    expect(transport.headers).not.toBe(headers);
    expect(transport.connectTimeoutMs).toBe(200);
    expect(transport.readTimeoutMs).toBe(0);
    expect(transport.maxLineBytes).toBe(0);
    expect(transport.maxBufferBytes).toBe(1024);
    expect(transport.maxEventChars).toBe(Number.MAX_SAFE_INTEGER);

    const noHeaders = new SseMcpTransport({
      url: "http://example.com",
      headers: [],
      connectTimeoutMs: 0,
      readTimeoutMs: -1,
      fetchImpl: vi.fn(),
    });
    expect(noHeaders.headers).toEqual({});
    expect(noHeaders.connectTimeoutMs).toBe(200);
    expect(noHeaders.readTimeoutMs).toBe(0);

    const stringTimeout = new SseMcpTransport({
      url: "http://example.com",
      connectTimeoutMs: "500",
      fetchImpl: vi.fn(),
    });
    expect(stringTimeout.connectTimeoutMs).toBe(10000);
  });

  it("connects via GET, emits connect, and starts SSE consumption", async () => {
    sseMocks.parseSseStream.mockImplementation((stream, options = {}) =>
      makeAsyncIterable([], { signal: options.signal, waitForAbort: true }),
    );

    const fetchImpl = vi.fn(async () =>
      makeResponse({
        ok: true,
        headers: { "content-type": "text/event-stream" },
        body: { stream: true },
      }),
    );

    const transport = new SseMcpTransport({
      url: "http://api.example.com",
      sseUrl: "http://sse.example.com",
      headers: { Authorization: "Bearer token" },
      fetchImpl,
      readTimeoutMs: 10,
      maxLineBytes: 128,
      maxBufferBytes: 256,
      maxEventChars: 512,
    });

    const onConnect = vi.fn();
    transport.on("connect", onConnect);

    await transport.connect();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchImpl.mock.calls[0];
    expect(calledUrl).toBe("http://sse.example.com");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({
      Accept: "text/event-stream",
      Authorization: "Bearer token",
    });
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(sseMocks.parseSseStream).toHaveBeenCalledTimes(1);
    expect(sseMocks.parseSseStream.mock.calls[0][1]).toMatchObject({
      readTimeoutMs: 10,
      maxLineBytes: 128,
      maxBufferBytes: 256,
      maxEventChars: 512,
    });
    expect(transport.isConnected()).toBe(true);

    await transport.disconnect();
  });

  it("skips connect when already connected or connecting", async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({ ok: true, headers: { "content-type": "text/event-stream" }, body: {} }),
    );

    const connected = new SseMcpTransport({ url: "http://example.com", fetchImpl });
    connected._connected = true;
    await connected.connect();
    expect(fetchImpl).not.toHaveBeenCalled();

    const connecting = new SseMcpTransport({ url: "http://example.com", fetchImpl });
    connecting._sseController = new AbortController();
    await connecting.connect();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws on non-OK responses and unexpected content types", async () => {
    const fetchFail = vi.fn(async () =>
      makeResponse({ ok: false, status: 500, headers: { "content-type": "text/event-stream" } }),
    );
    const failTransport = new SseMcpTransport({ url: "http://example.com", fetchImpl: fetchFail });
    await expect(failTransport.connect()).rejects.toThrow("SSE MCP error: HTTP 500");

    const fetchBadType = vi.fn(async () =>
      makeResponse({ ok: true, headers: { "content-type": "application/json" } }),
    );
    const badTypeTransport = new SseMcpTransport({ url: "http://example.com", fetchImpl: fetchBadType });
    await expect(badTypeTransport.connect()).rejects.toThrow(/unexpected content-type/i);
  });

  it("consumes SSE messages, ignores invalid data, and disconnects when stream ends", async () => {
    const events = [
      { data: "" },
      { data: "   " },
      { data: "not json" },
      { data: "123" },
      { data: JSON.stringify({ jsonrpc: "2.0", id: 0, result: { ok: true } }) },
    ];
    sseMocks.parseSseStream.mockImplementation(() => makeAsyncIterable(events));

    const fetchImpl = vi.fn(async () =>
      makeResponse({ ok: true, headers: { "content-type": "text/event-stream" }, body: {} }),
    );
    const transport = new SseMcpTransport({ url: "http://example.com", fetchImpl });

    const handleSpy = vi.spyOn(transport, "_handleMessage");
    const rejectSpy = vi.spyOn(transport, "_rejectAllPending");
    const onDisconnect = vi.fn();
    transport.on("disconnect", onDisconnect);

    await transport.connect();
    await transport._sseTask;

    expect(handleSpy).toHaveBeenCalledTimes(1);
    expect(handleSpy.mock.calls[0][0]).toMatchObject({ jsonrpc: "2.0", id: 0, result: { ok: true } });
    expect(rejectSpy).toHaveBeenCalledWith(expect.any(Error));
    expect(transport.isConnected()).toBe(false);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("emits error and disconnects when SSE consumption fails", async () => {
    sseMocks.parseSseStream.mockImplementation(() =>
      makeAsyncIterable([new Error("stream blew up")]),
    );

    const fetchImpl = vi.fn(async () =>
      makeResponse({ ok: true, headers: { "content-type": "text/event-stream" }, body: {} }),
    );
    const transport = new SseMcpTransport({ url: "http://example.com", fetchImpl });

    const errorSpy = vi.fn();
    const disconnectSpy = vi.fn();
    const rejectSpy = vi.spyOn(transport, "_rejectAllPending");

    transport.on("error", errorSpy);
    transport.on("disconnect", disconnectSpy);

    await transport.connect();
    await transport._sseTask;

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({ message: "stream blew up" });
    expect(rejectSpy).toHaveBeenCalled();
    expect(disconnectSpy).toHaveBeenCalled();
    expect(transport.isConnected()).toBe(false);
  });

  it("throws when send is called before connecting", async () => {
    const transport = new SseMcpTransport({ url: "http://example.com", fetchImpl: vi.fn() });
    await expect(transport.send({ jsonrpc: "2.0", method: "ping" })).rejects.toThrow("Transport not connected");
  });

  it("posts JSON and handles JSON-RPC responses", async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({
        ok: true,
        headers: { "content-type": "application/json" },
        text: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
      }),
    );
    const transport = new SseMcpTransport({
      url: "http://example.com",
      headers: { "X-Test": "1" },
      fetchImpl,
    });
    transport._connected = true;

    const handleSpy = vi.spyOn(transport, "_handleMessage");

    await transport.send({ jsonrpc: "2.0", id: 1, method: "ping" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Test": "1",
    });
    expect(JSON.parse(init.body)).toMatchObject({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(handleSpy).toHaveBeenCalledTimes(1);
  });

  it("handles array responses and ignores non-object entries", async () => {
    const fetchImpl = vi.fn(async () =>
      makeResponse({
        ok: true,
        text: JSON.stringify([
          { jsonrpc: "2.0", id: 1, result: "a" },
          42,
          { jsonrpc: "2.0", id: 2, result: "b" },
        ]),
      }),
    );
    const transport = new SseMcpTransport({ url: "http://example.com", fetchImpl });
    transport._connected = true;

    const handleSpy = vi.spyOn(transport, "_handleMessage");

    await transport.send({ jsonrpc: "2.0", id: 1, method: "list" });

    expect(handleSpy).toHaveBeenCalledTimes(2);
    expect(handleSpy.mock.calls[0][0]).toMatchObject({ jsonrpc: "2.0", id: 1, result: "a" });
    expect(handleSpy.mock.calls[1][0]).toMatchObject({ jsonrpc: "2.0", id: 2, result: "b" });
  });

  it("wraps non-JSONRPC responses for request ids and emits messages for notifications", async () => {
    const arrayLike = { 0: "a", length: 1 };
    const fetchImpl = vi.fn(async () =>
      makeResponse({
        ok: true,
        text: JSON.stringify(arrayLike),
      }),
    );
    const transport = new SseMcpTransport({ url: "http://example.com", fetchImpl });
    transport._connected = true;

    const handleSpy = vi.spyOn(transport, "_handleMessage");

    await transport.send({ jsonrpc: "2.0", id: Number.MAX_SAFE_INTEGER, method: "ping" });

    expect(handleSpy).toHaveBeenCalledTimes(1);
    expect(handleSpy.mock.calls[0][0]).toMatchObject({
      jsonrpc: "2.0",
      id: Number.MAX_SAFE_INTEGER,
      result: arrayLike,
    });

    const messageFetch = vi.fn(async () =>
      makeResponse({
        ok: true,
        text: JSON.stringify({ ok: true }),
      }),
    );
    const notifyTransport = new SseMcpTransport({ url: "http://example.com", fetchImpl: messageFetch });
    notifyTransport._connected = true;

    const onMessage = vi.fn();
    notifyTransport.on("message", onMessage);

    await notifyTransport.send({ jsonrpc: "2.0", method: "notify" });

    expect(onMessage).toHaveBeenCalledWith({ ok: true });
  });

  it("ignores empty responses and emits errors on fetch failures", async () => {
    const emptyFetch = vi.fn(async () => makeResponse({ ok: true, text: "" }));
    const transport = new SseMcpTransport({ url: "http://example.com", fetchImpl: emptyFetch });
    transport._connected = true;

    const handleSpy = vi.spyOn(transport, "_handleMessage");
    const messageSpy = vi.fn();
    transport.on("message", messageSpy);

    await transport.send({ jsonrpc: "2.0", id: 1, method: "noop" });

    expect(handleSpy).not.toHaveBeenCalled();
    expect(messageSpy).not.toHaveBeenCalled();

    const errorFetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const errorTransport = new SseMcpTransport({ url: "http://example.com", fetchImpl: errorFetch });
    errorTransport._connected = true;
    const onError = vi.fn();
    errorTransport.on("error", onError);

    await expect(errorTransport.send({ jsonrpc: "2.0", id: -1, method: "ping" })).rejects.toThrow("network down");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(errorTransport._inflight.size).toBe(0);
  });

  it("handles concurrent sends and large payloads without leaking inflight controllers", async () => {
    const first = createDeferred();
    const second = createDeferred();
    const fetchImpl = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const transport = new SseMcpTransport({ url: "http://example.com", fetchImpl });
    transport._connected = true;

    const largeContent = "x".repeat(512 * 1024);
    const deepMeta = buildDeepObject(40);

    const messageA = {
      jsonrpc: "2.0",
      id: 1,
      method: "upload",
      params: { content: largeContent, meta: deepMeta },
    };
    const messageB = {
      jsonrpc: "2.0",
      id: -1,
      method: "ping",
      params: [],
    };

    const sendA = transport.send(messageA);
    const sendB = transport.send(messageB);

    expect(transport._inflight.size).toBe(2);

    first.resolve(makeResponse({ ok: true, text: "" }));
    second.resolve(makeResponse({ ok: true, text: "" }));

    await Promise.all([sendA, sendB]);

    expect(transport._inflight.size).toBe(0);

    const payload = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(payload.params.content.length).toBe(largeContent.length);
    expect(payload.params.meta.next).toBeDefined();
  });

  it("receive resolves on message and rejects on error or disconnect", async () => {
    const transport = new SseMcpTransport({ url: "http://example.com", fetchImpl: vi.fn() });

    await expect(transport.receive()).rejects.toThrow("Transport not connected");

    transport._connected = true;

    const messagePromise = transport.receive();
    transport.emit("message", { ok: true });
    await expect(messagePromise).resolves.toEqual({ ok: true });
    expect(transport._events.get("message")).toBeUndefined();

    const errorPromise = transport.receive();
    transport.emit("error", new Error("boom"));
    await expect(errorPromise).rejects.toThrow("boom");

    const disconnectPromise = transport.receive();
    transport.emit("disconnect");
    await expect(disconnectPromise).rejects.toThrow("Transport disconnected");
  });

  it("disconnects safely, aborts inflight controllers, and clears state", async () => {
    const transport = new SseMcpTransport({ url: "http://example.com", fetchImpl: vi.fn() });
    await expect(transport.disconnect()).resolves.toBeUndefined();

    transport._connected = true;
    const inflightA = new AbortController();
    const inflightB = new AbortController();
    transport._inflight.add(inflightA);
    transport._inflight.add(inflightB);
    transport._sseController = new AbortController();
    transport._sseTask = Promise.resolve();

    const disconnectSpy = vi.fn();
    transport.on("disconnect", disconnectSpy);

    await transport.disconnect();

    expect(transport.isConnected()).toBe(false);
    expect(inflightA.signal.aborted).toBe(true);
    expect(inflightB.signal.aborted).toBe(true);
    expect(transport._inflight.size).toBe(0);
    expect(transport._sseController).toBeNull();
    expect(transport._sseTask).toBeNull();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });

  it("close delegates to disconnect", async () => {
    const transport = new SseMcpTransport({ url: "http://example.com", fetchImpl: vi.fn() });
    const disconnectSpy = vi.spyOn(transport, "disconnect").mockResolvedValue();
    await transport.close();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});

describe("default export", () => {
  it("exposes the same class as the named export", () => {
    expect(SseMcpTransportDefault).toBe(SseMcpTransport);
  });
});
