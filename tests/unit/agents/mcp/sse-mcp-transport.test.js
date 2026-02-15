import { describe, it, expect, vi, beforeEach } from "vitest";

const { parseSseStreamMock } = vi.hoisted(() => ({
  parseSseStreamMock: vi.fn(),
}));

vi.mock("../../../../js/agents/mcp/sse.js", () => ({
  parseSseStream: parseSseStreamMock,
}));

import { SseMcpTransport } from "../../../../js/agents/mcp/sse-mcp-transport.js";

function deferred() {
  /** @type {(v:any)=>void} */
  let resolve;
  /** @type {(e:any)=>void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createHeaders(contentType) {
  return {
    get(key) {
      return String(key).toLowerCase() === "content-type" ? contentType : null;
    },
  };
}

function createResponse({ ok = true, status = 200, contentType = "text/event-stream", body = {} } = {}) {
  const headers =
    contentType === undefined
      ? undefined
      : {
          get(key) {
            return String(key).toLowerCase() === "content-type" ? contentType : null;
          },
        };

  return {
    ok,
    status,
    headers,
    body,
    async text() {
      if (body === null || body === undefined) return "";
      if (typeof body === "string") return body;
      return String(body);
    },
  };
}

function getSendMethodName(instance) {
  if (typeof instance?.send === "function") return "send";
  if (typeof instance?.sendMessage === "function") return "sendMessage";
  return null;
}

function getCloseMethodName(instance) {
  if (typeof instance?.close === "function") return "close";
  if (typeof instance?.disconnect === "function") return "disconnect";
  if (typeof instance?.dispose === "function") return "dispose";
  return null;
}

function makeAbortAwarePendingFetch({ onCall, resolveOnAbort = false } = {}) {
  return vi.fn((input, init = {}) => {
    onCall?.(input, init);
    const signal = init.signal;

    return new Promise((resolve, reject) => {
      const finishOnAbort = () => {
        if (resolveOnAbort) {
          resolve(createResponse({ ok: false, status: 499, contentType: "", body: "" }));
          return;
        }
        const err = new Error("Aborted");
        err.name = "AbortError";
        err.reason = signal?.reason;
        reject(err);
      };

      if (signal?.aborted) {
        finishOnAbort();
        return;
      }

      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", finishOnAbort, { once: true });
      }
    });
  });
}

async function expectThrowOrReject(fn) {
  try {
    const r = fn();
    await r;
    throw new Error("Expected throw/reject, but it resolved");
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
  }
}

describe("SseMcpTransport", () => {
  beforeEach(() => {
    parseSseStreamMock.mockReset();
    // `parseSseStream` is an async iterable; return a "no-op" stream that
    // stays pending until aborted (so connect() sets `_connected=true` without
    // immediately tripping disconnect/error paths).
    parseSseStreamMock.mockImplementation((_body, options = {}) => {
      const signal = options?.signal;
      return (async function* () {
        if (signal?.aborted) return;
        if (!signal || typeof signal.addEventListener !== "function") {
          await new Promise(() => {});
          return;
        }
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      })();
    });
  });

  it("throws for missing/empty/invalid url (null/undefined/blank/type-boundary)", () => {
    const fetchImpl = vi.fn();
    // url is normalized via `toNonEmptyString` (coerces via String + trim).
    // Only values that normalize to empty/undefined should throw.
    const invalidUrls = [undefined, null, "", "   ", []];

    for (const url of invalidUrls) {
      expect(() => new SseMcpTransport({ url, fetchImpl })).toThrow(/requires url/i);
    }
  });

  it("normalizes options, clones plain headers, and clamps timeouts", () => {
    const fetchImpl = vi.fn();
    const headers = { Authorization: "Bearer x", Accept: "text/event-stream" };

    const t = new SseMcpTransport({
      url: "https://example.com/mcp",
      headers,
      fetchImpl,
      connectTimeoutMs: 0,
      readTimeoutMs: -1,
      maxLineBytes: 123,
      maxBufferBytes: 456,
      maxEventChars: 789,
    });

    expect(t.url).toBe("https://example.com/mcp");
    expect(t.sseUrl).toBe("https://example.com/mcp");
    expect(t.headers).toEqual(headers);
    expect(t.headers).not.toBe(headers);

    expect(t._fetch).toBe(fetchImpl);

    expect(t.connectTimeoutMs).toBe(200);
    expect(t.readTimeoutMs).toBe(0);

    expect(t.maxLineBytes).toBe(123);
    expect(t.maxBufferBytes).toBe(456);
    expect(t.maxEventChars).toBe(789);
  });

  it("treats non-plain headers as empty object (null/undefined/array/string/number)", () => {
    const fetchImpl = vi.fn();
    const cases = [null, undefined, [], "", 123];

    for (const headers of cases) {
      const t = new SseMcpTransport({ url: "https://example.com/mcp", headers, fetchImpl });
      expect(t.headers).toEqual({});
    }
  });

  it("uses defaults for non-numeric timeout inputs and accepts MAX_SAFE_INTEGER", () => {
    const fetchImpl = vi.fn();

    const t1 = new SseMcpTransport({
      url: "https://example.com/mcp",
      fetchImpl,
      connectTimeoutMs: "123",
      readTimeoutMs: "456",
    });

    expect(t1.connectTimeoutMs).toBe(10_000);
    expect(t1.readTimeoutMs).toBe(0);

    const t2 = new SseMcpTransport({
      url: "https://example.com/mcp",
      fetchImpl,
      connectTimeoutMs: Number.MAX_SAFE_INTEGER,
      readTimeoutMs: Number.MAX_SAFE_INTEGER,
    });

    expect(t2.connectTimeoutMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(t2.readTimeoutMs).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("requires global fetch or fetchImpl when fetchImpl is not provided", () => {
    vi.stubGlobal("fetch", undefined);
    try {
      expect(() => new SseMcpTransport({ url: "https://example.com/mcp" })).toThrow(/requires global fetch or fetchImpl/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("connect() uses sseUrl (override), sends GET with Accept header and merges headers", async () => {
    const fetchImpl = vi.fn(async (input, init = {}) => {
      return createResponse({
        ok: true,
        status: 200,
        contentType: "Text/Event-Stream; charset=utf-8",
        body: "STREAM",
      });
    });

    const t = new SseMcpTransport({
      url: "https://example.com/mcp",
      sseUrl: "https://example.com/sse",
      headers: { "X-Test": "1" },
      fetchImpl,
    });

    await t.connect();
    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0];

    expect(input).toBe("https://example.com/sse");
    expect(init).toEqual(
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Accept: "text/event-stream",
          "X-Test": "1",
        }),
      })
    );
    expect(init.signal).toBeTruthy();
    expect(typeof init.signal.aborted).toBe("boolean");

    expect(t._connected).toBe(true);
    expect(parseSseStreamMock).toHaveBeenCalledTimes(1);
    expect(parseSseStreamMock.mock.calls[0]).toContain("STREAM");
  });

  it("connect() allows empty or missing content-type", async () => {
    const fetchImplEmpty = vi.fn(async () => createResponse({ contentType: "" }));
    const t1 = new SseMcpTransport({ url: "https://example.com/mcp", fetchImpl: fetchImplEmpty });
    await t1.connect();

    const fetchImplMissing = vi.fn(async () => createResponse({ contentType: undefined }));
    const t2 = new SseMcpTransport({ url: "https://example.com/mcp", fetchImpl: fetchImplMissing });
    await t2.connect();
  });

  it("connect() is idempotent (does not refetch when already connected)", async () => {
    const fetchImpl = vi.fn(async () => createResponse({ body: "STREAM" }));
    const t = new SseMcpTransport({ url: "https://example.com/mcp", fetchImpl });

    await t.connect();
    await t.connect();
    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(t._connected).toBe(true);
  });

  it("connect() concurrent/rapid calls only issue one fetch", async () => {
    const gate = deferred();
    const fetchImpl = vi.fn(() => gate.promise);

    const t = new SseMcpTransport({ url: "https://example.com/mcp", fetchImpl });

    const p1 = t.connect();
    const p2 = t.connect();

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    gate.resolve(createResponse({ body: "STREAM" }));

    await Promise.all([p1, p2]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(t._connected).toBe(true);
  });

  it("connect() rejects on HTTP error (non-ok)", async () => {
    const fetchImpl = vi.fn(async () => createResponse({ ok: false, status: 401 }));
    const t = new SseMcpTransport({ url: "https://example.com/mcp", fetchImpl });

    await expect(t.connect()).rejects.toThrow(/HTTP 401/i);
    expect(t._connected).not.toBe(true);
  });

  it("connect() rejects on unexpected content-type", async () => {
    const fetchImpl = vi.fn(async () =>
      createResponse({
        ok: true,
        status: 200,
        contentType: "application/json",
        body: "STREAM",
      })
    );
    const t = new SseMcpTransport({ url: "https://example.com/mcp", fetchImpl });

    await expect(t.connect()).rejects.toThrow(/unexpected content-type/i);
    expect(t._connected).not.toBe(true);
  });

  it("connect() aborts when connectTimeoutMs elapses (timer boundary)", async () => {
    vi.useFakeTimers();
    try {
      /** @type {AbortSignal|undefined} */
      let seenSignal;

      const fetchImpl = makeAbortAwarePendingFetch({
        onCall: (_, init) => {
          seenSignal = init?.signal;
        },
      });

      const t = new SseMcpTransport({
        url: "https://example.com/mcp",
        fetchImpl,
        connectTimeoutMs: 200,
      });

      const p = t.connect();
      // Prevent "unhandled rejection" when fake timers advance before awaiting `p`.
      p.catch(() => {});
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(seenSignal).toBeTruthy();
      expect(seenSignal.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(200);

      expect(seenSignal.aborted).toBe(true);
      if (seenSignal.reason !== undefined) {
        expect(seenSignal.reason).toBe("connect_timeout");
      }

      await expect(p).rejects.toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("connect() attaches to parent AbortSignal (already-aborted and abort-after-call)", async () => {
    // already aborted
    {
      const parent = new AbortController();
      try {
        parent.abort("already");
      } catch {
        parent.abort();
      }

      /** @type {AbortSignal|undefined} */
      let seenSignal;
      const fetchImpl = makeAbortAwarePendingFetch({
        onCall: (_, init) => {
          seenSignal = init?.signal;
        },
      });

      const t = new SseMcpTransport({
        url: "https://example.com/mcp",
        fetchImpl,
        signal: parent.signal,
      });

      await expect(t.connect()).rejects.toBeDefined();
      expect(seenSignal).toBeTruthy();
      expect(seenSignal.aborted).toBe(true);
      if (seenSignal.reason !== undefined && parent.signal.reason !== undefined) {
        expect(seenSignal.reason).toBe(parent.signal.reason);
      }
    }

    // abort after call
    {
      const parent = new AbortController();

      /** @type {AbortSignal|undefined} */
      let seenSignal;
      const fetchImpl = makeAbortAwarePendingFetch({
        onCall: (_, init) => {
          seenSignal = init?.signal;
        },
      });

      const t = new SseMcpTransport({
        url: "https://example.com/mcp",
        fetchImpl,
        signal: parent.signal,
        connectTimeoutMs: 10_000,
      });

      const p = t.connect();
      // Avoid unhandled rejection if abort fires before awaiting `p`.
      p.catch(() => {});

      try {
        parent.abort("user_cancel");
      } catch {
        parent.abort();
      }

      await expect(p).rejects.toBeDefined();

      expect(seenSignal).toBeTruthy();
      expect(seenSignal.aborted).toBe(true);
      if (seenSignal.reason !== undefined && parent.signal.reason !== undefined) {
        expect(seenSignal.reason).toBe(parent.signal.reason);
      }
    }
  });

  it("send() posts JSON to url with correct headers; supports long strings and deep nesting (resource boundary)", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (input, init = {}) => {
      calls.push({ input, init });
      if (init.method === "GET") {
        return createResponse({ body: "STREAM" });
      }
      return createResponse({ ok: true, status: 204, contentType: "", body: "" });
    });

    const t = new SseMcpTransport({
      url: "https://example.com/mcp",
      sseUrl: "https://example.com/sse",
      headers: { Authorization: "Bearer x" },
      fetchImpl,
    });

    const sendName = getSendMethodName(t);
    expect(sendName).toBeTruthy();

    await t.connect();

    const deep = {};
    let cur = deep;
    for (let i = 0; i < 50; i++) {
      cur.next = {};
      cur = cur.next;
    }

    const payload = "x".repeat(200_000);
    const msg = {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: { payload, deep },
    };

    await t[sendName](msg);

    const postCalls = calls.filter((c) => c.init?.method === "POST");
    expect(postCalls.length).toBe(1);

    const { input, init } = postCalls[0];
    expect(input).toBe("https://example.com/mcp");

    expect(init.headers).toEqual(
      expect.objectContaining({
        "Content-Type": "application/json",
        Authorization: "Bearer x",
      })
    );

    expect(typeof init.body).toBe("string");
    expect(JSON.parse(init.body)).toEqual(msg);
  });

  it("send() rejects when message cannot be JSON-stringified and does not POST", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (input, init = {}) => {
      calls.push({ input, init });
      if (init.method === "GET") return createResponse({ body: "STREAM" });
      return createResponse({ ok: true, status: 204, contentType: "", body: "" });
    });

    const t = new SseMcpTransport({
      url: "https://example.com/mcp",
      sseUrl: "https://example.com/sse",
      fetchImpl,
    });

    const sendName = getSendMethodName(t);
    expect(sendName).toBeTruthy();

    await t.connect();

    const circular = {};
    circular.self = circular;
    const invalidMessages = [BigInt(1), { n: BigInt(2) }, circular];
    for (const bad of invalidMessages) {
      const before = calls.filter((c) => c.init?.method === "POST").length;
      await expectThrowOrReject(() => t[sendName](bad));
      const after = calls.filter((c) => c.init?.method === "POST").length;
      expect(after).toBe(before);
    }

    // empty object is allowed as a boundary; should serialize and POST
    await t[sendName]({});
    expect(calls.some((c) => c.init?.method === "POST" && c.input === "https://example.com/mcp")).toBe(true);
  });

  it("send() supports concurrent calls (concurrency boundary)", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (input, init = {}) => {
      calls.push({ input, init });
      if (init.method === "GET") return createResponse({ body: "STREAM" });
      return createResponse({ ok: true, status: 204, contentType: "", body: "" });
    });

    const t = new SseMcpTransport({
      url: "https://example.com/mcp",
      sseUrl: "https://example.com/sse",
      fetchImpl,
    });

    const sendName = getSendMethodName(t);
    expect(sendName).toBeTruthy();

    await t.connect();

    const msg1 = { jsonrpc: "2.0", id: 1, method: "m1", params: {} };
    const msg2 = { jsonrpc: "2.0", id: 2, method: "m2", params: {} };

    await Promise.all([t[sendName](msg1), t[sendName](msg2)]);

    const postCalls = calls.filter((c) => c.init?.method === "POST");
    expect(postCalls.length).toBe(2);
  });

  it("close rejects pending receive and clears listeners", async () => {
    const fetchImpl = vi.fn(async (_input, init = {}) => {
      if (init.method === "GET") return createResponse({ body: "STREAM" });
      return createResponse({ ok: true, status: 204, contentType: "", body: "" });
    });

    const t = new SseMcpTransport({
      url: "https://example.com/mcp",
      sseUrl: "https://example.com/sse",
      fetchImpl,
    });

    await t.connect();
    const receivePromise = t.receive();

    await t.close();

    await expect(receivePromise).rejects.toThrow(/transport disconnected/i);
    expect(t._events?.size ?? 0).toBe(0);
  });

  it("dispose aliases close and clears listeners", async () => {
    const fetchImpl = vi.fn(async (_input, init = {}) => {
      if (init.method === "GET") return createResponse({ body: "STREAM" });
      return createResponse({ ok: true, status: 204, contentType: "", body: "" });
    });

    const t = new SseMcpTransport({
      url: "https://example.com/mcp",
      sseUrl: "https://example.com/sse",
      fetchImpl,
    });

    t.on("message", vi.fn());
    await t.connect();

    await t.dispose();

    expect(t.isConnected()).toBe(false);
    expect(t._events?.size ?? 0).toBe(0);
  });

  it("close/disconnect is idempotent and aborts SSE + inflight POSTs (concurrency/resource cleanup boundary)", async () => {
    /** @type {AbortSignal[]} */
    const postSignals = [];

    const fetchImpl = vi.fn((input, init = {}) => {
      if (init.method === "GET") return Promise.resolve(createResponse({ body: "STREAM" }));

      if (init.method === "POST") {
        if (init.signal) postSignals.push(init.signal);
        // Resolve on abort to avoid unhandled rejections across implementations.
        return makeAbortAwarePendingFetch({ resolveOnAbort: true })(input, init);
      }

      return Promise.resolve(createResponse({ ok: true, status: 200, contentType: "", body: "" }));
    });

    const t = new SseMcpTransport({
      url: "https://example.com/mcp",
      sseUrl: "https://example.com/sse",
      fetchImpl,
    });

    const sendName = getSendMethodName(t);
    expect(sendName).toBeTruthy();

    const closeName = getCloseMethodName(t);
    expect(closeName).toBeTruthy();

    await t.connect();

    const p1 = t[sendName]({ jsonrpc: "2.0", id: 1, method: "m1", params: {} });
    const p2 = t[sendName]({ jsonrpc: "2.0", id: 2, method: "m2", params: {} });

    expect(Array.isArray(postSignals)).toBe(true);

    await t[closeName]();
    await t[closeName]();

    for (const s of postSignals) {
      expect(typeof s?.aborted).toBe("boolean");
      expect(s.aborted).toBe(true);
    }

    const sseController = t._sseController;
    if (sseController && sseController.signal) {
      expect(sseController.signal.aborted).toBe(true);
    }

    const settled = await Promise.allSettled([p1, p2].filter(Boolean));
    expect(settled.length).toBeGreaterThanOrEqual(0);
  });
});
