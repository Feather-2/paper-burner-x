import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSseParser,
  consumeSse,
  consumeSseJson,
  NewlineDecoder,
  parseSseStream,
  SseDecoder,
} from '../../../../js/agents/mcp/sse.js';

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

describe("mcp/sse", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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

      // event resets per-message; id/retry persist per spec.
      expect(d.decode("data: x")).toBeNull();
      const evt2 = d.decode("");
      expect(evt2).toEqual({ event: "message", data: "x", id: "123", retry: 2000 });
    });

    it("returns null on blank lines when there is no buffered event data", () => {
      const d = new SseDecoder();
      expect(d.decode("")).toBeNull();
      expect(d.decode("   ")).toBeNull();
    });

    it("handles lines without ':' and flushes the last event", () => {
      const d = new SseDecoder();
      // splitFirst() no-separator path
      d.decode("event");
      d.decode("data");
      const evt = d.flush();
      expect(evt).toEqual({ event: "message", data: "", id: null, retry: null });
    });

    it("ignores unknown fields and invalid retry values; supports id reset via empty id", () => {
      const d = new SseDecoder();

      // valueRaw without leading space.
      d.decode("event:update");
      d.decode("foo: bar"); // unknown field (no-op)
      d.decode("retry: -1"); // invalid (ignored)

      d.decode("id: abc");
      d.decode("data: hello");
      expect(d.decode("")).toMatchObject({ event: "update", data: "hello", id: "abc", retry: null });

      // Empty id resets to null (but retry/id still persist across events in general).
      d.decode("id:");
      d.decode("data: x");
      expect(d.decode("")).toMatchObject({ id: null, data: "x" });
    });

    it("enforces maxEventChars", () => {
      const d = new SseDecoder({ maxEventChars: 5 });
      expect(() => d.decode("data: 12345")).toThrow(/maxEventChars/i);
      try {
        d.decode("data: 12345");
      } catch (e) {
        expect(e).toMatchObject({ name: "SseSizeLimitError", code: "SSE_EVENT_LIMIT" });
      }
    });
  });

  describe("NewlineDecoder", () => {
    it("splits LF, CRLF (including across chunk boundaries), and bare CR", () => {
      const nd = new NewlineDecoder();

      expect(nd.decode(u8("a\nb\n"))).toEqual(["a", "b"]);
      expect(nd.flush()).toEqual([]);

      // CRLF across chunk boundary.
      expect(nd.decode(u8("x\r"))).toEqual([]);
      expect(nd.decode(u8("\n"))).toEqual(["x"]);
      expect(nd.flush()).toEqual([]);

      // Bare CR treated as newline.
      expect(nd.decode(u8("y\rz"))).toEqual(["y"]);
      expect(nd.flush()).toEqual(["z"]);
    });

    it("treats non-Uint8Array chunks as empty input and tolerates empty chunks", () => {
      const nd = new NewlineDecoder();
      expect(nd.decode("not-bytes")).toEqual([]);
      expect(nd.decode(new Uint8Array())).toEqual([]);
    });

    it("enforces maxBufferBytes and maxLineBytes", () => {
      const bufferLimited = new NewlineDecoder({ maxBufferBytes: 3 });
      expect(() => bufferLimited.decode(u8("abcd"))).toThrow(/maxBufferBytes/i);
      try {
        bufferLimited.decode(u8("abcd"));
      } catch (e) {
        expect(e).toMatchObject({ name: "SseSizeLimitError", code: "SSE_BUFFER_LIMIT" });
      }

      const lineLimited = new NewlineDecoder({ maxLineBytes: 2 });
      expect(() => lineLimited.decode(u8("abc\n"))).toThrow(/maxLineBytes/i);

      const flushLimited = new NewlineDecoder({ maxLineBytes: 2 });
      flushLimited.decode(u8("abc"));
      expect(() => flushLimited.flush()).toThrow(/maxLineBytes/i);
    });
  });

  describe("parseSseStream", () => {
    it("yields events, skips falsy chunks, and flushes a final unterminated event on EOS", async () => {
      const reader = makeReader([
        { done: false, value: undefined }, // covers `if (!value) continue`
        { done: false, value: u8("data: one\n\n") },
        { done: false, value: u8("data: last") }, // no trailing newline; should be flushed
        { done: true, value: undefined },
      ]);
      const stream = makeStreamFromReader(reader);

      const events = await collect(parseSseStream(stream, { maxLineBytes: Infinity, maxBufferBytes: Infinity, maxEventChars: Infinity }));
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
        read: vi.fn(() => new Promise(() => {})), // never resolves
        cancel: vi.fn(async () => {}),
        releaseLock: vi.fn(),
      };
      const stream = makeStreamFromReader(reader);

      const it = parseSseStream(stream, { readTimeoutMs: 10 });
      const next = it.next();

      // Attach the rejection assertion before we advance timers to avoid unhandled rejection warnings.
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

    it("uses a no-op onEvent when none is provided (still parses/flushes without throwing)", () => {
      const parser = createSseParser();
      parser.feed("data: x\n\n");
      parser.flush();
    });
  });

  describe("consumeSse", () => {
    it("validates url and fetch availability", async () => {
      await expect(consumeSse()).rejects.toThrow(/url is required/i);

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

    it("tolerates missing onEvent (no-op) and non-object headers", async () => {
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
        // Simulate a fetch that only fails when aborted.
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

      // First attempt: emit one event (with retry hint), then trigger a line-size error.
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => "text/event-stream" },
        body: makeStreamFromReader(
          makeReader([
            {
              done: false,
              value: u8("retry: 11\ndata: first\n\n"),
            },
            { done: false, value: u8("data: " + "x".repeat(30) + "\n") },
            { done: true },
          ])
        ),
      });

      // Second attempt: succeed and end normally.
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
        reconnectBackoffMs: 1000, // should be ignored due to retry: 11
        maxReconnects: 1,
        onEvent,
      });

      const first = await firstEvent;
      expect(first).toMatchObject({ data: "first", retry: 11 });

      // Let the stream error propagate into consumeSse's retry path (sleep/backoff).
      await Promise.resolve();

      // Not enough time for the 11ms retry-hint backoff.
      await vi.advanceTimersByTimeAsync(10);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Backoff elapses -> reconnect attempt.
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

      // Not enough time for the 7ms backoff.
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

    it("returns immediately when signal is already aborted", async () => {
      const ac = new AbortController();
      ac.abort("stop");
      const fetchMock = vi.fn(() => {
        throw new Error("should not fetch");
      });

      await consumeSse({ fetchImpl: fetchMock, url: "https://example.com/sse", connectTimeoutMs: 0, signal: ac.signal, onEvent: vi.fn() });
      expect(fetchMock).not.toHaveBeenCalled();
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
            {
              done: false,
              value: u8('data: {"a":1}\n\ndata: not-json\n\ndata: {"b":2}\n\n'),
            },
            { done: true },
          ])
        ),
      }));

      const onJson = vi.fn();
      await consumeSseJson({ fetchImpl: fetchMock, url: "https://example.com/sse", connectTimeoutMs: 0, onJson });

      expect(onJson).toHaveBeenCalledTimes(2);
      expect(onJson.mock.calls[0][0]).toEqual({ a: 1 });
      expect(onJson.mock.calls[1][0]).toEqual({ b: 2 });
      expect(onJson.mock.calls[0][1]).toMatchObject({ event: "message" });
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
  });
});
