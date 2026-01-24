import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger, logEvent, trackToolCall, useLogger } from "../../../../../js/agents/shared/utils/logger.js";

const originalConsole = globalThis.console;

/** @type {{ log: ReturnType<typeof vi.fn>, warn: ReturnType<typeof vi.fn>, error: ReturnType<typeof vi.fn> }} */
let consoleMocks;

beforeEach(() => {
  consoleMocks = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  globalThis.console = consoleMocks;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.console = originalConsole;
  vi.restoreAllMocks();
});

describe("createLogger", () => {
  it("should_log_to_console_log_with_trimmed_stage_when_options_is_string", () => {
    // Arrange
    const logger = createLogger("  stage-x  ");

    // Act
    logger.info("hello");

    // Assert
    expect(consoleMocks.log.mock.calls).toEqual([["[agent:stage-x]", "hello", {}]]);
  });

  it("should_emit_actor_scoped_event_name_when_emit_is_provided", () => {
    // Arrange
    const emit = vi.fn();
    const logger = createLogger({ emit, actor: "alpha", stage: "main" });

    // Act
    logger.info("hello");

    // Assert
    expect(emit.mock.calls[0][0]).toBe("alpha:log");
  });

  it("should_merge_context_and_data_into_payload_when_getContext_returns_object", () => {
    // Arrange
    const emit = vi.fn();
    const getContext = () => ({ runId: "run-1", nested: { a: 1 } });
    const logger = createLogger({ emit, getContext, actor: "alpha", stage: "main" });

    // Act
    logger.info("hello", { extra: "x" });

    // Assert
    expect(emit.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        runId: "run-1",
        nested: { a: 1 },
        extra: "x",
      })
    );
  });

  it("should_override_context_stage_with_stage_option_when_both_provided", () => {
    // Arrange
    const emit = vi.fn();
    const getContext = () => ({ stage: "old" });
    const logger = createLogger({ emit, getContext, actor: "alpha", stage: "  main  " });

    // Act
    logger.info("hello");

    // Assert
    expect(emit.mock.calls[0][1].stage).toBe("main");
  });

  it("should_set_meta_status_failed_when_level_is_error", () => {
    // Arrange
    const emit = vi.fn();
    const logger = createLogger({ emit, actor: "ops", stage: "prod" });

    // Act
    logger.error("boom", { code: 500 });

    // Assert
    expect(emit.mock.calls[0][2]).toEqual({ status: "failed" });
  });

  it("should_set_meta_status_info_when_level_is_warn", () => {
    // Arrange
    const emit = vi.fn();
    const logger = createLogger({ emit, actor: "ops", stage: "prod" });

    // Act
    logger.warn("heads-up", { code: 1 });

    // Assert
    expect(emit.mock.calls[0][2]).toEqual({ status: "info" });
  });

  it("should_write_to_console_error_when_level_is_error", () => {
    // Arrange
    const logger = createLogger({ actor: "ops", stage: "prod" });

    // Act
    logger.error("boom", { code: 500 });

    // Assert
    expect(consoleMocks.error.mock.calls).toEqual([["[ops:prod]", "boom", { code: 500 }]]);
  });

  it("should_write_to_console_warn_when_level_is_warn", () => {
    // Arrange
    const logger = createLogger({ actor: "ops", stage: "prod" });

    // Act
    logger.warn("heads-up", { code: 1 });

    // Assert
    expect(consoleMocks.warn.mock.calls).toEqual([["[ops:prod]", "heads-up", { code: 1 }]]);
  });

  it("should_not_emit_or_console_when_enabled_is_falsey", () => {
    // Arrange
    const emit = vi.fn();
    const logger = createLogger({ emit, enabled: 0, actor: "silent", stage: "muted" });

    // Act
    logger.warn("quiet", { ok: false });

    // Assert
    expect({ emitCalls: emit.mock.calls.length, warnCalls: consoleMocks.warn.mock.calls.length }).toEqual({
      emitCalls: 0,
      warnCalls: 0,
    });
  });

  it("should_skip_console_logging_when_console_method_is_missing", () => {
    // Arrange
    globalThis.console = {};
    const logger = createLogger({ actor: "no-console", stage: "x" });

    // Act
    logger.info("hello");

    // Assert
    expect(consoleMocks.log.mock.calls.length).toBe(0);
  });

  it("should_include_timestamp_in_payload_when_emitting", () => {
    // Arrange
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const emit = vi.fn();
    const logger = createLogger({ emit, actor: "t", stage: "s" });

    // Act
    logger.info("hello");

    // Assert
    expect(emit.mock.calls[0][1].timestamp).toBe("2024-01-01T00:00:00.000Z");
  });

  it("should_not_call_getContext_when_enabled_is_falsey", () => {
    // Arrange
    const getContext = vi.fn(() => ({ runId: "r" }));
    const logger = createLogger({ enabled: false, getContext, actor: "silent", stage: "muted" });

    // Act
    logger.info("quiet");

    // Assert
    expect(getContext).toHaveBeenCalledTimes(0);
  });

  it("should_use_context_stage_when_stage_option_is_missing", () => {
    // Arrange
    const emit = vi.fn();
    const getContext = () => ({ stage: "ctx-stage" });
    const logger = createLogger({ emit, getContext, actor: "alpha" });

    // Act
    logger.info("hello");

    // Assert
    expect(emit.mock.calls[0][1].stage).toBe("ctx-stage");
  });

  it("should_not_throw_when_emit_is_not_a_function", () => {
    // Arrange
    const logger = createLogger({ emit: 123, actor: "edge", stage: "edge" });

    // Act + Assert
    expect(() => logger.info("ok")).not.toThrow();
  });

  it("should_not_spread_non_object_data_into_payload_when_data_is_string", () => {
    // Arrange
    const emit = vi.fn();
    const logger = createLogger({ emit, actor: "tester", stage: "main" });

    // Act
    logger.info("msg", "payload");

    // Assert
    expect(Object.keys(emit.mock.calls[0][1]).sort()).toEqual(["level", "message", "stage", "timestamp"].sort());
  });

  it("should_use_question_mark_stage_in_console_prefix_when_no_stage_available", () => {
    // Arrange
    const logger = createLogger({ actor: "tester" });

    // Act
    logger.info("hello");

    // Assert
    expect(consoleMocks.log.mock.calls[0][0]).toBe("[tester:?]");
  });

  it.each([null, undefined, "", [], {}, 0, -1, Number.MAX_SAFE_INTEGER, "   ", "123"])(
    "should_forward_message_value_when_message_is_%j",
    (message) => {
      // Arrange
      const emit = vi.fn();
      const logger = createLogger({ emit, actor: "edge", stage: "edge" });

      // Act
      logger.debug(message, { value: message });

      // Assert
      expect(emit.mock.calls[0][1].message).toBe(message);
    }
  );

  it("should_preserve_deep_nested_data_reference_when_data_is_deep_object", () => {
    // Arrange
    const emit = vi.fn();
    const logger = createLogger({ emit, actor: "merge", stage: "merge" });
    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 20; i += 1) {
      cursor.level = i;
      cursor.child = {};
      cursor = cursor.child;
    }

    // Act
    logger.info("deep", { deep });

    // Assert
    expect(emit.mock.calls[0][1].deep).toBe(deep);
  });

  it("should_emit_for_each_call_when_called_concurrently", async () => {
    // Arrange
    const emit = vi.fn();
    const logger = createLogger({ emit, actor: "burst", stage: "burst" });

    // Act
    const tasks = Array.from({ length: 10 }, (_value, i) => Promise.resolve().then(() => logger.info(`async-${i}`, { i })));
    await Promise.all(tasks);

    // Assert
    expect(emit.mock.calls.length).toBe(10);
  });
});

describe("useLogger", () => {
  it("should_alias_createLogger_when_imported", () => {
    // Assert
    expect(useLogger).toBe(createLogger);
  });

  it("should_log_with_default_actor_when_options_is_null", () => {
    // Arrange
    const logger = useLogger(null);

    // Act
    logger.info("ok");

    // Assert
    expect(consoleMocks.log.mock.calls[0][0]).toBe("[agent:?]");
  });

  it("should_forward_options_to_createLogger_when_called", () => {
    // Arrange
    const emit = vi.fn();
    const logger = useLogger({ emit, actor: "alias", stage: "alias" });

    // Act
    logger.info("hi", { ok: true });

    // Assert
    expect(emit.mock.calls[0][0]).toBe("alias:log");
  });
});

describe("trackToolCall", () => {
  it.each([null, undefined, "", [], {}, 0, -1, Number.MAX_SAFE_INTEGER, "   ", { info: "nope" }])(
    "should_return_fn_result_when_logger_is_invalid_%j",
    async (logger) => {
      // Arrange
      const fn = vi.fn(() => "ok");

      // Act
      const result = await trackToolCall(logger, "noop", { a: 1 }, fn);

      // Assert
      expect({ result, calls: fn.mock.calls.length }).toEqual({ result: "ok", calls: 1 });
    }
  );

  it("should_log_start_payload_when_logger_is_valid", async () => {
    // Arrange
    const logger = { info: vi.fn(), error: vi.fn() };
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1000);

    // Act
    await trackToolCall(logger, "read", { path: "file.txt" }, () => "ok");

    // Assert
    expect(logger.info.mock.calls[0]).toEqual([
      "Tool call: read",
      { stage: "tool", data: { tool: "read", args: { path: "file.txt" } } },
    ]);
  });

  it("should_log_completion_payload_when_fn_resolves", async () => {
    // Arrange
    const logger = { info: vi.fn(), error: vi.fn() };
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1050);

    // Act
    await trackToolCall(logger, "glob", { pattern: "*.js" }, () => ["a", "b"]);

    // Assert
    expect(logger.info.mock.calls[1]).toEqual([
      "Tool completed: glob",
      expect.objectContaining({
        stage: "tool",
        data: { tool: "glob", duration: 50, success: true },
      }),
    ]);
  });

  it("should_include_duration_in_completion_payload_when_time_advances", async () => {
    // Arrange
    const logger = { info: vi.fn(), error: vi.fn() };
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1042);

    // Act
    await trackToolCall(logger, "grep", { q: "x" }, () => "ok");

    // Assert
    expect(logger.info.mock.calls[1][1].data.duration).toBe(42);
  });

  it("should_summarize_array_result_length_when_result_is_array", async () => {
    // Arrange
    const logger = { info: vi.fn(), error: vi.fn() };
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1000);

    // Act
    await trackToolCall(logger, "list", { dir: "." }, () => ["a", "b"]);

    // Assert
    expect(logger.info.mock.calls[1][1].toolCalls[0].result).toEqual({ type: "object", length: 2 });
  });

  it("should_summarize_object_result_when_result_is_object", async () => {
    // Arrange
    const logger = { info: vi.fn(), error: vi.fn() };
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1000);

    // Act
    await trackToolCall(logger, "stat", { path: "x" }, () => ({ ok: true }));

    // Assert
    expect(logger.info.mock.calls[1][1].toolCalls[0].result).toEqual({ type: "object", length: undefined });
  });

  it("should_include_primitive_result_when_result_is_number", async () => {
    // Arrange
    const logger = { info: vi.fn(), error: vi.fn() };
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1000);

    // Act
    await trackToolCall(logger, "count", { a: 1 }, () => 3);

    // Assert
    expect(logger.info.mock.calls[1][1].toolCalls[0].result).toBe(3);
  });

  it("should_include_null_result_when_result_is_null", async () => {
    // Arrange
    const logger = { info: vi.fn(), error: vi.fn() };
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1000);

    // Act
    await trackToolCall(logger, "read", { path: "x" }, () => null);

    // Assert
    expect(logger.info.mock.calls[1][1].toolCalls[0].result).toBe(null);
  });

  it("should_rethrow_same_error_instance_when_fn_throws", async () => {
    // Arrange
    const logger = { info: vi.fn(), error: vi.fn() };
    const error = new Error("boom");
    vi.spyOn(Date, "now").mockReturnValueOnce(2000).mockReturnValueOnce(2025);

    // Act + Assert
    await expect(
      trackToolCall(logger, "read", { path: "file.txt" }, () => {
        throw error;
      })
    ).rejects.toBe(error);
  });

  it("should_log_failure_payload_when_fn_throws_error", async () => {
    // Arrange
    const logger = { info: vi.fn(), error: vi.fn() };
    const error = new Error("boom");
    vi.spyOn(Date, "now").mockReturnValueOnce(2000).mockReturnValueOnce(2025);

    // Act
    try {
      await trackToolCall(logger, "read", { path: "file.txt" }, () => {
        throw error;
      });
    } catch {
      // expected
    }

    // Assert
    expect(logger.error.mock.calls[0]).toEqual([
      "Tool failed: read",
      {
        stage: "tool",
        data: { tool: "read", duration: 25, success: false, error: "boom" },
        toolCalls: [{ tool: "read", args: { path: "file.txt" }, error: "boom", duration: 25 }],
      },
    ]);
  });

  it("should_log_undefined_error_message_when_thrown_value_has_no_message", async () => {
    // Arrange
    const logger = { info: vi.fn(), error: vi.fn() };
    vi.spyOn(Date, "now").mockReturnValueOnce(2000).mockReturnValueOnce(2000);

    // Act
    try {
      await trackToolCall(logger, "read", { path: "file.txt" }, () => {
        throw "boom";
      });
    } catch {
      // expected
    }

    // Assert
    expect(logger.error.mock.calls[0][1].data.error).toBe(undefined);
  });

  it("should_support_concurrent_tool_calls_with_boundary_args", async () => {
    // Arrange
    const logger = { info: vi.fn(), error: vi.fn() };
    const argsValues = [null, undefined, "", [], {}, 0, -1, Number.MAX_SAFE_INTEGER, "   ", "123"];

    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => {
      const current = now;
      now += 5;
      return current;
    });

    // Act
    const results = await Promise.all(
      argsValues.map((value, index) =>
        trackToolCall(logger, `tool-${index}`, value, () => Promise.resolve({ ok: true, index }))
      )
    );

    // Assert
    expect({ results: results.length, info: logger.info.mock.calls.length, errors: logger.error.mock.calls.length }).toEqual({
      results: argsValues.length,
      info: argsValues.length * 2,
      errors: 0,
    });
  });
});

describe("logEvent", () => {
  const emptyMessage = { message: "" };
  const zeroMessage = { message: 0 };
  const missingMessage = {};
  const fallbackCases = [
    [null, null],
    [undefined, undefined],
    ["", ""],
    [emptyMessage, emptyMessage],
    [zeroMessage, zeroMessage],
    [missingMessage, missingMessage],
  ];

  it("should_log_payload_message_when_message_is_present", () => {
    // Act
    logEvent({ message: "hello" });

    // Assert
    expect(consoleMocks.log.mock.calls).toEqual([["[Agent]", "hello"]]);
  });

  it.each(fallbackCases)("should_log_payload_when_message_is_missing_or_falsy_%j", (payload, expected) => {
    // Act
    logEvent(payload);

    // Assert
    expect(consoleMocks.log.mock.calls[0]).toEqual(["[Agent]", expected]);
  });
});