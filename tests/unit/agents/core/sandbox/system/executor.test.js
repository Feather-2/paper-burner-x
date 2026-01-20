import { describe, it, expect, vi, beforeEach } from 'vitest';

const loggerMocks = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  createLogger: vi.fn(() => ({ warn: loggerMocks.warn })),
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/detect.js', () => ({
  detectBestBackend: vi.fn(),
  detectAllBackends: vi.fn(),
  getPlatform: vi.fn(),
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/bubblewrap.js', () => ({
  createBubblewrapExecutor: vi.fn(),
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/seatbelt.js', () => ({
  createSeatbeltExecutor: vi.fn(),
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/docker.js', () => ({
  createDockerExecutor: vi.fn(),
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/permission.js', () => ({
  createPermissionExecutor: vi.fn(),
}));

import { SandboxBackend, DefaultSandboxConfig } from '../../../../../../js/agents/core/sandbox/system/constants.js';
import { detectBestBackend, detectAllBackends, getPlatform } from '../../../../../../js/agents/core/sandbox/system/detect.js';
import { createBubblewrapExecutor } from '../../../../../../js/agents/core/sandbox/system/bubblewrap.js';
import { createSeatbeltExecutor } from '../../../../../../js/agents/core/sandbox/system/seatbelt.js';
import { createDockerExecutor } from '../../../../../../js/agents/core/sandbox/system/docker.js';
import { createPermissionExecutor } from '../../../../../../js/agents/core/sandbox/system/permission.js';
import { SystemSandboxExecutor, createSystemSandbox } from '../../../../../../js/agents/core/sandbox/system/executor.js';

let mockExecutor;

beforeEach(() => {
  vi.clearAllMocks();
  mockExecutor = {
    execute: vi.fn().mockResolvedValue({ ok: true }),
    shell: vi.fn().mockResolvedValue({ ok: true }),
  };
  detectBestBackend.mockResolvedValue({ backend: SandboxBackend.PERMISSION_ONLY });
  detectAllBackends.mockResolvedValue([
    { backend: SandboxBackend.PERMISSION_ONLY, available: true },
  ]);
  getPlatform.mockReturnValue('linux');
  createBubblewrapExecutor.mockReturnValue(mockExecutor);
  createSeatbeltExecutor.mockReturnValue(mockExecutor);
  createDockerExecutor.mockReturnValue(mockExecutor);
  createPermissionExecutor.mockReturnValue(mockExecutor);
});

describe('SystemSandboxExecutor', () => {
  it('merges defaults and preserves explicit boundary values', () => {
    const executor = new SystemSandboxExecutor({
      workDir: '',
      allowedReadPaths: undefined,
      allowedWritePaths: [],
      allowNetwork: null,
      timeoutMs: -1,
      memoryLimit: 0,
      permissionHandler: null,
    });

    expect(executor.config.workDir).toBe('');
    expect(executor.config.allowedReadPaths).toBeUndefined();
    expect(executor.config.allowedWritePaths).toEqual([]);
    expect(executor.config.allowNetwork).toBeNull();
    expect(executor.config.timeoutMs).toBe(-1);
    expect(executor.config.memoryLimit).toBe(0);
    expect(executor.config.permissionHandler).toBeNull();

    const defaultExecutor = new SystemSandboxExecutor({});
    expect(defaultExecutor.config.allowedReadPaths).toEqual(DefaultSandboxConfig.allowedReadPaths);
  });

  it('uses preferred backend when available and invokes callback', async () => {
    const onBackendSelected = vi.fn();
    const hugePath = `/tmp/${'x'.repeat(10000)}`;
    detectAllBackends.mockResolvedValue([
      { backend: SandboxBackend.BUBBLEWRAP, available: true },
    ]);

    const executor = new SystemSandboxExecutor({
      preferredBackend: SandboxBackend.BUBBLEWRAP,
      workDir: '/work',
      allowedReadPaths: [],
      allowedWritePaths: [hugePath],
      allowNetwork: true,
      timeoutMs: Number.MAX_SAFE_INTEGER,
      onBackendSelected,
    });

    await executor.init();

    expect(createBubblewrapExecutor).toHaveBeenCalledWith({
      workDir: '/work',
      allowedReadPaths: [],
      allowedWritePaths: [hugePath],
      allowNetwork: true,
      timeoutMs: Number.MAX_SAFE_INTEGER,
    });
    expect(executor.getBackend()).toBe(SandboxBackend.BUBBLEWRAP);
    expect(onBackendSelected).toHaveBeenCalledWith(SandboxBackend.BUBBLEWRAP);
    expect(detectBestBackend).not.toHaveBeenCalled();
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it('falls back when preferred backend unavailable and logs warning', async () => {
    const onBackendSelected = vi.fn();
    detectAllBackends.mockResolvedValue([
      { backend: SandboxBackend.BUBBLEWRAP, available: false },
      { backend: SandboxBackend.DOCKER, available: true },
    ]);
    detectBestBackend.mockResolvedValue({ backend: SandboxBackend.DOCKER });

    const executor = new SystemSandboxExecutor({
      preferredBackend: SandboxBackend.BUBBLEWRAP,
      onBackendSelected,
    });

    await executor.init();

    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn.mock.calls[0][0]).toContain('Preferred backend');
    expect(createBubblewrapExecutor).not.toHaveBeenCalled();
    expect(createDockerExecutor).toHaveBeenCalledTimes(1);
    expect(executor.getBackend()).toBe(SandboxBackend.DOCKER);
    expect(onBackendSelected).toHaveBeenCalledWith(SandboxBackend.DOCKER);
    expect(detectAllBackends).toHaveBeenCalledTimes(2);
  });

  it('uses permission-only backend and passes through type-boundary config', async () => {
    const permissionHandler = vi.fn();
    const executor = new SystemSandboxExecutor({
      preferredBackend: SandboxBackend.PERMISSION_ONLY,
      workDir: '',
      allowedReadPaths: { path: '/tmp' },
      allowedWritePaths: 'not-array',
      allowNetwork: null,
      timeoutMs: '5000',
      permissionHandler,
    });

    await executor.init();

    expect(detectAllBackends).not.toHaveBeenCalled();
    expect(detectBestBackend).not.toHaveBeenCalled();
    expect(createPermissionExecutor).toHaveBeenCalledWith({
      workDir: '',
      allowedReadPaths: { path: '/tmp' },
      allowedWritePaths: 'not-array',
      allowNetwork: null,
      timeoutMs: '5000',
      permissionHandler,
    });
    expect(executor.getBackend()).toBe(SandboxBackend.PERMISSION_ONLY);
  });

  it('rejects init when backend detection fails', async () => {
    detectBestBackend.mockRejectedValue(new Error('boom'));

    const executor = new SystemSandboxExecutor();

    await expect(executor.init()).rejects.toThrow('boom');
  });

  it('shares init promise across concurrent calls', async () => {
    let resolveBest;
    detectBestBackend.mockImplementation(
      () => new Promise((resolve) => {
        resolveBest = resolve;
      })
    );

    const executor = new SystemSandboxExecutor();
    const first = executor.init();
    const second = executor.init();

    expect(detectBestBackend).toHaveBeenCalledTimes(1);

    resolveBest({ backend: SandboxBackend.PERMISSION_ONLY });
    await Promise.all([first, second]);

    expect(createPermissionExecutor).toHaveBeenCalledTimes(1);
  });

  it('does not reinitialize on rapid sequential init calls', async () => {
    const executor = new SystemSandboxExecutor();

    await executor.init();
    await executor.init();

    expect(detectBestBackend).toHaveBeenCalledTimes(1);
    expect(createPermissionExecutor).toHaveBeenCalledTimes(1);
  });

  it('executes commands with default args and deep options', async () => {
    const deepOptions = { env: { nested: { level: { value: 42 } } } };
    const longCommand = 'x'.repeat(10000);
    const executor = new SystemSandboxExecutor({
      preferredBackend: SandboxBackend.PERMISSION_ONLY,
    });

    const result = await executor.execute(longCommand, undefined, deepOptions);

    expect(mockExecutor.execute).toHaveBeenCalledWith(longCommand, [], deepOptions);
    expect(result).toEqual({ ok: true });
  });

  it('propagates executor errors and keeps null args intact', async () => {
    mockExecutor.execute.mockRejectedValue(new Error('execution failed'));
    const executor = new SystemSandboxExecutor({
      preferredBackend: SandboxBackend.PERMISSION_ONLY,
    });

    await expect(executor.execute('', null, {})).rejects.toThrow('execution failed');
    expect(mockExecutor.execute).toHaveBeenCalledWith('', null, {});
  });

  it('runs shell commands with whitespace input', async () => {
    const executor = new SystemSandboxExecutor({
      preferredBackend: SandboxBackend.PERMISSION_ONLY,
    });

    await executor.shell('   ', { cwd: '/tmp' });

    expect(mockExecutor.shell).toHaveBeenCalledWith('   ', { cwd: '/tmp' });
  });

  it('returns null before init and active backend after init', async () => {
    const executor = new SystemSandboxExecutor({
      preferredBackend: SandboxBackend.PERMISSION_ONLY,
    });

    expect(executor.getBackend()).toBeNull();

    await executor.init();

    expect(executor.getBackend()).toBe(SandboxBackend.PERMISSION_ONLY);
  });

  it('reports platform, active backend, and available backends', async () => {
    const deepBackend = {
      backend: 'custom',
      available: true,
      meta: { nested: { depth: { level: 3 } } },
    };
    const allBackends = [
      { backend: SandboxBackend.BUBBLEWRAP, available: false },
      deepBackend,
      { backend: SandboxBackend.DOCKER, available: true },
    ];
    detectAllBackends.mockResolvedValue(allBackends);
    getPlatform.mockReturnValue('linux');

    const executor = new SystemSandboxExecutor({
      preferredBackend: SandboxBackend.PERMISSION_ONLY,
    });

    const info = await executor.getInfo();

    expect(info.platform).toBe('linux');
    expect(info.activeBackend).toBe(SandboxBackend.PERMISSION_ONLY);
    expect(info.availableBackends).toEqual(['custom', SandboxBackend.DOCKER]);
    expect(info.allBackends).toBe(allBackends);
  });
});

describe('createSystemSandbox', () => {
  it('creates a SystemSandboxExecutor with provided config', () => {
    const instance = createSystemSandbox({ workDir: '/tmp' });

    expect(instance).toBeInstanceOf(SystemSandboxExecutor);
    expect(instance.config.workDir).toBe('/tmp');
  });
});
