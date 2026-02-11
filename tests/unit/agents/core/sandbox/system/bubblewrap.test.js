/**
 * Unit coverage for executeInBubblewrap/createBubblewrapExecutor in bubblewrap.js,
 * exercising boundary inputs, env merging, PID namespace isolation,
 * and mocked system dependencies.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../../js/agents/core/sandbox/system/constants.js', () => ({
  SandboxBackend: { BUBBLEWRAP: 'bubblewrap' },
  DefaultSandboxConfig: {
    allowedReadPaths: ['/default-read', 'relative-read'],
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
}));

import {
  executeInBubblewrap,
  createBubblewrapExecutor,
} from '../../../../../../js/agents/core/sandbox/system/bubblewrap.js';
import { execCommand } from '../../../../../../js/agents/core/sandbox/system/detect.js';
import { normalizeSandboxPath } from '../../../../../../js/agents/core/sandbox/system/path-utils.js';
import {
  DefaultSandboxConfig,
  SandboxBackend,
} from '../../../../../../js/agents/core/sandbox/system/constants.js';

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
// Module exports
// ---------------------------------------------------------------------------
describe('module exports', () => {
  it('exports executeInBubblewrap as a function', () => {
    expect(typeof executeInBubblewrap).toBe('function');
  });

  it('exports createBubblewrapExecutor as a function', () => {
    expect(typeof createBubblewrapExecutor).toBe('function');
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

    const readIndex = bwrapArgs.indexOf('/default-read');
    expect(readIndex).toBeGreaterThan(-1);
    expect(bwrapArgs[readIndex - 1]).toBe('--ro-bind-try');
    expect(bwrapArgs).not.toContain('relative-read');

    expect(normalizeSandboxPath).toHaveBeenCalledWith('./default-write', workDir);
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
  it('includes base filesystem bindings (dev, tmpfs, ro-bind)', async () => {
    await executeInBubblewrap('echo', [], { workDir: '/work' });
    const args = execCommand.mock.calls[0][1];

    expect(args).toContain('--dev');
    expect(args).toContain('/dev');
    expect(args).toContain('--tmpfs');
    expect(args).toContain('/tmp');

    // Core read-only bindings
    const roBinds = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--ro-bind') roBinds.push(args[i + 1]);
    }
    expect(roBinds).toContain('/usr');
    expect(roBinds).toContain('/lib');
    expect(roBinds).toContain('/bin');
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

  // -- /etc partial binds --
  it('includes /etc partial file bindings for DNS and TLS', async () => {
    await executeInBubblewrap('echo', [], { workDir: '/work' });
    const args = execCommand.mock.calls[0][1];

    // resolv.conf is mandatory ro-bind: '--ro-bind', src, dest
    const roBindIdx = args.indexOf('/etc/resolv.conf');
    expect(roBindIdx).toBeGreaterThan(-1);
    expect(args[roBindIdx - 1]).toBe('--ro-bind');
    // src and dest are both /etc/resolv.conf
    expect(args[roBindIdx + 1]).toBe('/etc/resolv.conf');

    // SSL certs as try-bind
    expect(args).toContain('/etc/ssl');
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
    const readIndex = args.indexOf(hugePath);
    expect(readIndex).toBeGreaterThan(-1);
    expect(args[readIndex - 1]).toBe('--ro-bind-try');
    expect(args).toContain(longCommand);
    expect(args).toContain(deepEnv);
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
    expect(normalizeSandboxPath).toHaveBeenCalledWith('./override-write', '/base');
    expect(normalizeSandboxPath).not.toHaveBeenCalledWith('./base-write', '/base');

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
