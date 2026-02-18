/**
 * Unit coverage for executeInSeatbelt/createSeatbeltExecutor in seatbelt.js,
 * focusing on SBPL profile generation and boundary cases.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  mkdtempSync: vi.fn((prefix) => `${prefix}test`),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  realpathSync: vi.fn((p) => p),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:path', async () => {
  const actual = await vi.importActual('node:path');
  return { ...actual };
});

import {
  executeInSeatbelt,
  createSeatbeltExecutor,
  parseLogLine,
  startViolationMonitor,
  NOISY_PROCESSES,
  LOG_STREAM_PREDICATE,
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
import { statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawn as mockSpawnFn } from 'node:child_process';

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
    expect(profile).toContain('(allow file-read* (subpath "/work/relative-read"))');

    expect(normalizeSandboxPath).toHaveBeenCalledWith(
      './default-write',
      workDir,
      expect.objectContaining({
        allowAbsolute: true,
        resolveSymlinks: true,
      })
    );
    expect(normalizeSandboxPath).toHaveBeenCalledWith(
      '/abs-write',
      workDir,
      expect.objectContaining({
        allowAbsolute: true,
        resolveSymlinks: true,
      })
    );
    expect(profile).toContain('(allow file-write* (subpath "/work/default-write"))');
    expect(profile).toContain('(allow file-write* (subpath "/abs-write"))');
    expect(profile).toContain('(deny network*)');

    // Fine-grained mach-lookup whitelist (not open allow)
    expect(profile).toContain('(allow mach-lookup');
    expect(profile).toContain('(global-name "com.apple.SecurityServer")');
    expect(profile).toContain('(global-name "com.apple.logd")');
    expect(profile).toContain('(global-name-regex #"^com\\.apple\\.sandbox\\.")');
    // Must NOT have a bare (allow mach-lookup) line
    expect(profile).not.toMatch(/^\(allow mach-lookup\)$/m);

    // Fine-grained sysctl-read whitelist
    expect(profile).toContain('(allow sysctl-read');
    expect(profile).toContain('(sysctl-name "hw.memsize")');
    expect(profile).toContain('(sysctl-name-prefix "kern.")');
    expect(profile).not.toMatch(/^\(allow sysctl-read\)$/m);

    // file-write-unlink deny for system dirs
    expect(profile).toContain('(deny file-write-unlink (subpath "/etc"))');
    expect(profile).toContain('(deny file-write-unlink (subpath "/usr"))');
    expect(profile).toContain('(deny file-write-unlink (subpath "/System"))');
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
    expect(profile).toContain('(allow file-read* (subpath "/work/relative-read"))');
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

  it('falls back to -f profile file when inline profile is too long', async () => {
    await executeInSeatbelt('echo', ['hi'], {
      workDir: '/work',
      allowedReadPaths: [`/${'x'.repeat(5000)}`],
      profileInlineThresholdBytes: 32,
      profileTempDir: '/tmp',
    });

    const args = execCommand.mock.calls[0][1];
    expect(args[0]).toBe('-f');
    expect(args[1]).toContain('/tmp/pb-seatbelt-');
    expect(mkdtempSync).toHaveBeenCalledTimes(1);
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    expect(rmSync).toHaveBeenCalled();
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

describe('fine-grained whitelists', () => {
  beforeEach(() => {
    statSync.mockImplementation(() => { throw new Error('ENOENT'); });
  });

  it('generates sysctl-read with individual names and prefixes', async () => {
    await executeInSeatbelt('echo', [], { workDir: '/work' });
    const profile = getProfileFromCall();

    expect(profile).toContain('(allow sysctl-read');
    expect(profile).toContain('  (sysctl-name "hw.memsize")');
    expect(profile).toContain('  (sysctl-name "hw.ncpu")');
    expect(profile).toContain('  (sysctl-name "kern.ostype")');
    expect(profile).toContain('  (sysctl-name-prefix "hw.")');
    expect(profile).toContain('  (sysctl-name-prefix "kern.")');
    expect(profile).toContain('  (sysctl-name-prefix "sysctl.")');
    expect(profile).toContain('  (sysctl-name-prefix "net.")');
    // No bare (allow sysctl-read)
    expect(profile).not.toMatch(/^\(allow sysctl-read\)$/m);
  });

  it('generates mach-lookup with specific global-name entries', async () => {
    await executeInSeatbelt('echo', [], { workDir: '/work' });
    const profile = getProfileFromCall();

    expect(profile).toContain('(allow mach-lookup');
    expect(profile).toContain('  (global-name "com.apple.SecurityServer")');
    expect(profile).toContain('  (global-name "com.apple.lsd.mapdb")');
    expect(profile).toContain('  (global-name "com.apple.FSEvents")');
    expect(profile).toContain('  (global-name "com.apple.cfprefsd.daemon")');
    expect(profile).toContain('  (global-name "com.apple.cfprefsd.agent")');
    expect(profile).toContain('  (global-name-regex #"^com\\.apple\\.sandbox\\.")');
    // No bare (allow mach-lookup)
    expect(profile).not.toMatch(/^\(allow mach-lookup\)$/m);
  });

  it('appends extraMachServices to the whitelist', async () => {
    await executeInSeatbelt('echo', [], {
      workDir: '/work',
      extraMachServices: ['com.custom.myservice', 'com.custom.other'],
    });
    const profile = getProfileFromCall();

    expect(profile).toContain('  (global-name "com.custom.myservice")');
    expect(profile).toContain('  (global-name "com.custom.other")');
    // Default entries still present
    expect(profile).toContain('  (global-name "com.apple.SecurityServer")');
  });

  it('appends extraSysctlNames to the whitelist', async () => {
    await executeInSeatbelt('echo', [], {
      workDir: '/work',
      extraSysctlNames: ['custom.metric'],
    });
    const profile = getProfileFromCall();

    expect(profile).toContain('  (sysctl-name "custom.metric")');
    // Default entries still present
    expect(profile).toContain('  (sysctl-name "hw.memsize")');
  });

  it('filters out empty/non-string extra entries', async () => {
    await executeInSeatbelt('echo', [], {
      workDir: '/work',
      extraMachServices: ['', null, undefined, 42, 'com.valid.service'],
      extraSysctlNames: ['', null, 'valid.name'],
    });
    const profile = getProfileFromCall();

    expect(profile).toContain('  (global-name "com.valid.service")');
    expect(profile).toContain('  (sysctl-name "valid.name")');
    // Should not contain empty or invalid entries
    expect(profile).not.toContain('(global-name "")');
    expect(profile).not.toContain('(sysctl-name "")');
  });

  it('includes file-write-unlink deny for system directories', async () => {
    await executeInSeatbelt('echo', [], { workDir: '/work' });
    const profile = getProfileFromCall();

    expect(profile).toContain('(deny file-write-unlink (subpath "/etc"))');
    expect(profile).toContain('(deny file-write-unlink (subpath "/usr"))');
    expect(profile).toContain('(deny file-write-unlink (subpath "/System"))');
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

describe('constants', () => {
  it('NOISY_PROCESSES is a Set with expected entries', () => {
    expect(NOISY_PROCESSES).toBeInstanceOf(Set);
    expect(NOISY_PROCESSES.has('mDNSResponder')).toBe(true);
    expect(NOISY_PROCESSES.has('diagnosticd')).toBe(true);
    expect(NOISY_PROCESSES.has('analyticsd')).toBe(true);
    expect(NOISY_PROCESSES.has('cfprefsd')).toBe(true);
    expect(NOISY_PROCESSES.has('logd')).toBe(true);
    expect(NOISY_PROCESSES.size).toBe(5);
  });

  it('LOG_STREAM_PREDICATE contains deny filter', () => {
    expect(LOG_STREAM_PREDICATE).toBe('eventMessage CONTAINS "deny"');
  });
});

describe('parseLogLine', () => {
  it('returns null for empty/invalid input', () => {
    expect(parseLogLine('')).toBeNull();
    expect(parseLogLine(null)).toBeNull();
    expect(parseLogLine(undefined)).toBeNull();
    expect(parseLogLine(123)).toBeNull();
  });

  it('returns null for lines without deny', () => {
    expect(parseLogLine('some random log line')).toBeNull();
    expect(parseLogLine('allow file-read-data /foo')).toBeNull();
  });

  it('parses sandbox deny with file-read-data operation', () => {
    const line = '2025-01-15 10:30:45.123456 myprocess[1234] Sandbox: deny(1) file-read-data /usr/local/secret';
    const result = parseLogLine(line);
    expect(result).not.toBeNull();
    expect(result.operation).toBe('file-read-data');
    expect(result.path).toBe('/usr/local/secret');
    expect(result.process).toBe('myprocess');
    expect(result.timestamp).toMatch(/^2025-01-15/);
  });

  it('parses mach-lookup deny', () => {
    const line = '2025-01-15 10:30:45.000 node[5678] Sandbox: deny(1) mach-lookup com.apple.private.service';
    const result = parseLogLine(line);
    expect(result.operation).toBe('mach-lookup');
    expect(result.path).toBe('com.apple.private.service');
    expect(result.process).toBe('node');
  });

  it('parses network-outbound deny', () => {
    const line = '2025-01-15 10:30:45.000 curl[999] Sandbox: deny(1) network-outbound';
    const result = parseLogLine(line);
    expect(result.operation).toBe('network-outbound');
    expect(result.process).toBe('curl');
  });

  it('parses deny without parens', () => {
    const line = 'Sandbox: deny file-write-data /tmp/foo';
    const result = parseLogLine(line);
    expect(result.operation).toBe('file-write-data');
    expect(result.path).toBe('/tmp/foo');
  });

  it('preserves paths containing spaces', () => {
    const line = '2025-01-15 10:30:45.000 node[1] Sandbox: deny(1) file-read-data /Users/me/My Folder/secret.txt (No such file or directory)';
    const result = parseLogLine(line);
    expect(result.operation).toBe('file-read-data');
    expect(result.path).toBe('/Users/me/My Folder/secret.txt');
  });

  it('returns null timestamp when not present', () => {
    const line = 'Sandbox: deny(1) file-read-data /secret';
    const result = parseLogLine(line);
    expect(result.timestamp).toBeNull();
  });

  it('returns null process when not present', () => {
    const line = 'Sandbox: deny(1) file-read-data /secret';
    const result = parseLogLine(line);
    expect(result.process).toBeNull();
  });
});

describe('startViolationMonitor', () => {
  let mockStdout;
  let mockChild;

  beforeEach(() => {
    mockStdout = {
      on: vi.fn(),
    };
    mockChild = {
      stdout: mockStdout,
      kill: vi.fn(),
    };
    mockSpawnFn.mockReturnValue(mockChild);
  });

  it('rejects when violationStore is missing', async () => {
    await expect(startViolationMonitor({})).rejects.toThrow('violationStore');
    await expect(startViolationMonitor({ violationStore: null })).rejects.toThrow('violationStore');
    await expect(startViolationMonitor({ violationStore: {} })).rejects.toThrow('violationStore');
  });

  it('spawns log stream with correct predicate', async () => {
    const store = { add: vi.fn() };
    const { stop } = await startViolationMonitor({ violationStore: store });

    expect(mockSpawnFn).toHaveBeenCalledWith(
      'log',
      ['stream', '--predicate', LOG_STREAM_PREDICATE],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );

    stop();
    expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('parses incoming data and writes to violationStore', async () => {
    const store = { add: vi.fn() };
    await startViolationMonitor({ violationStore: store });

    // Simulate data event
    const dataHandler = mockStdout.on.mock.calls.find(c => c[0] === 'data')[1];
    dataHandler(Buffer.from(
      '2025-01-15 10:30:45.000 node[123] Sandbox: deny(1) file-read-data /secret\n'
    ));

    expect(store.add).toHaveBeenCalledTimes(1);
    const call = store.add.mock.calls[0][0];
    expect(call.type).toBe('sandbox:deny');
    expect(call.detail).toContain('file-read-data');
    expect(call.detail).toContain('/secret');
    expect(call.meta.operation).toBe('file-read-data');
    expect(call.meta.path).toBe('/secret');
    expect(call.meta.process).toBe('node');
  });

  it('filters out noisy processes', async () => {
    const store = { add: vi.fn() };
    await startViolationMonitor({ violationStore: store });

    const dataHandler = mockStdout.on.mock.calls.find(c => c[0] === 'data')[1];
    dataHandler(Buffer.from(
      '2025-01-15 10:30:45.000 mDNSResponder[111] Sandbox: deny(1) network-outbound\n' +
      '2025-01-15 10:30:45.000 diagnosticd[222] Sandbox: deny(1) file-read-data /foo\n' +
      '2025-01-15 10:30:45.000 myapp[333] Sandbox: deny(1) file-read-data /bar\n'
    ));

    expect(store.add).toHaveBeenCalledTimes(1);
    expect(store.add.mock.calls[0][0].meta.process).toBe('myapp');
  });

  it('filters by ignorePatterns', async () => {
    const store = { add: vi.fn() };
    await startViolationMonitor({
      violationStore: store,
      ignorePatterns: [/\/tmp\/harmless/],
    });

    const dataHandler = mockStdout.on.mock.calls.find(c => c[0] === 'data')[1];
    dataHandler(Buffer.from(
      'app[1] Sandbox: deny(1) file-read-data /tmp/harmless/foo\n' +
      'app[1] Sandbox: deny(1) file-read-data /secret/bar\n'
    ));

    expect(store.add).toHaveBeenCalledTimes(1);
    expect(store.add.mock.calls[0][0].detail).toContain('/secret/bar');
  });

  it('includes sessionId in meta when provided', async () => {
    const store = { add: vi.fn() };
    await startViolationMonitor({
      violationStore: store,
      sessionId: 'sess-42',
    });

    const dataHandler = mockStdout.on.mock.calls.find(c => c[0] === 'data')[1];
    dataHandler(Buffer.from(
      '2025-01-15 10:30:45.000 node[123] Sandbox: deny(1) file-read-data /x\n'
    ));

    expect(store.add.mock.calls[0][0].meta.sessionId).toBe('sess-42');
  });

  it('accepts custom noisyProcesses override', async () => {
    const store = { add: vi.fn() };
    const custom = new Set(['mynoisy']);
    await startViolationMonitor({
      violationStore: store,
      noisyProcesses: custom,
    });

    const dataHandler = mockStdout.on.mock.calls.find(c => c[0] === 'data')[1];
    dataHandler(Buffer.from(
      '2025-01-15 10:30:45.000 mynoisy[111] Sandbox: deny(1) file-read-data /a\n' +
      '2025-01-15 10:30:45.000 mDNSResponder[222] Sandbox: deny(1) file-read-data /b\n'
    ));

    // mynoisy filtered, mDNSResponder NOT filtered (custom override)
    expect(store.add).toHaveBeenCalledTimes(1);
    expect(store.add.mock.calls[0][0].meta.process).toBe('mDNSResponder');
  });

  it('handles partial lines across chunks', async () => {
    const store = { add: vi.fn() };
    await startViolationMonitor({ violationStore: store });

    const dataHandler = mockStdout.on.mock.calls.find(c => c[0] === 'data')[1];
    // First chunk: partial line
    dataHandler(Buffer.from('app[1] Sandbox: deny(1) file-read-data'));
    expect(store.add).not.toHaveBeenCalled();

    // Second chunk: completes the line
    dataHandler(Buffer.from(' /secret\n'));
    expect(store.add).toHaveBeenCalledTimes(1);
    expect(store.add.mock.calls[0][0].detail).toContain('/secret');
  });

  it('stop kills the child process', async () => {
    const store = { add: vi.fn() };
    const { stop } = await startViolationMonitor({ violationStore: store });

    stop();
    expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
