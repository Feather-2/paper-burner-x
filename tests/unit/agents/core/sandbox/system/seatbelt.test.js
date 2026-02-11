/**
 * Unit coverage for executeInSeatbelt/createSeatbeltExecutor in seatbelt.js,
 * focusing on SBPL profile generation and boundary cases.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../../js/agents/core/sandbox/system/constants.js', () => ({
  SandboxBackend: { SEATBELT: 'seatbelt' },
  DefaultSandboxConfig: {
    allowedReadPaths: ['/default-read', 'relative-read'],
    allowedWritePaths: ['./default-write', '/abs-write'],
    allowNetwork: false,
    timeoutMs: 12345,
  },
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/detect.js', () => ({
  execCommand: vi.fn(),
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/path-utils.js', () => ({
  normalizeSandboxPath: vi.fn(),
  isSafeForSBPL: vi.fn(),
}));

vi.mock('node:fs', () => ({
  statSync: vi.fn(),
  existsSync: vi.fn(),
  lstatSync: vi.fn(),
}));

vi.mock('node:path', async () => {
  const actual = await vi.importActual('node:path');
  return { ...actual };
});

import {
  executeInSeatbelt,
  createSeatbeltExecutor,
} from '../../../../../../js/agents/core/sandbox/system/seatbelt.js';
import { execCommand } from '../../../../../../js/agents/core/sandbox/system/detect.js';
import {
  normalizeSandboxPath,
  isSafeForSBPL,
} from '../../../../../../js/agents/core/sandbox/system/path-utils.js';
import {
  DefaultSandboxConfig,
  SandboxBackend,
} from '../../../../../../js/agents/core/sandbox/system/constants.js';
import { statSync } from 'node:fs';

const BASE_RESULT = { code: 0, stdout: 'ok', stderr: '' };

const getProfileFromCall = (callIndex = 0) => execCommand.mock.calls[callIndex][1][1];

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
  isSafeForSBPL.mockImplementation(
    (p) => typeof p === 'string' && !p.includes('unsafe')
  );
});

describe('executeInSeatbelt', () => {
  it('rejects when options is null or undefined', async () => {
    await expect(executeInSeatbelt('echo', [], undefined)).rejects.toThrow();
    await expect(executeInSeatbelt('echo', [], null)).rejects.toThrow();
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('rejects when workDir is missing or empty', async () => {
    await expect(executeInSeatbelt('echo', [], {})).rejects.toThrow(
      'workDir is required for Seatbelt sandbox'
    );
    await expect(executeInSeatbelt('echo', [], { workDir: '' })).rejects.toThrow(
      'workDir is required for Seatbelt sandbox'
    );
    await expect(executeInSeatbelt('echo', [], { workDir: null })).rejects.toThrow(
      'workDir is required for Seatbelt sandbox'
    );
  });

  it('throws when workDir contains unsafe characters', async () => {
    await expect(
      executeInSeatbelt('echo', [], { workDir: '/unsafe/path' })
    ).rejects.toThrow('workDir contains unsafe characters for SBPL profile');
  });

  it('uses default config values and builds profile', async () => {
    const workDir = '/work';
    const result = await executeInSeatbelt('echo', ['hello'], { workDir });

    expect(result).toEqual({
      ...BASE_RESULT,
      killed: false,
      backend: SandboxBackend.SEATBELT,
    });

    expect(execCommand).toHaveBeenCalledTimes(1);
    const [cmd, sandboxArgs, options] = execCommand.mock.calls[0];

    expect(cmd).toBe('sandbox-exec');
    expect(options).toEqual({ timeout: DefaultSandboxConfig.timeoutMs });
    expect(sandboxArgs.slice(0, 4)).toEqual([
      '-p',
      expect.any(String),
      'echo',
      'hello',
    ]);

    const profile = sandboxArgs[1];
    expect(profile).toContain('(allow file-read* (subpath "/work"))');
    expect(profile).toContain('(allow file-write* (subpath "/work"))');
    expect(profile).toContain('(allow file-read* (subpath "/default-read"))');
    expect(profile).not.toContain('relative-read');

    expect(normalizeSandboxPath).toHaveBeenCalledWith('./default-write', workDir);
    expect(normalizeSandboxPath).toHaveBeenCalledWith('/abs-write', workDir);
    expect(profile).toContain('(allow file-write* (subpath "/work/default-write"))');
    expect(profile).toContain('(allow file-write* (subpath "/abs-write"))');
    expect(profile).toContain('(deny network*)');
  });

  it('toggles network rule based on allowNetwork', async () => {
    await executeInSeatbelt('echo', [], { workDir: '/work', allowNetwork: true });
    const profileAllow = getProfileFromCall(0);
    expect(profileAllow).toContain('(allow network*)');
    expect(profileAllow).not.toContain('(deny network*)');

    await executeInSeatbelt('echo', [], { workDir: '/work', allowNetwork: false });
    const profileDeny = getProfileFromCall(1);
    expect(profileDeny).toContain('(deny network*)');
    expect(profileDeny).not.toContain('(allow network*)');
  });

  it('passes through timeout boundary values and string types', async () => {
    const timeouts = [0, -1, Number.MAX_SAFE_INTEGER, '5000'];

    for (const timeoutMs of timeouts) {
      execCommand.mockResolvedValueOnce({ ...BASE_RESULT });
      await executeInSeatbelt('echo', [], { workDir: '/work', timeoutMs });
      expect(execCommand).toHaveBeenLastCalledWith(
        'sandbox-exec',
        expect.any(Array),
        { timeout: timeoutMs }
      );
    }
  });

  it('sets killed for timeout exit codes', async () => {
    execCommand.mockResolvedValueOnce({ code: 137, stdout: '', stderr: '' });
    const killedBySignal = await executeInSeatbelt('echo', [], { workDir: '/work' });
    expect(killedBySignal.killed).toBe(true);
    expect(killedBySignal.backend).toBe(SandboxBackend.SEATBELT);

    execCommand.mockResolvedValueOnce({ code: 124, stdout: '', stderr: '' });
    const killedByTimeout = await executeInSeatbelt('echo', [], { workDir: '/work' });
    expect(killedByTimeout.killed).toBe(true);
    expect(killedByTimeout.backend).toBe(SandboxBackend.SEATBELT);
  });

  it('handles empty arrays without extra sections', async () => {
    await executeInSeatbelt('echo', [], {
      workDir: '/work',
      allowedReadPaths: [],
      allowedWritePaths: [],
    });

    const profile = getProfileFromCall();
    expect(profile).not.toContain('/default-read');
    expect(profile).not.toContain('/work/default-write');
    expect(profile).not.toContain('/abs-write');
    expect(normalizeSandboxPath).not.toHaveBeenCalled();
  });

  it('accepts whitespace workDir values', async () => {
    const workDir = '   ';
    await executeInSeatbelt('echo', [], { workDir });

    const profile = getProfileFromCall();
    expect(profile).toContain(`(allow file-read* (subpath "${workDir}"))`);
    expect(profile).toContain(`(allow file-write* (subpath "${workDir}"))`);
  });

  it('rejects when command args are not iterable', async () => {
    await expect(
      executeInSeatbelt('echo', { not: 'array' }, { workDir: '/work' })
    ).rejects.toThrow();
  });

  it('skips unsafe or invalid allowed paths', async () => {
    normalizeSandboxPath.mockImplementation((p, workDir) => {
      if (p === '../escape') return null;
      if (p.startsWith('/')) return p;
      const trimmed = p.startsWith('./') ? p.slice(2) : p;
      return `${workDir}/${trimmed}`;
    });

    await executeInSeatbelt('echo', [], {
      workDir: '/work',
      allowedReadPaths: ['/safe-read', '/unsafe-read', 'relative-read'],
      allowedWritePaths: ['../escape', '/unsafe-write', './safe-write'],
    });

    const profile = getProfileFromCall();
    expect(profile).toContain('(allow file-read* (subpath "/safe-read"))');
    expect(profile).not.toContain('/unsafe-read');
    expect(profile).not.toContain('relative-read');
    expect(profile).toContain('(allow file-write* (subpath "/work/safe-write"))');
    expect(profile).not.toContain('/unsafe-write');
  });

  it('supports concurrent execution calls', async () => {
    execCommand
      .mockResolvedValueOnce({ code: 0, stdout: 'first', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'second', stderr: '' });

    const [first, second] = await Promise.all([
      executeInSeatbelt('echo', ['1'], { workDir: '/work1' }),
      executeInSeatbelt('echo', ['2'], { workDir: '/work2' }),
    ]);

    expect(first.stdout).toBe('first');
    expect(second.stdout).toBe('second');
    expect(execCommand).toHaveBeenCalledTimes(2);
  });

  it('supports rapid sequential execution calls', async () => {
    execCommand
      .mockResolvedValueOnce({ code: 0, stdout: 'one', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'two', stderr: '' });

    const first = await executeInSeatbelt('echo', ['one'], { workDir: '/work1' });
    const second = await executeInSeatbelt('echo', ['two'], { workDir: '/work2' });

    expect(first.stdout).toBe('one');
    expect(second.stdout).toBe('two');
    expect(execCommand).toHaveBeenCalledTimes(2);
  });

  it('handles large inputs and deep nesting', async () => {
    const longCommand = `cmd-${'x'.repeat(8000)}`;
    const hugePath = `/tmp/${'a'.repeat(4000)}`;
    const deepPath = `deep/${'nest/'.repeat(20)}file`;

    execCommand.mockResolvedValueOnce({ ...BASE_RESULT });

    await executeInSeatbelt(longCommand, ['arg'], {
      workDir: '/work',
      allowedReadPaths: [hugePath],
      allowedWritePaths: [deepPath],
    });

    const args = execCommand.mock.calls[0][1];
    const profile = args[1];
    expect(profile).toContain(hugePath);
    expect(profile).toContain(`/work/${deepPath}`);
    expect(args).toContain(longCommand);
  });
});

describe('mandatory deny paths', () => {
  beforeEach(() => {
    // statSync throws by default (no .git directory)
    statSync.mockImplementation(() => { throw new Error('ENOENT'); });
  });

  it('adds deny rules for dangerous files and dirs by default', async () => {
    await executeInSeatbelt('echo', [], { workDir: '/work' });
    const profile = getProfileFromCall();

    // Dangerous files get literal deny
    expect(profile).toContain('(deny file-write* (literal "/work/.bashrc"))');
    expect(profile).toContain('(deny file-write* (literal "/work/.env"))');
    expect(profile).toContain('(deny file-write* (literal "/work/.gitconfig"))');
    expect(profile).toContain('(deny file-write* (literal "/work/.npmrc"))');
    expect(profile).toContain('(deny file-write* (literal "/work/.env.local"))');
    expect(profile).toContain('(deny file-write* (literal "/work/.env.production"))');

    // Dangerous dirs get subpath deny
    expect(profile).toContain('(deny file-write* (subpath "/work/.ssh"))');
    expect(profile).toContain('(deny file-write* (subpath "/work/.gnupg"))');
    expect(profile).toContain('(deny file-write* (subpath "/work/.claude"))');
  });

  it('adds .git/hooks and .git/config deny when .git is a directory', async () => {
    statSync.mockImplementation(() => ({ isDirectory: () => true }));

    await executeInSeatbelt('echo', [], { workDir: '/work' });
    const profile = getProfileFromCall();

    expect(profile).toContain('(deny file-write* (subpath "/work/.git/hooks"))');
    expect(profile).toContain('(deny file-write* (literal "/work/.git/config"))');
  });

  it('skips .git/hooks when .git is not a directory', async () => {
    statSync.mockImplementation(() => ({ isDirectory: () => false }));

    await executeInSeatbelt('echo', [], { workDir: '/work' });
    const profile = getProfileFromCall();

    expect(profile).not.toContain('.git/hooks');
    expect(profile).not.toContain('.git/config');
  });

  it('disables mandatory deny when disableMandatoryDeny is true', async () => {
    await executeInSeatbelt('echo', [], {
      workDir: '/work',
      disableMandatoryDeny: true,
    });
    const profile = getProfileFromCall();

    expect(profile).not.toContain('.bashrc');
    expect(profile).not.toContain('.ssh');
    expect(profile).not.toContain('.env');
    expect(profile).not.toContain('mandatory deny');
  });

  it('merges custom denyPaths with mandatory deny paths', async () => {
    await executeInSeatbelt('echo', [], {
      workDir: '/work',
      denyPaths: ['/custom/secret.key'],
    });
    const profile = getProfileFromCall();

    // Custom deny path
    expect(profile).toContain('(deny file-write* (literal "/custom/secret.key"))');
    // Mandatory still present
    expect(profile).toContain('(deny file-write* (literal "/work/.bashrc"))');
  });

  it('uses only custom denyPaths when mandatory deny is disabled', async () => {
    await executeInSeatbelt('echo', [], {
      workDir: '/work',
      denyPaths: ['/custom/secret.key'],
      disableMandatoryDeny: true,
    });
    const profile = getProfileFromCall();

    expect(profile).toContain('(deny file-write* (literal "/custom/secret.key"))');
    expect(profile).not.toContain('.bashrc');
    expect(profile).not.toContain('.ssh');
  });

  it('skips deny paths that fail isSafeForSBPL', async () => {
    await executeInSeatbelt('echo', [], {
      workDir: '/work',
      denyPaths: ['/unsafe/path'],
      disableMandatoryDeny: true,
    });
    const profile = getProfileFromCall();

    expect(profile).not.toContain('/unsafe/path');
  });
});

describe('createSeatbeltExecutor', () => {
  it('exposes backend and merges default options for execute', async () => {
    const executor = createSeatbeltExecutor({
      workDir: '/base',
      allowNetwork: false,
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
      allowedWritePaths: ['./override-write'],
    });

    expect(executor.backend).toBe(SandboxBackend.SEATBELT);
    const profile = getProfileFromCall();
    expect(profile).toContain('(allow network*)');
    expect(profile).toContain('(allow file-write* (subpath "/base/override-write"))');
    expect(profile).not.toContain('/base/base-write');
    expect(normalizeSandboxPath).toHaveBeenCalledWith('./override-write', '/base');
    expect(normalizeSandboxPath).not.toHaveBeenCalledWith('./base-write', '/base');
    expect(execCommand).toHaveBeenCalledWith('sandbox-exec', expect.any(Array), {
      timeout: 321,
    });
  });

  it('wraps shell commands with /bin/sh -c', async () => {
    const executor = createSeatbeltExecutor({ workDir: '/shell', timeoutMs: 50 });
    execCommand.mockResolvedValueOnce({ ...BASE_RESULT });

    await executor.shell('echo hi', { timeoutMs: 0 });

    const args = execCommand.mock.calls[0][1];
    expect(args.slice(2, 5)).toEqual(['/bin/sh', '-c', 'echo hi']);
    expect(execCommand).toHaveBeenCalledWith('sandbox-exec', expect.any(Array), {
      timeout: 0,
    });
  });
});
