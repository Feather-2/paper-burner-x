const test = require("node:test");
const assert = require("node:assert/strict");

function withEnv(patch, fn) {
  const prev = {};
  for (const [key, value] of Object.entries(patch || {})) {
    prev[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function withPatchedConsole(methods, fn) {
  const originals = {};
  for (const [k, v] of Object.entries(methods)) {
    originals[k] = console[k];
    console[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(originals)) console[k] = v;
    });
}

function createFakeSignal() {
  let aborted = false;
  let reason;
  const listeners = new Set();

  return {
    get aborted() {
      return aborted;
    },
    get reason() {
      return reason;
    },
    addEventListener(event, fn) {
      if (event === "abort" && typeof fn === "function") listeners.add(fn);
    },
    removeEventListener(event, fn) {
      if (event === "abort" && typeof fn === "function") listeners.delete(fn);
    },
    abort(nextReason) {
      aborted = true;
      reason = nextReason;
      for (const fn of Array.from(listeners)) fn();
    },
    _listeners: listeners,
  };
}

test("Design model-caller: logger injection, debug gating, hard timeout, and cleanup", async () => {
  const { NonRetryableError, isNonRetryableError, getDesignModelCaller, setLogger } = await import("../../../js/agents/stages/design/model.js");

  // NonRetryable helpers (exported)
  assert.equal(isNonRetryableError(null), false);
  assert.equal(isNonRetryableError(new NonRetryableError("x")), true);
  assert.equal(isNonRetryableError(new Error("401 Unauthorized")), true);
  assert.equal(isNonRetryableError("Invalid API key"), true);
  assert.equal(isNonRetryableError(new Error("random")), false);

  // setLogger contract
  setLogger(null);
  setLogger(() => {});
  setLogger({ debug: () => {} });
  assert.throws(() => setLogger(123), /loggerFn/i);
  setLogger(null);

  // getDesignModelCaller returns null without services
  await withEnv({ DESIGN_MODEL_TIMEOUT_MS: undefined }, async () => {
    assert.equal(getDesignModelCaller({}), null);
  });

  // Debug gating: debug disabled => injected logger not called.
  await withEnv({ NODE_ENV: "development", DEBUG_DESIGN_MODEL: "0" }, async () => {
    const logCalls = [];
    setLogger((msg, meta) => logCalls.push({ msg, meta }));

    const routerCalls = [];
    const stageApi = {
      modelRouter: {
        call: ({ usage, messages, signal }) => {
          routerCalls.push({ usage, messages, signal });
          return Promise.resolve({ content: "ok" });
        },
      },
    };

    const callModel = getDesignModelCaller(stageApi, { usage: "designer", timeoutMs: 5_000 });
    assert.equal(typeof callModel, "function");

    const out = await callModel([{ role: "user", content: "hi" }], { timeoutMs: 5_000 });
    assert.equal(out.content, "ok");
    assert.equal(routerCalls.length, 1);
    assert.equal(logCalls.length, 0);
  }).finally(() => setLogger(null));

  // Debug enabled => injected logger captures logs, and console.log is the default in dev.
  await withEnv({ NODE_ENV: "development", DEBUG_DESIGN_MODEL: "1" }, async () => {
    const injectedCalls = [];
    setLogger((msg, meta) => injectedCalls.push({ msg, meta }));

    const stageApi = {
      modelRouter: {
        call: ({ signal }) => Promise.resolve({ content: signal ? "ok" : "missing-signal" }),
      },
    };

    const callModel = getDesignModelCaller(stageApi, { usage: "designer", timeoutMs: 5_000 });
    const out = await callModel([{ role: "user", content: "hi" }], { timeoutMs: 5_000 });
    assert.equal(out.content, "ok");
    assert.ok(injectedCalls.some((c) => String(c.msg).includes("[design.model] call via ModelRouter")));

    setLogger(null);
    const consoleCalls = [];
    await withPatchedConsole(
      {
        log: (msg, meta) => consoleCalls.push({ msg, meta }),
      },
      async () => {
        const out2 = await callModel([{ role: "user", content: "hi" }], { timeoutMs: 5_000 });
        assert.equal(out2.content, "ok");
      }
    );
    assert.ok(consoleCalls.some((c) => String(c.msg).includes("[design.model] call via ModelRouter")));
  }).finally(() => setLogger(null));

  // Production env: debug logs are suppressed even if DEBUG_DESIGN_MODEL is set.
  await withEnv({ NODE_ENV: "production", DEBUG_DESIGN_MODEL: "1" }, async () => {
    const logCalls = [];
    setLogger((msg, meta) => logCalls.push({ msg, meta }));

    const stageApi = {
      modelRouter: {
        call: () => Promise.resolve({ content: "ok" }),
      },
    };

    const callModel = getDesignModelCaller(stageApi);
    const out = await callModel([{ role: "user", content: "hi" }], { timeoutMs: 5_000 });
    assert.equal(out.content, "ok");
    assert.equal(logCalls.length, 0);
  }).finally(() => setLogger(null));

  // Hard timeout: aborts and rejects with code=124; removes outer abort listeners on completion.
  await withEnv({ NODE_ENV: "development", DEBUG_DESIGN_MODEL: "0", DESIGN_MODEL_TIMEOUT_MS: "25" }, async () => {
    const outerSignal = createFakeSignal();
    assert.equal(outerSignal._listeners.size, 0);

    let capturedHardSignal = null;
    const stageApi = {
      modelRouter: {
        call: ({ signal }) => {
          capturedHardSignal = signal;
          return new Promise((_, reject) => {
            signal?.addEventListener?.("abort", () => reject(new Error("aborted")), { once: true });
          });
        },
      },
    };

    const callModel = getDesignModelCaller(stageApi);
    await assert.rejects(
      () => callModel([{ role: "user", content: "hi" }], { signal: outerSignal }),
      (err) => err && err.code === 124 && err.name === "TimeoutError"
    );

    assert.ok(capturedHardSignal && capturedHardSignal.aborted === true);
    assert.equal(outerSignal._listeners.size, 0);
  }).finally(() => setLogger(null));

  // Cleanup: outer abort listeners are removed after a successful call.
  await withEnv({ NODE_ENV: "development", DEBUG_DESIGN_MODEL: "0" }, async () => {
    const outerSignal = createFakeSignal();

    const stageApi = {
      modelRouter: {
        call: ({ signal }) => Promise.resolve({ content: signal ? "ok" : "missing" }),
      },
    };

    const callModel = getDesignModelCaller(stageApi, { timeoutMs: 5_000 });
    const out = await callModel([{ role: "user", content: "hi" }], { signal: outerSignal });
    assert.equal(out.content, "ok");
    assert.equal(outerSignal._listeners.size, 0);
  });

  // Outer abort: propagates as AbortError and preserves string and Error reasons.
  await withEnv({ NODE_ENV: "development", DEBUG_DESIGN_MODEL: "0" }, async () => {
    const stageApi = { modelRouter: { call: () => Promise.resolve({ content: "ok" }) } };
    const callModel = getDesignModelCaller(stageApi, { timeoutMs: 5_000 });

    const abortedString = createFakeSignal();
    abortedString.abort("stop-now");
    await assert.rejects(() => callModel([{ role: "user", content: "hi" }], { signal: abortedString }), /stop-now/);

    const abortedError = createFakeSignal();
    abortedError.abort(new Error("stop-error"));
    await assert.rejects(() => callModel([{ role: "user", content: "hi" }], { signal: abortedError }), /stop-error/);

    const abortedUnknown = createFakeSignal();
    abortedUnknown.abort({ any: "thing" });
    await assert.rejects(() => callModel([{ role: "user", content: "hi" }], { signal: abortedUnknown }), /Run cancelled/);
  });

  // aiApiService.chat fallback path
  await withEnv({ NODE_ENV: "development", DEBUG_DESIGN_MODEL: "0" }, async () => {
    let capturedSignal = null;
    const stageApi = {
      aiApiService: {
        chat: ({ signal }) => {
          capturedSignal = signal;
          return Promise.resolve({ content: "ok-chat" });
        },
      },
    };
    const callModel = getDesignModelCaller(stageApi, { timeoutMs: 5_000 });
    const out = await callModel([{ role: "user", content: "hi" }], { timeoutMs: 5_000 });
    assert.equal(out.content, "ok-chat");
    assert.ok(capturedSignal && typeof capturedSignal.addEventListener === "function");
  });

  // Legacy router signature (routerCall.length >= 2)
  await withEnv({ NODE_ENV: "development", DEBUG_DESIGN_MODEL: "0" }, async () => {
    const seen = [];
    const stageApi = {
      modelRouter: {
        call: (messages, opts) => {
          seen.push({ messages, opts });
          return Promise.resolve({ content: "ok-legacy" });
        },
      },
    };

    const callModel = getDesignModelCaller(stageApi, { usage: "brainstorm", timeoutMs: 5_000 });
    const out = await callModel([{ role: "user", content: "hi" }], null);
    assert.equal(out.content, "ok-legacy");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].opts.usage, "brainstorm");
    assert.ok(seen[0].opts.signal && typeof seen[0].opts.signal.addEventListener === "function");
  });
});

