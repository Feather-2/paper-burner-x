import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ResourceLimits, SandboxCapability, SandboxPreset } from '../../../../../js/agents/core/sandbox/constants.js';

const SKILL_EXECUTOR_PATH = '../../../../../js/agents/core/sandbox/skill-executor.js';
const SKILL_SANDBOX_PATH = '../../../../../js/agents/core/sandbox/skill-sandbox.js';
const SKILL_VALIDATION_PATH = '../../../../../js/agents/core/sandbox/skill-validation.js';

const sharedMocks = vi.hoisted(() => ({
  createLogger: vi.fn(),
  isNodeLike: vi.fn(),
}));

const helperState = vi.hoisted(() => ({
  allowFallbackExecution: false,
}));

const poolState = vi.hoisted(() => ({
  instances: [],
  withSandboxImpl: null,
}));

const workerThreadsState = vi.hoisted(() => ({
  behavior: 'success',
}));

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  createLogger: sharedMocks.createLogger,
  isNodeLike: sharedMocks.isNodeLike,
}));

vi.mock('../../../../../js/agents/core/sandbox/skill-executor-helpers.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    validateFallbackCode: (code) => {
      if (helperState.allowFallbackExecution) return { valid: true };
      return actual.validateFallbackCode(code);
    },
  };
});

vi.mock('../../../../../js/agents/core/sandbox/pool.js', () => {
  class MockSandboxPool {
    constructor(options = {}) {
      this.options = options;
      this.dispose = vi.fn();
      this.withSandbox = vi.fn(async (optionsArg, fn) => {
        if (poolState.withSandboxImpl) {
          return await poolState.withSandboxImpl(this, optionsArg, fn);
        }
        if (typeof fn === 'function') {
          return await fn({
            executeAsync: vi.fn(async () => ({
              ok: true,
              value: null,
              durationMs: 0,
            })),
          });
        }
        return { ok: true, value: null, durationMs: 0 };
      });
      poolState.instances.push(this);
    }
  }
  return { SandboxPool: MockSandboxPool, default: MockSandboxPool };
});

vi.mock('node:worker_threads', () => {
  class FakeWorker {
    constructor() {
      if (workerThreadsState.behavior === 'ctor-throw') {
        throw new Error('worker ctor failed');
      }
      this.handlers = {};
    }
    on(event, handler) {
      this.handlers[event] = handler;
    }
    postMessage() {
      if (workerThreadsState.behavior === 'post-throw') {
        throw new Error('postMessage failed');
      }
      if (workerThreadsState.behavior === 'error') {
        this.handlers.error?.(new Error('worker error'));
        return;
      }
      if (workerThreadsState.behavior === 'exit') {
        this.handlers.exit?.(1);
        return;
      }
      this.handlers.message?.({
        type: 'result',
        success: true,
        data: 7,
        metrics: { duration: 1 },
      });
    }
    terminate() {}
  }
  return { Worker: FakeWorker };
});

function createSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
  poolState.instances.length = 0;
  poolState.withSandboxImpl = null;
  helperState.allowFallbackExecution = false;
  sharedMocks.isNodeLike.mockReturnValue(true);
  sharedMocks.createLogger.mockImplementation(() => createSilentLogger());
  workerThreadsState.behavior = 'success';
});

describe('isWasmSupported', () => {
  it('returns false when WebAssembly is missing', async () => {
    vi.stubGlobal('WebAssembly', undefined);
    const { isWasmSupported } = await import(SKILL_EXECUTOR_PATH);

    await expect(isWasmSupported()).resolves.toBe(false);
  });

  it('returns false when WebAssembly.compile throws', async () => {
    const { isWasmSupported } = await import(SKILL_EXECUTOR_PATH);
    const compileSpy = vi.spyOn(WebAssembly, 'compile').mockRejectedValue(new Error('no wasm'));

    await expect(isWasmSupported()).resolves.toBe(false);

    compileSpy.mockRestore();
  });

  it('returns true when WebAssembly.compile succeeds', async () => {
    const { isWasmSupported } = await import(SKILL_EXECUTOR_PATH);
    const compileSpy = vi.spyOn(WebAssembly, 'compile').mockResolvedValue(new Uint8Array());

    await expect(isWasmSupported()).resolves.toBe(true);

    compileSpy.mockRestore();
  });
});

describe('SkillExecutor', () => {
  it('uses default logger and normalizes fallback config', async () => {
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const defaultLogger = createSilentLogger();
    sharedMocks.createLogger.mockReturnValueOnce(defaultLogger);

    const executor = new SkillExecutor({
      fallbackMode: '   ',
      fallbackAllowlist: ['  ', 'skill-a', '', 0],
    });

    expect(sharedMocks.createLogger).toHaveBeenCalledWith('core/sandbox/skill-executor');
    expect(executor.logger).toBe(defaultLogger);
    expect(executor.fallbackMode).toBe('eval');
    expect(executor.fallbackAllowlist).toBeInstanceOf(Set);
    expect(executor.fallbackAllowlist.has('skill-a')).toBe(true);
    expect(executor.fallbackAllowlist.has('  ')).toBe(false);
    expect(executor.fallbackPolicy).toMatchObject({
      enabled: false,
      mode: 'eval',
    });
  });

  it('trusts only system-scoped skills by default', async () => {
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const { defaultTrustChecker } = await import(SKILL_VALIDATION_PATH);
    const executor = new SkillExecutor({ logger: createSilentLogger() });

    expect(executor.trustChecker).toBe(defaultTrustChecker);
    expect(executor.trustChecker({ metadata: { scope: 'system' } })).toBe(true);
    expect(executor.trustChecker({ metadata: { scope: 'user' } })).toBe(false);
    expect(executor.trustChecker({ metadata: {} })).toBe(false);
  });

  it('evaluates fallback allowlist and trust flags correctly', async () => {
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const { isFallbackAllowed } = await import(SKILL_VALIDATION_PATH);
    const logger = createSilentLogger();

    const trusted = new SkillExecutor({ logger, trustChecker: () => true });
    expect(isFallbackAllowed({}, undefined, trusted.trustChecker, trusted.fallbackAllowlist, logger)).toBe(true);

    const contextTrusted = new SkillExecutor({ logger, trustChecker: () => false });
    expect(
      isFallbackAllowed(
        { metadata: { name: 'x' } },
        { trusted: true },
        contextTrusted.trustChecker,
        contextTrusted.fallbackAllowlist,
        logger
      )
    ).toBe(true);

    const allowlisted = new SkillExecutor({
      logger,
      trustChecker: () => false,
      fallbackAllowlist: ['allow'],
    });
    expect(
      isFallbackAllowed(
        { id: 'allow' },
        undefined,
        allowlisted.trustChecker,
        allowlisted.fallbackAllowlist,
        logger
      )
    ).toBe(true);
    expect(
      isFallbackAllowed(
        { metadata: { name: 'allow' } },
        undefined,
        allowlisted.trustChecker,
        allowlisted.fallbackAllowlist,
        logger
      )
    ).toBe(true);

    const contextAllowlist = new SkillExecutor({ logger, trustChecker: () => false });
    expect(
      isFallbackAllowed(
        { id: 'set-allowed' },
        { fallbackAllowlist: new Set(['set-allowed']) },
        contextAllowlist.trustChecker,
        contextAllowlist.fallbackAllowlist,
        logger
      )
    ).toBe(true);

    const emptyAllowlist = new SkillExecutor({
      logger,
      trustChecker: () => false,
      fallbackAllowlist: [],
    });
    expect(
      isFallbackAllowed(
        { id: 'allow' },
        undefined,
        emptyAllowlist.trustChecker,
        emptyAllowlist.fallbackAllowlist,
        logger
      )
    ).toBe(false);

    const invalidAllowlist = new SkillExecutor({
      logger,
      trustChecker: () => false,
      fallbackAllowlist: { 0: 'allow' },
    });
    expect(
      isFallbackAllowed(
        { id: 'allow' },
        undefined,
        invalidAllowlist.trustChecker,
        invalidAllowlist.fallbackAllowlist,
        logger
      )
    ).toBe(false);
    expect(
      isFallbackAllowed(
        { id: 0 },
        undefined,
        invalidAllowlist.trustChecker,
        invalidAllowlist.fallbackAllowlist,
        logger
      )
    ).toBe(false);
  });

  it('grants all capabilities to trusted skills', async () => {
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const { determineCapabilities } = await import(SKILL_VALIDATION_PATH);
    const executor = new SkillExecutor({
      logger: createSilentLogger(),
      trustChecker: () => true,
    });

    const caps = determineCapabilities(
      { metadata: { name: 'trusted' } },
      {},
      executor.trustChecker,
      executor.logger
    );

    expect(caps).toStrictEqual(SandboxPreset.TRUSTED);
  });

  it('grants only approved declared capabilities and warns on unknown entries', async () => {
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const { determineCapabilities } = await import(SKILL_VALIDATION_PATH);
    const logger = createSilentLogger();
    const executor = new SkillExecutor({
      logger,
      trustChecker: () => false,
    });

    const skill = {
      metadata: {
        name: 'caps',
        scope: 'user',
        capabilities: 'fetch,unknown,network',
      },
      body: 'return 1;',
    };

    const caps = determineCapabilities(
      skill,
      { approvedCapabilities: 'fetch,unknown2,network' },
      executor.trustChecker,
      executor.logger
    );

    expect(caps).toEqual(expect.arrayContaining(SandboxPreset.SKILL));
    expect(caps).toContain(SandboxCapability.FETCH);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('ignores malformed capability lists and unapproved declarations', async () => {
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const { determineCapabilities } = await import(SKILL_VALIDATION_PATH);
    const logger = createSilentLogger();
    const executor = new SkillExecutor({
      logger,
      trustChecker: () => false,
    });

    const capsFromObject = determineCapabilities(
      { metadata: { name: 'caps', capabilities: { 0: 'fetch' } } },
      { approvedCapabilities: { 0: 'fetch' } },
      executor.trustChecker,
      executor.logger
    );
    const capsFromEmpty = determineCapabilities(
      { metadata: { name: 'caps', capabilities: '   ' } },
      { approvedCapabilities: 'fetch' },
      executor.trustChecker,
      executor.logger
    );

    expect(capsFromObject).toStrictEqual(SandboxPreset.SKILL);
    expect(capsFromObject).not.toContain(SandboxCapability.FETCH);
    expect(capsFromEmpty).toStrictEqual(SandboxPreset.SKILL);
  });

  it('selects limits based on weight and defaults for edge values', async () => {
    const { determineLimits } = await import(SKILL_VALIDATION_PATH);

    expect(determineLimits({ metadata: { weight: 'light' } })).toStrictEqual(ResourceLimits.LIGHT);
    expect(determineLimits({ metadata: { weight: 'heavy' } })).toStrictEqual(ResourceLimits.HEAVY);
    expect(determineLimits({ metadata: { weight: 'extra' } })).toStrictEqual(ResourceLimits.STANDARD);
    expect(determineLimits({ metadata: { weight: 0 } })).toStrictEqual(ResourceLimits.STANDARD);
    expect(determineLimits({ metadata: { weight: -1 } })).toStrictEqual(ResourceLimits.STANDARD);
    expect(determineLimits({})).toStrictEqual(ResourceLimits.STANDARD);
  });

  it('initializes a single pool for concurrent callers', async () => {
    const module = await import(SKILL_EXECUTOR_PATH);
    const { ensurePool } = await import(SKILL_SANDBOX_PATH);
    let resolveCompile;
    const compilePromise = new Promise(resolve => {
      resolveCompile = resolve;
    });
    const compileSpy = vi.spyOn(WebAssembly, 'compile').mockReturnValue(compilePromise);
    const executor = new module.SkillExecutor({ logger: createSilentLogger() });

    const p1 = ensurePool(executor, executor.logger);
    const p2 = ensurePool(executor, executor.logger);

    expect(compileSpy).toHaveBeenCalledTimes(1);
    resolveCompile({});
    const [pool1, pool2] = await Promise.all([p1, p2]);

    expect(pool1).toBe(pool2);
    expect(poolState.instances).toHaveLength(1);
    expect(poolState.instances[0].options).toMatchObject({
      maxSize: 4,
      defaultCapabilities: SandboxPreset.SKILL,
    });
    expect(executor.pool).toBe(pool1);

    compileSpy.mockRestore();
  });

  it('warns once when WASM is unavailable', async () => {
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const { ensurePool } = await import(SKILL_SANDBOX_PATH);
    const logger = createSilentLogger();
    const executor = new SkillExecutor({ logger });
    executor.wasmSupported = false;

    const first = await ensurePool(executor, executor.logger);
    const second = await ensurePool(executor, executor.logger);

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('returns an error when the skill has no body', async () => {
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const executor = new SkillExecutor({ logger: createSilentLogger() });

    const cases = [null, undefined, {}, { metadata: { name: 'empty' }, body: '' }];
    for (const skill of cases) {
      const res = await executor.execute(skill, {});
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Skill has no body');
    }
  });

  it('executes via pool and forwards logs/emits to kernel', async () => {
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const executeAsync = vi.fn(async (body, args) => ({
      ok: true,
      value: { body, args },
      durationMs: 1,
      mode: 'wasm',
    }));
    const pool = {
      withSandbox: vi.fn(async (options, fn) => {
        options.onLog('info', ['hello']);
        options.onEmit('done', { ok: true });
        return await fn({ executeAsync });
      }),
      dispose: vi.fn(),
    };
    const kernel = { events: { emit: vi.fn() } };
    const executor = new SkillExecutor({ logger: createSilentLogger(), pool, kernel });

    const skill = { metadata: { name: 'pool-skill', scope: 'user' }, body: 'return 1;' };
    const context = { args: { count: 0 }, state: { extra: 'x' } };
    const res = await executor.execute(skill, context);

    expect(pool.withSandbox).toHaveBeenCalledTimes(1);
    const options = pool.withSandbox.mock.calls[0][0];
    expect(options.capabilities).toEqual(expect.arrayContaining(SandboxPreset.SKILL));
    expect(options.limits).toStrictEqual(ResourceLimits.STANDARD);
    expect(options.state.skill).toEqual({ name: 'pool-skill', scope: 'user' });
    expect(options.state.args).toBe(context.args);
    expect(options.state.extra).toBe('x');
    expect(executeAsync).toHaveBeenCalledWith(skill.body, context.args);

    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ body: skill.body, args: context.args });
    expect(res.logs).toHaveLength(1);
    expect(res.emits).toHaveLength(1);
    expect(res.skill).toBe('pool-skill');
    expect(res.mode).toBe('wasm');
    expect(kernel.events.emit).toHaveBeenCalledWith(
      'skill:log',
      expect.objectContaining({ skill: 'pool-skill', level: 'info' })
    );
    expect(kernel.events.emit).toHaveBeenCalledWith(
      'skill:done',
      expect.objectContaining({ skill: 'pool-skill', payload: { ok: true } })
    );
  });

  it('returns an error when fallback is disabled and WASM is unavailable', async () => {
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const executor = new SkillExecutor({ logger: createSilentLogger(), fallbackMode: 'none' });
    executor.wasmSupported = false;

    const res = await executor.execute(
      { metadata: { name: 'no-fallback', scope: 'user' }, body: 'return 1;' },
      {}
    );

    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/fallback disabled/i);
  });

  it('blocks fallback for untrusted skills without allowlist', async () => {
    sharedMocks.isNodeLike.mockReturnValue(false);
    vi.stubGlobal('Worker', undefined);
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const executor = new SkillExecutor({ logger: createSilentLogger(), fallbackMode: 'eval' });
    executor.wasmSupported = false;

    const res = await executor.execute(
      { metadata: { name: 'blocked', scope: 'user' }, body: 'return 1;' },
      {}
    );

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Security: fallback eval blocked for untrusted skill');
    expect(res.blocked).toBe(true);
  });

  it('blocks unsafe patterns before evaluating fallback code', async () => {
    sharedMocks.isNodeLike.mockReturnValue(false);
    vi.stubGlobal('Worker', undefined);
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const executor = new SkillExecutor({ logger: createSilentLogger(), fallbackMode: 'eval' });
    executor.wasmSupported = false;

    const res = await executor.execute(
      { metadata: { name: 'blocked', scope: 'system' }, body: 'return eval(\"1\")' },
      {}
    );

    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(
      /^Security: (Blocked pattern:|Fallback eval is disabled by policy)/
    );
    expect(res.blocked).toBe(true);
  });

  it('returns explicit deny-all policy message when fallback eval is configured', async () => {
    sharedMocks.isNodeLike.mockReturnValue(false);
    vi.stubGlobal('Worker', undefined);
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const executor = new SkillExecutor({ logger: createSilentLogger(), fallbackMode: 'eval' });
    executor.wasmSupported = false;

    const res = await executor.execute(
      { metadata: { name: 'policy', scope: 'system' }, body: 'return 1;' },
      {}
    );

    expect(res.ok).toBe(false);
    expect(String(res.error)).toBe('Security: Fallback eval is disabled by policy (deny-all)');
    expect(res.blocked).toBe(true);
  });

  it('reports runtime errors during main-thread fallback', async () => {
    helperState.allowFallbackExecution = true;
    sharedMocks.isNodeLike.mockReturnValue(false);
    vi.stubGlobal('Worker', undefined);
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const executor = new SkillExecutor({ logger: createSilentLogger(), fallbackMode: 'eval' });
    executor.wasmSupported = false;

    const res = await executor.execute(
      { metadata: { name: 'boom', scope: 'system' }, body: 'throw new Error(\"boom\");' },
      {}
    );

    expect(res.ok).toBe(false);
    expect(res.error).toContain('boom');
    expect(res.mode).toBe('eval');
  });

  it('respects timeout limits during fallback execution', async () => {
    vi.useFakeTimers();
    helperState.allowFallbackExecution = true;
    sharedMocks.isNodeLike.mockReturnValue(false);
    vi.stubGlobal('Worker', undefined);
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const executor = new SkillExecutor({ logger: createSilentLogger(), fallbackMode: 'eval' });
    executor.wasmSupported = false;

    const resPromise = executor.execute(
      {
        metadata: { name: 'timeout', scope: 'system', weight: 'light' },
        body: 'await new Promise(() => {});',
      },
      {}
    );

    await vi.advanceTimersByTimeAsync(ResourceLimits.LIGHT.timeoutMs);
    await Promise.resolve();
    const res = await resPromise;

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Execution timeout');
  });

  it('captures blocked globals in fallback audit metrics', async () => {
    helperState.allowFallbackExecution = true;
    sharedMocks.isNodeLike.mockReturnValue(false);
    vi.stubGlobal('Worker', undefined);
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const executor = new SkillExecutor({ logger: createSilentLogger(), fallbackMode: 'eval' });
    executor.wasmSupported = false;

    const res = await executor.execute(
      { metadata: { name: 'audit', scope: 'system' }, body: 'return typeof Function;' },
      {}
    );

    expect(res.ok).toBe(true);
    expect(res.value).toBe('undefined');
    expect(res.mode).toBe('eval');
    expect(res.blockedGlobals).toContain('Function');
  });

  it('handles large code, long strings, and deep nested state in fallback', async () => {
    helperState.allowFallbackExecution = true;
    sharedMocks.isNodeLike.mockReturnValue(false);
    vi.stubGlobal('Worker', undefined);
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const executor = new SkillExecutor({ logger: createSilentLogger(), fallbackMode: 'eval' });
    executor.wasmSupported = false;

    const bigText = 'x'.repeat(100000);
    const deepState = {
      deep: { level1: { level2: { level3: { value: 7 } } } },
      bigText,
    };
    const padding = 'x'.repeat(50000);
    const body = `/*${padding}*/ return state.deep.level1.level2.level3.value + state.bigText.length;`;

    const res = await executor.execute(
      { metadata: { name: 'big', scope: 'system' }, body },
      { state: deepState }
    );

    expect(res.ok).toBe(true);
    expect(res.value).toBe(7 + bigText.length);
  });

  it('falls back to eval and disposes owned pool on sandbox failure', async () => {
    helperState.allowFallbackExecution = true;
    sharedMocks.isNodeLike.mockReturnValue(false);
    vi.stubGlobal('Worker', undefined);
    poolState.withSandboxImpl = async () => {
      throw new Error('pool boom');
    };
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const executor = new SkillExecutor({ logger: createSilentLogger(), fallbackMode: 'eval' });
    executor.wasmSupported = true;

    const res = await executor.execute(
      { metadata: { name: 'pool-failure', scope: 'system' }, body: 'return 2;' },
      {}
    );

    expect(res.ok).toBe(true);
    expect(res.value).toBe(2);
    expect(poolState.instances).toHaveLength(1);
    expect(poolState.instances[0].dispose).toHaveBeenCalledTimes(1);
    expect(executor.pool).toBeNull();
    expect(executor.wasmSupported).toBe(false);
  });

  it('returns an error when pool execution fails and fallback is disabled', async () => {
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const pool = {
      withSandbox: vi.fn(async () => {
        throw new Error('pool boom');
      }),
      dispose: vi.fn(),
    };
    const executor = new SkillExecutor({
      logger: createSilentLogger(),
      pool,
      fallbackMode: 'none',
    });

    const res = await executor.execute(
      { metadata: { name: 'pool-fail', scope: 'system' }, body: 'return 1;' },
      {}
    );

    expect(res.ok).toBe(false);
    expect(res.error).toBe('pool boom');
    expect(pool.dispose).not.toHaveBeenCalled();
    expect(executor.pool).toBe(pool);
  });

  it('executes multiple skills concurrently and preserves order', async () => {
    helperState.allowFallbackExecution = true;
    sharedMocks.isNodeLike.mockReturnValue(false);
    vi.stubGlobal('Worker', undefined);
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const executor = new SkillExecutor({ logger: createSilentLogger(), fallbackMode: 'eval' });
    executor.wasmSupported = false;

    const skills = [
      { metadata: { name: 'a', scope: 'system' }, body: 'return state.skill.name;' },
      { metadata: { name: 'b', scope: 'system' }, body: 'return state.skill.name;' },
    ];
    const results = await executor.executeMany(skills, {});

    expect(results).toHaveLength(2);
    expect(results.map(result => result.value)).toEqual(['a', 'b']);
  });

  it('supports rapid consecutive execute calls without sharing logs', async () => {
    helperState.allowFallbackExecution = true;
    sharedMocks.isNodeLike.mockReturnValue(false);
    vi.stubGlobal('Worker', undefined);
    const { SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const executor = new SkillExecutor({ logger: createSilentLogger(), fallbackMode: 'eval' });
    executor.wasmSupported = false;

    const skill = {
      metadata: { name: 'repeat', scope: 'system' },
      body: 'console.log(\"hit\"); return 1;',
    };

    const res1 = await executor.execute(skill, {});
    const res2 = await executor.execute(skill, {});

    expect(res1.logs).toHaveLength(1);
    expect(res2.logs).toHaveLength(1);
    expect(res1.logs).not.toBe(res2.logs);
  });

  it('handles timeout boundaries and max safe integers in main-thread fallback', async () => {
    const { executeFallbackInMainThread } = await import(SKILL_SANDBOX_PATH);
    const logger = createSilentLogger();

    const resZero = await executeFallbackInMainThread({
      code: 'return maxValue;',
      state: null,
      globals: { maxValue: Number.MAX_SAFE_INTEGER },
      timeoutMs: 0,
      onLog: vi.fn(),
      onEmit: vi.fn(),
    }, logger);
    const resNegative = await executeFallbackInMainThread({
      code: 'return 1;',
      state: {},
      globals: {},
      timeoutMs: -1,
      onLog: vi.fn(),
      onEmit: vi.fn(),
    }, logger);
    const resString = await executeFallbackInMainThread({
      code: 'return typeof missing;',
      state: {},
      globals: {},
      timeoutMs: '5',
      onLog: vi.fn(),
      onEmit: vi.fn(),
    }, logger);

    expect(resZero.ok).toBe(true);
    expect(resZero.value).toBe(Number.MAX_SAFE_INTEGER);
    expect(resNegative.ok).toBe(true);
    expect(resString.ok).toBe(true);
    expect(resString.value).toBe('undefined');
  });

  it('handles worker messages during fallback execution', async () => {
    class WorkerMock {
      constructor() {
        this.onmessage = null;
        this.onerror = null;
      }
      postMessage() {
        this.onmessage?.({ data: { type: 'log', level: 'info', args: ['hello'] } });
        this.onmessage?.({ data: { type: 'emit', name: 'ping', payload: { ok: true } } });
        this.onmessage?.({ data: { type: 'audit', event: 'blocked', payload: { id: 1 } } });
        this.onmessage?.({ data: { type: 'result', success: true, data: 5, metrics: { duration: 12 } } });
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', WorkerMock);

    const { executeFallbackInWorker } = await import(SKILL_SANDBOX_PATH);
    const logger = createSilentLogger();
    const onLog = vi.fn();
    const onEmit = vi.fn();

    const res = await executeFallbackInWorker('worker.js', {
      code: 'return 1;',
      state: {},
      globals: {},
      timeoutMs: 0,
      onLog,
      onEmit,
    }, logger);

    expect(onLog).toHaveBeenCalledWith('info', ['hello']);
    expect(onEmit).toHaveBeenCalledWith('ping', { ok: true });
    expect(res.ok).toBe(true);
    expect(res.value).toBe(5);
    expect(res.mode).toBe('worker');
  });

  it('executes fallback via node worker when available', async () => {
    const { executeFallbackInNodeWorker } = await import(SKILL_SANDBOX_PATH);

    const res = await executeFallbackInNodeWorker({
      code: 'return 1;',
      state: {},
      globals: {},
      timeoutMs: 0,
      onLog: vi.fn(),
      onEmit: vi.fn(),
    }, createSilentLogger());

    expect(res.ok).toBe(true);
    expect(res.value).toBe(7);
    expect(res.mode).toBe('node-worker');
  });
});

describe('createSkillExecutor', () => {
  it('creates a SkillExecutor instance with options', async () => {
    const { createSkillExecutor, SkillExecutor } = await import(SKILL_EXECUTOR_PATH);
    const logger = createSilentLogger();

    const executor = createSkillExecutor({ logger, fallbackMode: 'eval' });

    expect(executor).toBeInstanceOf(SkillExecutor);
    expect(executor.logger).toBe(logger);
    expect(executor.fallbackMode).toBe('eval');
  });
});

describe('default export', () => {
  it('exports SkillExecutor as default', async () => {
    const module = await import(SKILL_EXECUTOR_PATH);

    expect(module.default).toBe(module.SkillExecutor);
  });
});
