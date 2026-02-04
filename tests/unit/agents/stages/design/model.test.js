import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    injectSystemHint: vi.fn(),
  };
});

vi.mock("../../../../../js/agents/stages/design/shared/design-utils.js", () => {
  return {
    toNonEmptyString: vi.fn(),
  };
});

let injectSystemHint;
let toNonEmptyString;

let NonRetryableError;
let setLogger;
let isNonRetryableError;
let getDesignModelCaller;

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
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

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  resetEnv();

  process.env.DEBUG_DESIGN_MODEL = "0";
  process.env.DESIGN_MODEL_TIMEOUT_MS = "0";
  process.env.NODE_ENV = "test";

  ({ injectSystemHint } = await import("../../../../../js/agents/shared/index.js"));
  ({ toNonEmptyString } = await import("../../../../../js/agents/stages/design/shared/design-utils.js"));

  ({ NonRetryableError, setLogger, isNonRetryableError, getDesignModelCaller } = await import(
    "../../../../../js/agents/stages/design/model.js"
  ));

  injectSystemHint.mockImplementation((messages) => messages);
  toNonEmptyString.mockImplementation((value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  });

  setLogger(null);
});

describe("NonRetryableError", () => {
  it("sets name and nonRetryable flag for standard message", () => {
    const err = new NonRetryableError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("NonRetryableError");
    expect(err.nonRetryable).toBe(true);
    expect(err.message).toBe("boom");
  });

  it("allows empty message", () => {
    const err = new NonRetryableError("");
    expect(err.message).toBe("");
    expect(err.name).toBe("NonRetryableError");
    expect(err.nonRetryable).toBe(true);
  });
});

describe("setLogger", () => {
  it("accepts function logger and uses it when debug enabled", async () => {
    process.env.DEBUG_DESIGN_MODEL = "1";
    const loggerFn = vi.fn();
    setLogger(loggerFn);

    const modelRouterCall = vi.fn(() => Promise.resolve("ok"));
    const stageApi = { modelRouter: { call: modelRouterCall } };
    const caller = getDesignModelCaller(stageApi);

    await caller([{ role: "user", content: "hi" }]);

    expect(loggerFn).toHaveBeenCalledTimes(1);
    expect(loggerFn).toHaveBeenCalledWith(
      expect.stringContaining("ModelRouter"),
      expect.objectContaining({ usage: "designer" })
    );
  });

  it("accepts logger-like objects and clears with null/undefined", async () => {
    process.env.DEBUG_DESIGN_MODEL = "1";
    const loggerObj = { debug: vi.fn() };
    setLogger(loggerObj);

    const modelRouterCall = vi.fn(() => Promise.resolve("ok"));
    const stageApi = { modelRouter: { call: modelRouterCall } };
    const caller = getDesignModelCaller(stageApi);

    await caller([]);
    expect(loggerObj.debug).toHaveBeenCalledTimes(1);

    expect(() => setLogger(null)).not.toThrow();
    expect(() => setLogger(undefined)).not.toThrow();

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await caller([]);

    expect(loggerObj.debug).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("throws for invalid logger inputs", () => {
    for (const value of ["", {}, [], 0]) {
      expect(() => setLogger(value)).toThrow(TypeError);
    }
  });
});

describe("isNonRetryableError", () => {
  it("returns true for NonRetryableError instances and nonRetryable flags", () => {
    expect(isNonRetryableError(new NonRetryableError("nope"))).toBe(true);
    expect(isNonRetryableError({ nonRetryable: true })).toBe(true);
  });

  it("returns false for nullish and empty values", () => {
    for (const value of [null, undefined, "", "   ", [], {}]) {
      expect(isNonRetryableError(value)).toBe(false);
    }
  });

  it("delegates to shared classifier for auth/config messages", () => {
    expect(isNonRetryableError(new Error("Invalid API key"))).toBe(true);
    expect(isNonRetryableError("no available model config")).toBe(true);
  });
});

describe("getDesignModelCaller", () => {
  it("returns null when stageApi lacks a caller", () => {
    expect(getDesignModelCaller(null)).toBeNull();
    expect(getDesignModelCaller(undefined)).toBeNull();
    expect(getDesignModelCaller({})).toBeNull();
  });

  it("prefers modelRouter over aiApiService", async () => {
    const modelRouterCall = vi.fn(() => Promise.resolve("router"));
    const chat = vi.fn(() => Promise.resolve("chat"));
    const stageApi = { modelRouter: { call: modelRouterCall }, aiApiService: { chat } };

    const caller = getDesignModelCaller(stageApi);
    const result = await caller([{ role: "user", content: "hello" }]);

    expect(result).toBe("router");
    expect(modelRouterCall).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
  });

  it("uses legacy modelRouter signature when length >= 2", async () => {
    const calls = [];
    function legacyCall(messages, opts) {
      calls.push({ messages, opts });
      return Promise.resolve("legacy");
    }

    const stageApi = { modelRouter: { call: legacyCall } };
    const caller = getDesignModelCaller(stageApi, { usage: "   " });

    const result = await caller([], {});

    expect(result).toBe("legacy");
    expect(calls).toHaveLength(1);
    expect(calls[0].messages).toEqual([]);
    expect(calls[0].opts.usage).toBe("designer");
    expect(typeof calls[0].opts.signal?.aborted).toBe("boolean");
    expect(injectSystemHint).toHaveBeenCalledWith([], undefined);
  });

  it("uses new modelRouter signature, awaits flush, and forwards nested options", async () => {
    const largeText = "x".repeat(200000);
    const rawMessages = { role: "user", content: largeText, fileContent: largeText };
    injectSystemHint.mockImplementation((messages, hint) => ({ ...messages, hint, hinted: true }));

    const nested = { level1: { level2: { level3: { level4: { level5: "value" } } } } };
    let resolveFlush;
    const flushPromise = new Promise((resolve) => {
      resolveFlush = resolve;
    });

    const modelRouterCall = vi.fn(() => Promise.resolve({ ok: true }));
    const stageApi = {
      modelRouter: { call: modelRouterCall },
      runtimeHints: { system: "SYS_HINT" },
      flushCompression: vi.fn(() => flushPromise),
    };

    const caller = getDesignModelCaller(stageApi, { usage: "brainstorm" });
    const callPromise = caller(rawMessages, { temperature: 0.3, metadata: nested });

    expect(stageApi.flushCompression).toHaveBeenCalledTimes(1);
    expect(modelRouterCall).not.toHaveBeenCalled();

    resolveFlush();
    const result = await callPromise;

    expect(result).toEqual({ ok: true });
    expect(injectSystemHint).toHaveBeenCalledWith(rawMessages, "SYS_HINT");

    const payload = modelRouterCall.mock.calls[0][0];
    expect(payload.usage).toBe("brainstorm");
    expect(payload.messages.hinted).toBe(true);
    expect(payload.messages.hint).toBe("SYS_HINT");
    expect(payload.messages.content.length).toBe(largeText.length);
    expect(payload.messages.fileContent.length).toBe(largeText.length);
    expect(payload.metadata).toBe(nested);
    expect(typeof payload.signal?.aborted).toBe("boolean");
  });

  it("falls back to aiApiService.chat when modelRouter missing", async () => {
    const chat = vi.fn(() => Promise.resolve("chat"));
    const stageApi = { aiApiService: { chat } };
    const caller = getDesignModelCaller(stageApi, { usage: "refiner" });

    const result = await caller([{ role: "user", content: "hello" }], { top_p: 0.9 });

    expect(result).toBe("chat");
    const payload = chat.mock.calls[0][0];
    expect(payload.usage).toBe("refiner");
    expect(payload.top_p).toBe(0.9);
    expect(Array.isArray(payload.messages)).toBe(true);
    expect(typeof payload.signal?.aborted).toBe("boolean");
  });

  it("rejects with AbortError when signal is already aborted", async () => {
    const modelRouterCall = vi.fn(() => Promise.resolve("ok"));
    const stageApi = { modelRouter: { call: modelRouterCall } };
    const caller = getDesignModelCaller(stageApi);

    const controller = new AbortController();
    controller.abort("stop");

    await expect(caller([], { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
      message: "stop",
    });
    expect(modelRouterCall).not.toHaveBeenCalled();
  });

	  it("times out with TimeoutError and code 124", async () => {
	    vi.useFakeTimers();
	    try {
	      const modelRouterCall = vi.fn(() => new Promise(() => {}));
	      const stageApi = { modelRouter: { call: modelRouterCall } };
	      const caller = getDesignModelCaller(stageApi);
	      const promise = caller([], { timeoutMs: 5 });

	      const assertion = expect(promise).rejects.toMatchObject({ name: "TimeoutError", code: 124, timeoutMs: 5 });
	      await vi.advanceTimersByTimeAsync(5);

	      await assertion;
	      expect(modelRouterCall).toHaveBeenCalledTimes(1);
	    } finally {
	      vi.useRealTimers();
	    }
	  });

  it("does not schedule timeout when timeoutMs <= 0", async () => {
    const modelRouterCall = vi.fn(() => Promise.resolve("ok"));
    const stageApi = { modelRouter: { call: modelRouterCall } };
    const caller = getDesignModelCaller(stageApi);

    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

    await expect(caller([], { timeoutMs: -1 })).resolves.toBe("ok");
    await expect(caller([], { timeoutMs: 0 })).resolves.toBe("ok");

    expect(timeoutSpy).not.toHaveBeenCalled();
    timeoutSpy.mockRestore();
  });

	  it("uses env timeout when opts.timeoutMs is a string", async () => {
	    process.env.DESIGN_MODEL_TIMEOUT_MS = "7";
	    vi.useFakeTimers();
	    let timeoutSpy;
	    try {
	      const modelRouterCall = vi.fn(() => new Promise(() => {}));
	      const stageApi = { modelRouter: { call: modelRouterCall } };
	      const caller = getDesignModelCaller(stageApi);

	      timeoutSpy = vi.spyOn(globalThis, "setTimeout");
	      const promise = caller([], { timeoutMs: "3" });

	      // `getDesignModelCaller` awaits a flush barrier before scheduling the hard timeout.
	      await Promise.resolve();
	      expect(timeoutSpy).toHaveBeenCalled();
	      expect(timeoutSpy.mock.calls.some((call) => call[1] === 7)).toBe(true);

	      const assertion = expect(promise).rejects.toMatchObject({ name: "TimeoutError", timeoutMs: 7 });
	      await vi.advanceTimersByTimeAsync(7);
	      await assertion;
	    } finally {
	      timeoutSpy?.mockRestore();
	      vi.useRealTimers();
	    }
	  });

	  it("uses default timeout when env value is whitespace", async () => {
	    process.env.DESIGN_MODEL_TIMEOUT_MS = "   ";
	    vi.useFakeTimers();
	    let timeoutSpy;
	    try {
	      const modelRouterCall = vi.fn(() => new Promise(() => {}));
	      const stageApi = { modelRouter: { call: modelRouterCall } };
	      const caller = getDesignModelCaller(stageApi);

	      timeoutSpy = vi.spyOn(globalThis, "setTimeout");
	      const promise = caller([]);

	      // `getDesignModelCaller` awaits a flush barrier before scheduling the hard timeout.
	      await Promise.resolve();
	      expect(timeoutSpy).toHaveBeenCalled();
	      expect(timeoutSpy.mock.calls.some((call) => call[1] === 120000)).toBe(true);

	      const assertion = expect(promise).rejects.toMatchObject({ name: "TimeoutError", timeoutMs: 120000 });
	      await vi.advanceTimersByTimeAsync(120000);
	      await assertion;
	    } finally {
	      timeoutSpy?.mockRestore();
	      vi.useRealTimers();
	    }
	  });

  it("handles concurrent calls independently", async () => {
    const deferreds = [createDeferred(), createDeferred()];
    let idx = 0;
    const modelRouterCall = vi.fn(() => deferreds[idx++].promise);
    const stageApi = { modelRouter: { call: modelRouterCall } };
    const caller = getDesignModelCaller(stageApi);

    const p1 = caller([{ role: "user", content: "a" }]);
    const p2 = caller([{ role: "user", content: "b" }]);

    deferreds[1].resolve("second");
    deferreds[0].resolve("first");

    const results = await Promise.all([p1, p2]);
    expect(results).toEqual(["first", "second"]);

    const payload1 = modelRouterCall.mock.calls[0][0];
    const payload2 = modelRouterCall.mock.calls[1][0];
    expect(payload1.signal).not.toBe(payload2.signal);
  });

  it("handles rapid sequential calls", async () => {
    const modelRouterCall = vi.fn((payload) => Promise.resolve(payload.messages[0]?.content || "ok"));
    const stageApi = { modelRouter: { call: modelRouterCall } };
    const caller = getDesignModelCaller(stageApi);

    const results = [];
    results.push(await caller([{ role: "user", content: "one" }], { timeoutMs: Number.MAX_SAFE_INTEGER }));
    results.push(await caller([{ role: "user", content: "two" }]));
    results.push(await caller([{ role: "user", content: "three" }]));

    expect(results).toEqual(["one", "two", "three"]);
    expect(modelRouterCall).toHaveBeenCalledTimes(3);
  });
});
