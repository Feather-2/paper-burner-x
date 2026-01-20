import { describe, it, expect, vi, beforeEach } from "vitest";

const { loggerError, createLoggerMock, getGlobalContainerMock } = vi.hoisted(() => {
  const loggerError = vi.fn();
  const createLoggerMock = vi.fn(() => ({ error: loggerError }));
  const getGlobalContainerMock = vi.fn();
  return { loggerError, createLoggerMock, getGlobalContainerMock };
});

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: createLoggerMock,
}));

vi.mock("../../../../../js/agents/core/di/global-container.js", () => ({
  getGlobalContainer: getGlobalContainerMock,
}));

import {
  ErrorCategory,
  ERROR_BOUNDARY_UNHANDLED,
  categorizeError,
  createErrorInfo,
  ErrorBoundary,
  createDefaultErrorBoundary,
  getErrorBoundary,
  withErrorBoundary,
} from "../../../../../js/agents/runtime/core/error-boundary.js";

const createError = (message, overrides = {}) => Object.assign(new Error(message), overrides);

const buildDeepObject = (depth) => {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
};

beforeEach(() => {
  loggerError.mockClear();
  createLoggerMock.mockClear();
  getGlobalContainerMock.mockReset();
});

describe("ErrorCategory", () => {
  it("exposes expected categories", () => {
    expect(ErrorCategory).toEqual({
      NETWORK: "network",
      VALIDATION: "validation",
      TIMEOUT: "timeout",
      QUOTA: "quota",
      PERMISSION: "permission",
      INTERNAL: "internal",
      EXTERNAL: "external",
      UNKNOWN: "unknown",
    });
  });
});

describe("ERROR_BOUNDARY_UNHANDLED", () => {
  it("is a unique symbol", () => {
    expect(typeof ERROR_BOUNDARY_UNHANDLED).toBe("symbol");
    expect(ERROR_BOUNDARY_UNHANDLED).not.toBe(Symbol("error_boundary_unhandled"));
  });
});

describe("categorizeError", () => {
  it("returns UNKNOWN for empty values and whitespace", () => {
    expect(categorizeError(null)).toBe(ErrorCategory.UNKNOWN);
    expect(categorizeError(undefined)).toBe(ErrorCategory.UNKNOWN);
    expect(categorizeError("")).toBe(ErrorCategory.UNKNOWN);
    expect(categorizeError([])).toBe(ErrorCategory.UNKNOWN);
    expect(categorizeError({})).toBe(ErrorCategory.UNKNOWN);
    expect(categorizeError(new Error("   "))).toBe(ErrorCategory.UNKNOWN);
  });

  it("categorizes network errors by code or message", () => {
    expect(categorizeError(createError("Fetch failed"))).toBe(ErrorCategory.NETWORK);
    expect(categorizeError(createError("", { code: "ECONNRESET" }))).toBe(ErrorCategory.NETWORK);
  });

  it("categorizes timeout errors", () => {
    expect(categorizeError(createError("Operation timeout", { name: "TimeoutError" }))).toBe(
      ErrorCategory.TIMEOUT,
    );
  });

  it("categorizes validation errors", () => {
    expect(categorizeError(createError("invalid input", { name: "ValidationError" }))).toBe(
      ErrorCategory.VALIDATION,
    );
    expect(categorizeError(createError("required field missing"))).toBe(ErrorCategory.VALIDATION);
  });

  it("categorizes quota errors for long messages", () => {
    const longMessage = "x".repeat(100000) + " quota exceeded";
    expect(categorizeError(createError(longMessage))).toBe(ErrorCategory.QUOTA);
  });

  it("categorizes permission errors", () => {
    expect(categorizeError(createError("Permission denied"))).toBe(ErrorCategory.PERMISSION);
    expect(categorizeError(createError("Access forbidden"))).toBe(ErrorCategory.PERMISSION);
  });

  it("categorizes external errors for numeric and string status", () => {
    expect(categorizeError({ status: 400 })).toBe(ErrorCategory.EXTERNAL);
    expect(categorizeError({ status: "500" })).toBe(ErrorCategory.EXTERNAL);
    expect(categorizeError({ status: Number.MAX_SAFE_INTEGER })).toBe(ErrorCategory.EXTERNAL);
  });

  it("does not treat 0 or negative status as external", () => {
    expect(categorizeError({ status: 0 })).toBe(ErrorCategory.UNKNOWN);
    expect(categorizeError({ status: -1 })).toBe(ErrorCategory.UNKNOWN);
  });
});

describe("createErrorInfo", () => {
  it("creates info with defaults for null errors", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.123456);

    const info = createErrorInfo(null);

    expect(info.category).toBe(ErrorCategory.UNKNOWN);
    expect(info.message).toBe("null");
    expect(info.ts).toBe(0);
    expect(info.context).toEqual({});
    expect(info.recovered).toBe(false);
    expect(info.id).toMatch(/^err_0_[0-9a-z]{4}$/);

    nowSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it("preserves deep nested context objects", () => {
    const context = buildDeepObject(50);
    const info = createErrorInfo(createError("Fetch failed"), context);

    expect(info.category).toBe(ErrorCategory.NETWORK);
    expect(info.context).toBe(context);
    expect(info.context.next.next).toBeDefined();
  });

  it("accepts array-like context objects", () => {
    const context = { 0: "item", length: 1 };
    const info = createErrorInfo(createError("boom"), context);

    expect(info.context).toBe(context);
    expect(info.context.length).toBe(1);
  });

  it("handles huge messages without truncation", () => {
    const hugeMessage = "x".repeat(200000);
    const info = createErrorInfo(createError(hugeMessage));

    expect(info.message.length).toBe(hugeMessage.length);
    expect(info.message.startsWith("x")).toBe(true);
  });

  it("accepts string error values", () => {
    const info = createErrorInfo("boom");

    expect(info.message).toBe("boom");
    expect(info.category).toBe(ErrorCategory.UNKNOWN);
  });
});

describe("ErrorBoundary", () => {
  it("wrap returns result and records no errors", async () => {
    const boundary = new ErrorBoundary();

    const result = await boundary.wrap(async () => "ok");

    expect(result).toBe("ok");
    expect(boundary.errors).toHaveLength(0);
  });

  it("wrap records errors and returns fallbackValue", async () => {
    const onError = vi.fn();
    const boundary = new ErrorBoundary({ onError });

    const result = await boundary.wrap(
      () => {
        throw new Error("boom");
      },
      { fallbackValue: "fallback" },
    );

    expect(result).toBe("fallback");
    expect(boundary.errors).toHaveLength(1);
    expect(boundary.errors[0].message).toBe("boom");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("swallows onError callback failures", async () => {
    const boundary = new ErrorBoundary({
      onError: () => {
        throw new Error("callback failed");
      },
    });

    await expect(
      boundary.wrap(
        () => {
          throw new Error("boom");
        },
        { fallbackValue: "safe" },
      ),
    ).resolves.toBe("safe");
  });

  it("uses category fallback and marks recovered", async () => {
    const fallback = vi.fn(() => "cached");
    const boundary = new ErrorBoundary({
      fallbacks: {
        [ErrorCategory.NETWORK]: fallback,
      },
    });

    const result = await boundary.wrap(() => {
      throw new Error("fetch failed");
    });

    const [info] = boundary.errors;
    expect(result).toBe("cached");
    expect(fallback).toHaveBeenCalledWith(expect.any(Error), info);
    expect(info.recovered).toBe(true);
    expect(boundary.stats.recovered).toBe(1);
  });

  it("returns fallbackValue when fallback declines", async () => {
    const fallback = vi.fn(() => ERROR_BOUNDARY_UNHANDLED);
    const boundary = new ErrorBoundary({
      fallbacks: {
        [ErrorCategory.NETWORK]: fallback,
      },
    });

    const result = await boundary.wrap(
      () => {
        throw new Error("fetch failed");
      },
      { fallbackValue: "default" },
    );

    expect(result).toBe("default");
    expect(boundary.errors[0].recovered).toBe(false);
  });

  it("logs and continues when fallback throws", async () => {
    const fallback = vi.fn(() => {
      throw new Error("fallback boom");
    });
    const boundary = new ErrorBoundary({
      fallbacks: {
        [ErrorCategory.NETWORK]: fallback,
      },
    });

    const result = await boundary.wrap(
      () => {
        throw new Error("fetch failed");
      },
      { fallbackValue: "safe" },
    );

    expect(result).toBe("safe");
    expect(loggerError).toHaveBeenCalledWith(
      "Fallback failed",
      expect.objectContaining({ category: ErrorCategory.NETWORK, error: "fallback boom" }),
    );
  });

  it("rethrows when rethrow is true", async () => {
    const boundary = new ErrorBoundary();

    await expect(
      boundary.wrap(
        () => {
          throw new Error("boom");
        },
        { rethrow: true },
      ),
    ).rejects.toThrow("boom");

    expect(boundary.errors).toHaveLength(1);
  });

  it("trims history using numeric string maxErrors", () => {
    const boundary = new ErrorBoundary({ maxErrors: "2" });

    boundary.report(new Error("one"));
    boundary.report(new Error("two"));
    boundary.report(new Error("three"));

    expect(boundary.errors).toHaveLength(2);
    expect(boundary.errors[0].message).toBe("two");
    expect(boundary.errors[1].message).toBe("three");
  });

  it("drops errors when maxErrors is 0", () => {
    const boundary = new ErrorBoundary({ maxErrors: 0 });

    boundary.report(new Error("boom"));

    expect(boundary.errors).toHaveLength(0);
  });

  it("returns a copy of error history", () => {
    const boundary = new ErrorBoundary();

    boundary.report(new Error("boom"));

    const first = boundary.errors;
    const second = boundary.errors;

    first.push({ id: "extra" });

    expect(first).not.toBe(second);
    expect(boundary.errors).toHaveLength(1);
  });

  it("tracks stats and recovered state", async () => {
    const boundary = new ErrorBoundary();

    await boundary.wrap(
      () => {
        throw new Error("fetch failed");
      },
      { fallbackValue: "fallback" },
    );
    boundary.report(createError("invalid", { name: "ValidationError" }));

    const [first] = boundary.errors;
    boundary.markRecovered(first.id);

    expect(boundary.stats.total).toBe(2);
    expect(boundary.stats.byCategory[ErrorCategory.NETWORK]).toBe(1);
    expect(boundary.stats.byCategory[ErrorCategory.VALIDATION]).toBe(1);
    expect(boundary.stats.recovered).toBe(1);
  });

  it("marks recovered and swallows onRecovery errors", () => {
    const onRecovery = vi.fn(() => {
      throw new Error("recovery failed");
    });
    const boundary = new ErrorBoundary({ onRecovery });

    boundary.report(new Error("boom"));

    const [info] = boundary.errors;

    expect(() => boundary.markRecovered(info.id)).not.toThrow();
    expect(boundary.errors[0].recovered).toBe(true);
    expect(onRecovery).toHaveBeenCalledWith(expect.objectContaining({ id: info.id }));
  });

  it("clears error history", () => {
    const boundary = new ErrorBoundary();

    boundary.report(new Error("boom"));
    boundary.clear();

    expect(boundary.errors).toHaveLength(0);
  });

  it("handles concurrent wrap calls", async () => {
    const boundary = new ErrorBoundary({
      fallbacks: {
        [ErrorCategory.NETWORK]: () => "net",
        [ErrorCategory.TIMEOUT]: () => "timeout",
      },
    });

    const [first, second] = await Promise.all([
      boundary.wrap(() => {
        throw new Error("fetch failed");
      }),
      boundary.wrap(() => {
        const err = new Error("timeout");
        err.name = "TimeoutError";
        throw err;
      }),
    ]);

    expect(first).toBe("net");
    expect(second).toBe("timeout");
    expect(boundary.errors).toHaveLength(2);
  });
});

describe("createDefaultErrorBoundary", () => {
  it("degrades with context fallbackValue and notifies", async () => {
    const boundary = createDefaultErrorBoundary();
    const onDegrade = vi.fn();
    const context = {
      degrade: true,
      fallbackValue: "cached",
      stage: "runtime",
      runId: "run_1",
      onDegrade,
    };

    const result = await boundary.wrap(
      () => {
        throw new Error("fetch failed");
      },
      { context },
    );

    expect(result).toBe("cached");
    expect(onDegrade).toHaveBeenCalledTimes(1);
    expect(onDegrade).toHaveBeenCalledWith(
      expect.objectContaining({
        category: ErrorCategory.NETWORK,
        runId: "run_1",
        stage: "runtime",
      }),
    );
    expect(boundary.errors[0].recovered).toBe(true);
  });

  it("skips degrade when context lacks fallback values", async () => {
    const boundary = createDefaultErrorBoundary();
    const context = { degrade: true };

    const result = await boundary.wrap(
      () => {
        throw new Error("fetch failed");
      },
      { context, fallbackValue: "default" },
    );

    expect(result).toBe("default");
    expect(boundary.errors[0].recovered).toBe(false);
  });
});

describe("getErrorBoundary", () => {
  it("registers default boundary when missing", () => {
    const services = new Map();
    const container = {
      has: vi.fn((id) => services.has(id)),
      register: vi.fn((id, factory) => {
        services.set(id, factory());
      }),
      get: vi.fn((id) => services.get(id)),
    };

    getGlobalContainerMock.mockReturnValue(container);

    const boundary = getErrorBoundary();

    expect(boundary).toBeInstanceOf(ErrorBoundary);
    expect(container.register).toHaveBeenCalledTimes(1);
    expect(container.get).toHaveBeenCalledTimes(1);
  });

  it("returns existing boundary when registered", () => {
    const existing = new ErrorBoundary();
    const container = {
      has: vi.fn(() => true),
      register: vi.fn(),
      get: vi.fn(() => existing),
    };

    getGlobalContainerMock.mockReturnValue(container);

    const boundary = getErrorBoundary();

    expect(boundary).toBe(existing);
    expect(container.register).not.toHaveBeenCalled();
  });
});

describe("withErrorBoundary", () => {
  it("delegates to global boundary wrap", async () => {
    const wrap = vi.fn().mockResolvedValue("ok");
    const boundary = { wrap };
    const container = {
      has: vi.fn(() => true),
      register: vi.fn(),
      get: vi.fn(() => boundary),
    };

    getGlobalContainerMock.mockReturnValue(container);

    const fn = vi.fn();
    const options = { fallbackValue: "fallback" };

    const result = await withErrorBoundary(fn, options);

    expect(result).toBe("ok");
    expect(wrap).toHaveBeenCalledWith(fn, options);
  });
});
