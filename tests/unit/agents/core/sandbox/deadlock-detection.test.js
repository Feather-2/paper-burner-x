import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sandbox-interface — default mainThreadFallback: true so deadlock path is reachable.
vi.mock(
  '../../../../../js/agents/core/sandbox/sandbox-interface.js',
  () => ({
    SANDBOX_LEVELS: ['wasm', 'worker', 'iframe', 'main'],
    AUTO_PRIORITY: ['wasm', 'iframe', 'worker', 'main'],
    DEFAULT_CONFIG: {
      level: 'auto',
      vfs: null,
      capabilities: [],
      timeout: 30000,
      cwd: '/',
      env: {},
      onConsole: null,
      mainThreadFallback: true,
    },
    validateConfig(config) {
      const base = {
        level: 'auto',
        vfs: null,
        capabilities: [],
        timeout: 30000,
        cwd: '/',
        env: {},
        onConsole: null,
        mainThreadFallback: true,
      };
      return { ...base, ...config };
    },
  })
);

// Mock skill-executor-helpers (isWasmSupported).
vi.mock(
  '../../../../../js/agents/core/sandbox/skill-executor-helpers.js',
  () => ({
    isWasmSupported: vi.fn(async () => false),
  })
);

// Mock wasm-sandbox.js so we never need real QuickJS.
vi.mock(
  '../../../../../js/agents/core/sandbox/wasm-sandbox.js',
  () => ({
    createSandbox: vi.fn(async () => ({
      execute: vi.fn(async () => ({ ok: true, value: 42, durationMs: 1 })),
      dispose: vi.fn(),
    })),
  })
);

const { createSandboxFactory } = await import(
  '../../../../../js/agents/core/sandbox/create-sandbox.js'
);

describe('deadlock detection in createMainSandbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws deadlock error when vfs._isRemote is true', async () => {
    await expect(
      createSandboxFactory({
        level: 'main',
        vfs: { _isRemote: true },
      }),
    ).rejects.toThrow('synchronous IO deadlock');
  });

  it('does not throw deadlock error when vfs._isRemote is false', async () => {
    const sandbox = await createSandboxFactory({
      level: 'main',
      vfs: { _isRemote: false },
    });
    expect(sandbox.level).toBe('main');
    expect(sandbox.terminated).toBe(false);
  });

  it('does not throw deadlock error when vfs is absent', async () => {
    const sandbox = await createSandboxFactory({
      level: 'main',
    });
    expect(sandbox.level).toBe('main');
  });

  it('throws disabled-by-config when mainThreadFallback is false', async () => {
    await expect(
      createSandboxFactory({
        level: 'main',
        mainThreadFallback: false,
      }),
    ).rejects.toThrow('disabled by config');
  });
});
