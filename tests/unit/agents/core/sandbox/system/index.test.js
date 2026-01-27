import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../js/agents/core/sandbox/system/constants.js', () => {
  const SandboxBackend = Object.freeze({
    BUBBLEWRAP: 'bubblewrap',
    SEATBELT: 'seatbelt',
    DOCKER: 'docker',
    PERMISSION: 'permission',
  });

  const SandboxPolicy = Object.freeze({
    STRICT: 'strict',
    PERMISSIVE: 'permissive',
  });

  const DefaultSandboxConfig = Object.freeze({
    backend: SandboxBackend.PERMISSION,
    policy: SandboxPolicy.PERMISSIVE,
    limits: Object.freeze({ cpu: 0, memory: 0 }),
  });

  const Platform = Object.freeze({
    LINUX: 'linux',
    DARWIN: 'darwin',
    WINDOWS: 'windows',
    UNKNOWN: 'unknown',
  });

  return { SandboxBackend, SandboxPolicy, DefaultSandboxConfig, Platform };
});

vi.mock('../../../../../../js/agents/core/sandbox/system/detect.js', () => ({
  detectAllBackends: vi.fn(),
  detectBestBackend: vi.fn(),
  detectBubblewrap: vi.fn(),
  detectSeatbelt: vi.fn(),
  detectDocker: vi.fn(),
  getPlatform: vi.fn(),
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/bubblewrap.js', () => ({
  executeInBubblewrap: vi.fn(),
  createBubblewrapExecutor: vi.fn(),
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/seatbelt.js', () => ({
  executeInSeatbelt: vi.fn(),
  createSeatbeltExecutor: vi.fn(),
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/docker.js', () => ({
  executeInDocker: vi.fn(),
  createDockerExecutor: vi.fn(),
  ensureImage: vi.fn(),
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/permission.js', () => ({
  executeWithPermission: vi.fn(),
  createPermissionExecutor: vi.fn(),
  createInteractivePermissionHandler: vi.fn(),
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/executor.js', () => {
  const execInSandbox = vi.fn();
  const shellInSandbox = vi.fn();
  const createSystemSandbox = vi.fn();

  class SystemSandboxExecutor {
    constructor(...args) {
      if (args[0] === '__THROW__') throw new Error('ctor boom');
      this.args = args;
    }
  }

  return { SystemSandboxExecutor, createSystemSandbox, execInSandbox, shellInSandbox };
});

const INDEX_PATH = '../../../../../../js/agents/core/sandbox/system/index.js';
const CONSTANTS_PATH = '../../../../../../js/agents/core/sandbox/system/constants.js';
const DETECT_PATH = '../../../../../../js/agents/core/sandbox/system/detect.js';
const BUBBLEWRAP_PATH = '../../../../../../js/agents/core/sandbox/system/bubblewrap.js';
const SEATBELT_PATH = '../../../../../../js/agents/core/sandbox/system/seatbelt.js';
const DOCKER_PATH = '../../../../../../js/agents/core/sandbox/system/docker.js';
const PERMISSION_PATH = '../../../../../../js/agents/core/sandbox/system/permission.js';
const EXECUTOR_PATH = '../../../../../../js/agents/core/sandbox/system/executor.js';

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});

function makeDeepObject(depth) {
  let node = { level: depth };
  for (let i = depth - 1; i >= 0; i--) node = { level: i, child: node };
  return node;
}

function makeBoundaryArgs() {
  const emptyArr = [];
  const emptyObj = {};
  const objectAsArray = { 0: 'x', length: 1 };
  const deep = makeDeepObject(50);
  const longString = 'x'.repeat(200_000);
  const hugePath = `/tmp/${'a'.repeat(5_000)}`;

  return [
    null,
    undefined,
    '',
    '   ',
    emptyArr,
    emptyObj,
    0,
    -1,
    Number.MAX_SAFE_INTEGER,
    '42',
    objectAsArray,
    deep,
    longString,
    hugePath,
  ];
}

function defineReExportedFunctionTests(exportName, depPath, extra) {
  describe(exportName, () => {
    it('re-exports the function from its dependency module', async () => {
      const system = await import(INDEX_PATH);
      const dep = await import(depPath);
      expect(system[exportName]).toBe(dep[exportName]);
    });

    it('works on the normal path and returns underlying result', async () => {
      const system = await import(INDEX_PATH);
      const dep = await import(depPath);

      const normalArgs = ['normal', { ok: true }, [1, 2, 3]];
      dep[exportName].mockImplementation(async (...args) => ({ ok: true, args }));

      await expect(system[exportName](...normalArgs)).resolves.toEqual({
        ok: true,
        args: normalArgs,
      });
      expect(dep[exportName]).toHaveBeenCalledTimes(1);
      expect(dep[exportName]).toHaveBeenCalledWith(...normalArgs);
    });

    it('forwards empty/boundary/type/resource inputs', async () => {
      const system = await import(INDEX_PATH);
      const dep = await import(depPath);

      dep[exportName].mockImplementation(async (...args) => ({ args }));

      const args = makeBoundaryArgs();
      await expect(system[exportName](...args)).resolves.toEqual({ args });
      expect(dep[exportName]).toHaveBeenCalledTimes(1);
      expect(dep[exportName]).toHaveBeenCalledWith(...args);
    });

    it('propagates errors from the underlying implementation', async () => {
      const system = await import(INDEX_PATH);
      const dep = await import(depPath);

      dep[exportName].mockImplementation(async () => {
        throw new Error('boom');
      });

      await expect(system[exportName]('anything')).rejects.toThrow('boom');
      expect(dep[exportName]).toHaveBeenCalledTimes(1);
    });

    if (typeof extra === 'function') extra({ exportName, depPath });
  });
}

describe('SandboxBackend', () => {
  it('re-exports SandboxBackend from constants.js', async () => {
    const system = await import(INDEX_PATH);
    const constants = await import(CONSTANTS_PATH);
    expect(system.SandboxBackend).toBe(constants.SandboxBackend);
  });

  it('has a stable shape on the normal path', async () => {
    const system = await import(INDEX_PATH);
    expect(system.SandboxBackend).toEqual(
      expect.objectContaining({
        BUBBLEWRAP: expect.any(String),
        DOCKER: expect.any(String),
      })
    );
  });

  it('handles empty/unknown keys (boundary)', async () => {
    const system = await import(INDEX_PATH);
    expect(system.SandboxBackend['']).toBeUndefined();
    expect(system.SandboxBackend['   ']).toBeUndefined();
    expect(system.SandboxBackend[0]).toBeUndefined();
    expect(system.SandboxBackend[-1]).toBeUndefined();
    expect(system.SandboxBackend[Number.MAX_SAFE_INTEGER]).toBeUndefined();
    expect(system.SandboxBackend[null]).toBeUndefined();
    expect(system.SandboxBackend[undefined]).toBeUndefined();
  });

  it('throws on mutation attempts (error handling)', async () => {
    const system = await import(INDEX_PATH);
    expect(Object.isFrozen(system.SandboxBackend)).toBe(true);
    expect(() => {
      system.SandboxBackend.NEW_BACKEND = 'new';
    }).toThrow();
  });
});

describe('SandboxPolicy', () => {
  it('re-exports SandboxPolicy from constants.js', async () => {
    const system = await import(INDEX_PATH);
    const constants = await import(CONSTANTS_PATH);
    expect(system.SandboxPolicy).toBe(constants.SandboxPolicy);
  });

  it('has a stable shape on the normal path', async () => {
    const system = await import(INDEX_PATH);
    expect(system.SandboxPolicy).toEqual(
      expect.objectContaining({
        STRICT: expect.any(String),
        PERMISSIVE: expect.any(String),
      })
    );
  });

  it('handles empty/unknown keys (boundary)', async () => {
    const system = await import(INDEX_PATH);
    expect(system.SandboxPolicy['']).toBeUndefined();
    expect(system.SandboxPolicy['   ']).toBeUndefined();
    expect(system.SandboxPolicy[0]).toBeUndefined();
    expect(system.SandboxPolicy[-1]).toBeUndefined();
    expect(system.SandboxPolicy[Number.MAX_SAFE_INTEGER]).toBeUndefined();
    expect(system.SandboxPolicy[null]).toBeUndefined();
    expect(system.SandboxPolicy[undefined]).toBeUndefined();
  });

  it('throws on mutation attempts (error handling)', async () => {
    const system = await import(INDEX_PATH);
    expect(Object.isFrozen(system.SandboxPolicy)).toBe(true);
    expect(() => {
      system.SandboxPolicy.NEW_POLICY = 'new';
    }).toThrow();
  });
});

describe('DefaultSandboxConfig', () => {
  it('re-exports DefaultSandboxConfig from constants.js', async () => {
    const system = await import(INDEX_PATH);
    const constants = await import(CONSTANTS_PATH);
    expect(system.DefaultSandboxConfig).toBe(constants.DefaultSandboxConfig);
  });

  it('has a stable shape on the normal path', async () => {
    const system = await import(INDEX_PATH);
    expect(system.DefaultSandboxConfig).toEqual(
      expect.objectContaining({
        backend: expect.any(String),
        policy: expect.any(String),
        limits: expect.any(Object),
      })
    );
  });

  it('handles empty/unknown keys (boundary)', async () => {
    const system = await import(INDEX_PATH);
    expect(system.DefaultSandboxConfig['']).toBeUndefined();
    expect(system.DefaultSandboxConfig['   ']).toBeUndefined();
    expect(system.DefaultSandboxConfig[0]).toBeUndefined();
    expect(system.DefaultSandboxConfig[-1]).toBeUndefined();
    expect(system.DefaultSandboxConfig[Number.MAX_SAFE_INTEGER]).toBeUndefined();
    expect(system.DefaultSandboxConfig[null]).toBeUndefined();
    expect(system.DefaultSandboxConfig[undefined]).toBeUndefined();
  });

  it('throws on mutation attempts (error handling)', async () => {
    const system = await import(INDEX_PATH);
    expect(Object.isFrozen(system.DefaultSandboxConfig)).toBe(true);
    expect(() => {
      system.DefaultSandboxConfig.backend = 'changed';
    }).toThrow();
  });
});

describe('Platform', () => {
  it('re-exports Platform from constants.js', async () => {
    const system = await import(INDEX_PATH);
    const constants = await import(CONSTANTS_PATH);
    expect(system.Platform).toBe(constants.Platform);
  });

  it('has a stable shape on the normal path', async () => {
    const system = await import(INDEX_PATH);
    expect(system.Platform).toEqual(
      expect.objectContaining({
        LINUX: expect.any(String),
        DARWIN: expect.any(String),
      })
    );
  });

  it('handles empty/unknown keys (boundary)', async () => {
    const system = await import(INDEX_PATH);
    expect(system.Platform['']).toBeUndefined();
    expect(system.Platform['   ']).toBeUndefined();
    expect(system.Platform[0]).toBeUndefined();
    expect(system.Platform[-1]).toBeUndefined();
    expect(system.Platform[Number.MAX_SAFE_INTEGER]).toBeUndefined();
    expect(system.Platform[null]).toBeUndefined();
    expect(system.Platform[undefined]).toBeUndefined();
  });

  it('throws on mutation attempts (error handling)', async () => {
    const system = await import(INDEX_PATH);
    expect(Object.isFrozen(system.Platform)).toBe(true);
    expect(() => {
      system.Platform.NEW_PLATFORM = 'new';
    }).toThrow();
  });
});

defineReExportedFunctionTests('detectAllBackends', DETECT_PATH);
defineReExportedFunctionTests('detectBestBackend', DETECT_PATH);
defineReExportedFunctionTests('detectBubblewrap', DETECT_PATH);
defineReExportedFunctionTests('detectSeatbelt', DETECT_PATH);
defineReExportedFunctionTests('detectDocker', DETECT_PATH);
defineReExportedFunctionTests('getPlatform', DETECT_PATH);

defineReExportedFunctionTests('executeInBubblewrap', BUBBLEWRAP_PATH);
defineReExportedFunctionTests('createBubblewrapExecutor', BUBBLEWRAP_PATH);

defineReExportedFunctionTests('executeInSeatbelt', SEATBELT_PATH);
defineReExportedFunctionTests('createSeatbeltExecutor', SEATBELT_PATH);

defineReExportedFunctionTests('executeInDocker', DOCKER_PATH);
defineReExportedFunctionTests('createDockerExecutor', DOCKER_PATH);
defineReExportedFunctionTests('ensureImage', DOCKER_PATH);

defineReExportedFunctionTests('executeWithPermission', PERMISSION_PATH);
defineReExportedFunctionTests('createPermissionExecutor', PERMISSION_PATH);
defineReExportedFunctionTests('createInteractivePermissionHandler', PERMISSION_PATH);

describe('SystemSandboxExecutor', () => {
  it('re-exports the class from executor.js', async () => {
    const system = await import(INDEX_PATH);
    const executor = await import(EXECUTOR_PATH);
    expect(system.SystemSandboxExecutor).toBe(executor.SystemSandboxExecutor);
  });

  it('constructs on the normal path', async () => {
    const system = await import(INDEX_PATH);
    const inst = new system.SystemSandboxExecutor('normal', { ok: true });
    expect(inst).toBeInstanceOf(system.SystemSandboxExecutor);
    expect(inst.args).toEqual(['normal', { ok: true }]);
  });

  it('constructs with boundary/type/resource inputs', async () => {
    const system = await import(INDEX_PATH);
    const args = makeBoundaryArgs();
    const inst = new system.SystemSandboxExecutor(...args);
    expect(inst).toBeInstanceOf(system.SystemSandboxExecutor);
    expect(inst.args).toEqual(args);
  });

  it('propagates constructor errors (error handling)', async () => {
    const system = await import(INDEX_PATH);
    expect(() => new system.SystemSandboxExecutor('__THROW__')).toThrow('ctor boom');
  });
});

defineReExportedFunctionTests('createSystemSandbox', EXECUTOR_PATH);

defineReExportedFunctionTests('execInSandbox', EXECUTOR_PATH, ({ exportName, depPath }) => {
  it('handles concurrent calls (concurrency boundary)', async () => {
    const system = await import(INDEX_PATH);
    const dep = await import(depPath);

    dep[exportName].mockImplementation(async (value) => value);

    const results = await Promise.all([
      system[exportName]('a'),
      system[exportName]('b'),
      system[exportName]('c'),
    ]);

    expect(results).toEqual(['a', 'b', 'c']);
    expect(dep[exportName]).toHaveBeenCalledTimes(3);
  });

  it('handles rapid successive calls (concurrency boundary)', async () => {
    const system = await import(INDEX_PATH);
    const dep = await import(depPath);

    dep[exportName].mockImplementation(async (value) => value);

    const promises = [];
    for (let i = 0; i < 25; i++) promises.push(system[exportName](i));
    const results = await Promise.all(promises);

    expect(results[0]).toBe(0);
    expect(results[24]).toBe(24);
    expect(dep[exportName]).toHaveBeenCalledTimes(25);
  });
});

defineReExportedFunctionTests('shellInSandbox', EXECUTOR_PATH, ({ exportName, depPath }) => {
  it('handles concurrent calls (concurrency boundary)', async () => {
    const system = await import(INDEX_PATH);
    const dep = await import(depPath);

    dep[exportName].mockImplementation(async (value) => value);

    const results = await Promise.all([
      system[exportName]('cmd1'),
      system[exportName]('cmd2'),
      system[exportName]('cmd3'),
    ]);

    expect(results).toEqual(['cmd1', 'cmd2', 'cmd3']);
    expect(dep[exportName]).toHaveBeenCalledTimes(3);
  });

  it('handles rapid successive calls (concurrency boundary)', async () => {
    const system = await import(INDEX_PATH);
    const dep = await import(depPath);

    dep[exportName].mockImplementation(async (value) => value);

    const promises = [];
    for (let i = 0; i < 25; i++) promises.push(system[exportName](`cmd-${i}`));
    const results = await Promise.all(promises);

    expect(results[0]).toBe('cmd-0');
    expect(results[24]).toBe('cmd-24');
    expect(dep[exportName]).toHaveBeenCalledTimes(25);
  });
});

describe('default', () => {
  it('exposes the expected surface and references named exports', async () => {
    const system = await import(INDEX_PATH);
    const api = system.default;

    expect(api).toBeTruthy();
    expect(Object.keys(api).sort()).toEqual(
      [
        'SandboxBackend',
        'createSystemSandbox',
        'detectAllBackends',
        'detectBestBackend',
        'execInSandbox',
        'shellInSandbox',
      ].sort()
    );

    expect(api.createSystemSandbox).toBe(system.createSystemSandbox);
    expect(api.execInSandbox).toBe(system.execInSandbox);
    expect(api.shellInSandbox).toBe(system.shellInSandbox);
    expect(api.detectBestBackend).toBe(system.detectBestBackend);
    expect(api.detectAllBackends).toBe(system.detectAllBackends);
    expect(api.SandboxBackend).toBe(system.SandboxBackend);
  });

  it('forwards boundary/type/resource inputs through default API', async () => {
    const system = await import(INDEX_PATH);
    const detect = await import(DETECT_PATH);
    const executor = await import(EXECUTOR_PATH);

    detect.detectBestBackend.mockImplementation(async (...args) => ({ args }));
    executor.execInSandbox.mockImplementation(async (...args) => ({ args }));

    const args = makeBoundaryArgs();

    await expect(system.default.detectBestBackend(...args)).resolves.toEqual({ args });
    expect(detect.detectBestBackend).toHaveBeenCalledTimes(1);
    expect(detect.detectBestBackend).toHaveBeenCalledWith(...args);

    await expect(system.default.execInSandbox(...args)).resolves.toEqual({ args });
    expect(executor.execInSandbox).toHaveBeenCalledTimes(1);
    expect(executor.execInSandbox).toHaveBeenCalledWith(...args);
  });

  it('propagates errors through default API', async () => {
    const system = await import(INDEX_PATH);
    const executor = await import(EXECUTOR_PATH);

    executor.shellInSandbox.mockImplementation(async () => {
      throw new Error('boom');
    });

    await expect(system.default.shellInSandbox('anything')).rejects.toThrow('boom');
    expect(executor.shellInSandbox).toHaveBeenCalledTimes(1);
  });
});