import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function importSkillExecutorWithPoolMock({ withSandboxImpl } = {}) {
  const instances = [];
  class SandboxPoolMock {
    constructor(opts) {
      this.opts = opts;
      this.dispose = vi.fn();
      this.withSandbox = vi.fn((ctx, fn) => {
        const impl =
          typeof withSandboxImpl === "function"
            ? withSandboxImpl
            : async (_ctx, _fn) => _fn({ executeAsync: vi.fn(async () => ({ success: true, data: "ok", metrics: {} })) });
        return impl(ctx, fn);
      });
      instances.push(this);
    }
    static get instances() {
      return instances;
    }
  }

  vi.doMock("../../../js/agents/core/sandbox/pool.js", () => ({ SandboxPool: SandboxPoolMock }));
  const mod = await import("../../../js/agents/core/sandbox/skill-executor.js");
  return { mod, SandboxPoolMock };
}

describe("core/sandbox/skill-executor: WASM detection", () => {
  it("isWasmSupported returns false when WebAssembly is unavailable", async () => {
    vi.stubGlobal("WebAssembly", undefined);
    const { mod } = await importSkillExecutorWithPoolMock();
    await expect(mod.isWasmSupported()).resolves.toBe(false);
  });

  it("isWasmSupported returns false when WebAssembly.compile throws", async () => {
    vi.stubGlobal("WebAssembly", { compile: vi.fn(async () => Promise.reject(new Error("nope"))) });
    const { mod } = await importSkillExecutorWithPoolMock();
    await expect(mod.isWasmSupported()).resolves.toBe(false);
  });
});

describe("core/sandbox/skill-executor: capability + limits", () => {
  it("returns TRUSTED preset for trusted skills", async () => {
    const { mod } = await importSkillExecutorWithPoolMock();
    const { SandboxPreset } = await import("../../../js/agents/core/sandbox/constants.js");

    const executor = new mod.SkillExecutor({ trustChecker: vi.fn(() => true) });
    const caps = executor._determineCapabilities({ metadata: { name: "T", scope: "user" } }, {});
    expect(caps).toBe(SandboxPreset.TRUSTED);
  });

  it("only grants declared capabilities when explicitly approved (unknown caps warn but do not grant)", async () => {
    const { mod } = await importSkillExecutorWithPoolMock();
    const { SandboxCapability, SandboxPreset } = await import("../../../js/agents/core/sandbox/constants.js");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const executor = new mod.SkillExecutor({ trustChecker: vi.fn(() => false) });

    const skill = { metadata: { name: "U", scope: "user", capabilities: ["fetch", "unknown-cap"] } };

    const noApproval = executor._determineCapabilities(skill, {});
    expect(noApproval).toEqual(SandboxPreset.SKILL);
    expect(noApproval).not.toContain(SandboxCapability.FETCH);

    const approved = executor._determineCapabilities(skill, { approvedCapabilities: ["fetch", "unknown-approval"] });
    expect(approved).toContain(SandboxCapability.FETCH);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("uses resource limits based on metadata.weight", async () => {
    const { mod } = await importSkillExecutorWithPoolMock();
    const { ResourceLimits } = await import("../../../js/agents/core/sandbox/constants.js");

    const executor = new mod.SkillExecutor();
    expect(executor._determineLimits({ metadata: { weight: "light" } })).toEqual(ResourceLimits.LIGHT);
    expect(executor._determineLimits({ metadata: { weight: "heavy" } })).toEqual(ResourceLimits.HEAVY);
    expect(executor._determineLimits({ metadata: { weight: "standard" } })).toEqual(ResourceLimits.STANDARD);
    expect(executor._determineLimits({ metadata: {} })).toEqual(ResourceLimits.STANDARD);
  });
});

describe("core/sandbox/skill-executor: pool init + execute", () => {
  it("initializes a SandboxPool when wasmSupported is true and no pool is provided", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { mod, SandboxPoolMock } = await importSkillExecutorWithPoolMock();

    const executor = new mod.SkillExecutor({ logger });
    executor.wasmSupported = true;

    const pool = await executor._ensurePool();
    expect(pool).toBeInstanceOf(SandboxPoolMock);
    expect(pool.opts).toEqual({ maxSize: 4, defaultCapabilities: expect.any(Array) });

    executor.dispose();
    expect(pool.dispose).toHaveBeenCalledTimes(1);
  });

  it("warns only once when wasm is unsupported and fallbackMode is enabled", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { mod } = await importSkillExecutorWithPoolMock();

    const executor = new mod.SkillExecutor({ logger, fallbackMode: "eval" });
    executor.wasmSupported = false;

    await expect(executor._ensurePool()).resolves.toBeNull();
    await expect(executor._ensurePool()).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("returns a structured error when skill body is missing", async () => {
    const { mod } = await importSkillExecutorWithPoolMock();
    const executor = new mod.SkillExecutor();
    const res = await executor.execute({ metadata: { name: "NoBody", scope: "user" }, body: "" }, {});
    expect(res).toMatchObject({ success: false, error: "Skill has no body" });
  });

  it("fails when wasm is unavailable and fallbackMode is none", async () => {
    const { mod } = await importSkillExecutorWithPoolMock();
    const executor = new mod.SkillExecutor({ fallbackMode: "none", logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    executor.wasmSupported = false;

    const res = await executor.execute({ metadata: { name: "X", scope: "user" }, body: "return 1;" }, {});
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/fallback disabled/i);
  });

  it("blocks dangerous patterns in fallback mode", async () => {
    const { mod } = await importSkillExecutorWithPoolMock();
    const executor = new mod.SkillExecutor({ fallbackMode: "eval", logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    executor.wasmSupported = false;

    const res = await executor.execute({ metadata: { name: "Danger", scope: "user" }, body: "eval('1')" }, {});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/^Security:/);
    expect(res.metrics).toMatchObject({ blocked: true, mode: "eval" });
  });

  it("executes in main-thread fallback and isolates host globals via Proxy", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const kernel = { events: { emit: vi.fn() } };

    const { mod } = await importSkillExecutorWithPoolMock();
    const executor = new mod.SkillExecutor({ fallbackMode: "eval", logger, kernel });
    executor.wasmSupported = false;

    const originalWorker = globalThis.Worker;
    try {
      if (typeof originalWorker !== "undefined") vi.stubGlobal("Worker", undefined);

      const res = await executor.execute(
        {
          metadata: { name: "FallbackMain", scope: "user" },
          body: "console.log('hi'); emit('done',{x:1}); return [typeof Buffer, foo + 1, typeof eval];",
        },
        { args: { foo: 1 } }
      );

      expect(res.success).toBe(true);
      expect(res.data).toEqual(["undefined", 2, "undefined"]);
      expect(res.metrics.mode).toBe("eval");
      expect(res.metrics.blockedGlobals).toContain("eval");
      expect(res.logs).toHaveLength(1);
      expect(res.emits).toHaveLength(1);

      // Kernel should receive forwarded events.
      expect(kernel.events.emit).toHaveBeenCalledWith("skill:log", expect.any(Object));
      expect(kernel.events.emit).toHaveBeenCalledWith("skill:done", expect.any(Object));
    } finally {
      if (typeof originalWorker !== "undefined") vi.stubGlobal("Worker", originalWorker);
    }
  });

  it("falls back to eval when WASM pool.withSandbox throws (and disposes the pool)", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { mod, SandboxPoolMock } = await importSkillExecutorWithPoolMock({
      withSandboxImpl: async () => {
        throw new Error("boom");
      },
    });

    const executor = new mod.SkillExecutor({ fallbackMode: "eval", logger });
    executor.wasmSupported = true;

    // Ensure we hit main-thread fallback.
    vi.stubGlobal("Worker", undefined);

    const res = await executor.execute({ metadata: { name: "FallbackAfterWasm", scope: "user" }, body: "return 1;" }, {});
    expect(res.success).toBe(true);
    expect(res.data).toBe(1);

    // The pool that was created should be disposed since this executor owns it.
    expect(SandboxPoolMock.instances).toHaveLength(1);
    expect(SandboxPoolMock.instances[0].dispose).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("WASM sandbox failed, falling back to eval", expect.any(Object));
  });

  it("executes in WASM mode via pool.withSandbox when available", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { mod, SandboxPoolMock } = await importSkillExecutorWithPoolMock({
      withSandboxImpl: async (ctx, fn) => {
        // Simulate sandbox emitting and logging during execution.
        ctx.onLog("info", ["hello"]);
        ctx.onEmit("tick", { n: 1 });
        return await fn({
          executeAsync: vi.fn(async () => ({ success: true, data: { ok: true }, metrics: { from: "wasm" } })),
        });
      },
    });

    const kernel = { events: { emit: vi.fn() } };
    const executor = new mod.SkillExecutor({ logger, kernel });
    executor.wasmSupported = true;

    const res = await executor.execute({ metadata: { name: "WasmOk", scope: "user" }, body: "return 0;" }, {});
    expect(res).toMatchObject({ success: true, data: { ok: true } });
    expect(res.metrics).toMatchObject({ from: "wasm" });
    expect(res.logs).toHaveLength(1);
    expect(res.emits).toHaveLength(1);
    expect(res.logs[0]).toMatchObject({ level: "info" });
    expect(res.emits[0]).toMatchObject({ name: "tick" });

    expect(SandboxPoolMock.instances).toHaveLength(1);
    expect(kernel.events.emit).toHaveBeenCalledWith("skill:log", expect.any(Object));
    expect(kernel.events.emit).toHaveBeenCalledWith("skill:tick", expect.any(Object));
  });

  it("executeMany runs execute() for each skill and preserves order", async () => {
    const { mod } = await importSkillExecutorWithPoolMock();
    const executor = new mod.SkillExecutor();

    const execSpy = vi
      .spyOn(executor, "execute")
      .mockImplementation(async (skill) => ({ success: true, skill: skill?.metadata?.name || "?" }));

    const out = await executor.executeMany(
      [
        { metadata: { name: "A" }, body: "return 1;" },
        { metadata: { name: "B" }, body: "return 2;" },
      ],
      { args: { x: 1 } }
    );

    expect(execSpy).toHaveBeenCalledTimes(2);
    expect(out).toEqual([{ success: true, skill: "A" }, { success: true, skill: "B" }]);
  });
});

describe("core/sandbox/skill-executor: factory", () => {
  it("createSkillExecutor returns a SkillExecutor instance", async () => {
    const { mod } = await importSkillExecutorWithPoolMock();
    const ex = mod.createSkillExecutor({ fallbackMode: "eval" });
    expect(ex).toBeInstanceOf(mod.SkillExecutor);
  });
});

describe("core/sandbox/skill-executor: worker fallback", () => {
  it("can execute fallback in a Worker and surfaces log/emit/result messages", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { mod } = await importSkillExecutorWithPoolMock();

    /** @type {any[]} */
    const created = [];
    class MockWorker {
      constructor(_url, opts) {
        // Exercise the non-module fallback branch as well.
        if (opts && opts.type === "module") throw new Error("no module worker");
        this.terminated = false;
        created.push(this);
      }
      terminate() {
        this.terminated = true;
      }
      postMessage(msg) {
        if (msg?.type !== "execute") return;
        queueMicrotask(() => {
          this.onmessage?.({ data: { type: "log", level: "log", args: ["hi"] } });
          this.onmessage?.({ data: { type: "emit", name: "done", payload: { ok: true } } });
          this.onmessage?.({ data: { type: "audit", event: "start", payload: { x: 1 } } });
          this.onmessage?.({ data: { type: "result", success: true, data: 42, metrics: { duration: 1 } } });
        });
      }
    }

    vi.stubGlobal("Worker", MockWorker);

    const kernel = { events: { emit: vi.fn() } };
    const executor = new mod.SkillExecutor({ fallbackMode: "eval", logger, kernel });
    executor.wasmSupported = false;

    const res = await executor.execute({ metadata: { name: "WorkerOk", scope: "user" }, body: "return 1;" }, {});
    expect(res.success).toBe(true);
    expect(res.data).toBe(42);
    expect(res.metrics.mode).toBe("worker");
    expect(res.logs).toHaveLength(1);
    expect(res.emits).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(created[0].terminated).toBe(true);

    expect(kernel.events.emit).toHaveBeenCalledWith("skill:log", expect.any(Object));
    expect(kernel.events.emit).toHaveBeenCalledWith("skill:done", expect.any(Object));
  });

  it("returns a timeout error when the worker does not respond", async () => {
    const { mod } = await importSkillExecutorWithPoolMock();

    class SilentWorker {
      constructor() {}
      terminate() {}
      postMessage() {}
    }

    const executor = new mod.SkillExecutor({ fallbackMode: "eval" });
    executor.wasmSupported = false;

    vi.stubGlobal("Worker", SilentWorker);
    vi.useFakeTimers();

    const p = executor._executeFallbackInWorker(new URL("file:///worker.js"), {
      code: "return 1;",
      state: {},
      globals: {},
      timeoutMs: 10,
      onLog: vi.fn(),
      onEmit: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(1015);
    const res = await p;
    expect(res.success).toBe(false);
    expect(res.error).toBe("Worker execution timeout");
    expect(res.metrics).toMatchObject({ timedOut: true, mode: "worker" });
  });

  it("surfaces worker construction/postMessage errors", async () => {
    const { mod } = await importSkillExecutorWithPoolMock();

    class BadWorker {
      constructor() {}
      terminate() {}
      postMessage() {
        throw new Error("no postMessage");
      }
    }

    vi.stubGlobal("Worker", BadWorker);

    const executor = new mod.SkillExecutor({ fallbackMode: "eval", logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    executor.wasmSupported = false;

    const res = await executor.execute({ metadata: { name: "WorkerBad", scope: "user" }, body: "return 1;" }, {});
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/no postMessage/i);
  });
});

describe("core/sandbox/skill-executor: main-thread fallback timeout", () => {
  it("times out long-running async code", async () => {
    const { mod } = await importSkillExecutorWithPoolMock();
    const executor = new mod.SkillExecutor({ fallbackMode: "eval", logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });

    vi.useFakeTimers();
    const p = executor._executeFallbackInMainThread({
      code: "await new Promise(() => {}); return 1;",
      state: {},
      globals: {},
      timeoutMs: 5,
      onLog: vi.fn(),
      onEmit: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(10);
    const res = await p;
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/Execution timeout/);
    expect(res.metrics.mode).toBe("eval");
  });
});
