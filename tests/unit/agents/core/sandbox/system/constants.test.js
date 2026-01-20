import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:os', () => ({
  platform: vi.fn(() => 'linux'),
}));

import { platform as osPlatform } from 'node:os';

import constantsDefault, {
  DefaultSandboxConfig,
  Platform,
  SandboxBackend,
  SandboxPolicy,
} from '../../../../../../js/agents/core/sandbox/system/constants.js';

const LONG_STRING = 'x'.repeat(10000);
const HUGE_STRING = 'y'.repeat(1024 * 1024);

const makeDeepObject = (depth) => {
  let root = {};
  let current = root;

  for (let i = 0; i < depth; i += 1) {
    current.next = {};
    current = current.next;
  }

  return root;
};

const DEEP_OBJECT = makeDeepObject(20);

const isKnownValue = (enumObj, value) => Object.values(enumObj).includes(value);
const safeLookup = (enumObj, key) => enumObj?.[key];
const safeIncludes = (paths, value) => (Array.isArray(paths) ? paths.includes(value) : false);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SandboxBackend', () => {
  it('defines expected backend identifiers', () => {
    expect(SandboxBackend).toEqual({
      BUBBLEWRAP: 'bubblewrap',
      SEATBELT: 'seatbelt',
      DOCKER: 'docker',
      PERMISSION_ONLY: 'permission-only',
      NONE: 'none',
    });
  });

  it('validates known values and rejects boundary inputs', () => {
    expect(isKnownValue(SandboxBackend, SandboxBackend.DOCKER)).toBe(true);
    expect(isKnownValue(SandboxBackend, SandboxBackend.SEATBELT)).toBe(true);

    const invalidValues = [
      null,
      undefined,
      '',
      '   ',
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      [],
      {},
      '0',
      LONG_STRING,
    ];

    invalidValues.forEach((value) => {
      expect(isKnownValue(SandboxBackend, value)).toBe(false);
    });
  });

  it('returns undefined for unknown keys without throwing', () => {
    const invalidKeys = [null, undefined, '', 'missing', [], {}, DEEP_OBJECT];

    invalidKeys.forEach((key) => {
      expect(() => safeLookup(SandboxBackend, key)).not.toThrow();
      expect(safeLookup(SandboxBackend, key)).toBeUndefined();
    });
  });
});

describe('SandboxPolicy', () => {
  it('defines expected policy identifiers', () => {
    expect(SandboxPolicy).toEqual({
      NO_NETWORK: 'no-network',
      READ_ONLY_FS: 'read-only-fs',
      RESTRICT_WRITE: 'restrict-write',
      NO_SPAWN: 'no-spawn',
    });
  });

  it('is stable under concurrent reads', async () => {
    const reads = Array.from({ length: 32 }, () =>
      Promise.resolve(SandboxPolicy.NO_NETWORK)
    );
    const results = await Promise.all(reads);

    expect(results.every((value) => value === SandboxPolicy.NO_NETWORK)).toBe(true);
  });

  it('keeps consistent values across rapid reads', () => {
    const reads = [];

    for (let i = 0; i < 100; i += 1) {
      reads.push(SandboxPolicy.RESTRICT_WRITE);
    }

    expect(new Set(reads).size).toBe(1);
  });

  it('returns undefined for unknown keys and boundary values', () => {
    const invalidKeys = [
      null,
      undefined,
      '',
      '   ',
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      [],
      {},
      DEEP_OBJECT,
    ];

    invalidKeys.forEach((key) => {
      expect(SandboxPolicy[key]).toBeUndefined();
    });
  });
});

describe('DefaultSandboxConfig', () => {
  it('exposes the expected default configuration', () => {
    expect(DefaultSandboxConfig.allowedWritePaths).toEqual(['.', './output', './temp']);
    expect(DefaultSandboxConfig.allowedReadPaths).toEqual(['.', '/usr', '/lib', '/lib64', '/bin', '/etc']);
    expect(DefaultSandboxConfig.allowNetwork).toBe(false);
    expect(DefaultSandboxConfig.timeoutMs).toBe(60000);
    expect(DefaultSandboxConfig.memoryLimit).toBe(512 * 1024 * 1024);
  });

  it('supports numeric and string indices while rejecting boundary numbers', () => {
    const { allowedWritePaths } = DefaultSandboxConfig;

    expect(allowedWritePaths[0]).toBe('.');
    expect(allowedWritePaths['0']).toBe('.');
    expect(allowedWritePaths[-1]).toBeUndefined();
    expect(allowedWritePaths[Number.MAX_SAFE_INTEGER]).toBeUndefined();
  });

  it('handles invalid path collections and resource-sized values safely', () => {
    expect(safeIncludes(DefaultSandboxConfig.allowedReadPaths, HUGE_STRING)).toBe(false);
    expect(safeIncludes(DefaultSandboxConfig.allowedReadPaths, LONG_STRING)).toBe(false);
    expect(safeIncludes(DefaultSandboxConfig.allowedReadPaths, '   ')).toBe(false);
    expect(safeIncludes(DefaultSandboxConfig.allowedReadPaths, null)).toBe(false);
    expect(safeIncludes(DefaultSandboxConfig.allowedReadPaths, undefined)).toBe(false);
    expect(safeIncludes([], '.')).toBe(false);
    expect(safeIncludes({}, '.')).toBe(false);
    expect(safeIncludes(DefaultSandboxConfig.allowedReadPaths, DEEP_OBJECT)).toBe(false);
  });
});

describe('Platform', () => {
  it('defines expected platform strings', () => {
    expect(Platform).toEqual({
      LINUX: 'linux',
      DARWIN: 'darwin',
      WIN32: 'win32',
    });
  });

  it('matches the mocked os.platform value', () => {
    expect(osPlatform()).toBe(Platform.LINUX);
    expect(osPlatform).toHaveBeenCalledTimes(1);
  });

  it('returns undefined for unknown keys and boundary values', () => {
    const invalidKeys = [
      null,
      undefined,
      '',
      '   ',
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      [],
      {},
      DEEP_OBJECT,
    ];

    invalidKeys.forEach((key) => {
      expect(Platform[key]).toBeUndefined();
    });
  });
});

describe('default export', () => {
  it('exposes named exports by reference', () => {
    expect(constantsDefault.SandboxBackend).toBe(SandboxBackend);
    expect(constantsDefault.SandboxPolicy).toBe(SandboxPolicy);
    expect(constantsDefault.DefaultSandboxConfig).toBe(DefaultSandboxConfig);
    expect(constantsDefault.Platform).toBe(Platform);
  });

  it('handles unknown keys safely', () => {
    expect(() => safeLookup(constantsDefault, null)).not.toThrow();
    expect(constantsDefault.UNKNOWN).toBeUndefined();
    expect(safeLookup(constantsDefault, 'missing')).toBeUndefined();
  });
});
