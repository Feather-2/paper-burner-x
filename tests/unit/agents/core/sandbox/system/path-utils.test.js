/**
 * Unit tests for sandbox path utilities with boundary and concurrency coverage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedTmpdir = vi.hoisted(() => vi.fn(() => '/tmp'));

vi.mock('node:os', () => ({
  tmpdir: mockedTmpdir
}));

import { tmpdir } from 'node:os';
import pathUtils, {
  normalizeSandboxPath,
  isSafeForSBPL
} from '../../../../../../js/agents/core/sandbox/system/path-utils.js';

beforeEach(() => {
  mockedTmpdir.mockClear();
});

describe('normalizeSandboxPath', () => {
  it('returns null for missing input or base dir', () => {
    const base = `${tmpdir()}/sandbox`;
    const missingValues = [null, undefined, '', 0];

    for (const value of missingValues) {
      expect(normalizeSandboxPath(value, base)).toBeNull();
    }

    for (const value of missingValues) {
      expect(normalizeSandboxPath('file.txt', value)).toBeNull();
    }
  });

  it('normalizes relative paths inside base', () => {
    const base = `${tmpdir()}/sandbox/root/`;

    expect(normalizeSandboxPath('dir/./file.txt', base)).toBe('/tmp/sandbox/root/dir/file.txt');
    expect(normalizeSandboxPath('dir//sub//file', base)).toBe('/tmp/sandbox/root/dir/sub/file');
    expect(normalizeSandboxPath('0', base)).toBe('/tmp/sandbox/root/0');
  });

  it('allows relative paths that resolve within base even with traversal segments', () => {
    const base = `${tmpdir()}/sandbox/root`;

    expect(normalizeSandboxPath('dir/../file', base)).toBe('/tmp/sandbox/root/file');
  });

  it('rejects relative paths that escape base', () => {
    const base = `${tmpdir()}/sandbox/root`;

    expect(normalizeSandboxPath('../etc/passwd', base)).toBeNull();
  });

  it('rejects absolute paths by default and blocks traversal', () => {
    const base = `${tmpdir()}/sandbox`;

    expect(normalizeSandboxPath('/var/log/app.log', base)).toBeNull();
    expect(normalizeSandboxPath('/var/../etc/passwd', base)).toBeNull();
  });

  it('allows absolute paths only when allowAbsolute=true', () => {
    const base = `${tmpdir()}/sandbox`;
    expect(normalizeSandboxPath('/var/log/app.log', base, { allowAbsolute: true })).toBe('/var/log/app.log');
    expect(normalizeSandboxPath('/var/../etc/passwd', base, { allowAbsolute: true })).toBeNull();
  });

  it('handles deep nesting and large filenames', () => {
    const base = `${tmpdir()}/sandbox`;
    const deepSegments = Array.from({ length: 50 }, (_, index) => `dir${index}`);
    const deepPath = deepSegments.join('/');
    const hugeName = `file-${'a'.repeat(10000)}.bin`;

    expect(normalizeSandboxPath(deepPath, base)).toBe(`/tmp/sandbox/${deepPath}`);
    expect(normalizeSandboxPath(hugeName, base)).toBe(`/tmp/sandbox/${hugeName}`);
  });

  it('throws on non-string truthy inputs', () => {
    const base = `${tmpdir()}/sandbox`;
    const badInputs = [[], {}, -1, Number.MAX_SAFE_INTEGER];
    const badBases = [[], {}];

    for (const value of badInputs) {
      expect(() => normalizeSandboxPath(value, base)).toThrow(TypeError);
    }

    for (const value of badBases) {
      expect(() => normalizeSandboxPath('file', value)).toThrow(TypeError);
    }
  });

  it('returns consistent results for concurrent calls', async () => {
    const base = `${tmpdir()}/sandbox`;
    const inputs = ['a', 'b/c', '../etc', '/abs/path'];

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve(normalizeSandboxPath(input, base)))
    );

    expect(results).toEqual(['/tmp/sandbox/a', '/tmp/sandbox/b/c', null, null]);
  });

  it('rejects symlink-escaped relative paths when resolveSymlinks is enabled', () => {
    const base = `${tmpdir()}/sandbox/root`;
    const realpath = vi.fn((path) => {
      if (path === '/tmp/sandbox/root') return '/tmp/sandbox/root';
      if (path === '/tmp/sandbox/root/link') return '/outside';
      throw new Error('ENOENT');
    });

    const resolved = normalizeSandboxPath('link/file.txt', base, {
      resolveSymlinks: true,
      realpath,
    });
    expect(resolved).toBeNull();
  });

  it('remains stable under rapid consecutive calls', () => {
    const base = `${tmpdir()}/sandbox`;
    const results = [];

    for (let index = 0; index < 100; index += 1) {
      results.push(normalizeSandboxPath('dir/file', base));
    }

    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe('/tmp/sandbox/dir/file');
  });
});

describe('isSafeForSBPL', () => {
  it('returns false for empty or falsy inputs', () => {
    const values = [null, undefined, '', 0];

    for (const value of values) {
      expect(isSafeForSBPL(value)).toBe(false);
    }
  });

  it('rejects control characters', () => {
    expect(isSafeForSBPL('null\0byte')).toBe(false);
    expect(isSafeForSBPL('line\nbreak')).toBe(false);
    expect(isSafeForSBPL('del\x7fchar')).toBe(false);
  });

  it('accepts normal strings including whitespace', () => {
    expect(isSafeForSBPL('/tmp/sandbox/file.txt')).toBe(true);
    expect(isSafeForSBPL('   ')).toBe(true);
    expect(isSafeForSBPL('123')).toBe(true);
  });

  it('handles long strings and flags long strings with control characters', () => {
    const long = 'a'.repeat(100000);

    expect(isSafeForSBPL(long)).toBe(true);
    expect(isSafeForSBPL(`${long}\x00`)).toBe(false);
  });

  it('is deterministic under concurrent calls', async () => {
    const inputs = ['ok', 'bad\x1f', 'also-ok'];

    const results = await Promise.all(
      inputs.map((value) => Promise.resolve(isSafeForSBPL(value)))
    );

    expect(results).toEqual([true, false, true]);
  });
});

describe('default export', () => {
  it('exposes normalizeSandboxPath and isSafeForSBPL', () => {
    expect(pathUtils.normalizeSandboxPath).toBe(normalizeSandboxPath);
    expect(pathUtils.isSafeForSBPL).toBe(isSafeForSBPL);
  });
});
