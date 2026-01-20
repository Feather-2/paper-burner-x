import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';

import { SandboxBackend, Platform } from '../../../../../../js/agents/core/sandbox/system/constants.js';
import {
  detectAllBackends,
  detectBestBackend,
  getPlatform,
  detectBubblewrap,
  detectSeatbelt,
} from '../../../../../../js/agents/core/sandbox/system/detect.js';

const spawnMock = vi.mocked(spawn);
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

function setProcessPlatform(value) {
  if (!originalPlatformDescriptor) {
    return;
  }
  Object.defineProperty(process, 'platform', {
    ...originalPlatformDescriptor,
    value,
  });
}

function createMockProcess({ code = 0, stdout = '', stderr = '', emitError, delay = 0 } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  const finalize = () => {
    if (emitError) {
      proc.emit('error', emitError);
      return;
    }
    if (stdout !== undefined) {
      proc.stdout.emit('data', stdout);
    }
    if (stderr !== undefined) {
      proc.stderr.emit('data', stderr);
    }
    proc.emit('close', code);
  };

  if (delay > 0) {
    setTimeout(finalize, delay);
  } else {
    queueMicrotask(finalize);
  }

  return proc;
}

function mockSpawnWithMap(map) {
  spawnMock.mockImplementation((cmd, args = []) => {
    const key = args.length ? `${cmd} ${args.join(' ')}` : cmd;
    const response = map[key] ?? map[cmd] ?? {};
    if (Object.prototype.hasOwnProperty.call(response, 'throwError')) {
      throw response.throwError;
    }
    return createMockProcess(response);
  });
}

beforeEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  spawnMock.mockReset();
  if (originalPlatformDescriptor) {
    Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  spawnMock.mockReset();
  if (originalPlatformDescriptor) {
    Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  }
});

describe('detectAllBackends', () => {
  it('returns bubblewrap, docker, permission-only in priority order on linux', async () => {
    setProcessPlatform(Platform.LINUX);
    mockSpawnWithMap({
      'which bwrap': { code: 1, stdout: '' },
      'docker --version': { code: 1, stdout: '' },
    });

    const results = await detectAllBackends();

    expect(results.map((r) => r.backend)).toEqual([
      SandboxBackend.BUBBLEWRAP,
      SandboxBackend.DOCKER,
      SandboxBackend.PERMISSION_ONLY,
    ]);
    expect(results[0].available).toBe(false);
    expect(results[1].available).toBe(false);
    expect(results[2].available).toBe(true);
  });

  it('returns seatbelt, docker, permission-only on darwin', async () => {
    setProcessPlatform(Platform.DARWIN);
    mockSpawnWithMap({
      'which sandbox-exec': { code: 1, stdout: '' },
      'docker --version': { code: 1, stdout: '' },
    });

    const results = await detectAllBackends();

    expect(results.map((r) => r.backend)).toEqual([
      SandboxBackend.SEATBELT,
      SandboxBackend.DOCKER,
      SandboxBackend.PERMISSION_ONLY,
    ]);
  });

  it('returns docker + permission-only on non-linux/darwin platforms', async () => {
    setProcessPlatform(Platform.WIN32);
    mockSpawnWithMap({
      'docker --version': { code: 1, stdout: '' },
    });

    const results = await detectAllBackends();

    expect(results.map((r) => r.backend)).toEqual([
      SandboxBackend.DOCKER,
      SandboxBackend.PERMISSION_ONLY,
    ]);
  });
});

describe('detectBestBackend', () => {
  it('selects the first available backend by priority', async () => {
    setProcessPlatform(Platform.LINUX);
    mockSpawnWithMap({
      'which bwrap': { code: 0, stdout: '/usr/bin/bwrap\n' },
      'bwrap --version': { code: 0, stdout: 'bubblewrap 0.8.0\n' },
      'docker --version': { code: 0, stdout: 'Docker version 25.0.0\n' },
      'docker info': { code: 0, stdout: 'ok\n' },
    });

    const result = await detectBestBackend();

    expect(result.backend).toBe(SandboxBackend.BUBBLEWRAP);
    expect(result.available).toBe(true);
    expect(result.path).toBe('/usr/bin/bwrap');
  });

  it('falls back to permission-only when others are unavailable', async () => {
    setProcessPlatform(Platform.WIN32);
    mockSpawnWithMap({
      'docker --version': { code: 1, stdout: '' },
    });

    const result = await detectBestBackend();

    expect(result.backend).toBe(SandboxBackend.PERMISSION_ONLY);
    expect(result.available).toBe(true);
  });

  it('supports rapid consecutive calls', async () => {
    setProcessPlatform(Platform.WIN32);
    mockSpawnWithMap({
      'docker --version': { code: 1, stdout: '' },
    });

    const first = await detectBestBackend();
    const second = await detectBestBackend();

    expect(second).toEqual(first);
  });

  it('handles large docker version outputs (resource boundary)', async () => {
    setProcessPlatform(Platform.WIN32);
    const hugeVersion = `Docker version ${'x'.repeat(50000)}`;
    mockSpawnWithMap({
      'docker --version': { code: 0, stdout: hugeVersion },
      'docker info': { code: 0, stdout: 'ok' },
    });

    const result = await detectBestBackend();

    expect(result.backend).toBe(SandboxBackend.DOCKER);
    expect(result.version).toBe(hugeVersion.trim());
    expect(result.version.length).toBeGreaterThan(40000);
  });
});

describe('getPlatform', () => {
  it('returns process.platform when available', () => {
    expect(getPlatform()).toBe(process.platform);
  });

  it('uses Deno build when process.platform is empty string', () => {
    setProcessPlatform('');
    const deno = { build: { os: 'windows' } };
    vi.stubGlobal('Deno', deno);

    expect(getPlatform()).toBe(Platform.WIN32);
  });

  it('returns browser when no platform and no Deno', () => {
    setProcessPlatform(undefined);
    vi.stubGlobal('Deno', undefined);

    expect(getPlatform()).toBe('browser');
  });

  it('supports concurrent reads without shared state', async () => {
    setProcessPlatform(Platform.LINUX);

    const [first, second] = await Promise.all([
      Promise.resolve(getPlatform()),
      Promise.resolve(getPlatform()),
    ]);

    expect(first).toBe(Platform.LINUX);
    expect(second).toBe(Platform.LINUX);
  });

  it('handles Deno edge values for type and empty inputs', () => {
    setProcessPlatform(undefined);
    const deno = { build: { os: 'linux' } };
    vi.stubGlobal('Deno', deno);

    deno.build.os = '   ';
    expect(getPlatform()).toBe('   ');

    deno.build.os = '123';
    expect(getPlatform()).toBe('123');

    deno.build.os = [];
    expect(getPlatform()).toEqual([]);

    const arrayLike = { 0: 'linux', length: 1 };
    deno.build.os = arrayLike;
    expect(getPlatform()).toBe(arrayLike);

    deno.build = [];
    expect(getPlatform()).toBeUndefined();

    deno.build = {};
    expect(getPlatform()).toBeUndefined();

    deno.build = null;
    expect(getPlatform()).toBe('browser');
  });
});

describe('detectBubblewrap', () => {
  it('returns unavailable on non-linux platforms', async () => {
    setProcessPlatform(Platform.DARWIN);

    const result = await detectBubblewrap();

    expect(result.available).toBe(false);
    expect(result.error).toBe('Bubblewrap only available on Linux');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('returns available with path and version when found', async () => {
    setProcessPlatform(Platform.LINUX);
    mockSpawnWithMap({
      'which bwrap': { code: 0, stdout: '/usr/bin/bwrap\n' },
      'bwrap --version': { code: 0, stdout: 'bubblewrap 0.8.0\n' },
    });

    const result = await detectBubblewrap();

    expect(result).toMatchObject({
      backend: SandboxBackend.BUBBLEWRAP,
      platform: Platform.LINUX,
      available: true,
      path: '/usr/bin/bwrap',
      version: 'bubblewrap 0.8.0',
    });
  });

  it('returns not found when which reports empty output', async () => {
    setProcessPlatform(Platform.LINUX);
    mockSpawnWithMap({
      'which bwrap': { code: 0, stdout: '' },
    });

    const result = await detectBubblewrap();

    expect(result.available).toBe(false);
    expect(result.error).toBe('bwrap not found. Install with: apt install bubblewrap');
  });

  it('handles null errors from execCommand', async () => {
    setProcessPlatform(Platform.LINUX);
    mockSpawnWithMap({
      'which bwrap': { throwError: null },
    });

    const result = await detectBubblewrap();

    expect(result.available).toBe(false);
    expect(result.error).toBe('bwrap detection failed');
  });
});

describe('detectSeatbelt', () => {
  it('returns unavailable on non-darwin platforms', async () => {
    setProcessPlatform(Platform.LINUX);

    const result = await detectSeatbelt();

    expect(result.available).toBe(false);
    expect(result.error).toBe('Seatbelt only available on macOS');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('returns available and trims whitespace paths', async () => {
    setProcessPlatform(Platform.DARWIN);
    mockSpawnWithMap({
      'which sandbox-exec': { code: 0, stdout: '   \n' },
    });

    const result = await detectSeatbelt();

    expect(result.available).toBe(true);
    expect(result.path).toBe('');
  });

  it('returns unavailable for boundary exit code -1', async () => {
    setProcessPlatform(Platform.DARWIN);
    mockSpawnWithMap({
      'which sandbox-exec': { code: -1, stdout: '' },
    });

    const result = await detectSeatbelt();

    expect(result.available).toBe(false);
    expect(result.error).toBe('sandbox-exec not found (should be built-in on macOS)');
  });

  it('returns unavailable for boundary exit code MAX_SAFE_INTEGER', async () => {
    setProcessPlatform(Platform.DARWIN);
    mockSpawnWithMap({
      'which sandbox-exec': { code: Number.MAX_SAFE_INTEGER, stdout: '' },
    });

    const result = await detectSeatbelt();

    expect(result.available).toBe(false);
    expect(result.error).toBe('sandbox-exec not found (should be built-in on macOS)');
  });

  it('handles undefined errors from execCommand', async () => {
    setProcessPlatform(Platform.DARWIN);
    mockSpawnWithMap({
      'which sandbox-exec': { throwError: undefined },
    });

    const result = await detectSeatbelt();

    expect(result.available).toBe(false);
    expect(result.error).toBe('sandbox-exec detection failed');
  });

  it('handles deep nested error objects', async () => {
    setProcessPlatform(Platform.DARWIN);
    const deepError = { nested: { level1: { level2: { level3: { level4: {} } } } } };
    mockSpawnWithMap({
      'which sandbox-exec': { throwError: deepError },
    });

    const result = await detectSeatbelt();

    expect(result.available).toBe(false);
    expect(result.error).toBe('sandbox-exec detection failed');
  });
});
