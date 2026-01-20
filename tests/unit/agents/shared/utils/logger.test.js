import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const consoleMocks = vi.hoisted(() => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("node:console", () => ({
  default: {
    log: consoleMocks.log,
    warn: consoleMocks.warn,
    error: consoleMocks.error,
  },
}));

import consoleModule from "node:console";
import { createLogger, useLogger, trackToolCall, logEvent } from "../../../../../js/agents/shared/utils/logger.js";

const originalConsole = globalThis.console;
const mockedConsole = consoleModule;

beforeEach(() => {
  globalThis.console = mockedConsole;
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.console = originalConsole;
  vi.restoreAllMocks();
});

describe("createLogger", () => {
  it("supports string stage options with default actor", () => {
    const logger = createLogger("  stage-x  ");

    logger.info("hello");

    expect(consoleMocks.log).toHaveBeenCalledWith("[agent:stage-x]", "hello", {});
  });

  it("emits payload with context and stage override", () => {
    const emit = vi.fn();
    const getContext = vi.fn(() => ({ runId: "run-1", stage: "old", nested: { a: 1 } }));
    const logger = createLogger({ emit, getContext, actor: "alpha", stage: "  main  " });

    logger.info("hello", { extra: "x" });

    expect(getContext).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);

    const [event, payload, meta] = emit.mock.calls[0];
    expect(event).toBe("alpha:log");
    expect(payload).toEqual(
      expect.objectContaining({
        level: "info",
        message: "hello",
        stage: "main",
        runId: "run-1",
        nested: { a: 1 },
        extra: "x",
      })
    );
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
    expect(meta).toEqual({ status: "info" });
    expect(consoleMocks.log).toHaveBeenCalledWith("[alpha:main]", "hello", { extra: "x" });
  });

  it("marks error status and uses console.error", () => {
    const emit = vi.fn();
    const logger = createLogger({ emit, actor: "ops", stage: "prod" });

    logger.error("boom", { code: 500 });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][2]).toEqual({ status: "failed" });
    expect(consoleMocks.error).toHaveBeenCalledWith("[ops:prod]", "boom", { code: 500 });
  });

  it("skips logging when disabled", () => {
    const emit = vi.fn();
    const logger = createLogger({ emit, enabled: 0, actor: "silent", stage: "muted" });

    logger.warn("quiet", { ok: false });

    expect(emit).not.toHaveBeenCalled();
    expect(consoleMocks.warn).not.toHaveBeenCalled();
  });

  it("ignores non-object context/data and uses default stage marker", () => {
    const emit = vi.fn();
    const getContext = vi.fn(() => "not-object");
    const logger = createLogger({ emit, getContext, actor: "tester", stage: "   " });

    logger.warn("msg", "payload");

    expect(getContext).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);

    const payload = emit.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(["level", "message", "timestamp"].sort());
    expect(consoleMocks.warn).toHaveBeenCalledWith("[tester:?]", "msg", "payload");
  });

  it("handles boundary message values", () => {
    const emit = vi.fn();
    const logger = createLogger({ emit, actor: "edge", stage: "edge" });
    const values = [
      null,
      undefined,
      "",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "   ",
      "123",
    ];

    for (const value of values) {
      logger.debug(value, { value });
    }

    expect(emit).toHaveBeenCalledTimes(values.length);
    const messages = emit.mock.calls.map((call) => call[1].message);
    expect(messages).toEqual(values);
    expect(consoleMocks.log).toHaveBeenCalledTimes(values.length);
  });

  it("merges array-like data and deep nested payloads", () => {
    const emit = vi.fn();
    const logger = createLogger({ emit, actor: "merge", stage: "merge" });
    const arrayLike = { 0: "a", length: 1 };

    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 20; i += 1) {
      cursor.level = i;
      cursor.child = {};
      cursor = cursor.child;
    }

    logger.info("array-like", arrayLike);
    logger.info("deep", { deep });

    const arrayPayload = emit.mock.calls[0][1];
    expect(arrayPayload["0"]).toBe("a");
    expect(arrayPayload.length).toBe(1);

    const deepPayload = emit.mock.calls[1][1];
    expect(deepPayload.deep).toBe(deep);
  });

  it("handles large payloads without throwing", () => {
    const emit = vi.fn();
    const logger = createLogger({ emit, actor: "big", stage: "big" });
    const hugeString = "x".repeat(100000);

    expect(() => logger.info(hugeString, { blob: hugeString })).not.toThrow();

    expect(emit).toHaveBeenCalledTimes(1);
    const payload = emit.mock.calls[0][1];
    expect(payload.message).toBe(hugeString);
    expect(payload.blob).toBe(hugeString);
  });

  it("handles rapid consecutive and concurrent calls", async () => {
    const emit = vi.fn();
    const logger = createLogger({ emit, actor: "burst", stage: "burst" });

    for (let i = 0; i < 20; i += 1) {
      logger.debug(`sync-${i}`, { i });
    }

    const tasks = Array.from({ length: 10 }, (_value, i) =>
      Promise.resolve().then(() => logger.info(`async-${i}`, { i }))
    );

    await Promise.all(tasks);

    expect(emit).toHaveBeenCalledTimes(30);
    expect(consoleMocks.log).toHaveBeenCalledTimes(30);
  });
});

describe("useLogger", () => {
  it("aliases createLogger", () => {
    expect(useLogger).toBe(createLogger);
  });

  it("creates logger instances with null options", () => {
    const logger = useLogger(null);

    expect(typeof logger.info).toBe("function");
    expect(() => logger.info("ok")).not.toThrow();
    expect(consoleMocks.log).toHaveBeenCalledWith("[agent:?]", "ok", {});
  });

  it("passes options through", () => {
    const emit = vi.fn();
    const logger = useLogger({ emit, actor: "alias", stage: "alias" });

    logger.info("hi", { ok: true });

    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe("trackToolCall", () => {
  it.each([
    null,
    undefined,
    "",
    [],
    {},
    0,
    -1,
    Number.MAX_SAFE_INTEGER,
    "   ",
    { info: "nope" },
  ])("bypasses logging when logger is invalid (%s)", async (logger) => {
    const fn = vi.fn(() => "ok");

    const result = await trackToolCall(logger, "noop", { a: 1 }, fn);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("logs start and completion with args and array results", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const args = { 0: "a", length: 1 };

    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1050);

    const result = await trackToolCall(logger, "123", args, () => ["a", "b"]);

    expect(result).toEqual(["a", "b"]);
    expect(logger.info).toHaveBeenCalledTimes(2);

    const [startMessage, startPayload] = logger.info.mock.calls[0];
    expect(startMessage).toBe("Tool call: 123");
    expect(startPayload).toEqual({ stage: "tool", data: { tool: "123", args } });

    const [doneMessage, donePayload] = logger.info.mock.calls[1];
    expect(doneMessage).toBe("Tool completed: 123");
    expect(donePayload.data).toEqual({ tool: "123", duration: 50, success: true });
    expect(donePayload.toolCalls[0]).toEqual(
      expect.objectContaining({
        tool: "123",
        args,
        duration: 50,
        result: { type: "object", length: 2 },
      })
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs failure and rethrows errors", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const error = new Error("boom");

    vi.spyOn(Date, "now").mockReturnValueOnce(2000).mockReturnValueOnce(2025);

    await expect(
      trackToolCall(logger, "read", { path: "file.txt" }, () => {
        throw error;
      })
    ).rejects.toThrow("boom");

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, payload] = logger.error.mock.calls[0];
    expect(message).toBe("Tool failed: read");
    expect(payload.data).toEqual({ tool: "read", duration: 25, success: false, error: "boom" });
    expect(payload.toolCalls[0]).toEqual({
      tool: "read",
      args: { path: "file.txt" },
      error: "boom",
      duration: 25,
    });
  });

  it("handles concurrent tool calls with boundary args", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const argsValues = [
      null,
      undefined,
      "",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "   ",
      "123",
    ];

    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => {
      const current = now;
      now += 5;
      return current;
    });

    const tasks = argsValues.map((value, index) =>
      trackToolCall(logger, `tool-${index}`, value, () => Promise.resolve({ ok: true, index }))
    );

    const results = await Promise.all(tasks);

    expect(results).toHaveLength(argsValues.length);
    expect(logger.info).toHaveBeenCalledTimes(argsValues.length * 2);
    expect(logger.error).not.toHaveBeenCalled();
    expect(results.every((result) => result.ok === true)).toBe(true);
  });
});

describe("logEvent", () => {
  it("logs payload message when present", () => {
    logEvent({ message: "hello" });

    expect(consoleMocks.log).toHaveBeenCalledWith("[Agent]", "hello");
  });

  it("falls back to payload when message is missing or falsy", () => {
    logEvent(null);
    logEvent(undefined);
    logEvent("");
    logEvent({ message: "" });
    logEvent({ message: 0 });
    logEvent({});

    expect(consoleMocks.log).toHaveBeenNthCalledWith(1, "[Agent]", null);
    expect(consoleMocks.log).toHaveBeenNthCalledWith(2, "[Agent]", undefined);
    expect(consoleMocks.log).toHaveBeenNthCalledWith(3, "[Agent]", "");
    expect(consoleMocks.log).toHaveBeenNthCalledWith(4, "[Agent]", { message: "" });
    expect(consoleMocks.log).toHaveBeenNthCalledWith(5, "[Agent]", { message: 0 });
    expect(consoleMocks.log).toHaveBeenNthCalledWith(6, "[Agent]", {});
  });
});
