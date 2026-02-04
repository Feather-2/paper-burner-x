import { describe, it, expect, vi, beforeEach } from 'vitest';

let isNodeLikeValue = false;

const systemIndexMock = {
  detectAllBackends: vi.fn(),
  detectBestBackend: vi.fn(),
  getPlatform: vi.fn(),
  createSystemSandbox: vi.fn(),
  execInSandbox: vi.fn(),
  shellInSandbox: vi.fn(),
  createBubblewrapExecutor: vi.fn(),
  createSeatbeltExecutor: vi.fn(),
  createDockerExecutor: vi.fn(),
  createPermissionExecutor: vi.fn(),
  createInteractivePermissionHandler: vi.fn(),
  SystemSandboxExecutor: class SystemSandboxExecutorMock {},
};

class MockWasmSandbox {
  constructor(...args) {
    this.args = args;
  }
}
const createSandboxMock = vi.fn((...args) => ({ kind: 'sandbox', args }));

class MockSandboxPool {
  constructor(...args) {
    this.args = args;
  }
}
const createSandboxPluginMock = vi.fn((...args) => ({ kind: 'plugin', args }));

class MockSkillExecutor {
  constructor(...args) {
    this.args = args;
  }
}
const createSkillExecutorMock = vi.fn((...args) => ({ kind: 'skill-executor', args }));
const isWasmSupportedMock = vi.fn(() => true);

const SandboxCapabilityMock = Object.freeze({ FS: 'fs', NET: 'net', PROC: 'proc' });
const SandboxPresetMock = Object.freeze({ DEFAULT: 'default', STRICT: 'strict' });
const ResourceLimitsMock = Object.freeze({ memoryMB: 64, timeMs: 1000, recursionLimit: 100 });

const SandboxBackendMock = Object.freeze({
  BUBBLEWRAP: 'bubblewrap',
  SEATBELT: 'seatbelt',
  DOCKER: 'docker',
  PERMISSION: 'permission',
});
const SandboxPolicyMock = Object.freeze({ ALLOW: 'allow', DENY: 'deny' });
const DefaultSandboxConfigMock = Object.freeze({
  backend: SandboxBackendMock.PERMISSION,
  policy: SandboxPolicyMock.ALLOW,
});
const PlatformMock = Object.freeze({ LINUX: 'linux', DARWIN: 'darwin', WINDOWS: 'windows' });

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  isNodeLike: () => isNodeLikeValue,
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../../../../js/agents/core/sandbox/system/index.js', () => systemIndexMock);
// Vite/Vitest may resolve dynamic imports to root-absolute module IDs ("/js/...") even when tests use fs paths.
// Mock both IDs to avoid accidentally importing the real system module during concurrent dynamic imports.
vi.mock('/js/agents/core/sandbox/system/index.js', () => systemIndexMock);

vi.mock('../../../../../js/agents/core/sandbox/wasm-sandbox.js', () => ({
  WasmSandbox: MockWasmSandbox,
  createSandbox: createSandboxMock,
}));

vi.mock('../../../../../js/agents/core/sandbox/pool.js', () => ({
  SandboxPool: MockSandboxPool,
}));

vi.mock('../../../../../js/agents/core/sandbox/plugin.js', () => ({
  createSandboxPlugin: createSandboxPluginMock,
}));

vi.mock('../../../../../js/agents/core/sandbox/skill-executor.js', () => ({
  SkillExecutor: MockSkillExecutor,
  createSkillExecutor: createSkillExecutorMock,
  isWasmSupported: isWasmSupportedMock,
}));

vi.mock('../../../../../js/agents/core/sandbox/constants.js', () => ({
  SandboxCapability: SandboxCapabilityMock,
  SandboxPreset: SandboxPresetMock,
  ResourceLimits: ResourceLimitsMock,
}));

vi.mock('../../../../../js/agents/core/sandbox/system/constants.js', () => ({
  SandboxBackend: SandboxBackendMock,
  SandboxPolicy: SandboxPolicyMock,
  DefaultSandboxConfig: DefaultSandboxConfigMock,
  Platform: PlatformMock,
}));

const INDEX_PATH = '../../../../../js/agents/core/sandbox/index.js';

beforeEach(() => {
  vi.clearAllMocks();
  isNodeLikeValue = false;
});

async function importSandboxIndex({ nodeLike } = { nodeLike: false }) {
  vi.resetModules();
  isNodeLikeValue = nodeLike;
  return import(INDEX_PATH);
}

function captureError(thunk) {
  try {
    thunk();
    return null;
  } catch (error) {
    return error;
  }
}

function expectNodeOnlyError(thunk, fnName) {
  const error = captureError(thunk);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain(`${fnName}() is only available in Node.js/Bun/Deno environments.`);
  expect(error.message).toContain('Use WASM sandbox (createSandbox/SkillExecutor) for browser environments.');
}

async function assertBrowserNodeOnly(exportName, callArgs = []) {
  const mod = await importSandboxIndex({ nodeLike: false });
  expectNodeOnlyError(() => mod[exportName](...callArgs), exportName);
}

async function assertNodeDelegates(exportName, callArgs, resolvedValue) {
  systemIndexMock[exportName].mockResolvedValueOnce(resolvedValue);
  const mod = await importSandboxIndex({ nodeLike: true });
  const result = await mod[exportName](...callArgs);
  expect(result).toBe(resolvedValue);
  expect(systemIndexMock[exportName]).toHaveBeenCalledTimes(1);
  expect(systemIndexMock[exportName]).toHaveBeenCalledWith(...callArgs);
}

describe('detectAllBackends', () => {
  it('throws a clear Node-only error in non-Node-like environments', async () => {
    await assertBrowserNodeOnly('detectAllBackends');
  });

  it('delegates to system implementation in Node-like environments', async () => {
    const sentinel = [{ backend: 'docker' }];
    await assertNodeDelegates('detectAllBackends', [null, undefined, '', [], {}], sentinel);
  });

  it('supports concurrent and rapid calls with boundary values', async () => {
    systemIndexMock.detectAllBackends.mockImplementation(async (n) => `v:${n}`);
    const mod = await importSandboxIndex({ nodeLike: true });

    // Prime the mocked system module so concurrent calls don't race the dynamic import loader.
    await import('../../../../../js/agents/core/sandbox/system/index.js');

    const results = await Promise.all([
      mod.detectAllBackends(0),
      mod.detectAllBackends(-1),
      mod.detectAllBackends(Number.MAX_SAFE_INTEGER),
    ]);

    expect(results).toEqual([`v:0`, `v:-1`, `v:${Number.MAX_SAFE_INTEGER}`]);
    expect(systemIndexMock.detectAllBackends).toHaveBeenCalledTimes(3);
    expect(systemIndexMock.detectAllBackends).toHaveBeenNthCalledWith(1, 0);
    expect(systemIndexMock.detectAllBackends).toHaveBeenNthCalledWith(2, -1);
    expect(systemIndexMock.detectAllBackends).toHaveBeenNthCalledWith(3, Number.MAX_SAFE_INTEGER);
  });
});

describe('detectBestBackend', () => {
  it('throws a clear Node-only error in non-Node-like environments', async () => {
    await assertBrowserNodeOnly('detectBestBackend');
  });

  it('delegates to system implementation and forwards type-boundary inputs', async () => {
    const sentinel = { backend: 'permission' };
    const stringAsNumber = '123';
    const objectAsArray = { 0: 'x', length: 1 };
    await assertNodeDelegates('detectBestBackend', [stringAsNumber, objectAsArray], sentinel);
  });
});

describe('getPlatform', () => {
  it('throws a clear Node-only error in non-Node-like environments', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    expectNodeOnlyError(() => mod.getPlatform(), 'getPlatform');
  });

  it('delegates to system implementation and ignores extraneous arguments', async () => {
    systemIndexMock.getPlatform.mockResolvedValueOnce(PlatformMock.LINUX);
    const mod = await importSandboxIndex({ nodeLike: true });

    const result = await mod.getPlatform('ignored', 123, { any: 'thing' });
    expect(result).toBe(PlatformMock.LINUX);
    expect(systemIndexMock.getPlatform).toHaveBeenCalledTimes(1);
    expect(systemIndexMock.getPlatform).toHaveBeenCalledWith();
  });
});

describe('createSystemSandbox', () => {
  it('throws a clear Node-only error in non-Node-like environments', async () => {
    await assertBrowserNodeOnly('createSystemSandbox');
  });

  it('delegates to system implementation', async () => {
    const sentinel = { id: 'sys-sandbox' };
    await assertNodeDelegates('createSystemSandbox', ['   ', {}], sentinel);
  });

  it('propagates synchronous errors from the system implementation as rejections', async () => {
    systemIndexMock.createSystemSandbox.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const mod = await importSandboxIndex({ nodeLike: true });
    await expect(mod.createSystemSandbox({})).rejects.toThrow('boom');
    expect(systemIndexMock.createSystemSandbox).toHaveBeenCalledTimes(1);
  });
});

describe('execInSandbox', () => {
  it('throws a clear Node-only error in non-Node-like environments', async () => {
    await assertBrowserNodeOnly('execInSandbox', ['echo', 'hello']);
  });

  it('forwards empty values, boundary values, and resource-heavy inputs', async () => {
    systemIndexMock.execInSandbox.mockImplementationOnce((...received) => received);

    const longString = 'x'.repeat(10_000);
    const deepNested = { a: { b: { c: { d: { e: { f: [1, { g: 'h' }] } } } } } };

    const args = [
      null,
      undefined,
      '',
      '   ',
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      '123',
      { 0: 'not-array', length: 1 },
      longString,
      deepNested,
    ];

    const mod = await importSandboxIndex({ nodeLike: true });
    const result = await mod.execInSandbox(...args);

    expect(result).toEqual(args);
    expect(systemIndexMock.execInSandbox).toHaveBeenCalledTimes(1);
    expect(systemIndexMock.execInSandbox).toHaveBeenCalledWith(...args);
  });

  it('propagates promise rejections from the system implementation', async () => {
    systemIndexMock.execInSandbox.mockRejectedValueOnce(new Error('denied'));

    const mod = await importSandboxIndex({ nodeLike: true });
    await expect(mod.execInSandbox('cmd')).rejects.toThrow('denied');
    expect(systemIndexMock.execInSandbox).toHaveBeenCalledTimes(1);
  });
});

describe('shellInSandbox', () => {
  it('throws a clear Node-only error in non-Node-like environments', async () => {
    await assertBrowserNodeOnly('shellInSandbox');
  });

  it('delegates to system implementation (including long command strings)', async () => {
    const sentinel = { code: 0, stdout: 'ok' };
    const longCommand = `echo ${'a'.repeat(4096)}`;
    await assertNodeDelegates('shellInSandbox', [longCommand], sentinel);
  });
});

describe('createBubblewrapExecutor', () => {
  it('throws a clear Node-only error in non-Node-like environments', async () => {
    await assertBrowserNodeOnly('createBubblewrapExecutor');
  });

  it('delegates to system implementation', async () => {
    const sentinel = { kind: 'bwrap-exec' };
    await assertNodeDelegates('createBubblewrapExecutor', [{}], sentinel);
  });
});

describe('createSeatbeltExecutor', () => {
  it('throws a clear Node-only error in non-Node-like environments', async () => {
    await assertBrowserNodeOnly('createSeatbeltExecutor');
  });

  it('delegates to system implementation', async () => {
    const sentinel = { kind: 'seatbelt-exec' };
    await assertNodeDelegates('createSeatbeltExecutor', [{}], sentinel);
  });
});

describe('createDockerExecutor', () => {
  it('throws a clear Node-only error in non-Node-like environments', async () => {
    await assertBrowserNodeOnly('createDockerExecutor');
  });

  it('delegates to system implementation', async () => {
    const sentinel = { kind: 'docker-exec' };
    await assertNodeDelegates('createDockerExecutor', [{ image: 'alpine' }], sentinel);
  });
});

describe('createPermissionExecutor', () => {
  it('throws a clear Node-only error in non-Node-like environments', async () => {
    await assertBrowserNodeOnly('createPermissionExecutor');
  });

  it('delegates to system implementation', async () => {
    const sentinel = { kind: 'permission-exec' };
    await assertNodeDelegates('createPermissionExecutor', [{ allow: [] }], sentinel);
  });
});

describe('createInteractivePermissionHandler', () => {
  it('throws a clear Node-only error in non-Node-like environments', async () => {
    await assertBrowserNodeOnly('createInteractivePermissionHandler');
  });

  it('delegates to system implementation', async () => {
    const sentinel = { kind: 'interactive-handler' };
    await assertNodeDelegates('createInteractivePermissionHandler', [{ mode: 'prompt' }], sentinel);
  });
});

describe('SystemSandboxExecutor', () => {
  it('throws a clear Node-only error when constructed in non-Node-like environments', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const error = captureError(() => new mod.SystemSandboxExecutor());
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('SystemSandboxExecutor() is only available in Node.js/Bun/Deno environments.');
  });

  it('throws an instructive error when constructed in Node-like environments', async () => {
    const mod = await importSandboxIndex({ nodeLike: true });
    const error = captureError(() => new mod.SystemSandboxExecutor());
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('SystemSandboxExecutor must be imported dynamically in Node.js environments.');
    expect(error.message).toContain('await import("./system/index.js")');
  });

  it('does not expose the real system executor class directly', async () => {
    const mod = await importSandboxIndex({ nodeLike: true });
    const system = await import('../../../../../js/agents/core/sandbox/system/index.js');
    expect(mod.SystemSandboxExecutor).not.toBe(system.SystemSandboxExecutor);
  });
});

describe('WasmSandbox', () => {
  it('re-exports WasmSandbox from wasm-sandbox.js', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const wasm = await import('../../../../../js/agents/core/sandbox/wasm-sandbox.js');
    expect(mod.WasmSandbox).toBe(wasm.WasmSandbox);
  });

  it('can be constructed with boundary inputs', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const instance = new mod.WasmSandbox(null, undefined, '', [], {});
    expect(instance).toBeInstanceOf(mod.WasmSandbox);
    expect(instance.args).toEqual([null, undefined, '', [], {}]);
  });
});

describe('createSandbox', () => {
  it('re-exports createSandbox from wasm-sandbox.js', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const wasm = await import('../../../../../js/agents/core/sandbox/wasm-sandbox.js');
    expect(mod.createSandbox).toBe(wasm.createSandbox);
  });

  it('propagates errors from the underlying implementation', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    createSandboxMock.mockImplementationOnce(() => {
      throw new Error('bad sandbox config');
    });
    expect(() => mod.createSandbox({})).toThrow('bad sandbox config');
  });
});

describe('SandboxPool', () => {
  it('re-exports SandboxPool from pool.js', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const pool = await import('../../../../../js/agents/core/sandbox/pool.js');
    expect(mod.SandboxPool).toBe(pool.SandboxPool);
  });

  it('can be constructed with boundary inputs', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const instance = new mod.SandboxPool(0, -1, Number.MAX_SAFE_INTEGER, []);
    expect(instance).toBeInstanceOf(mod.SandboxPool);
  });
});

describe('createSandboxPlugin', () => {
  it('re-exports createSandboxPlugin from plugin.js', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const plugin = await import('../../../../../js/agents/core/sandbox/plugin.js');
    expect(mod.createSandboxPlugin).toBe(plugin.createSandboxPlugin);
  });

  it('accepts boundary inputs and returns the underlying result', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const result = mod.createSandboxPlugin(null, undefined, '', {}, []);
    expect(result).toEqual({ kind: 'plugin', args: [null, undefined, '', {}, []] });
    expect(createSandboxPluginMock).toHaveBeenCalledTimes(1);
  });
});

describe('SkillExecutor', () => {
  it('re-exports SkillExecutor from skill-executor.js', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const skill = await import('../../../../../js/agents/core/sandbox/skill-executor.js');
    expect(mod.SkillExecutor).toBe(skill.SkillExecutor);
  });

  it('can be constructed with boundary inputs', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const instance = new mod.SkillExecutor('', 0, {}, []);
    expect(instance).toBeInstanceOf(mod.SkillExecutor);
  });
});

describe('createSkillExecutor', () => {
  it('re-exports createSkillExecutor from skill-executor.js', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const skill = await import('../../../../../js/agents/core/sandbox/skill-executor.js');
    expect(mod.createSkillExecutor).toBe(skill.createSkillExecutor);
  });

  it('forwards resource-heavy inputs', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const longString = 'y'.repeat(10_000);
    const deepNested = { x: { y: { z: { w: [1, 2, { k: 'v' }] } } } };

    const result = mod.createSkillExecutor(longString, deepNested);
    expect(result).toEqual({ kind: 'skill-executor', args: [longString, deepNested] });
    expect(createSkillExecutorMock).toHaveBeenCalledTimes(1);
  });
});

describe('isWasmSupported', () => {
  it('re-exports isWasmSupported from skill-executor.js', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const skill = await import('../../../../../js/agents/core/sandbox/skill-executor.js');
    expect(mod.isWasmSupported).toBe(skill.isWasmSupported);
  });

  it('returns the underlying value (no hidden state)', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    isWasmSupportedMock.mockReturnValueOnce(false);
    expect(mod.isWasmSupported()).toBe(false);
    expect(isWasmSupportedMock).toHaveBeenCalledTimes(1);
  });
});

describe('SandboxCapability', () => {
  it('re-exports SandboxCapability from constants.js', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const constants = await import('../../../../../js/agents/core/sandbox/constants.js');
    expect(mod.SandboxCapability).toBe(constants.SandboxCapability);
    expect(mod.SandboxCapability.FS).toBe('fs');
  });
});

describe('SandboxPreset', () => {
  it('re-exports SandboxPreset from constants.js', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const constants = await import('../../../../../js/agents/core/sandbox/constants.js');
    expect(mod.SandboxPreset).toBe(constants.SandboxPreset);
    expect(mod.SandboxPreset.DEFAULT).toBe('default');
  });
});

describe('ResourceLimits', () => {
  it('re-exports ResourceLimits from constants.js', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const constants = await import('../../../../../js/agents/core/sandbox/constants.js');
    expect(mod.ResourceLimits).toBe(constants.ResourceLimits);
    expect(mod.ResourceLimits.memoryMB).toBe(64);
  });
});

describe('SandboxBackend', () => {
  it('re-exports SandboxBackend from system/constants.js', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const sysConstants = await import('../../../../../js/agents/core/sandbox/system/constants.js');
    expect(mod.SandboxBackend).toBe(sysConstants.SandboxBackend);
    expect(mod.SandboxBackend.DOCKER).toBe('docker');
  });
});

describe('SandboxPolicy', () => {
  it('re-exports SandboxPolicy from system/constants.js', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const sysConstants = await import('../../../../../js/agents/core/sandbox/system/constants.js');
    expect(mod.SandboxPolicy).toBe(sysConstants.SandboxPolicy);
    expect(mod.SandboxPolicy.DENY).toBe('deny');
  });
});

describe('DefaultSandboxConfig', () => {
  it('re-exports DefaultSandboxConfig from system/constants.js', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const sysConstants = await import('../../../../../js/agents/core/sandbox/system/constants.js');
    expect(mod.DefaultSandboxConfig).toBe(sysConstants.DefaultSandboxConfig);
    expect(mod.DefaultSandboxConfig.backend).toBe('permission');
  });
});

describe('Platform', () => {
  it('re-exports Platform from system/constants.js', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    const sysConstants = await import('../../../../../js/agents/core/sandbox/system/constants.js');
    expect(mod.Platform).toBe(sysConstants.Platform);
    expect(mod.Platform.DARWIN).toBe('darwin');
  });
});

describe('default', () => {
  it('exposes expected public members with stable references (Node-like)', async () => {
    const mod = await importSandboxIndex({ nodeLike: true });

    expect(mod.default).toEqual(
      expect.objectContaining({
        SandboxCapability: mod.SandboxCapability,
        SandboxPreset: mod.SandboxPreset,
        ResourceLimits: mod.ResourceLimits,
        SandboxBackend: mod.SandboxBackend,
        createSystemSandbox: mod.createSystemSandbox,
      })
    );

    expect(mod.default.SandboxCapability).toBe(mod.SandboxCapability);
    expect(mod.default.SandboxPreset).toBe(mod.SandboxPreset);
    expect(mod.default.ResourceLimits).toBe(mod.ResourceLimits);
    expect(mod.default.SandboxBackend).toBe(mod.SandboxBackend);
    expect(mod.default.createSystemSandbox).toBe(mod.createSystemSandbox);
  });

  it('exposes createSystemSandbox that throws in non-Node-like environments', async () => {
    const mod = await importSandboxIndex({ nodeLike: false });
    expectNodeOnlyError(() => mod.default.createSystemSandbox(), 'createSystemSandbox');
  });
});
