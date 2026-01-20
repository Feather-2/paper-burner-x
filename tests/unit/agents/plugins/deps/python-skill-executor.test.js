import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedDependencyManager = vi.hoisted(() => {
  const instances = [];

  class DependencyManager {
    constructor(options = {}) {
      this.options = options;
      this.resolve = vi.fn();
      this.cacheWheel = vi.fn();
      this.markLoaded = vi.fn();
      instances.push(this);
    }
  }

  return { instances, DependencyManager };
});

const mockedPythonAdapter = vi.hoisted(() => {
  const instances = [];

  class PythonRuntimeAdapter {
    constructor(options = {}) {
      this.options = options;
      this.initialize = vi.fn().mockResolvedValue(undefined);
      this.preloadPlan = vi.fn().mockResolvedValue(undefined);
      this.execute = vi.fn().mockResolvedValue({
        success: true,
        data: null,
        metrics: {},
      });
      this.terminate = vi.fn().mockResolvedValue(undefined);
      instances.push(this);
    }
  }

  return { instances, PythonRuntimeAdapter };
});

const mockedSkillRuntime = vi.hoisted(() => ({
  SkillRuntime: { PYTHON: 'python' },
}));

const mockedLogger = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  };

  return {
    logger,
    createLogger: vi.fn(() => logger),
  };
});

vi.mock('../../../../../js/agents/plugins/deps/dependency-manager.js', () => ({
  DependencyManager: mockedDependencyManager.DependencyManager,
}));

vi.mock('../../../../../js/agents/runtime/core/python-adapter.js', () => ({
  PythonRuntimeAdapter: mockedPythonAdapter.PythonRuntimeAdapter,
}));

vi.mock('../../../../../js/agents/skills/model.js', () => ({
  SkillRuntime: mockedSkillRuntime.SkillRuntime,
}));

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  createLogger: mockedLogger.createLogger,
}));

async function loadModule() {
  return await import('../../../../../js/agents/plugins/deps/python-skill-executor.js');
}

function makeSkill(overrides = {}) {
  const { metadata: metadataOverrides = {}, ...rest } = overrides;
  const metadata = {
    name: 'demo-skill',
    runtime: 'python',
    dependencies: {},
    ...metadataOverrides,
  };

  return {
    path: '/skills/demo',
    ...rest,
    metadata,
  };
}

function makePlan(overrides = {}) {
  return {
    builtin: [],
    micropip: [],
    wheels: [],
    ...overrides,
  };
}

function makeDeepState(depth = 10) {
  const root = {};
  let node = root;
  for (let i = 0; i < depth; i++) {
    node.next = { level: i };
    node = node.next;
  }
  return root;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockedDependencyManager.instances.length = 0;
  mockedPythonAdapter.instances.length = 0;
});

describe('PythonSkillExecutor', () => {
  it('constructor sets defaults and creates dependency manager', async () => {
    const { PythonSkillExecutor } = await loadModule();
    const executor = new PythonSkillExecutor();

    expect(executor.vfs).toBeNull();
    expect(executor.pythonAdapter).toBeNull();
    expect(executor._initialized).toBe(false);

    expect(mockedDependencyManager.instances).toHaveLength(1);
    expect(mockedDependencyManager.instances[0].options).toEqual({ vfs: null });
  });

  it('ensureAdapter creates and initializes adapter once', async () => {
    const { PythonSkillExecutor } = await loadModule();
    const executor = new PythonSkillExecutor();

    await executor.ensureAdapter();

    expect(mockedPythonAdapter.instances).toHaveLength(1);
    const adapter = mockedPythonAdapter.instances[0];

    expect(adapter.options).toEqual({ watchPaths: ['/mnt/workspace', '/output'] });
    expect(adapter.initialize).toHaveBeenCalledTimes(1);

    await executor.ensureAdapter();

    expect(mockedPythonAdapter.instances).toHaveLength(1);
    expect(adapter.initialize).toHaveBeenCalledTimes(1);
  });

  it('executes skill, caches wheels, and marks loaded deps', async () => {
    const { PythonSkillExecutor } = await loadModule();
    const vfs = {
      readFile: vi.fn().mockResolvedValue("print('hi')"),
    };
    const pythonAdapter = new mockedPythonAdapter.PythonRuntimeAdapter();
    const dependencyManager = new mockedDependencyManager.DependencyManager({ vfs });

    const plan = makePlan({
      builtin: ['stdlib'],
      micropip: ['requests==2.0', 'numpy>=1.0'],
      wheels: [
        { name: 'wheel-a', cached: false },
        { name: 'wheel-b', cached: true },
      ],
    });

    dependencyManager.resolve.mockResolvedValue(plan);
    dependencyManager.cacheWheel.mockImplementation(async (wheel) => ({
      ...wheel,
      cached: true,
      uri: 'cache://wheel-a',
    }));

    pythonAdapter.execute.mockResolvedValue({
      success: true,
      data: { ok: true },
      metrics: { tokens: 3 },
    });

    const executor = new PythonSkillExecutor({ vfs, pythonAdapter, dependencyManager });
    const skill = makeSkill({
      path: '/skills/demo',
      metadata: { name: 'demo', dependencies: { numpy: '>=1.0' } },
    });
    const context = { state: { run: true }, vfs };

    const result = await executor.execute(skill, context);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: true });
    expect(result.metrics.tokens).toBe(3);
    expect(typeof result.metrics.duration).toBe('number');

    expect(dependencyManager.resolve).toHaveBeenCalledWith(skill.metadata.dependencies);
    expect(dependencyManager.cacheWheel).toHaveBeenCalledTimes(1);
    expect(plan.wheels[0].cached).toBe(true);

    expect(pythonAdapter.preloadPlan).toHaveBeenCalledWith(plan);
    expect(dependencyManager.markLoaded).toHaveBeenCalledWith(['stdlib', 'requests', 'numpy']);

    expect(vfs.readFile).toHaveBeenCalledWith('/skills/demo/main.py');
    expect(pythonAdapter.execute).toHaveBeenCalledWith("print('hi')", {
      state: { run: true },
      vfs,
    });
  });

  it('executes with empty dependencies array and empty state object', async () => {
    const { PythonSkillExecutor } = await loadModule();
    const vfs = {
      readFile: vi.fn().mockResolvedValue('code'),
    };
    const pythonAdapter = new mockedPythonAdapter.PythonRuntimeAdapter();
    const dependencyManager = new mockedDependencyManager.DependencyManager({ vfs });

    dependencyManager.resolve.mockResolvedValue(makePlan());
    pythonAdapter.execute.mockResolvedValue({ success: true, data: 'ok', metrics: {} });

    const executor = new PythonSkillExecutor({ vfs, pythonAdapter, dependencyManager });
    const skill = makeSkill({ metadata: { dependencies: [] } });
    const context = { state: {}, vfs };

    const result = await executor.execute(skill, context);

    expect(result.success).toBe(true);
    expect(dependencyManager.resolve).toHaveBeenCalledWith([]);
    expect(dependencyManager.markLoaded).toHaveBeenCalledWith([]);
    expect(pythonAdapter.execute).toHaveBeenCalledWith('code', { state: {}, vfs });
  });

  it('accepts numeric entrypoints and defaults for falsy values', async () => {
    const { PythonSkillExecutor } = await loadModule();
    const vfs = {
      readFile: vi.fn().mockResolvedValue('code'),
    };
    const pythonAdapter = new mockedPythonAdapter.PythonRuntimeAdapter();
    const dependencyManager = new mockedDependencyManager.DependencyManager({ vfs });

    dependencyManager.resolve.mockImplementation(() => Promise.resolve(makePlan()));
    pythonAdapter.execute.mockResolvedValue({ success: true, data: 'ok', metrics: {} });

    const executor = new PythonSkillExecutor({ vfs, pythonAdapter, dependencyManager });

    const entrypoints = [0, -1, Number.MAX_SAFE_INTEGER, '123'];
    for (const entrypoint of entrypoints) {
      const skill = makeSkill({
        path: '/skills/num',
        metadata: { entrypoint },
      });
      const result = await executor.execute(skill, { state: { entrypoint }, vfs });
      expect(result.success).toBe(true);
    }

    expect(pythonAdapter.initialize).toHaveBeenCalledTimes(1);
    expect(pythonAdapter.execute).toHaveBeenCalledTimes(entrypoints.length);

    const expectedPaths = [
      '/skills/num/main.py',
      '/skills/num/-1',
      `/skills/num/${Number.MAX_SAFE_INTEGER}`,
      '/skills/num/123',
    ];
    expect(vfs.readFile.mock.calls.map((call) => call[0])).toEqual(expectedPaths);
  });

  it('defaults to main.py when entrypoint is empty, null, or undefined', async () => {
    const { PythonSkillExecutor } = await loadModule();
    const vfs = {
      readFile: vi.fn().mockResolvedValue('code'),
    };
    const pythonAdapter = new mockedPythonAdapter.PythonRuntimeAdapter();
    const dependencyManager = new mockedDependencyManager.DependencyManager({ vfs });

    dependencyManager.resolve.mockResolvedValue(makePlan());
    pythonAdapter.execute.mockResolvedValue({ success: true, data: 'ok', metrics: {} });

    const executor = new PythonSkillExecutor({ vfs, pythonAdapter, dependencyManager });
    const entrypoints = ['', null, undefined];

    for (const entrypoint of entrypoints) {
      const skill = makeSkill({ path: '/skills/default', metadata: { entrypoint } });
      const result = await executor.execute(skill, { state: {}, vfs });
      expect(result.success).toBe(true);
    }

    expect(vfs.readFile).toHaveBeenCalledTimes(entrypoints.length);
    expect(vfs.readFile.mock.calls.map((call) => call[0])).toEqual([
      '/skills/default/main.py',
      '/skills/default/main.py',
      '/skills/default/main.py',
    ]);
  });

  it('handles concurrent executes', async () => {
    const { PythonSkillExecutor } = await loadModule();
    const vfs = {
      readFile: vi.fn().mockResolvedValue('code'),
    };
    const pythonAdapter = new mockedPythonAdapter.PythonRuntimeAdapter();
    const dependencyManager = new mockedDependencyManager.DependencyManager({ vfs });

    dependencyManager.resolve.mockImplementation(() => Promise.resolve(makePlan()));

    const started = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    pythonAdapter.execute.mockImplementation(async (code) => {
      started.push(code);
      if (started.length === 2) {
        release();
      }
      await gate;
      return { success: true, data: code, metrics: {} };
    });

    const executor = new PythonSkillExecutor({ vfs, pythonAdapter, dependencyManager });

    const skillA = makeSkill({ path: '/skills/concurrent', metadata: { entrypoint: 'a.py' } });
    const skillB = makeSkill({ path: '/skills/concurrent', metadata: { entrypoint: 'b.py' } });

    const results = await Promise.all([
      executor.execute(skillA, { state: { n: 1 }, vfs }),
      executor.execute(skillB, { state: { n: 2 }, vfs }),
    ]);

    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    expect(pythonAdapter.execute).toHaveBeenCalledTimes(2);
    expect(dependencyManager.resolve).toHaveBeenCalledTimes(2);
  });

  it('returns error for non-python runtime (null/undefined/empty)', async () => {
    const { PythonSkillExecutor } = await loadModule();
    const vfs = {
      readFile: vi.fn().mockResolvedValue('code'),
    };
    const pythonAdapter = new mockedPythonAdapter.PythonRuntimeAdapter();
    const dependencyManager = new mockedDependencyManager.DependencyManager({ vfs });

    const executor = new PythonSkillExecutor({ vfs, pythonAdapter, dependencyManager });

    const invalidRuntimes = [null, undefined, '', 'node'];
    for (const runtime of invalidRuntimes) {
      const skill = makeSkill({ metadata: { runtime } });
      const result = await executor.execute(skill, { state: {}, vfs });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Expected Python skill');
    }

    expect(dependencyManager.resolve).not.toHaveBeenCalled();
    expect(pythonAdapter.initialize).not.toHaveBeenCalled();
  });

  it('rejects invalid entrypoints including empty and whitespace', async () => {
    const { PythonSkillExecutor } = await loadModule();
    const vfs = {
      readFile: vi.fn().mockResolvedValue('code'),
    };
    const pythonAdapter = new mockedPythonAdapter.PythonRuntimeAdapter();
    const dependencyManager = new mockedDependencyManager.DependencyManager({ vfs });

    dependencyManager.resolve.mockResolvedValue(makePlan());

    const executor = new PythonSkillExecutor({ vfs, pythonAdapter, dependencyManager });

    const invalidEntrypoints = ['   ', '.', '..', '/abs.py', 'dir/main.py', 'main\\file.py'];
    for (const entrypoint of invalidEntrypoints) {
      const skill = makeSkill({ metadata: { entrypoint } });
      const result = await executor.execute(skill, { state: {}, vfs });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid entrypoint');
    }

    expect(vfs.readFile).not.toHaveBeenCalled();
  });

  it('rejects path traversal when skill path is empty', async () => {
    const { PythonSkillExecutor } = await loadModule();
    const vfs = {
      readFile: vi.fn().mockResolvedValue('code'),
    };
    const pythonAdapter = new mockedPythonAdapter.PythonRuntimeAdapter();
    const dependencyManager = new mockedDependencyManager.DependencyManager({ vfs });

    dependencyManager.resolve.mockResolvedValue(makePlan());

    const executor = new PythonSkillExecutor({ vfs, pythonAdapter, dependencyManager });
    const skill = makeSkill({ path: '' });

    const result = await executor.execute(skill, { state: {}, vfs });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Path traversal detected');
    expect(vfs.readFile).not.toHaveBeenCalled();
  });

  it('returns error when vfs is missing', async () => {
    const { PythonSkillExecutor } = await loadModule();
    const vfs = {
      readFile: vi.fn().mockResolvedValue('code'),
    };
    const pythonAdapter = new mockedPythonAdapter.PythonRuntimeAdapter();
    const dependencyManager = new mockedDependencyManager.DependencyManager({ vfs });

    dependencyManager.resolve.mockResolvedValue(makePlan());

    const executor = new PythonSkillExecutor({ vfs: null, pythonAdapter, dependencyManager });
    const skill = makeSkill({ path: '/skills/missing' });

    const result = await executor.execute(skill, { state: {}, vfs });

    expect(result.success).toBe(false);
    expect(result.error).toContain('VFS required');
    expect(pythonAdapter.execute).not.toHaveBeenCalled();
  });

  it('handles large file, long entrypoint, and deep state', async () => {
    const { PythonSkillExecutor } = await loadModule();
    const largeText = 'x'.repeat(1024 * 1024);
    const largeBytes = new TextEncoder().encode(largeText);
    const longEntrypoint = `${'a'.repeat(2048)}.py`;
    const deepState = makeDeepState(40);

    const vfs = {
      readFile: vi.fn().mockResolvedValue(largeBytes),
    };
    const pythonAdapter = new mockedPythonAdapter.PythonRuntimeAdapter();
    const dependencyManager = new mockedDependencyManager.DependencyManager({ vfs });

    dependencyManager.resolve.mockResolvedValue(makePlan());
    pythonAdapter.execute.mockResolvedValue({ success: true, data: 'ok', metrics: {} });

    const executor = new PythonSkillExecutor({ vfs, pythonAdapter, dependencyManager });
    const skill = makeSkill({ path: '/skills/big', metadata: { entrypoint: longEntrypoint } });

    const result = await executor.execute(skill, { state: deepState, vfs });

    expect(result.success).toBe(true);
    expect(vfs.readFile).toHaveBeenCalledWith(`/skills/big/${longEntrypoint}`);

    const [code, options] = pythonAdapter.execute.mock.calls[0];
    expect(code.length).toBe(largeText.length);
    expect(options.state).toBe(deepState);
  });

  it('returns error when micropip is not an array', async () => {
    const { PythonSkillExecutor } = await loadModule();
    const vfs = {
      readFile: vi.fn().mockResolvedValue('code'),
    };
    const pythonAdapter = new mockedPythonAdapter.PythonRuntimeAdapter();
    const dependencyManager = new mockedDependencyManager.DependencyManager({ vfs });

    dependencyManager.resolve.mockResolvedValue(makePlan({ micropip: { pkg: 'numpy' } }));

    const executor = new PythonSkillExecutor({ vfs, pythonAdapter, dependencyManager });
    const skill = makeSkill();

    const result = await executor.execute(skill, { state: {}, vfs });

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('returns error when python adapter execute throws', async () => {
    const { PythonSkillExecutor } = await loadModule();
    const vfs = {
      readFile: vi.fn().mockResolvedValue('code'),
    };
    const pythonAdapter = new mockedPythonAdapter.PythonRuntimeAdapter();
    const dependencyManager = new mockedDependencyManager.DependencyManager({ vfs });

    dependencyManager.resolve.mockResolvedValue(makePlan());
    pythonAdapter.execute.mockRejectedValue(new Error('boom'));

    const executor = new PythonSkillExecutor({ vfs, pythonAdapter, dependencyManager });
    const skill = makeSkill();

    const result = await executor.execute(skill, { state: {}, vfs });

    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
  });

  it('terminate calls adapter and resets state', async () => {
    const { PythonSkillExecutor } = await loadModule();
    const pythonAdapter = new mockedPythonAdapter.PythonRuntimeAdapter();
    const dependencyManager = new mockedDependencyManager.DependencyManager({ vfs: null });

    const executor = new PythonSkillExecutor({ pythonAdapter, dependencyManager });
    executor._initialized = true;

    await executor.terminate();

    expect(pythonAdapter.terminate).toHaveBeenCalledTimes(1);
    expect(executor.pythonAdapter).toBeNull();
    expect(executor._initialized).toBe(false);
  });
});

describe('createPythonSkillExecutor', () => {
  it('returns executor instance with provided options', async () => {
    const { createPythonSkillExecutor, PythonSkillExecutor } = await loadModule();
    const vfs = { readFile: vi.fn() };

    const executor = createPythonSkillExecutor({ vfs });

    expect(executor).toBeInstanceOf(PythonSkillExecutor);
    expect(executor.vfs).toBe(vfs);
    expect(mockedDependencyManager.instances).toHaveLength(1);
  });
});

describe('executePythonSkill', () => {
  it('executes skill and terminates executor', async () => {
    const { executePythonSkill, PythonSkillExecutor } = await loadModule();
    const vfs = { readFile: vi.fn().mockResolvedValue('code') };
    const pythonAdapter = new mockedPythonAdapter.PythonRuntimeAdapter();
    const dependencyManager = new mockedDependencyManager.DependencyManager({ vfs });

    dependencyManager.resolve.mockResolvedValue(makePlan());
    pythonAdapter.execute.mockResolvedValue({ success: true, data: 'ok', metrics: {} });

    const skill = makeSkill({ path: '/skills/exec' });
    const context = { state: { ok: true }, vfs };

    const terminateSpy = vi.spyOn(PythonSkillExecutor.prototype, 'terminate');

    const result = await executePythonSkill(skill, context, { pythonAdapter, dependencyManager });

    expect(result.success).toBe(true);
    expect(terminateSpy).toHaveBeenCalledTimes(1);
    expect(pythonAdapter.terminate).toHaveBeenCalledTimes(1);

    terminateSpy.mockRestore();
  });

  it('terminates even when execute throws', async () => {
    const { executePythonSkill, PythonSkillExecutor } = await loadModule();
    const skill = makeSkill();
    const context = { state: {}, vfs: { readFile: vi.fn() } };

    const terminateSpy = vi.spyOn(PythonSkillExecutor.prototype, 'terminate');
    const executeSpy = vi
      .spyOn(PythonSkillExecutor.prototype, 'execute')
      .mockRejectedValue(new Error('explode'));

    await expect(executePythonSkill(skill, context)).rejects.toThrow('explode');
    expect(terminateSpy).toHaveBeenCalledTimes(1);

    executeSpy.mockRestore();
    terminateSpy.mockRestore();
  });
});
