import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockedCreateLogger = vi.hoisted(() => vi.fn(() => mockedLogger));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: mockedCreateLogger,
}));

import {
  SpanStatus,
  SpanKind,
  Span,
  TraceContext,
  generateTraceId,
  generateSpanId,
  withSpan,
} from "../../../../../js/agents/plugins/telemetry/trace-context.js";

const TRACE_ID = "a".repeat(32);
const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_16 = /^[0-9a-f]{16}$/;

function buildDeepObject(depth) {
  let node = { level: depth };
  for (let i = depth - 1; i >= 0; i -= 1) {
    node = { level: i, child: node };
  }
  return node;
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("SpanStatus", () => {
  it("exposes frozen status values", () => {
    expect(SpanStatus).toEqual({
      OK: "ok",
      ERROR: "error",
      UNSET: "unset",
    });
    expect(Object.isFrozen(SpanStatus)).toBe(true);
  });
});

describe("SpanKind", () => {
  it("exposes frozen kind values", () => {
    expect(SpanKind).toEqual({
      INTERNAL: "internal",
      CLIENT: "client",
      SERVER: "server",
      PRODUCER: "producer",
      CONSUMER: "consumer",
    });
    expect(Object.isFrozen(SpanKind)).toBe(true);
  });
});

describe("generateTraceId", () => {
  it("returns 32 hex chars when crypto is unavailable", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      const id = generateTraceId();
      expect(id).toMatch(HEX_32);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        "WebCrypto unavailable, trace IDs use reduced-entropy fallback",
        expect.objectContaining({ mode: "math-random" }),
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "crypto", originalDescriptor);
      }
    }
  });

  it("handles rapid consecutive calls", () => {
    const ids = Array.from({ length: 20 }, () => generateTraceId());
    expect(ids.every((id) => HEX_32.test(id))).toBe(true);
  });
});

describe("generateSpanId", () => {
  it("returns 16 hex chars", () => {
    expect(generateSpanId()).toMatch(HEX_16);
  });

  it("supports concurrent calls", async () => {
    const ids = await Promise.all(
      Array.from({ length: 10 }, () => Promise.resolve(generateSpanId())),
    );
    expect(ids.every((id) => HEX_16.test(id))).toBe(true);
  });
});

describe("Span", () => {
  it("initializes defaults and filters unsafe attributes", () => {
    const deepNested = buildDeepObject(12);
    const largePayload = "x".repeat(200000);
    const attributes = Object.create(null);
    attributes.safe = "value";
    attributes.nested = deepNested;
    attributes.file = largePayload;
    attributes["__proto__"] = "polluted";
    attributes.constructor = "bad";
    attributes.prototype = "bad";

    const span = new Span({
      name: `span-${"y".repeat(10000)}`,
      traceId: TRACE_ID,
      attributes,
    });

    expect(span.traceId).toBe(TRACE_ID);
    expect(span.parentSpanId).toBeNull();
    expect(span.kind).toBe(SpanKind.INTERNAL);
    expect(span.status).toBe(SpanStatus.UNSET);
    expect(span.events).toEqual([]);
    expect(span.spanId).toMatch(HEX_16);

    expect(span.attributes.safe).toBe("value");
    expect(span.attributes.nested).toBe(deepNested);
    expect(span.attributes.file).toBe(largePayload);
    expect(Object.prototype.hasOwnProperty.call(span.attributes, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(span.attributes, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(span.attributes, "prototype")).toBe(false);
  });

  it("accepts empty name and empty attribute object", () => {
    const span = new Span({ name: "", traceId: TRACE_ID, attributes: {} });
    expect(span.name).toBe("");
    expect(Object.keys(span.attributes)).toEqual([]);
  });

  it("setAttribute handles boundary values and ignores updates after end", () => {
    const span = new Span({ name: "numbers", traceId: TRACE_ID });

    expect(span.setAttribute("", "blank")).toBe(span);
    span.setAttribute("zero", 0);
    span.setAttribute("neg", -1);
    span.setAttribute("max", Number.MAX_SAFE_INTEGER);
    span.setAttribute("constructor", "blocked");

    expect(span.attributes[""]).toBe("blank");
    expect(span.attributes.zero).toBe(0);
    expect(span.attributes.neg).toBe(-1);
    expect(span.attributes.max).toBe(Number.MAX_SAFE_INTEGER);
    expect(Object.prototype.hasOwnProperty.call(span.attributes, "constructor")).toBe(false);

    span.end();
    span.setAttribute("after", "ignored");
    expect(Object.prototype.hasOwnProperty.call(span.attributes, "after")).toBe(false);
  });

  it("setAttributes handles null, undefined, empty array, and array-like objects", () => {
    const span = new Span({ name: "attrs", traceId: TRACE_ID });

    span.setAttributes(null);
    span.setAttributes(undefined);
    span.setAttributes([]);
    expect(Object.keys(span.attributes)).toEqual([]);

    const arrayLike = { 0: "zero", 1: "one", length: 2 };
    span.setAttributes(arrayLike);
    expect(span.attributes["0"]).toBe("zero");
    expect(span.attributes["1"]).toBe("one");
    expect(span.attributes.length).toBe(2);
  });

  it("addEvent records events and ignores after end, preserving whitespace names", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);

    try {
      const span = new Span({ name: "events", traceId: TRACE_ID });
      span.addEvent("   ", { count: 1 });

      expect(span.events).toHaveLength(1);
      expect(span.events[0]).toEqual({
        name: "   ",
        ts: 1000,
        attributes: { count: 1 },
      });

      span.end();
      span.addEvent("ignored", { count: 2 });
      expect(span.events).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("setStatus handles empty message and does not update after end", () => {
    const span = new Span({ name: "status", traceId: TRACE_ID });

    span.setStatus(SpanStatus.ERROR, "");
    expect(span.status).toBe(SpanStatus.ERROR);
    expect(span.statusMessage).toBeNull();

    span.end();
    span.setStatus(SpanStatus.OK, "late");
    expect(span.status).toBe(SpanStatus.ERROR);
    expect(span.statusMessage).toBeNull();
  });

  it("recordException populates event fields and handles null input", () => {
    const span = new Span({ name: "exception", traceId: TRACE_ID });
    const error = new Error("boom");

    span.recordException(error);
    expect(span.status).toBe(SpanStatus.ERROR);
    expect(span.statusMessage).toBe("boom");
    expect(span.events[0].attributes["exception.type"]).toBe("Error");
    expect(span.events[0].attributes["exception.message"]).toBe("boom");

    const spanWithNull = new Span({ name: "null-error", traceId: TRACE_ID });
    spanWithNull.recordException(null);
    expect(spanWithNull.status).toBe(SpanStatus.ERROR);
    expect(spanWithNull.events[0].attributes["exception.type"]).toBe("Error");
    expect(spanWithNull.events[0].attributes["exception.message"]).toBe("null");
  });

  it("end sets endTime once, defaults status, and duration uses endTime", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);

    try {
      const span = new Span({ name: "timing", traceId: TRACE_ID });

      vi.setSystemTime(1800);
      span.end();
      const firstEndTime = span.endTime;

      vi.setSystemTime(2200);
      span.end();

      expect(span.endTime).toBe(firstEndTime);
      expect(span.status).toBe(SpanStatus.OK);
      expect(span.duration).toBe(800);
    } finally {
      vi.useRealTimers();
    }
  });

  it("traceparent includes version, traceId, spanId, and flags", () => {
    const span = new Span({ name: "traceparent", traceId: TRACE_ID });
    expect(span.traceparent).toBe(`00-${TRACE_ID}-${span.spanId}-01`);
  });

  it("toJSON returns a serializable snapshot", () => {
    const span = new Span({ name: "json", traceId: TRACE_ID });
    span.setAttribute("key", "value");
    span.addEvent("event");
    span.end();

    const json = span.toJSON();

    expect(json).toEqual({
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: null,
      name: "json",
      kind: SpanKind.INTERNAL,
      startTime: span.startTime,
      endTime: span.endTime,
      duration: span.duration,
      status: span.status,
      statusMessage: span.statusMessage,
      attributes: span.attributes,
      events: span.events,
    });
  });
});

describe("TraceContext", () => {
  it("constructs with defaults and optional settings", () => {
    const ctx = new TraceContext({
      traceId: TRACE_ID,
      parentSpanId: "root",
      onSpanEnd: "not-fn",
      maxSpans: 5,
    });

    expect(ctx.traceId).toBe(TRACE_ID);
    expect(ctx._rootSpanId).toBe("root");
    expect(ctx._onSpanEnd).toBeNull();
    expect(ctx._maxSpans).toBe(5);

    const defaultCtx = new TraceContext();
    expect(defaultCtx.traceId).toMatch(HEX_32);
    expect(defaultCtx._rootSpanId).toBeNull();
    expect(defaultCtx._maxSpans).toBe(1000);
  });

  it("startSpan selects parent spans and logs", () => {
    const ctx = new TraceContext({ parentSpanId: "root" });

    const root = ctx.startSpan("root");
    const child = ctx.startSpan("child");
    const explicit = ctx.startSpan("explicit", { parentSpan: root });

    expect(root.parentSpanId).toBe("root");
    expect(child.parentSpanId).toBe(root.spanId);
    expect(explicit.parentSpanId).toBe(root.spanId);
    expect(mockedLogger.info).toHaveBeenCalledTimes(3);
  });

  it("createSpan delegates to startSpan", () => {
    const ctx = new TraceContext();
    const spy = vi.spyOn(ctx, "startSpan");

    const span = ctx.createSpan("alias");

    expect(spy).toHaveBeenCalledWith("alias", {});
    expect(span).toBeInstanceOf(Span);
  });

  it("endSpan ends spans, updates stack, and handles empty stack", () => {
    const onSpanEnd = vi.fn();
    const ctx = new TraceContext({ onSpanEnd });

    const span1 = ctx.startSpan("one");
    const span2 = ctx.startSpan("two");

    ctx.endSpan(span1);
    expect(span1.isEnded).toBe(true);
    expect(ctx._spanStack).toEqual([span2]);

    ctx.endSpan();
    expect(span2.isEnded).toBe(true);
    expect(ctx.currentSpan).toBeNull();
    expect(onSpanEnd).toHaveBeenCalledTimes(2);

    expect(() => ctx.endSpan()).not.toThrow();
  });

  it("withSpan resolves results, sets status ok, and ends spans", async () => {
    const onSpanEnd = vi.fn();
    const ctx = new TraceContext({ onSpanEnd });

    const result = await ctx.withSpan("work", (span) => {
      span.setAttribute("value", 0);
      return "done";
    });

    expect(result).toBe("done");
    const endedSpan = onSpanEnd.mock.calls[0][0];
    expect(endedSpan.isEnded).toBe(true);
    expect(endedSpan.status).toBe(SpanStatus.OK);
    expect(endedSpan.attributes.value).toBe(0);
  });

  it("withSpan records exceptions and rethrows", async () => {
    const onSpanEnd = vi.fn();
    const ctx = new TraceContext({ onSpanEnd });

    await expect(
      ctx.withSpan("fail", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const endedSpan = onSpanEnd.mock.calls[0][0];
    expect(endedSpan.status).toBe(SpanStatus.ERROR);
    expect(endedSpan.events[0].name).toBe("exception");
  });

  it("supports concurrent spans", async () => {
    const onSpanEnd = vi.fn();
    const ctx = new TraceContext({ onSpanEnd });

    const [a, b] = await Promise.all([
      ctx.withSpan("a", async (span) => {
        span.setAttribute("tag", "a");
        return "A";
      }),
      ctx.withSpan("b", async (span) => {
        span.setAttribute("tag", "b");
        return "B";
      }),
    ]);

    expect([a, b]).toEqual(["A", "B"]);
    expect(onSpanEnd).toHaveBeenCalledTimes(2);
    expect(ctx.getSpans()).toHaveLength(2);
  });

  it("getSpans and getSpanTree return structured data", () => {
    const ctx = new TraceContext();
    const root = ctx.startSpan("root");
    ctx.startSpan("child");
    ctx.endSpan();
    ctx.endSpan(root);

    const spans = ctx.getSpans();
    expect(spans).toHaveLength(2);
    expect(spans[0]).toHaveProperty("traceId", ctx.traceId);

    const tree = ctx.getSpanTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe("child");
  });

  it("getTraceparent uses current span or generates new", () => {
    const ctx = new TraceContext();
    const span = ctx.startSpan("active");

    expect(ctx.getTraceparent()).toBe(span.traceparent);

    ctx.endSpan(span);
    const traceparent = ctx.getTraceparent();
    expect(traceparent).toMatch(new RegExp(`^00-${ctx.traceId}-[0-9a-f]{16}-01$`));
  });

  it("parseTraceparent validates inputs", () => {
    expect(TraceContext.parseTraceparent(null)).toBeNull();
    expect(TraceContext.parseTraceparent(undefined)).toBeNull();
    expect(TraceContext.parseTraceparent("")).toBeNull();
    expect(TraceContext.parseTraceparent("   ")).toBeNull();
    expect(TraceContext.parseTraceparent("00-123-456-01")).toBeNull();
    expect(
      TraceContext.parseTraceparent(`ff-${TRACE_ID}-${"b".repeat(16)}-01`),
    ).toBeNull();

    const parsed = TraceContext.parseTraceparent(`00-${TRACE_ID}-${"b".repeat(16)}-01`);
    expect(parsed).toEqual({
      version: "00",
      traceId: TRACE_ID,
      spanId: "b".repeat(16),
      sampled: true,
    });
  });

  it("stats summarizes span counts and durations", () => {
    const ctx = new TraceContext();
    const nowSpy = vi.spyOn(Date, "now");

    nowSpy
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1100)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(2600);

    const span1 = ctx.startSpan("one");
    ctx.endSpan(span1);
    const span2 = ctx.startSpan("two");
    ctx.endSpan(span2);

    const stats = ctx.stats;
    expect(stats.totalSpans).toBe(2);
    expect(stats.activeSpans).toBe(0);
    expect(stats.completedSpans).toBe(2);
    expect(stats.errorSpans).toBe(0);
    expect(stats.avgDuration).toBe(350);

    nowSpy.mockRestore();
  });

  it("trims ended spans when maxSpans is a numeric string", () => {
    const ctx = new TraceContext({ maxSpans: "5" });

    for (let i = 0; i < 5; i += 1) {
      const span = ctx.startSpan(`span-${i}`);
      ctx.endSpan(span);
    }

    const active = ctx.startSpan("overflow");
    const spans = ctx.getSpans();

    expect(spans).toHaveLength(5);
    expect(spans.some((span) => span.spanId === active.spanId)).toBe(true);
  });

  it("reset clears spans and stack", () => {
    const ctx = new TraceContext();
    ctx.startSpan("work");

    ctx.reset();

    expect(ctx.getSpans()).toEqual([]);
    expect(ctx.currentSpan).toBeNull();
  });
});

describe("withSpan", () => {
  it("runs fn with null span when context is missing", async () => {
    const fn = vi.fn((span) => ({ span }));
    const result = await withSpan(null, "", fn);

    expect(result).toEqual({ span: null });
    expect(fn).toHaveBeenCalledWith(null);
  });

  it("delegates to traceContext.withSpan when available", async () => {
    const traceContext = {
      withSpan: vi.fn().mockResolvedValue("ok"),
    };

    const result = await withSpan(traceContext, "name", () => "ignored", { kind: "client" });

    expect(result).toBe("ok");
    expect(traceContext.withSpan).toHaveBeenCalledWith("name", expect.any(Function), {
      kind: "client",
    });
  });

  it("propagates errors when no context exists", async () => {
    await expect(
      withSpan(undefined, "fail", () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
  });
});
