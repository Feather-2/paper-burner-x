/**
 * Unit coverage for executeInBubblewrap/createBubblewrapExecutor in bubblewrap.js,
 * exercising boundary inputs, env merging, PID namespace isolation,
 * and mocked system dependencies.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../../js/agents/core/sandbox/system/constants.js', () => ({
  SandboxBackend: { BUBBLEWRAP: 'bubblewrap' },
  DefaultSandboxConfig: {
    allowedReadPaths: [],
    allowedWritePaths: ['./default-write'],
    allowNetwork: false,
    timeoutMs: 12345,
  },
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/detect.js', () => ({
  execCommand: vi.fn(),
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/path-utils.js', () => ({
  normalizeSandboxPath: vi.fn(),
}));

// getMandatoryDenyPaths calls statSync — stub it so it never touches real FS
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  statSync: vi.fn(() => { throw new Error('ENOENT'); }),
  lstatSync: vi.fn(() => { throw new Error('ENOENT'); }),
  unlinkSync: vi.fn(),
  rmdirSync: vi.fn(),
  realpathSync: vi.fn((p) => p),
}));

import {
  executeInBubblewrap,
  createBubblewrapExecutor,
  findSeccompBinary,
  generateSeccompCommand,
} from '../../../../../../js/agents/core/sandbox/system/bubblewrap.js';
import { execCommand } from '../../../../../../js/agents/core/sandbox/system/detect.js';
import { normalizeSandboxPath } from '../../../../../../js/agents/core/sandbox/system/path-utils.js';
import {
  DefaultSandboxConfig,
  SandboxBackend,
} from '../../../../../../js/agents/core/sandbox/system/constants.js';
import { existsSync, lstatSync, unlinkSync } from 'node:fs';

const BASE_RESULT = { code: 0, stdout: 'ok', stderr: '' };

const extractEnvMap = (args) => {
  const envMap = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--setenv') {
      envMap[args[i + 1]] = args[i + 2];
    }
  }
  return envMap;
};

beforeEach(() => {
  vi.clearAllMocks();
  execCommand.mockResolvedValue({ ...BASE_RESULT });
  normalizeSandboxPath.mockImplementation((p, workDir) => {
    if (!p || !workDir) return null;
    if (p === '.') return workDir;
    if (p.startsWith('/')) return p;
    const trimmed = p.startsWith('./') ? p.slice(2) : p;
    return `${workDir}/${trimmed}`;
  });
});

// ---------------------------------------------------------------------------
// executeInBubblewrap
// ---------------------------------------------------------------------------
describe('executeInBubblewrap', () => {
  it('rejects when options is null or undefined', async () => {
    await expect(executeInBubblewrap('echo', [], undefined)).rejects.toThrow();
    await expect(executeInBubblewrap('echo', [], null)).rejects.toThrow();
  });

  it('rejects when workDir is missing or empty', async () => {
    await expect(executeInBubblewrap('echo', [], {})).rejects.toThrow(
      'workDir is required for Bubblewrap sandbox'
    );
    await expect(executeInBubblewrap('echo', [], { workDir: '' })).rejects.toThrow(
      'workDir is required for Bubblewrap sandbox'
    );
    await expect(executeInBubblewrap('echo', [], { workDir: null })).rejects.toThrow(
      'workDir is required for Bubblewrap sandbox'
    );
  });

  it('uses default config values and builds command args', async () => {
    const workDir = '/work';
    const result = await executeInBubblewrap('echo', ['hello'], { workDir });

    expect(result).toEqual({
      ...BASE_RESULT,
      killed: false,
      backend: SandboxBackend.BUBBLEWRAP,
    });

    expect(execCommand).toHaveBeenCalledTimes(1);
    const [cmd, bwrapArgs, options] = execCommand.mock.calls[0];

    expect(cmd).toBe('bwrap');
    expect(options).toEqual({ timeout: DefaultSandboxConfig.timeoutMs });

    // With global readonly root, allowedReadPaths are already covered — no separate --ro-bind-try
    expect(bwrapArgs).not.toContain('relative-read');

    expect(normalizeSandboxPath).toHaveBeenCalledWith(
      './default-write',
      workDir,
      expect.objectContaining({
        allowAbsolute: true,
        resolveSymlinks: true,
      })
    );
    expect(bwrapArgs).toContain(`${workDir}/default-write`);

    expect(bwrapArgs).toContain('--unshare-net');
    expect(bwrapArgs).not.toContain('--share-net');

    const envMap = extractEnvMap(bwrapArgs);
    expect(envMap.PATH).toBe('/usr/local/bin:/usr/bin:/bin');
    expect(envMap.HOME).toBe('/tmp');
    expect(envMap.LANG).toBe('C.UTF-8');

    const separatorIndex = bwrapArgs.indexOf('--');
    expect(bwrapArgs.slice(separatorIndex + 1)).toEqual(['echo', 'hello']);
  });

  // -- PID namespace isolation --
  it('includes PID namespace isolation args (--unshare-pid and --proc /proc)', async () => {
    await executeInBubblewrap('echo', [], { workDir: '/work' });
    const args = execCommand.mock.calls[0][1];

    expect(args).toContain('--unshare-pid');
    const procIdx = args.indexOf('--proc');
    expect(procIdx).toBeGreaterThan(-1);
    expect(args[procIdx + 1]).toBe('/proc');
  });

  it('places --unshare-pid before the command separator', async () => {
    await executeInBubblewrap('echo', [], { workDir: '/work' });
    const args = execCommand.mock.calls[0][1];
    const sepIdx = args.indexOf('--');
    const pidIdx = args.indexOf('--unshare-pid');
    expect(pidIdx).toBeLessThan(sepIdx);
  });

  it('includes --unshare-all for full namespace isolation', async () => {
    await executeInBubblewrap('echo', [], { workDir: '/work' });
    const args = execCommand.mock.calls[0][1];
    expect(args).toContain('--unshare-all');
    expect(args).toContain('--die-with-parent');
    expect(args).toContain('--new-session');
  });

  // -- Base filesystem bindings --
  it('includes base filesystem bindings (dev, tmpfs, global ro-bind)', async () => {
    await executeInBubblewrap('echo', [], { workDir: '/work' });
    const args = execCommand.mock.calls[0][1];

    expect(args).toContain('--dev');
    expect(args).toContain('/dev');
    expect(args).toContain('--tmpfs');
    expect(args).toContain('/tmp');

    // Global readonly root — replaces individual /usr, /lib, /bin bindings
    const roBindIdx = args.indexOf('--ro-bind');
    expect(roBindIdx).toBeGreaterThan(-1);
    expect(args[roBindIdx + 1]).toBe('/');
    expect(args[roBindIdx + 2]).toBe('/');
  });

  it('uses explicit allowedReadPaths whitelist mounts when provided', async () => {
    await executeInBubblewrap('echo', [], {
      workDir: '/work',
      allowedReadPaths: ['./src', '/etc/ssl'],
      allowedWritePaths: [],
    });
    const args = execCommand.mock.calls[0][1];

    const hasReadonlyRoot = args.some((token, index) => {
      return token === '--ro-bind' && args[index + 1] === '/' && args[index + 2] === '/';
    });
    expect(hasReadonlyRoot).toBe(false);
    expect(normalizeSandboxPath).toHaveBeenCalledWith(
      './src',
      '/work',
      expect.objectContaining({
        allowAbsolute: true,
        resolveSymlinks: true,
      })
    );
    expect(args).toContain('/work/src');
    expect(args).toContain('/etc/ssl');
  });

  // -- workDir binding --
  it('binds workDir as read-write with --bind and --chdir', async () => {
    const workDir = '/my/project';
    await executeInBubblewrap('echo', [], { workDir });
    const args = execCommand.mock.calls[0][1];

    const bindIdx = args.indexOf('--bind');
    expect(args[bindIdx + 1]).toBe(workDir);
    expect(args[bindIdx + 2]).toBe(workDir);

    const chdirIdx = args.indexOf('--chdir');
    expect(args[chdirIdx + 1]).toBe(workDir);
  });

  // -- Network --
  it('toggles network namespace args based on allowNetwork', async () => {
    execCommand.mockResolvedValueOnce({ ...BASE_RESULT });
    await executeInBubblewrap('echo', [], { workDir: '/work', allowNetwork: true });
    const argsAllow = execCommand.mock.calls[0][1];
    expect(argsAllow).toContain('--share-net');
    expect(argsAllow).not.toContain('--unshare-net');

    execCommand.mockResolvedValueOnce({ ...BASE_RESULT });
    await executeInBubblewrap('echo', [], { workDir: '/work', allowNetwork: false });
    const argsDeny = execCommand.mock.calls[1][1];
    expect(argsDeny).toContain('--unshare-net');
    expect(argsDeny).not.toContain('--share-net');
  });

  // -- Timeout --
  it('passes through timeout boundary values and string types', async () => {
    const timeouts = [0, -1, Number.MAX_SAFE_INTEGER, '5000'];

    for (const timeoutMs of timeouts) {
      execCommand.mockResolvedValueOnce({ ...BASE_RESULT });
      await executeInBubblewrap('echo', [], { workDir: '/work', timeoutMs });
      expect(execCommand).toHaveBeenLastCalledWith('bwrap', expect.any(Array), {
        timeout: timeoutMs,
      });
    }
  });

  // -- Killed detection --
  it('sets killed for timeout exit codes', async () => {
    execCommand.mockResolvedValueOnce({ code: 137, stdout: '', stderr: '' });
    const killedBySig = await executeInBubblewrap('echo', [], { workDir: '/work' });
    expect(killedBySig.killed).toBe(true);
    expect(killedBySig.backend).toBe(SandboxBackend.BUBBLEWRAP);

    execCommand.mockResolvedValueOnce({ code: 124, stdout: '', stderr: '' });
    const killedByTimeout = await executeInBubblewrap('echo', [], { workDir: '/work' });
    expect(killedByTimeout.killed).toBe(true);
    expect(killedByTimeout.backend).toBe(SandboxBackend.BUBBLEWRAP);
  });

  it('calls onViolation callback with annotated failure details', async () => {
    const onViolation = vi.fn();
    execCommand.mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'Permission denied' });

    const result = await executeInBubblewrap('cat', ['/secret'], {
      workDir: '/work',
      onViolation,
      disableMandatoryDeny: true,
      allowedWritePaths: [],
    });

    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation.mock.calls[0][0]).toMatchObject({
      backend: SandboxBackend.BUBBLEWRAP,
      code: 1,
      command: 'cat',
      args: ['/secret'],
      workDir: '/work',
    });
    expect(result.stderr).toContain('[sandbox] Permission denied');
  });

  it('does not set killed for normal exit codes', async () => {
    for (const code of [0, 1, 2, 127, 128, 255]) {
      execCommand.mockResolvedValueOnce({ code, stdout: '', stderr: '' });
      const result = await executeInBubblewrap('echo', [], { workDir: '/work' });
      expect(result.killed).toBe(false);
    }
  });

  // -- Environment --
  it('merges user env over defaults', async () => {
    await executeInBubblewrap('echo', [], {
      workDir: '/work',
      env: { PATH: '/custom/bin', MY_VAR: 'hello' },
    });
    const args = execCommand.mock.calls[0][1];
    const envMap = extractEnvMap(args);
    expect(envMap.PATH).toBe('/custom/bin');
    expect(envMap.MY_VAR).toBe('hello');
    expect(envMap.HOME).toBe('/tmp');
    expect(args).toContain('--clearenv');
  });

  // -- Empty arrays --
  it('handles empty arrays and objects without extra bindings', async () => {
    await executeInBubblewrap('echo', [], {
      workDir: '/work',
      allowedReadPaths: [],
      allowedWritePaths: [],
      env: {},
    });

    expect(normalizeSandboxPath).not.toHaveBeenCalled();
    const args = execCommand.mock.calls[0][1];
    expect(args).not.toContain('relative-read');
  });

  it('accepts blank string workDir values', async () => {
    const workDir = '   ';
    await executeInBubblewrap('echo', [], { workDir });

    const args = execCommand.mock.calls[0][1];
    const bindIndex = args.indexOf('--bind');
    expect(args.slice(bindIndex, bindIndex + 3)).toEqual(['--bind', workDir, workDir]);

    const chdirIndex = args.indexOf('--chdir');
    expect(args[chdirIndex + 1]).toBe(workDir);
  });

  it('rejects when command args are not iterable', async () => {
    await expect(
      executeInBubblewrap('echo', { not: 'array' }, { workDir: '/work' })
    ).rejects.toThrow();
  });

  // -- /etc covered by global root --
  it('/etc is covered by global readonly root (no separate binds needed)', async () => {
    await executeInBubblewrap('echo', [], { workDir: '/work' });
    const args = execCommand.mock.calls[0][1];

    // Global root covers /etc — verify no separate /etc/resolv.conf bind
    const roBindIdx = args.indexOf('/');
    expect(roBindIdx).toBeGreaterThan(-1);
    expect(args[roBindIdx - 1]).toBe('--ro-bind');
  });

  // -- Concurrency --
  it('supports concurrent execution calls', async () => {
    execCommand
      .mockResolvedValueOnce({ code: 0, stdout: 'first', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'second', stderr: '' });

    const [first, second] = await Promise.all([
      executeInBubblewrap('echo', ['1'], { workDir: '/work1' }),
      executeInBubblewrap('echo', ['2'], { workDir: '/work2' }),
    ]);

    expect(first.stdout).toBe('first');
    expect(second.stdout).toBe('second');
    expect(execCommand).toHaveBeenCalledTimes(2);
  });

  it('supports rapid sequential execution calls', async () => {
    execCommand
      .mockResolvedValueOnce({ code: 0, stdout: 'one', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'two', stderr: '' });

    const first = await executeInBubblewrap('echo', ['one'], { workDir: '/work1' });
    const second = await executeInBubblewrap('echo', ['two'], { workDir: '/work2' });

    expect(first.stdout).toBe('one');
    expect(second.stdout).toBe('two');
    expect(execCommand).toHaveBeenCalledTimes(2);
  });

  it('quotes network proxy socket path in bridged shell script', async () => {
    await executeInBubblewrap('node', ['index.js'], {
      workDir: '/work',
      networkProxy: { httpSocketPath: '/tmp/socket path;rm -rf /' },
      disableMandatoryDeny: true,
      allowedWritePaths: [],
    });

    const args = execCommand.mock.calls[0][1];
    const sepIdx = args.indexOf('--');
    const script = args[sepIdx + 3];
    expect(script).toContain("'UNIX-CONNECT:/tmp/socket path;rm -rf /'");
    expect(script).not.toContain('UNIX-CONNECT:/tmp/socket path;rm -rf / &');
  });

  it('handles large inputs and deep env nesting', async () => {
    const longCommand = `cmd-${'x'.repeat(8000)}`;
    const hugePath = `/tmp/${'a'.repeat(4000)}`;
    const deepEnv = { level1: { level2: { level3: { level4: { level5: 'v' } } } } };

    normalizeSandboxPath.mockImplementation((p) => p);
    execCommand.mockResolvedValueOnce({ ...BASE_RESULT });

    await executeInBubblewrap(longCommand, ['arg'], {
      workDir: '/work',
      allowedReadPaths: [hugePath],
      allowedWritePaths: [hugePath],
      env: { DEEP: deepEnv },
    });

    const args = execCommand.mock.calls[0][1];
    // With global readonly root, allowedWritePaths generates --bind-try
    const writeIndex = args.indexOf(hugePath);
    expect(writeIndex).toBeGreaterThan(-1);
    expect(['--bind-try', '--ro-bind-try']).toContain(args[writeIndex - 1]);
    expect(args).toContain(longCommand);
    expect(args).toContain(deepEnv);
  });
});

// ---------------------------------------------------------------------------
// Non-existent deny path protection
// ---------------------------------------------------------------------------
describe('non-existent deny path protection', () => {
  it('binds /dev/null to non-existent file deny path', async () => {
    // /work exists but /work/.env.secret does not
    existsSync.mockImplementation((p) => p === '/work');

    await executeInBubblewrap('echo', [], {
      workDir: '/work',
      denyPaths: ['/work/.env.secret'],
      disableMandatoryDeny: true,
      allowedWritePaths: [],
    });
    const args = execCommand.mock.calls[0][1];
    // Should have --ro-bind /dev/null /work/.env.secret
    const idx = args.indexOf('/work/.env.secret');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx - 1]).toBe('/dev/null');
    expect(args[idx - 2]).toBe('--ro-bind');

    existsSync.mockReset();
    existsSync.mockReturnValue(false);
  });

  it('binds /dev/null to first non-existent component for deep paths', async () => {
    // /work exists, /work/deep does not, so /work/deep/nested/file should
    // result in --ro-bind /dev/null /work/deep
    existsSync.mockImplementation((p) => {
      if (p === '/work') return true;
      return false;
    });

    await executeInBubblewrap('echo', [], {
      workDir: '/work',
      denyPaths: ['/work/deep/nested/file'],
      disableMandatoryDeny: true,
      allowedWritePaths: [],
    });
    const args = execCommand.mock.calls[0][1];
    const idx = args.indexOf('/work/deep');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx - 1]).toBe('/dev/null');
    expect(args[idx - 2]).toBe('--ro-bind');
    // Should NOT contain the full path — blocked at /work/deep
    expect(args).not.toContain('/work/deep/nested/file');

    existsSync.mockReset();
    existsSync.mockReturnValue(false);
  });

  it('uses --ro-bind path path for existing deny paths (unchanged behavior)', async () => {
    existsSync.mockImplementation(() => true);

    await executeInBubblewrap('echo', [], {
      workDir: '/work',
      denyPaths: ['/work/.bashrc'],
      disableMandatoryDeny: true,
      allowedWritePaths: [],
    });
    const args = execCommand.mock.calls[0][1];
    // --ro-bind /work/.bashrc /work/.bashrc  (src=dest for existing paths)
    // indexOf finds the first occurrence (src), so idx-1 is '--ro-bind'
    const idx = args.indexOf('/work/.bashrc');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx - 1]).toBe('--ro-bind');
    expect(args[idx + 1]).toBe('/work/.bashrc');

    existsSync.mockReset();
    existsSync.mockReturnValue(false);
  });

  it('does not remove pre-existing empty deny targets during mount cleanup', async () => {
    existsSync.mockImplementation((p) => p === '/work/existing-empty');
    lstatSync.mockImplementation(() => ({
      isFile: () => true,
      size: 0,
      isDirectory: () => false,
    }));

    await executeInBubblewrap('echo', [], {
      workDir: '/work',
      denyPaths: ['/work/existing-empty'],
      disableMandatoryDeny: true,
      allowedWritePaths: [],
    });

    expect(unlinkSync).not.toHaveBeenCalled();
    existsSync.mockReset();
    existsSync.mockReturnValue(false);
  });
});

// ---------------------------------------------------------------------------
// createBubblewrapExecutor
// ---------------------------------------------------------------------------
describe('createBubblewrapExecutor', () => {
  it('returns an object with backend, execute, and shell', () => {
    const executor = createBubblewrapExecutor({ workDir: '/w' });
    expect(executor.backend).toBe(SandboxBackend.BUBBLEWRAP);
    expect(typeof executor.execute).toBe('function');
    expect(typeof executor.shell).toBe('function');
  });

  it('works with no arguments (empty defaults)', () => {
    const executor = createBubblewrapExecutor();
    expect(executor.backend).toBe(SandboxBackend.BUBBLEWRAP);
  });

  it('exposes backend and merges default options for execute', async () => {
    const executor = createBubblewrapExecutor({
      workDir: '/base',
      allowNetwork: false,
      env: { FOO: 'base' },
      timeoutMs: 321,
      allowedWritePaths: ['./base-write'],
    });

    normalizeSandboxPath.mockImplementation((p, workDir) => {
      if (p === './override-write') return `${workDir}/override-write`;
      if (p === './base-write') return `${workDir}/base-write`;
      if (p.startsWith('/')) return p;
      return `${workDir}/${p}`;
    });

    execCommand.mockResolvedValueOnce({ ...BASE_RESULT });

    await executor.execute('echo', ['hi'], {
      allowNetwork: true,
      env: { FOO: 'override', BAR: 'extra' },
      allowedWritePaths: ['./override-write'],
    });

    expect(executor.backend).toBe(SandboxBackend.BUBBLEWRAP);
    const args = execCommand.mock.calls[0][1];
    expect(args).toContain('--share-net');
    expect(args).toContain('/base');
    expect(normalizeSandboxPath).toHaveBeenCalledWith(
      './override-write',
      '/base',
      expect.objectContaining({
        allowAbsolute: true,
        resolveSymlinks: true,
      })
    );
    expect(normalizeSandboxPath).not.toHaveBeenCalledWith(
      './base-write',
      '/base',
      expect.any(Object)
    );

    const envMap = extractEnvMap(args);
    expect(envMap.FOO).toBe('override');
    expect(envMap.BAR).toBe('extra');
    expect(execCommand).toHaveBeenCalledWith('bwrap', expect.any(Array), { timeout: 321 });
  });

  it('wraps shell commands with /bin/sh -c', async () => {
    const executor = createBubblewrapExecutor({ workDir: '/shell', timeoutMs: 50 });
    execCommand.mockResolvedValueOnce({ ...BASE_RESULT });

    await executor.shell('echo hi', { timeoutMs: 0 });

    const args = execCommand.mock.calls[0][1];
    const separatorIndex = args.indexOf('--');
    expect(args.slice(separatorIndex + 1, separatorIndex + 4)).toEqual([
      '/bin/sh',
      '-c',
      'echo hi',
    ]);
    expect(execCommand).toHaveBeenCalledWith('bwrap', expect.any(Array), { timeout: 0 });
  });

  it('shell inherits PID namespace args from executor defaults', async () => {
    const executor = createBubblewrapExecutor({ workDir: '/w' });
    execCommand.mockResolvedValueOnce({ ...BASE_RESULT });

    await executor.shell('whoami');

    const args = execCommand.mock.calls[0][1];
    expect(args).toContain('--unshare-pid');
    expect(args).toContain('--proc');
  });

  it('execute rejects when workDir is not provided in defaults or overrides', async () => {
    const executor = createBubblewrapExecutor();
    await expect(executor.execute('echo', [])).rejects.toThrow(
      'workDir is required for Bubblewrap sandbox'
    );
  });
});

// ---------------------------------------------------------------------------
// findSeccompBinary
// ---------------------------------------------------------------------------
describe('findSeccompBinary', () => {
  it('returns null when no binary exists anywhere', () => {
    existsSync.mockReturnValue(false);
    expect(findSeccompBinary('bpf', 'x64')).toBeNull();
    expect(findSeccompBinary('apply-seccomp', 'x64')).toBeNull();
  });

  it('returns user-specified bpfPath when it exists', () => {
    existsSync.mockImplementation((p) => p === '/custom/seccomp-bpf.bin');
    const result = findSeccompBinary('bpf', 'x64', { bpfPath: '/custom/seccomp-bpf.bin' });
    expect(result).toBe('/custom/seccomp-bpf.bin');
  });

  it('returns user-specified applySeccompPath when it exists', () => {
    existsSync.mockImplementation((p) => p === '/custom/apply-seccomp');
    const result = findSeccompBinary('apply-seccomp', 'x64', { applySeccompPath: '/custom/apply-seccomp' });
    expect(result).toBe('/custom/apply-seccomp');
  });

  it('skips user path when file does not exist and falls through', () => {
    existsSync.mockReturnValue(false);
    const result = findSeccompBinary('bpf', 'x64', { bpfPath: '/missing/file' });
    expect(result).toBeNull();
  });

  it('finds vendor path for bpf type', () => {
    existsSync.mockImplementation((p) => p.includes('vendor/seccomp/x64/seccomp-bpf.bin'));
    const result = findSeccompBinary('bpf', 'x64');
    expect(result).toContain('vendor/seccomp/x64/seccomp-bpf.bin');
  });

  it('finds vendor path for apply-seccomp type', () => {
    existsSync.mockImplementation((p) => p.includes('vendor/seccomp/arm64/apply-seccomp'));
    const result = findSeccompBinary('apply-seccomp', 'arm64');
    expect(result).toContain('vendor/seccomp/arm64/apply-seccomp');
  });

  it('uses correct filename for each type', () => {
    const calls = [];
    existsSync.mockImplementation((p) => { calls.push(p); return false; });
    findSeccompBinary('bpf', 'x64');
    expect(calls.some(c => c.includes('seccomp-bpf.bin'))).toBe(true);
    expect(calls.every(c => !c.includes('apply-seccomp'))).toBe(true);

    calls.length = 0;
    findSeccompBinary('apply-seccomp', 'x64');
    expect(calls.some(c => c.includes('apply-seccomp'))).toBe(true);
  });

  afterEach(() => {
    existsSync.mockReset();
    existsSync.mockReturnValue(false);
  });
});

// ---------------------------------------------------------------------------
// generateSeccompCommand
// ---------------------------------------------------------------------------
describe('generateSeccompCommand', () => {
  it('throws when BPF filter not found', () => {
    existsSync.mockReturnValue(false);
    expect(() => generateSeccompCommand(['echo', 'hi'], { arch: 'x64' }))
      .toThrow('Seccomp BPF filter not found for arch x64');
  });

  it('throws when apply-seccomp binary not found', () => {
    // bpf exists but apply-seccomp does not
    existsSync.mockImplementation((p) => p.includes('seccomp-bpf.bin'));
    expect(() => generateSeccompCommand(['echo', 'hi'], { arch: 'x64' }))
      .toThrow('apply-seccomp binary not found for arch x64');
    existsSync.mockReset();
    existsSync.mockReturnValue(false);
  });

  it('returns correct two-stage command structure', () => {
    existsSync.mockImplementation((p) => {
      return p.includes('vendor/seccomp/x64/seccomp-bpf.bin')
        || p.includes('vendor/seccomp/x64/apply-seccomp');
    });
    const result = generateSeccompCommand(['node', 'app.js'], { arch: 'x64' });
    expect(result.bpfPath).toContain('seccomp-bpf.bin');
    expect(result.applySeccompPath).toContain('apply-seccomp');
    expect(result.wrappedCmd).toEqual([
      result.applySeccompPath,
      result.bpfPath,
      '--',
      'node',
      'app.js',
    ]);
    existsSync.mockReset();
    existsSync.mockReturnValue(false);
  });

  it('uses user-specified paths from config', () => {
    existsSync.mockImplementation((p) => {
      return p === '/my/bpf.bin' || p === '/my/apply';
    });
    const result = generateSeccompCommand(['ls'], {
      arch: 'arm64',
      bpfPath: '/my/bpf.bin',
      applySeccompPath: '/my/apply',
    });
    expect(result.bpfPath).toBe('/my/bpf.bin');
    expect(result.applySeccompPath).toBe('/my/apply');
    expect(result.wrappedCmd).toEqual(['/my/apply', '/my/bpf.bin', '--', 'ls']);
    existsSync.mockReset();
    existsSync.mockReturnValue(false);
  });

  it('defaults arch to x64 when not specified', () => {
    existsSync.mockImplementation((p) => p.includes('vendor/seccomp/x64/'));
    const result = generateSeccompCommand(['echo'], {});
    expect(result.bpfPath).toContain('x64');
    existsSync.mockReset();
    existsSync.mockReturnValue(false);
  });
});

// ---------------------------------------------------------------------------
// buildBubblewrapArgs seccomp integration
// ---------------------------------------------------------------------------
describe('seccomp integration in executeInBubblewrap', () => {
  it('inserts apply-seccomp stage when seccomp.enabled is true', async () => {
    existsSync.mockImplementation((p) => {
      return p.includes('vendor/seccomp/x64/seccomp-bpf.bin')
        || p.includes('vendor/seccomp/x64/apply-seccomp');
    });

    await executeInBubblewrap('node', ['app.js'], {
      workDir: '/work',
      disableMandatoryDeny: true,
      allowedWritePaths: [],
      seccomp: { enabled: true, arch: 'x64' },
    });

    const args = execCommand.mock.calls[0][1];
    const sepIdx = args.indexOf('--');
    const tail = args.slice(sepIdx + 1);
    // tail should be: [apply-seccomp-path, bpf-path, '--', 'node', 'app.js']
    expect(tail.length).toBe(5);
    expect(tail[0]).toContain('apply-seccomp');
    expect(tail[1]).toContain('seccomp-bpf.bin');
    expect(tail[2]).toBe('--');
    expect(tail[3]).toBe('node');
    expect(tail[4]).toBe('app.js');

    existsSync.mockReset();
    existsSync.mockReturnValue(false);
  });

  it('does not insert seccomp stage when seccomp.enabled is false', async () => {
    await executeInBubblewrap('echo', ['hi'], {
      workDir: '/work',
      disableMandatoryDeny: true,
      allowedWritePaths: [],
      seccomp: { enabled: false },
    });

    const args = execCommand.mock.calls[0][1];
    const sepIdx = args.indexOf('--');
    expect(args.slice(sepIdx + 1)).toEqual(['echo', 'hi']);
  });

  it('does not insert seccomp stage when seccomp is undefined', async () => {
    await executeInBubblewrap('echo', ['hi'], {
      workDir: '/work',
      disableMandatoryDeny: true,
      allowedWritePaths: [],
    });

    const args = execCommand.mock.calls[0][1];
    const sepIdx = args.indexOf('--');
    expect(args.slice(sepIdx + 1)).toEqual(['echo', 'hi']);
  });

  it('uses user-specified seccomp paths in buildCommand', async () => {
    existsSync.mockImplementation((p) => {
      return p === '/opt/bpf.bin' || p === '/opt/apply-seccomp';
    });

    await executeInBubblewrap('bash', ['-c', 'echo test'], {
      workDir: '/work',
      disableMandatoryDeny: true,
      allowedWritePaths: [],
      seccomp: {
        enabled: true,
        bpfPath: '/opt/bpf.bin',
        applySeccompPath: '/opt/apply-seccomp',
      },
    });

    const args = execCommand.mock.calls[0][1];
    const sepIdx = args.indexOf('--');
    const tail = args.slice(sepIdx + 1);
    expect(tail[0]).toBe('/opt/apply-seccomp');
    expect(tail[1]).toBe('/opt/bpf.bin');
    expect(tail[2]).toBe('--');
    expect(tail[3]).toBe('bash');
    expect(tail[4]).toBe('-c');
    expect(tail[5]).toBe('echo test');

    existsSync.mockReset();
    existsSync.mockReturnValue(false);
  });
});
