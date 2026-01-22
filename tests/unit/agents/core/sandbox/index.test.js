import { describe, it, expect, vi, beforeEach } from 'vitest';

const nodeLikeState = vi.hoisted(() => ({ value: true }));

const systemMocks = vi.hoisted(() => ({
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
}));

vi.mock('../../../../../js/agents/shared/index.js', async () => {
  const actual = await vi.importActual('../../../../../js/agents/shared/index.js');
  return {
    ...actual,
    isNodeLike: () => nodeLikeState.value,
  };
});

const boundary = {
  nullValue: null,
  undefinedValue: undefined,
  emptyString: "",
  whitespaceString: "   ",
  emptyArray: [],
  emptyObject: {},
  zero: 0,
  negativeOne: -1,
  maxSafe: Number.MAX_SAFE_INTEGER,
  stringNumber: "123",
  objectAsArray: { 0: "a", length: 1 },
  longString: "x".repeat(10000),
  deepObject: { level1: { level2: { level3: { value: "deep" } } } },
  largeFile: { name: "big.bin", content: "x".repeat(50000) },
};

beforeEach(() => {
  vi.clearAllMocks();
});

const loadSandboxModule = async (nodeLike) => {
  nodeLikeState.value = nodeLike;
  vi.resetModules();
  vi.doMock('../../../../../js/agents/core/sandbox/system/index.js', () => systemMocks);
  return await import('../../../../../js/agents/core/sandbox/index.js');
};

const describeNodeFunction = ({
  name,
  exportName,
  mock,
  boundaryArgs,
  ignoreArgs = false,
  extraTests,
}) => {
  describe(name, () => {
    it('resolves the underlying value for normal input', async () => {
      const sandbox = await loadSandboxModule(true);
      mock.mockResolvedValueOnce('ok');

      const result = ignoreArgs
        ? await sandbox[exportName]()
        : await sandbox[exportName]('input');

      expect(result).toBe('ok');
      if (ignoreArgs) {
        expect(mock).toHaveBeenCalledWith();
      } else {
        expect(mock).toHaveBeenCalledWith('input');
      }
    });

    if (boundaryArgs && boundaryArgs.length) {
      boundaryArgs.forEach((value, index) => {
        it(`forwards boundary input #${index + 1}`, async () => {
          const sandbox = await loadSandboxModule(true);
          mock.mockResolvedValueOnce('ok');

          const result = await sandbox[exportName](value);
          expect(result).toBe('ok');

          if (ignoreArgs) {
            expect(mock).toHaveBeenCalledWith();
          } else {
            expect(mock).toHaveBeenCalledWith(value);
          }
        });
      });
    }

    it('propagates errors from the underlying implementation', async () => {
      const sandbox = await loadSandboxModule(true);
      mock.mockImplementationOnce(() => {
        throw new Error('boom');
      });

      await expect(sandbox[exportName]('bad')).rejects.toThrow('boom');
    });

    it('throws in browser-like environments', async () => {
      const sandbox = await loadSandboxModule(false);
      expect(() => sandbox[exportName]('input')).toThrow(/only available/i);
    });

    if (extraTests) {
      extraTests();
    }
  });
};

describeNodeFunction({
  name: 'detectAllBackends',
  exportName: 'detectAllBackends',
  mock: systemMocks.detectAllBackends,
  boundaryArgs: [
    boundary.nullValue,
    boundary.undefinedValue,
    boundary.emptyString,
    boundary.whitespaceString,
  ],
});

describeNodeFunction({
  name: 'detectBestBackend',
  exportName: 'detectBestBackend',
  mock: systemMocks.detectBestBackend,
  boundaryArgs: [boundary.zero, boundary.negativeOne, boundary.maxSafe],
});

describeNodeFunction({
  name: 'getPlatform',
  exportName: 'getPlatform',
  mock: systemMocks.getPlatform,
  boundaryArgs: [boundary.longString, boundary.emptyArray],
  ignoreArgs: true,
});

describeNodeFunction({
  name: 'createSystemSandbox',
  exportName: 'createSystemSandbox',
  mock: systemMocks.createSystemSandbox,
  boundaryArgs: [boundary.longString, boundary.emptyObject],
});

describeNodeFunction({
  name: 'execInSandbox',
  exportName: 'execInSandbox',
  mock: systemMocks.execInSandbox,
  boundaryArgs: [boundary.largeFile, boundary.deepObject],
  extraTests: () => {
    it('handles concurrent calls', async () => {
      const sandbox = await loadSandboxModule(false);
      const results = await Promise.allSettled([
        Promise.resolve().then(() => sandbox.execInSandbox('alpha')),
        Promise.resolve().then(() => sandbox.execInSandbox('beta')),
      ]);

      expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
      results.forEach((result) => {
        if (result.status === "rejected") {
          expect(String(result.reason)).toMatch(/only available/i);
        }
      });
    });

    it('handles rapid consecutive calls', async () => {
      const sandbox = await loadSandboxModule(true);
      const values = ['v1', 'v2', 'v3', 'v4', 'v5'];
      systemMocks.execInSandbox.mockImplementation((value) => `ok:${value}`);

      const results = [];
      for (const value of values) {
        // Sequential on purpose to validate back-to-back calls.
        results.push(await sandbox.execInSandbox(value));
      }

      expect(results).toEqual(values.map((value) => `ok:${value}`));
      expect(systemMocks.execInSandbox).toHaveBeenCalledTimes(values.length);
    });
  },
});

describeNodeFunction({
  name: 'shellInSandbox',
  exportName: 'shellInSandbox',
  mock: systemMocks.shellInSandbox,
  boundaryArgs: [boundary.deepObject],
});

describeNodeFunction({
  name: 'createBubblewrapExecutor',
  exportName: 'createBubblewrapExecutor',
  mock: systemMocks.createBubblewrapExecutor,
  boundaryArgs: [boundary.emptyArray, boundary.objectAsArray],
});

describeNodeFunction({
  name: 'createSeatbeltExecutor',
  exportName: 'createSeatbeltExecutor',
  mock: systemMocks.createSeatbeltExecutor,
  boundaryArgs: [boundary.whitespaceString],
});

describeNodeFunction({
  name: 'createDockerExecutor',
  exportName: 'createDockerExecutor',
  mock: systemMocks.createDockerExecutor,
  boundaryArgs: [boundary.stringNumber],
});

describeNodeFunction({
  name: 'createPermissionExecutor',
  exportName: 'createPermissionExecutor',
  mock: systemMocks.createPermissionExecutor,
  boundaryArgs: [boundary.emptyObject],
});

describeNodeFunction({
  name: 'createInteractivePermissionHandler',
  exportName: 'createInteractivePermissionHandler',
  mock: systemMocks.createInteractivePermissionHandler,
  boundaryArgs: [boundary.nullValue],
});

describe('SystemSandboxExecutor', () => {
  it('throws a dynamic import error in node-like environments', async () => {
    const sandbox = await loadSandboxModule(true);
    expect(() => new sandbox.SystemSandboxExecutor('config'))
      .toThrow(/SystemSandboxExecutor must be imported dynamically/i);
  });

  it('throws a node-only error in browser-like environments', async () => {
    const sandbox = await loadSandboxModule(false);
    expect(() => new sandbox.SystemSandboxExecutor('config'))
      .toThrow(/SystemSandboxExecutor\(\) is only available/i);
  });

  it('handles boundary constructor inputs', async () => {
    const sandbox = await loadSandboxModule(true);
    const values = [boundary.undefinedValue, boundary.emptyArray];

    values.forEach((value) => {
      expect(() => new sandbox.SystemSandboxExecutor(value))
        .toThrow(/SystemSandboxExecutor must be imported dynamically/i);
    });
  });
});

describe('WasmSandbox', () => {
  it('re-exports the wasm sandbox class', async () => {
    const sandbox = await loadSandboxModule(false);
    const wasm = await import('../../../../../js/agents/core/sandbox/wasm-sandbox.js');
    expect(sandbox.WasmSandbox).toBe(wasm.WasmSandbox);
  });
});

describe('createSandbox', () => {
  it('re-exports the createSandbox function', async () => {
    const sandbox = await loadSandboxModule(false);
    const wasm = await import('../../../../../js/agents/core/sandbox/wasm-sandbox.js');
    expect(sandbox.createSandbox).toBe(wasm.createSandbox);
  });
});

describe('SandboxPool', () => {
  it('re-exports the pool class', async () => {
    const sandbox = await loadSandboxModule(false);
    const pool = await import('../../../../../js/agents/core/sandbox/pool.js');
    expect(sandbox.SandboxPool).toBe(pool.SandboxPool);
  });
});

describe('createSandboxPlugin', () => {
  it('re-exports the plugin factory', async () => {
    const sandbox = await loadSandboxModule(false);
    const plugin = await import('../../../../../js/agents/core/sandbox/plugin.js');
    expect(sandbox.createSandboxPlugin).toBe(plugin.createSandboxPlugin);
  });
});

describe('SkillExecutor', () => {
  it('re-exports the skill executor class', async () => {
    const sandbox = await loadSandboxModule(false);
    const executor = await import('../../../../../js/agents/core/sandbox/skill-executor.js');
    expect(sandbox.SkillExecutor).toBe(executor.SkillExecutor);
  });
});

describe('createSkillExecutor', () => {
  it('re-exports the skill executor factory', async () => {
    const sandbox = await loadSandboxModule(false);
    const executor = await import('../../../../../js/agents/core/sandbox/skill-executor.js');
    expect(sandbox.createSkillExecutor).toBe(executor.createSkillExecutor);
  });
});

describe('isWasmSupported', () => {
  it('re-exports the wasm support check', async () => {
    const sandbox = await loadSandboxModule(false);
    const executor = await import('../../../../../js/agents/core/sandbox/skill-executor.js');
    expect(sandbox.isWasmSupported).toBe(executor.isWasmSupported);
  });
});

describe('SandboxCapability', () => {
  it('re-exports the sandbox capability constants', async () => {
    const sandbox = await loadSandboxModule(false);
    const constants = await import('../../../../../js/agents/core/sandbox/constants.js');
    expect(sandbox.SandboxCapability).toBe(constants.SandboxCapability);
  });
});

describe('SandboxPreset', () => {
  it('re-exports the sandbox preset constants', async () => {
    const sandbox = await loadSandboxModule(false);
    const constants = await import('../../../../../js/agents/core/sandbox/constants.js');
    expect(sandbox.SandboxPreset).toBe(constants.SandboxPreset);
  });
});

describe('ResourceLimits', () => {
  it('re-exports the resource limits constants', async () => {
    const sandbox = await loadSandboxModule(false);
    const constants = await import('../../../../../js/agents/core/sandbox/constants.js');
    expect(sandbox.ResourceLimits).toBe(constants.ResourceLimits);
  });
});

describe('SandboxBackend', () => {
  it('re-exports the system backend constants', async () => {
    const sandbox = await loadSandboxModule(false);
    const constants = await import('../../../../../js/agents/core/sandbox/system/constants.js');
    expect(sandbox.SandboxBackend).toBe(constants.SandboxBackend);
  });
});

describe('SandboxPolicy', () => {
  it('re-exports the system policy constants', async () => {
    const sandbox = await loadSandboxModule(false);
    const constants = await import('../../../../../js/agents/core/sandbox/system/constants.js');
    expect(sandbox.SandboxPolicy).toBe(constants.SandboxPolicy);
  });
});

describe('DefaultSandboxConfig', () => {
  it('re-exports the default system config', async () => {
    const sandbox = await loadSandboxModule(false);
    const constants = await import('../../../../../js/agents/core/sandbox/system/constants.js');
    expect(sandbox.DefaultSandboxConfig).toBe(constants.DefaultSandboxConfig);
  });
});

describe('Platform', () => {
  it('re-exports the platform constants', async () => {
    const sandbox = await loadSandboxModule(false);
    const constants = await import('../../../../../js/agents/core/sandbox/system/constants.js');
    expect(sandbox.Platform).toBe(constants.Platform);
  });
});

describe('default', () => {
  it('exposes the expected surface in node-like environments', async () => {
    const sandbox = await loadSandboxModule(true);
    expect(sandbox.default).toEqual({
      SandboxCapability: sandbox.SandboxCapability,
      SandboxPreset: sandbox.SandboxPreset,
      ResourceLimits: sandbox.ResourceLimits,
      SandboxBackend: sandbox.SandboxBackend,
      createSystemSandbox: sandbox.createSystemSandbox,
    });
  });

  it('does not include unexpected keys', async () => {
    const sandbox = await loadSandboxModule(true);
    expect(Object.keys(sandbox.default).sort()).toEqual([
      'ResourceLimits',
      'SandboxBackend',
      'SandboxCapability',
      'SandboxPreset',
      'createSystemSandbox',
    ].sort());
  });
});
