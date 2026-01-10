/**
 * @file tests/shared/logger.test.js
 * @description shared/utils/logger.js 单元测试
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import createLogger, { createLogger as namedCreateLogger } from "../../js/shared/utils/logger.js";

const FIXED_TIME = new Date("2024-01-01T00:00:00.000Z");
const FIXED_TS = FIXED_TIME.toISOString();

describe("shared/utils/logger.js", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);

    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exports createLogger as both named and default", () => {
    expect(createLogger).toBe(namedCreateLogger);
  });

  it("returns a frozen logger with debug/info/warn/error", () => {
    const logger = createLogger("test");

    expect(Object.isFrozen(logger)).toBe(true);
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("logs with timestamp + module prefix and uppercased level", () => {
    const logger = createLogger("test");
    logger.info("hello");

    expect(console.info).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledWith(`[${FIXED_TS}] [test] INFO: hello`);
  });

  it("trims moduleName and falls back to 'app' when moduleName is empty", () => {
    const logger = createLogger("  mymod  ");
    logger.warn("x");
    expect(console.warn).toHaveBeenCalledWith(`[${FIXED_TS}] [mymod] WARN: x`);

    console.warn.mockClear();

    const logger2 = createLogger("   ");
    logger2.warn("y");
    expect(console.warn).toHaveBeenCalledWith(`[${FIXED_TS}] [app] WARN: y`);
  });

  it("stringifies non-string messages", () => {
    const logger = createLogger("test", { level: "debug" });
    logger.debug(123);

    expect(console.debug).toHaveBeenCalledTimes(1);
    expect(console.debug).toHaveBeenCalledWith(`[${FIXED_TS}] [test] DEBUG: 123`);
  });

  it("passes optional data as a second argument", () => {
    const logger = createLogger("test", { level: "debug" });
    const payload = { a: 1 };

    logger.warn("msg", payload);
    expect(console.warn).toHaveBeenCalledWith(`[${FIXED_TS}] [test] WARN: msg`, payload);
  });

  it("filters messages below the minimum level", () => {
    const logger = createLogger("test", { level: " WARN " });

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("defaults invalid levels to 'info'", () => {
    const logger = createLogger("test", { level: "not-a-level" });

    logger.debug("d");
    logger.info("i");

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(`[${FIXED_TS}] [test] INFO: i`);
  });

  it("falls back to console.log when a level-specific method is missing", () => {
    const originalConsole = globalThis.console;
    const fakeConsole = { log: vi.fn() };

    try {
      globalThis.console = fakeConsole;
      const logger = createLogger("test", { level: "debug" });

      logger.warn("hello");
      expect(fakeConsole.log).toHaveBeenCalledWith(`[${FIXED_TS}] [test] WARN: hello`);
    } finally {
      globalThis.console = originalConsole;
    }
  });

  it("falls back to 'app' when moduleName is not a string", () => {
    const logger = createLogger(null);
    logger.info("hello");

    expect(console.info).toHaveBeenCalledWith(`[${FIXED_TS}] [app] INFO: hello`);
  });

  it("suppresses all logs when level is 'silent' or enabled is false", () => {
    const silent = createLogger("test", { level: "silent" });
    silent.error("boom");
    silent.warn("w");

    const disabled = createLogger("test", { enabled: false, level: "debug" });
    disabled.debug("d");
    disabled.error("e");

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });
});
