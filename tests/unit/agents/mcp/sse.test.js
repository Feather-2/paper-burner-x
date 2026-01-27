import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/shared/index.js", () => {
  const toNonEmptyString = vi.fn((value) => {
    const s = typeof value === "string" ? value : String(value ?? "");
    const trimmed = s.trim();
    return trimmed.length ? trimmed : "";
  });

  const toPositiveInt = vi.fn((value, fallback = 0) => {
    const raw = typeof value === "string" ? value.trim() : value;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.floor(n);
  });

  const createLogger = vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }));

  return { createLogger, toNonEmptyString, toPositiveInt };
});

import { SseDecoder } from "../../../../js/agents/mcp/sse.js";

describe("SseDecoder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches an event when given a blank delimiter (including null/undefined/whitespace/empty array)", () => {
    const delimiters = ["", "   ", null, undefined, []];

    for (const delimiter of delimiters) {
      const decoder = new SseDecoder();
      decoder.decode("data: hello");
      const evt = decoder.decode(delimiter);

      expect(evt).toEqual({
        event: "message",
        data: "hello",
        id: null,
        retry: null,
      });
    }
  });

  it("returns null for a blank delimiter when no data is buffered, and clears pending event type", () => {
    const decoder = new SseDecoder();

    decoder.decode("event: ping");
    expect(decoder.decode("")).toBeNull();

    decoder.decode("data: ok");
    expect(decoder.decode("")).toEqual({
      event: "message",
      data: "ok",
      id: null,
      retry: null,
    });
  });

  it("supports multi-line data and preserves ':' inside values", () => {
    const decoder = new SseDecoder();

    decoder.decode("data: first");
    decoder.decode("data: second:part");
    const evt = decoder.decode("");

    expect(evt).toEqual({
      event: "message",
      data: "first\nsecond:part",
      id: null,
      retry: null,
    });
  });

  it("treats 'data' lines without ':' as empty values", () => {
    const decoder = new SseDecoder();

    decoder.decode("data");
    const evt = decoder.decode("");

    expect(evt).toEqual({
      event: "message",
      data: "",
      id: null,
      retry: null,
    });
  });

  it("ignores comment lines and unknown fields without affecting buffered data", () => {
    const decoder = new SseDecoder();

    decoder.decode("data: a");
    expect(decoder.decode(": keep-alive")).toBeNull();
    decoder.decode("foo: bar");
    decoder.decode("data: b");

    expect(decoder.decode("")).toEqual({
      event: "message",
      data: "a\nb",
      id: null,
      retry: null,
    });
  });

  it("parses event type, defaults to 'message' when empty/whitespace, and resets per event", () => {
    const decoder = new SseDecoder();

    decoder.decode("event: update");
    decoder.decode("data: one");
    expect(decoder.decode("")).toEqual({
      event: "update",
      data: "one",
      id: null,
      retry: null,
    });

    decoder.decode("event:   ");
    decoder.decode("data: two");
    expect(decoder.decode("")).toEqual({
      event: "message",
      data: "two",
      id: null,
      retry: null,
    });

    decoder.decode("data: three");
    expect(decoder.decode("")).toEqual({
      event: "message",
      data: "three",
      id: null,
      retry: null,
    });
  });

  it("persists id and retry across events (including after empty dispatch), and allows clearing id", () => {
    const decoder = new SseDecoder();

    decoder.decode("id: 0");
    decoder.decode("retry: 1500");
    expect(decoder.decode("")).toBeNull();

    decoder.decode("data: one");
    expect(decoder.decode("")).toEqual({
      event: "message",
      data: "one",
      id: "0",
      retry: 1500,
    });

    decoder.decode("data: two");
    expect(decoder.decode("")).toEqual({
      event: "message",
      data: "two",
      id: "0",
      retry: 1500,
    });

    decoder.decode("id:");
    decoder.decode("data: three");
    expect(decoder.decode("")).toEqual({
      event: "message",
      data: "three",
      id: null,
      retry: 1500,
    });
  });

  it("parses retry as a non-negative integer and ignores invalid/negative updates", () => {
    const decoder = new SseDecoder();

    decoder.decode("retry: 10.9");
    decoder.decode("data: a");
    expect(decoder.decode("")).toEqual({
      event: "message",
      data: "a",
      id: null,
      retry: 10,
    });

    decoder.decode("retry: -1");
    decoder.decode("data: b");
    expect(decoder.decode("")).toEqual({
      event: "message",
      data: "b",
      id: null,
      retry: 10,
    });

    decoder.decode("retry: not-a-number");
    decoder.decode("data: c");
    expect(decoder.decode("")).toEqual({
      event: "message",
      data: "c",
      id: null,
      retry: 10,
    });

    decoder.decode("retry: 0");
    decoder.decode("data: d");
    expect(decoder.decode("")).toEqual({
      event: "message",
      data: "d",
      id: null,
      retry: 0,
    });
  });

  it("strips exactly one leading space from the value after ':'", () => {
    const decoder = new SseDecoder();

    decoder.decode("data:  x");
    const evt = decoder.decode("");

    expect(evt).toEqual({
      event: "message",
      data: " x",
      id: null,
      retry: null,
    });
  });

  it("enforces maxEventChars (including string input) and throws a typed error without corrupting buffered data", () => {
    const decoder = new SseDecoder({ maxEventChars: "5" });

    decoder.decode("data: 1234"); // 4 + newline => 5 (ok)

    let thrown = null;
    try {
      decoder.decode("data:");
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      name: "SseSizeLimitError",
      code: "SSE_EVENT_LIMIT",
    });
    expect(thrown.message).toContain("maxEventChars");
    expect(thrown.message).toContain("(5)");

    expect(decoder.decode("")).toEqual({
      event: "message",
      data: "1234",
      id: null,
      retry: null,
    });

    decoder.decode("data: ok");
    expect(decoder.decode("")).toEqual({
      event: "message",
      data: "ok",
      id: null,
      retry: null,
    });
  });

  it("treats non-positive or non-numeric maxEventChars as unlimited (boundary values)", () => {
    const cases = [
      0,
      -1,
      "",
      "   ",
      null,
      undefined,
      {},
      Infinity,
      Number.MAX_SAFE_INTEGER,
    ];

    const big = "a".repeat(10_000);

    for (const maxEventChars of cases) {
      const decoder = new SseDecoder({ maxEventChars });
      decoder.decode(`data: ${big}`);
      const evt = decoder.decode("");

      expect(evt).toEqual({
        event: "message",
        data: big,
        id: null,
        retry: null,
      });
    }
  });

  it("handles very large data payloads when unlimited (resource boundary)", () => {
    const decoder = new SseDecoder({ maxEventChars: 0 });
    const big = "x".repeat(200_000);

    decoder.decode(`data: ${big}`);
    const evt = decoder.decode("");

    expect(evt.event).toBe("message");
    expect(evt.data).toBe(big);
    expect(evt.data.length).toBe(200_000);
  });

  it("decodes many sequential events without leaking state (rapid consecutive calls)", () => {
    const decoder = new SseDecoder();

    for (let i = 0; i < 50; i++) {
      decoder.decode(`data: ${i}`);
      const evt = decoder.decode("");
      expect(evt).toEqual({
        event: "message",
        data: String(i),
        id: null,
        retry: null,
      });
    }
  });

  it("can be used concurrently across independent instances (simultaneous calls)", async () => {
    const d1 = new SseDecoder();
    const d2 = new SseDecoder();

    const [e1, e2] = await Promise.all([
      Promise.resolve().then(() => {
        d1.decode("id: a");
        d1.decode("data: one");
        return d1.decode("");
      }),
      Promise.resolve().then(() => {
        d2.decode("id: b");
        d2.decode("data: two");
        return d2.decode("");
      }),
    ]);

    expect(e1).toEqual({
      event: "message",
      data: "one",
      id: "a",
      retry: null,
    });
    expect(e2).toEqual({
      event: "message",
      data: "two",
      id: "b",
      retry: null,
    });
  });

  it("handles deeply nested and non-string inputs via string coercion (type/resource boundary)", () => {
    const deepNest = (value, depth) => {
      let v = value;
      for (let i = 0; i < depth; i++) v = [v];
      return v;
    };

    const decoder1 = new SseDecoder();
    decoder1.decode(deepNest("data: deep", 200));
    expect(decoder1.decode("")).toEqual({
      event: "message",
      data: "deep",
      id: null,
      retry: null,
    });

    const decoder2 = new SseDecoder();
    decoder2.decode({ toString: () => "data: obj" });
    expect(decoder2.decode("")).toEqual({
      event: "message",
      data: "obj",
      id: null,
      retry: null,
    });

    const decoder3 = new SseDecoder();
    expect(decoder3.decode({})).toBeNull();
    expect(decoder3.decode("")).toBeNull();
  });
});