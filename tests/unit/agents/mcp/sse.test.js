import { describe, it, expect, vi, beforeEach } from "vitest";

function toNonNegativeInt(value, fallback = 0) {
  const n = Number(value);
  if (Number.isFinite(n)) {
    const v = Math.floor(n);
    return v >= 0 ? v : fallback;
  }
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return fallback;
  const parsed = Number.parseInt(s, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function defaultToPositiveInt(value, fallback = 1) {
  const n = toNonNegativeInt(value, fallback);
  return n > 0 ? n : fallback;
}

function defaultToNonEmptyString(value) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
}

const mockLoggerWarn = vi.hoisted(() => vi.fn());
const mockCreateLogger = vi.hoisted(() => vi.fn(() => ({ warn: mockLoggerWarn })));
const mockToNonEmptyString = vi.hoisted(() => vi.fn(defaultToNonEmptyString));
const mockToPositiveInt = vi.hoisted(() => vi.fn(defaultToPositiveInt));

vi.mock("../../../../js/agents/shared/index.js", () => ({
  createLogger: mockCreateLogger,
  toNonEmptyString: mockToNonEmptyString,
  toPositiveInt: mockToPositiveInt,
}));

import sseDefault, {
  createSseParser,
  consumeSse,
  consumeSseJson,
  NewlineDecoder,
  parseSseStream,
  SseDecoder,
} from "../../../../js/agents/mcp/sse.js";

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockToNonEmptyString.mockImplementation(defaultToNonEmptyString);
  mockToPositiveInt.mockImplementation(defaultToPositiveInt);
  mockCreateLogger.mockImplementation(() => ({ warn: mockLoggerWarn }));
});

function u8(text) {
  return new TextEncoder().encode(String(text ?? ""));
}

function makeReader(readResults) {
  let i = 0;
  return {
    read: vi.fn(async () => {
      if (i >= readResults.length) return { done: true, value: undefined };
      const next = readResults[i++];
      if (next instanceof Error) throw next;
      if (next && typeof next === "object" && ("done" in next || "value" in next)) return next;
      return { done: false, value: next };
    }),
    cancel: vi.fn(async () => {}),
    releaseLock: vi.fn(),
  };
}

function makeStreamFromReader(reader) {
  return { getReader: () => reader };
}

async function collect(iterable) {
  const out = [];
  for await (const v of iterable) out.push(v);
  return out;
}

describe("SseDecoder", () => {
  it("parses event/data/id/retry, ignores comments, and keeps id/retry across events", () => {
    const d = new SseDecoder();

    expect(d.decode(": comment")).toBeNull();
    expect(d.decode("event: update")).toBeNull();
    expect(d.decode("data: a")).toBeNull();
    expect(d.decode("data: b")).toBeNull();
    expect(d.decode("id: 123")).toBeNull();
    expect(d.decode("retry: 2000")).toBeNull();

    const evt1 = d.decode("");
    expect(evt1).toEqual({ event: "update", data: "a\nb", id: "123", retry: 2000 });

    expect(d.decode("data: x")).toBeNull();
    const evt2 = d.decode("");
    expect(evt2).toEqual({ event: "message", data: "x", id: "123", retry: 2000 });
  });

  it("treats null/undefined/empty/whitespace inputs as empty lines and ignores objects", () => {
    const d = new SseDecoder();

    expect(d.decode(null)).toBeNull();
    expect(d.decode(undefined)).toBeNull();
    expect(d.decode("")).toBeNull();
    expect(d.decode("   ")).toBeNull();
    expect(d.decode([])).toBeNull();
    expect(d.decode({})).toBeNull();
    expect(d.flush()).toBeNull();
  });

  it("handles lines without ':' and flushes the last event", () => {
    const d = new SseDecoder();
    d.decode("event");
    d.decode("data");
    const evt = d.flush();
    expect(evt).toEqual({ event: "message", data: "", id: null, retry: null });
  });

  it("ignores unknown fields and invalid retry values; supports id reset via empty id", () => {
    const d = new SseDecoder();

    d.decode("event:update");
    d.decode("foo: bar");
    d.decode("retry: -1");

    d.decode("id: abc");
    d.decode("data: hello");
    expect(d.decode("")).toMatchObject({ event: "update", data: "hello", id: "abc", retry: null });

    d.decode("id:");
    d.decode("data: x");
    expect(d.decode("")).toMatchObject({ id: null, data: "x" });
  });

  it("enforces maxEventChars and accepts numeric string limits", () => {
    const d = new SseDecoder({ maxEventChars: "5" });
    d.decode("data: 1234");
    expect(d.decode("")).toEqual({ event: "message", data: "1234", id: null, retry: null });

    const limited = new SseDecoder({ maxEventChars: 5 });
    let err;
    try {
      limited.decode("data: 12345");
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ name: "SseSizeLimitError", code: "SSE_EVENT_LIMIT" });
  });

  it("accepts large event data and rapid consecutive calls when limits are disabled", () => {
    const big = "x".repeat(200000);
    const d = new SseDecoder({ maxEventChars: 0 });
    d.decode(`data: ${big}`);
    d.decode("data: tail");
    const evt = d.decode("");
    expect(evt.data.length).toBe(big.length + 1 + 4);
    expect(evt.data.endsWith("tail")).toBe(true);

    const rapid = new SseDecoder();
    for (let i = 0; i < 5; i += 1) rapid.decode(`data: ${i}`);
    const rapidEvt = rapid.decode("");
    expect(rapidEvt.data).toBe("0\n1\n2\n3\n4");
  });

  it("isolates state across concurrent decoders", async () => {
    const d1 = new SseDecoder();
    const d2 = new SseDecoder();

    const [evt1, evt2] = await Promise.all([
      Promise.resolve().then(() => {
        d1.decode("data: one");
        return d1.decode("");
      }),
      Promise.resolve().then(() => {
        d2.decode("event: ping");
        d2.decode("data: two");
        return d2.decode("");
      }),
    ]);

    expect(evt1).toEqual({ event: "message", data: "one", id: null, retry: null });
    expect(evt2).toEqual({ event: "ping", data: "two", id: null, retry: null });
  });
});

describe("NewlineDecoder", () => {
  it("splits LF, CRLF (including across chunk boundaries), and bare CR", () => {
    const nd = new NewlineDecoder();

    expect(nd.decode(u8("a\nb\n"))).toEqual(["a", "b"]);
    expect(nd.flush()).toEqual([]);

    expect(nd.decode(u8("x\r"))).toEqual([]);
    expect(nd.decode(u8("\n"))).toEqual(["x"]);
    expect(nd.flush()).toEqual([]);

    expect(nd.decode(u8("y\rz"))).toEqual(["y"]);
    expect(nd.flush()).toEqual(["z"]);
  });

  it("treats non-Uint8Array chunks as empty input", () => {
    const nd = new NewlineDecoder();
    expect(nd.decode("not-bytes")).toEqual([]);
    expect(nd.decode(null)).toEqual([]);
    expect(nd.decode(undefined)).toEqual([]);
    expect(nd.decode([])).toEqual([]);
    expect(nd.decode({})).toEqual([]);
    expect(nd.decode({ length: 2, 0: 0x61 })).toEqual([]);
    expect(nd.decode(new Uint8Array())).toEqual([]);
  });

  it("enforces maxBufferBytes and maxLineBytes (string limits)", () => {
    const bufferLimited = new NewlineDecoder({ maxBufferBytes: 3 });
    let bufferErr;
    try {
      bufferLimited.decode(u8("abcd"));
    } catch (e) {
      bufferErr = e;
    }
    expect(bufferErr).toMatchObject({ name: "SseSizeLimitError", code: "SSE_BUFFER_LIMIT" });

    const lineLimited = new NewlineDecoder({ maxLineBytes: "2" });
    expect(() => lineLimited.decode(u8("abc\n"))).toThrow(/maxLineBytes/i);

    const flushLimited = new NewlineDecoder({ maxLineBytes: 2 });
    flushLimited.decode(u8("abc"));
    expect(() => flushLimited.flush()).toThrow(/maxLineBytes/i);
  });

  it("flushes remaining bytes and handles large buffers", () => {
    const nd = new NewlineDecoder({ maxLineBytes: Infinity });
    const big = "z".repeat(150000);
    expect(nd.decode(u8(big))).toEqual([]);
    const lines = nd.flush();
    expect(lines).toEqual([big]);
  });

  it("throws when TextDecoder is unavailable", () => {
    vi.stubGlobal("TextDecoder", undefined);
    const nd = new NewlineDecoder();
    expect(() => nd.decode(u8("a\n"))).toThrow(/TextDecoder unavailable/i);
  });

  it("handles concurrent decoding on separate instances", async () => {
    const left = new NewlineDecoder();
    const right = new NewlineDecoder();

    const [l, r] = await Promise.all([
      Promise.resolve().then(() => left.decode(u8("l1\n"))),
      Promise.resolve().then(() => right.decode(u8("r1\n"))),
    ]);

    expect(l).toEqual(["l1"]);
    expect(r).toEqual(["r1"]);
  });
});

describe("parseSseStream", () => {
  it("yields events, skips falsy chunks, and flushes a final unterminated event on EOS", async () => {
    const reader = makeReader([
      { done: false, value: undefined },
      { done: false, value: u8("data: one\n\n") },
      { done: false, value: u8("data: last") },
      { done: true, value: undefined },
    ]);
    const stream = makeStreamFromReader(reader);

    const events = await collect(
      parseSseStream(stream, { maxLineBytes: Infinity, maxBufferBytes: Infinity, maxEventChars: Infinity })
    );
    expect(events).toEqual([
      { event: "message", data: "one", id: null, retry: null },
      { event: "message", data: "last", id: null, retry: null },
    ]);

    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("cancels and stops when the AbortSignal is already aborted", async () => {
    const reader = {
      read: vi.fn(() => {
        throw new Error("should not read");
      }),
      cancel: vi.fn(async () => {}),
      releaseLock: vi.fn(),
    };
    const stream = makeStreamFromReader(reader);
    const ac = new AbortController();
    ac.abort("stop");

    const events = await collect(parseSseStream(stream, { signal: ac.signal }));
    expect(events).toEqual([]);
    expect(reader.read).not.toHaveBeenCalled();
    expect(reader.cancel).toHaveBeenCalledWith("stop");
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("throws a structured timeout error and cancels the reader on readTimeoutMs", async () => {
    vi.useFakeTimers();

    const reader = {
      read: vi.fn(() => new Promise(() => {})),
      cancel: vi.fn(async () => {}),
      releaseLock: vi.fn(),
    };
    const stream = makeStreamFromReader(reader);

    const itor = parseSseStream(stream, { readTimeoutMs: "10" });
    const next = itor.next();

    const rejected = expect(next).rejects.toMatchObject({
      name: "SseReadTimeoutError",
      code: "SSE_READ_TIMEOUT",
      readTimeoutMs: 10,
    });

    await vi.advanceTimersByTimeAsync(11);
    await rejected;

    expect(reader.cancel).toHaveBeenCalledWith("read_timeout");
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-timeout reader errors (and still releases the lock)", async () => {
    const err = new Error("boom");
    const reader = {
      read: vi.fn(async () => {
        throw err;
      }),
      cancel: vi.fn(async () => {}),
      releaseLock: vi.fn(),
    };
    const stream = makeStreamFromReader(reader);

    await expect(async () => collect(parseSseStream(stream, { readTimeoutMs: 50 }))).rejects.toThrow(/boom/);
    expect(reader.cancel).not.toHaveBeenCalled();
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("validates inputs (readable stream + TextDecoder availability)", async () => {
    await expect(async () => collect(parseSseStream(null))).rejects.toThrow(/readable stream/i);

    const reader = makeReader([{ done: true }]);
    const stream = makeStreamFromReader(reader);

    vi.stubGlobal("TextDecoder", undefined);
    await expect(async () => collect(parseSseStream(stream))).rejects.toThrow(/TextDecoder unavailable/i);
  });

  it("honors string numeric maxLineBytes limits", async () => {
    const reader = makeReader([{ done: false, value: u8("abc\n") }, { done: true }]);
    const stream = makeStreamFromReader(reader);

    await expect(async () =>
      collect(parseSseStream(stream, { maxLineBytes: "2", maxBufferBytes: Infinity, maxEventChars: Infinity }))
    ).rejects.toMatchObject({ name: "SseSizeLimitError", code: "SSE_LINE_LIMIT" });
  });

  it("handles concurrent streams independently", async () => {
    const readerA = makeReader([{ done: false, value: u8("data: a\n\n") }, { done: true }]);
    const readerB = makeReader([{ done: false, value: u8("data: b\n\n") }, { done: true }]);

    const [eventsA, eventsB] = await Promise.all([
      collect(parseSseStream(makeStreamFromReader(readerA), { maxLineBytes: Infinity, maxBufferBytes: Infinity, maxEventChars: Infinity })),
      collect(parseSseStream(makeStreamFromReader(readerB), { maxLineBytes: Infinity, maxBufferBytes: Infinity, maxEventChars: Infinity })),
    ]);

    expect(eventsA).toEqual([{ event: "message", data: "a", id: null, retry: null }]);
    expect(eventsB).toEqual([{ event: "message", data: "b", id: null, retry: null }]);
  });

  it("processes large event payloads when limits are infinite", async () => {
    const big = "y".repeat(300000);
    const reader = makeReader([{ done: false, value: u8(`data: ${big}\n\n`) }, { done: true }]);
    const stream = makeStreamFromReader(reader);

    const events = await collect(
      parseSseStream(stream, { maxLineBytes: Infinity, maxBufferBytes: Infinity, maxEventChars: Infinity })
    );
    expect(events[0].data.length).toBe(big.length);
  });
});

describe("createSseParser", () => {
  it("parses events from fed text chunks (LF/CRLF) and flush() handles trailing CR", () => {
    const events = [];
    const parser = createSseParser({ onEvent: (evt) => events.push(evt) });

    parser.feed("data: a\n");
    parser.feed("\n");

    parser.feed("data: b\r");
    parser.feed("\n\r\n");

    const parser2Events = [];
    const parser2 = createSseParser({ onEvent: (evt) => parser2Events.push(evt) });
    parser2.feed("data: c\r");
    parser2.flush();

    expect(events).toEqual([
      { event: "message", data: "a", id: null, retry: null },
      { event: "message", data: "b", id: null, retry: null },
    ]);
    expect(parser2Events).toEqual([{ event: "message", data: "c", id: null, retry: null }]);
  });

  it("uses a no-op onEvent when none is provided", () => {
    const parser = createSseParser();
    parser.feed("data: x\n\n");
    parser.flush();
  });

  it("accepts empty/null/undefined/array/object chunks without emitting", () => {
    const events = [];
    const parser = createSseParser({ onEvent: (evt) => events.push(evt) });

    parser.feed("");
    parser.feed("   ");
    parser.feed(null);
    parser.feed(undefined);
    parser.feed([]);
    parser.feed({});
    parser.flush();

    expect(events).toEqual([]);
  });

  it("handles rapid consecutive feeds", () => {
    const events = [];
    const parser = createSseParser({ onEvent: (evt) => events.push(evt) });

    const parts = ["data: 1", "\n", "\n", "data: 2", "\n", "\n", "data: 3", "\n", "\n"];
    for (const part of parts) parser.feed(part);

    expect(events.map((e) => e.data)).toEqual(["1", "2", "3"]);
  });
});

describe("consumeSse", () => {
  it("validates url and fetch availability (including whitespace urls)", async () => {
    await expect(consumeSse()).rejects.toThrow(/url is required/i);

    await expect(
      consumeSse({ fetchImpl: vi.fn(), url: "   ", connectTimeoutMs: 0, onEvent: vi.fn() })
    ).rejects.toThrow(/url is required/i);

    vi.stubGlobal("fetch", undefined);
    await expect(consumeSse({ url: "https://example.com" })).rejects.toThrow(/fetch unavailable/i);
  });

  it("calls fetch with SSE accept header, emits events, and stops on normal EOS", async () => {
    const { stream } = (() => {
      const reader = makeReader([{ done: false, value: u8("data: one\n\n") }, { done: true }]);
      return { stream: makeStreamFromReader(reader), reader };
    })();

    const fetchMock = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? "text/event-stream" : "") },
      body: stream,
      url,
      init,
    }));

    const onEvent = vi.fn();
    await consumeSse({
      fetchImpl: fetchMock,
      url: "https://example.com/sse",
      headers: { "X-Test": "1" },
      connectTimeoutMs: 0,
      readTimeoutMs: 0,
      onEvent,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ Accept: "text/event-stream", "X-Test": "1" });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0]).toEqual({ event: "message", data: "one", id: null, retry: null });
  });

  it("tolerates missing onEvent and non-object headers", async () => {
    const reader = makeReader([{ done: false, value: u8("data: one\n\n") }, { done: true }]);
    const fetchMock = vi.fn(async (_url, init) => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(reader),
      init,
    }));

    await consumeSse({
      fetchImpl: fetchMock,
      url: "https://example.com/sse",
      headers: ["not", "an", "object"],
      connectTimeoutMs: 0,
      readTimeoutMs: 0,
      onEvent: null,
    });

    const init = fetchMock.mock.calls[0][1];
    expect(init.headers).toMatchObject({ Accept: "text/event-stream" });
  });

  it("passes through object headers (including array-like objects)", async () => {
    const reader = makeReader([{ done: false, value: u8("data: ok\n\n") }, { done: true }]);
    const fetchMock = vi.fn(async (_url, init) => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(reader),
      init,
    }));

    await consumeSse({
      fetchImpl: fetchMock,
      url: "https://example.com/sse",
      headers: { "X-Test": "1", length: 1 },
      connectTimeoutMs: 0,
      readTimeoutMs: 0,
      onEvent: vi.fn(),
    });

    const init = fetchMock.mock.calls[0][1];
    expect(init.headers).toMatchObject({ Accept: "text/event-stream", "X-Test": "1", length: 1 });
  });

  it("rejects unexpected HTTP/content-type responses (without reconnect)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      body: makeStreamFromReader(makeReader([{ done: true }])),
    }));

    await expect(
      consumeSse({ fetchImpl: fetchMock, url: "https://example.com/sse", connectTimeoutMs: 0, reconnect: false, onEvent: vi.fn() })
    ).rejects.toThrow(/unexpected content-type/i);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(makeReader([{ done: true }])),
    });
    await expect(
      consumeSse({ fetchImpl: fetchMock, url: "https://example.com/sse", connectTimeoutMs: 0, reconnect: false, onEvent: vi.fn() })
    ).rejects.toThrow(/HTTP 500/i);
  });

  it("aborts and fails the attempt when connectTimeoutMs elapses", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn((_url, init) => {
      return new Promise((_, reject) => {
        init.signal?.addEventListener?.(
          "abort",
          () => {
            reject(new Error(String(init.signal.reason)));
          },
          { once: true }
        );
      });
    });

    const p = consumeSse({
      fetchImpl: fetchMock,
      url: "https://example.com/sse",
      connectTimeoutMs: 5,
      reconnect: false,
      onEvent: null,
    });

    const rejected = expect(p).rejects.toThrow(/connect_timeout/i);
    await vi.advanceTimersByTimeAsync(5);
    await rejected;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reconnects with retry-hint backoff when the stream errors after emitting events", async () => {
    vi.useFakeTimers();

    const onEvent = vi.fn();
    const firstEvent = new Promise((resolve) => {
      onEvent.mockImplementationOnce((evt) => resolve(evt));
    });

    const fetchMock = vi.fn();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(
        makeReader([
          { done: false, value: u8("retry: 11\ndata: first\n\n") },
          { done: false, value: u8("data: " + "x".repeat(30) + "\n") },
          { done: true },
        ])
      ),
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(makeReader([{ done: false, value: u8("data: ok\n\n") }, { done: true }])),
    });

    const p = consumeSse({
      fetchImpl: fetchMock,
      url: "https://example.com/sse",
      connectTimeoutMs: 0,
      readTimeoutMs: 0,
      maxLineBytes: 20,
      reconnectBackoffMs: 1000,
      maxReconnects: 1,
      onEvent,
    });

    const first = await firstEvent;
    expect(first).toMatchObject({ data: "first", retry: 11 });

    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await p;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls.map((c) => c[0]?.data)).toEqual(["first", "ok"]);
  });

  it("reconnects using reconnectBackoffMs when no retry hint is available", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn();
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(makeReader([{ done: false, value: u8("data: ok\n\n") }, { done: true }])),
    });

    const onEvent = vi.fn();
    const p = consumeSse({
      fetchImpl: fetchMock,
      url: "https://example.com/sse",
      connectTimeoutMs: 0,
      readTimeoutMs: 0,
      reconnectBackoffMs: 7,
      maxReconnects: 1,
      onEvent,
    });

    await vi.advanceTimersByTimeAsync(6);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await p;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("retries immediately when backoff is 0", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(makeReader([{ done: false, value: u8("data: ok\n\n") }, { done: true }])),
    });

    const onEvent = vi.fn();
    await consumeSse({
      fetchImpl: fetchMock,
      url: "https://example.com/sse",
      connectTimeoutMs: 0,
      readTimeoutMs: 0,
      reconnectBackoffMs: 0,
      maxReconnects: 1,
      onEvent,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("does not retry when reconnect is disabled (propagates errors)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("net down");
    });

    await expect(
      consumeSse({ fetchImpl: fetchMock, url: "https://example.com/sse", connectTimeoutMs: 0, reconnect: false, onEvent: vi.fn() })
    ).rejects.toThrow(/net down/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry when maxReconnects is zero or negative", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("no retry");
    });

    await expect(
      consumeSse({ fetchImpl: fetchMock, url: "https://example.com/sse", connectTimeoutMs: 0, maxReconnects: -1, onEvent: vi.fn() })
    ).rejects.toThrow(/no retry/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries with MAX_SAFE_INTEGER maxReconnects", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(makeReader([{ done: false, value: u8("data: ok\n\n") }, { done: true }])),
    });

    const onEvent = vi.fn();
    await consumeSse({
      fetchImpl: fetchMock,
      url: "https://example.com/sse",
      connectTimeoutMs: 0,
      readTimeoutMs: 0,
      reconnectBackoffMs: 0,
      maxReconnects: Number.MAX_SAFE_INTEGER,
      onEvent,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("returns immediately when signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort("stop");
    const fetchMock = vi.fn(() => {
      throw new Error("should not fetch");
    });

    await consumeSse({ fetchImpl: fetchMock, url: "https://example.com/sse", connectTimeoutMs: 0, signal: ac.signal, onEvent: vi.fn() });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("supports concurrent consumeSse calls", async () => {
    const fetchA = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(makeReader([{ done: false, value: u8("data: a\n\n") }, { done: true }])),
    }));

    const fetchB = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(makeReader([{ done: false, value: u8("data: b\n\n") }, { done: true }])),
    }));

    const onEventA = vi.fn();
    const onEventB = vi.fn();

    await Promise.all([
      consumeSse({ fetchImpl: fetchA, url: "https://example.com/a", connectTimeoutMs: 0, readTimeoutMs: 0, onEvent: onEventA }),
      consumeSse({ fetchImpl: fetchB, url: "https://example.com/b", connectTimeoutMs: 0, readTimeoutMs: 0, onEvent: onEventB }),
    ]);

    expect(onEventA).toHaveBeenCalledTimes(1);
    expect(onEventB).toHaveBeenCalledTimes(1);
  });
});

describe("consumeSseJson", () => {
  it("parses JSON data per event and ignores invalid JSON payloads", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(
        makeReader([
          { done: false, value: u8('data: {"a":1}\n\ndata: not-json\n\ndata: {"b":2}\n\n') },
          { done: true },
        ])
      ),
    }));

    const onJson = vi.fn();
    const onError = vi.fn();
    await consumeSseJson({ fetchImpl: fetchMock, url: "https://example.com/sse", connectTimeoutMs: 0, onJson, onError });

    expect(onJson).toHaveBeenCalledTimes(2);
    expect(onJson.mock.calls[0][0]).toEqual({ a: 1 });
    expect(onJson.mock.calls[1][0]).toEqual({ b: 2 });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("tolerates missing onJson (no-op) while still consuming the stream", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(makeReader([{ done: false, value: u8('data: {"a":1}\n\n') }, { done: true }])),
    }));

    await consumeSseJson({ fetchImpl: fetchMock, url: "https://example.com/sse", connectTimeoutMs: 0, onJson: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses default logger onError when invalid JSON is encountered", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(makeReader([{ done: false, value: u8("data: nope\n\n") }, { done: true }])),
    }));

    await consumeSseJson({ fetchImpl: fetchMock, url: "https://example.com/sse", connectTimeoutMs: 0 });

    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn.mock.calls[0][0]).toBe("SSE JSON payload rejected");
    expect(mockLoggerWarn.mock.calls[0][1]).toMatchObject({ reason: "invalid_json" });
  });

  it("enforces maxJsonChars limits and reports size errors", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(makeReader([{ done: false, value: u8('data: {"long":123}\n\n') }, { done: true }])),
    }));

    const onError = vi.fn();
    const onJson = vi.fn();
    await consumeSseJson({
      fetchImpl: fetchMock,
      url: "https://example.com/sse",
      connectTimeoutMs: 0,
      maxJsonChars: "5",
      onJson,
      onError,
    });

    expect(onJson).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toMatchObject({ limit: 5 });
  });

  it("rejects messages when validateMessage reports an error", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(makeReader([{ done: false, value: u8('data: {"a":1}\n\n') }, { done: true }])),
    }));

    const onError = vi.fn();
    const onJson = vi.fn();
    await consumeSseJson({
      fetchImpl: fetchMock,
      url: "https://example.com/sse",
      connectTimeoutMs: 0,
      onJson,
      onError,
      validateMessage: () => "schema fail",
    });

    expect(onJson).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toMatchObject({ reason: "schema" });
  });

  it("ignores empty data payloads", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(makeReader([{ done: false, value: u8("data: \n\n") }, { done: true }])),
    }));

    const onJson = vi.fn();
    await consumeSseJson({ fetchImpl: fetchMock, url: "https://example.com/sse", connectTimeoutMs: 0, onJson });

    expect(onJson).not.toHaveBeenCalled();
  });

  it("handles deep nested JSON payloads", async () => {
    const nested = {};
    let cursor = nested;
    for (let i = 0; i < 30; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(makeReader([{ done: false, value: u8(`data: ${JSON.stringify(nested)}\n\n`) }, { done: true }])),
    }));

    const onJson = vi.fn();
    await consumeSseJson({ fetchImpl: fetchMock, url: "https://example.com/sse", connectTimeoutMs: 0, onJson });

    expect(onJson).toHaveBeenCalledTimes(1);
    expect(onJson.mock.calls[0][0]).toEqual(nested);
  });

  it("supports concurrent consumeSseJson calls", async () => {
    const fetchA = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(makeReader([{ done: false, value: u8('data: {"a":1}\n\n') }, { done: true }])),
    }));

    const fetchB = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: makeStreamFromReader(makeReader([{ done: false, value: u8('data: {"b":2}\n\n') }, { done: true }])),
    }));

    const onJsonA = vi.fn();
    const onJsonB = vi.fn();

    await Promise.all([
      consumeSseJson({ fetchImpl: fetchA, url: "https://example.com/a", connectTimeoutMs: 0, onJson: onJsonA }),
      consumeSseJson({ fetchImpl: fetchB, url: "https://example.com/b", connectTimeoutMs: 0, onJson: onJsonB }),
    ]);

    expect(onJsonA).toHaveBeenCalledTimes(1);
    expect(onJsonB).toHaveBeenCalledTimes(1);
  });
});

describe("default export", () => {
  it("exposes the public API", () => {
    expect(sseDefault).toMatchObject({
      createSseParser,
      consumeSse,
      consumeSseJson,
      parseSseStream,
      SseDecoder,
      NewlineDecoder,
    });
  });
});
