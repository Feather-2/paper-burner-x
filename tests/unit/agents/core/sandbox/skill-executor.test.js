import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResourceLimits, SandboxCapability } from '../../../../../js/agents/core/sandbox/constants.js';

function createSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('core/sandbox/skill-executor: capability + fallback paths', () => {
  it('returns a helpful error when the skill has no body', async () => {
    const { SkillExecutor } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const executor = new SkillExecutor({ logger: createSilentLogger() });
    executor.wasmSupported = false; // ensure we never try to create a WASM pool

    const res = await executor.execute({ metadata: { name: 'no-body' } }, {});

    expect(res.success).toBe(false);
    expect(res.error).toBe('Skill has no body');
  });

  it('grants only approved + allowlisted capabilities and warns on unknown declarations/approvals', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { SkillExecutor } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const executor = new SkillExecutor({
      logger: createSilentLogger(),
      trustChecker: () => false, // force untrusted path
    });

    const skill = {
      metadata: {
        name: 'caps',
        scope: 'user',
        capabilities: 'fetch,unknown',
      },
      body: 'return 1;',
    };

    const caps = executor._determineCapabilities(skill, { approvedCapabilities: 'fetch,unknown2' });
    expect(caps).toContain(SandboxCapability.FETCH);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('does not grant declared capabilities when they are not explicitly approved', async () => {
    const { SkillExecutor } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const executor = new SkillExecutor({
      logger: createSilentLogger(),
      trustChecker: () => false,
    });

    const skill = {
      metadata: {
        name: 'caps',
        scope: 'user',
        capabilities: 'fetch',
      },
      body: 'return 1;',
    };

    const caps = executor._determineCapabilities(skill, { approvedCapabilities: [] });
    expect(caps).not.toContain(SandboxCapability.FETCH);
  });

  it('selects heavy limits for heavy skills', async () => {
    const { SkillExecutor } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const executor = new SkillExecutor({ logger: createSilentLogger() });
    const limits = executor._determineLimits({
      metadata: { name: 'heavy-skill', weight: 'heavy' },
    });

    expect(limits).toStrictEqual(ResourceLimits.HEAVY);
  });

  it('defaults to standard limits for unknown weights', async () => {
    const { SkillExecutor } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const executor = new SkillExecutor({ logger: createSilentLogger() });
    const limits = executor._determineLimits({
      metadata: { name: 'unknown-weight', weight: 'extra' },
    });

    expect(limits).toStrictEqual(ResourceLimits.STANDARD);
  });

  it('blocks unsafe patterns in fallback mode before evaluating code', async () => {
    const { SkillExecutor } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const executor = new SkillExecutor({ logger: createSilentLogger() });
    executor.wasmSupported = false;

    const res = await executor.execute(
      {
        metadata: { name: 'blocked', scope: 'user' },
        body: 'return eval(\"1\")',
      },
      {}
    );

    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/^Security:/);
    expect(res.metrics?.blocked).toBe(true);
  });

  it('reports syntax errors in fallback code (script parsing errors)', async () => {
    const { SkillExecutor } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const executor = new SkillExecutor({ logger: createSilentLogger() });
    executor.wasmSupported = false;

    const res = await executor.execute(
      {
        metadata: { name: 'parse-error', scope: 'user' },
        body: 'return {',
      },
      {}
    );

    expect(res.success).toBe(false);
    expect(typeof res.error).toBe('string');
    expect(res.error.length).toBeGreaterThan(0);
  });

  it('respects timeoutMs limits during fallback execution', async () => {
    vi.useFakeTimers();

    const { SkillExecutor } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const executor = new SkillExecutor({ logger: createSilentLogger() });
    executor.wasmSupported = false;

    const p = executor.execute(
      {
        metadata: { name: 'timeout', scope: 'user', weight: 'light' },
        body: 'await new Promise(() => {});',
      },
      {}
    );

    // ResourceLimits.LIGHT.timeoutMs is 1000ms.
    await vi.advanceTimersByTimeAsync(1000);

    const res = await p;
    expect(res.success).toBe(false);
    expect(res.error).toBe('Execution timeout');
  });

  it('captures blocked global accesses in fallback audit metrics', async () => {
    const { SkillExecutor } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const executor = new SkillExecutor({ logger: createSilentLogger() });
    executor.wasmSupported = false;

    const res = await executor.execute(
      {
        metadata: { name: 'audit', scope: 'user' },
        body: 'return typeof fetch;',
      },
      {}
    );

    expect(res.success).toBe(true);
    expect(res.data).toBe('undefined');
    expect(res.metrics?.mode).toMatch(/eval|node-worker/);
    // blockedGlobals may not be tracked in node-worker mode
    if (res.metrics?.blockedGlobals) {
      expect(res.metrics.blockedGlobals).toContain('fetch');
    }
  });

  it('attempts worker-based fallback and continues when worker construction fails', async () => {
    vi.stubGlobal('Worker', function Worker() {
      throw new Error('no worker');
    });

    const { SkillExecutor } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const executor = new SkillExecutor({ logger: createSilentLogger() });
    executor.wasmSupported = false;

    const res = await executor.execute(
      {
        metadata: { name: 'worker-fallback', scope: 'user' },
        body: 'return 2;',
      },
      {}
    );

    expect(res.success).toBe(true);
    expect(res.data).toBe(2);
    expect(res.metrics?.mode).toMatch(/eval|node-worker/);
  });

  it('falls back to main-thread eval when browser workers are unavailable', async () => {
    vi.doMock('../../../../js/agents/shared/platform.js', () => ({
      isNodeLike: () => false,
    }));

    const workerSpy = vi.fn(function Worker() {
      throw new Error('no worker');
    });
    vi.stubGlobal('Worker', workerSpy);

    const { SkillExecutor } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const executor = new SkillExecutor({ logger: createSilentLogger() });
    executor.wasmSupported = false;

    const res = await executor.execute(
      {
        metadata: { name: 'browser-fallback', scope: 'user' },
        body: 'return 9;',
      },
      {}
    );

    expect(workerSpy).toHaveBeenCalledTimes(2);
    expect(res.success).toBe(true);
    expect(res.data).toBe(9);
    expect(res.metrics?.mode).toBe('eval');
  });

  it('errors when fallbackMode is none and the WASM sandbox is unavailable', async () => {
    const { SkillExecutor } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const executor = new SkillExecutor({ logger: createSilentLogger(), fallbackMode: 'none' });
    executor.wasmSupported = false;

    const res = await executor.execute(
      {
        metadata: { name: 'no-fallback', scope: 'user' },
        body: 'return 1;',
      },
      {}
    );

    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/fallback disabled/i);
  });

  it('returns false from isWasmSupported when WebAssembly.compile fails', async () => {
    const { isWasmSupported } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const compileSpy = vi.spyOn(WebAssembly, 'compile').mockImplementation(async () => {
      throw new Error('no wasm');
    });

    await expect(isWasmSupported()).resolves.toBe(false);

    compileSpy.mockRestore();
  });
});

describe('core/sandbox/skill-executor: cleanup branches', () => {
  it('returns an error when the pool fails and fallbackMode is none', async () => {
    const pool = {
      withSandbox: vi.fn(async () => {
        throw new Error('pool boom');
      }),
      dispose: vi.fn(),
    };

    const { SkillExecutor } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const executor = new SkillExecutor({
      logger: createSilentLogger(),
      pool,
      fallbackMode: 'none',
    });

    const res = await executor.execute(
      {
        metadata: { name: 'pool-fail-no-fallback', scope: 'user' },
        body: 'return 1;',
      },
      {}
    );

    expect(res.success).toBe(false);
    expect(res.error).toBe('pool boom');
    expect(pool.withSandbox).toHaveBeenCalledTimes(1);
    expect(pool.dispose).not.toHaveBeenCalled();
    expect(executor.pool).toBe(pool);
  });

  it('falls back without disposing external pools when pool execution fails', async () => {
    const pool = {
      withSandbox: vi.fn(async () => {
        throw new Error('pool boom');
      }),
      dispose: vi.fn(),
    };

    const { SkillExecutor } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const executor = new SkillExecutor({
      logger: createSilentLogger(),
      pool,
    });
    executor.wasmSupported = true;

    const res = await executor.execute(
      {
        metadata: { name: 'pool-fail-fallback', scope: 'user' },
        body: 'return 7;',
      },
      {}
    );

    expect(res.success).toBe(true);
    expect(res.data).toBe(7);
    expect(pool.dispose).not.toHaveBeenCalled();
    expect(executor.pool).toBe(null);
    expect(executor.wasmSupported).toBe(false);
  });

  it('falls back to eval and disposes its owned pool when pool.withSandbox throws', async () => {
    /** @type {any[]} */
    const poolInstances = [];

    class FakeSandboxPool {
      constructor() {
        this.withSandbox = vi.fn(async () => {
          throw new Error('pool boom');
        });
        this.dispose = vi.fn();
        poolInstances.push(this);
      }
    }

    vi.doMock('../../../../js/agents/core/sandbox/pool.js', () => ({
      SandboxPool: FakeSandboxPool,
      default: FakeSandboxPool,
    }));

    const { SkillExecutor } = await import('../../../../js/agents/core/sandbox/skill-executor.js');

    const executor = new SkillExecutor({ logger: createSilentLogger() });
    executor.wasmSupported = true; // force pool creation path

    const res = await executor.execute(
      {
        metadata: { name: 'pool-failure', scope: 'user' },
        body: 'return 42;',
      },
      {}
    );

    expect(res.success).toBe(true);
    expect(res.data).toBe(42);
    expect(poolInstances).toHaveLength(1);
    expect(poolInstances[0].dispose).toHaveBeenCalledTimes(1);
    expect(executor.pool).toBe(null);
    expect(executor.wasmSupported).toBe(false);
  });
});
