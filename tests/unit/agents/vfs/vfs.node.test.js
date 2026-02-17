// Unit tests for NodeFsVfs (Node.js fs/promises backend) with fully mocked path normalization and fs implementation.
// These tests avoid touching the real filesystem and focus on path-joining, type coercion, and directory traversal logic.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { normalizeVfsPathMock, defaultNormalizeVfsPath } = vi.hoisted(() => {
  /**
   * Minimal deterministic mock normalizer used only for unit tests.
   * - Ensures paths are relative (no leading "/")
   * - Uses forward slashes
   * - Collapses repeated slashes
   * - Trims leading "./" and trailing "/"
   */
  const defaultNormalizeVfsPath = (value) => {
    let s = String(value ?? '');
    s = s.replaceAll('\\', '/');
    s = s.replace(/^[\\/]+/, '');
    s = s.replace(/\/+/g, '/');
    s = s.replace(/^\.\/+/, '');
    s = s.replace(/\/+$/, '');
    return s;
  };

  return {
    defaultNormalizeVfsPath,
    normalizeVfsPathMock: vi.fn(defaultNormalizeVfsPath),
  };
});

// MUST mock: js/agents/vfs/path.js
vi.mock('../../../../js/agents/vfs/path.js', () => ({
  normalizeVfsPath: normalizeVfsPathMock,
}));

import NodeFsVfsDefault, { NodeFsVfs } from '../../../../js/agents/vfs/vfs.node.js';

beforeEach(() => {
  vi.clearAllMocks();
  normalizeVfsPathMock.mockImplementation(defaultNormalizeVfsPath);
});

function createDirent(name, isDir) {
  return {
    name,
    isDirectory: () => !!isDir,
  };
}

function createFsMock(overrides = {}) {
  return {
    readFile: vi.fn(),
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    stat: vi.fn(),
    readdir: vi.fn(),
    access: vi.fn(async () => undefined),
    copyFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
    appendFile: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createVfsWithMockFs({ rootPath = '.', fsMock } = {}) {
  const vfs = new NodeFsVfs({ rootPath });
  vfs._fs = vi.fn(async () => fsMock);
  return vfs;
}

async function collectAsync(asyncIterable) {
  const out = [];
  for await (const v of asyncIterable) out.push(v);
  return out;
}

describe('js/agents/vfs/vfs.node.js - exports', () => {
  it('exports NodeFsVfs and default export aliases NodeFsVfs', () => {
    expect(NodeFsVfs).toBeTypeOf('function');
    expect(NodeFsVfsDefault).toBe(NodeFsVfs);
  });
});

describe('NodeFsVfs - constructor and _fs', () => {
  it('defaults rootPath to "." when omitted', () => {
    const vfs = new NodeFsVfs();
    expect(vfs._rootPath).toBe('.');
  });

  it('stores provided rootPath as-is', () => {
    const vfs = new NodeFsVfs({ rootPath: '/data' });
    expect(vfs._rootPath).toBe('/data');
  });

  it('loads node:fs/promises via _fs()', async () => {
    const vfs = new NodeFsVfs();
    const fs = await vfs._fs();
    expect(fs).toBeTruthy();
    expect(fs.readFile).toBeTypeOf('function');
    expect(fs.writeFile).toBeTypeOf('function');
  });
});

describe('NodeFsVfs - readFile', () => {
  it('reads bytes and returns a copied Uint8Array slice (handles non-zero Buffer offsets)', async () => {
    const base = Buffer.from([9, 1, 2, 3, 9]);
    const buf = base.subarray(1, 4); // [1,2,3] with non-zero byteOffset
    const fsMock = createFsMock({
      readFile: vi.fn(async () => buf),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const out = await vfs.readFile('file.bin');

    expect(normalizeVfsPathMock).toHaveBeenCalledWith('file.bin');
    expect(fsMock.readFile).toHaveBeenCalledWith('ROOT/file.bin');
    expect(out).toBeInstanceOf(Uint8Array);
    expect([...out]).toEqual([1, 2, 3]);

    // Ensure it is a copy, not a view into the original Buffer/ArrayBuffer.
    out[0] = 99;
    expect([...base]).toEqual([9, 1, 2, 3, 9]);
  });

  it('normalizes rootPath backslashes and trims trailing slashes when joining paths', async () => {
    const fsMock = createFsMock({
      readFile: vi.fn(async () => Buffer.from([1])),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'C:\\tmp\\root\\\\', fsMock });

    await vfs.readFile('a/b.txt');

    expect(fsMock.readFile).toHaveBeenCalledWith('C:/tmp/root/a/b.txt');
  });

  it('propagates fs.readFile errors', async () => {
    const fsMock = createFsMock({
      readFile: vi.fn(async () => {
        throw new Error('read failed');
      }),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    await expect(vfs.readFile('x.bin')).rejects.toThrow('read failed');
  });
});

describe('NodeFsVfs - readText', () => {
  it('reads text with utf8 encoding and returns a string', async () => {
    const fsMock = createFsMock({
      readFile: vi.fn(async () => 'hello'),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT/', fsMock });

    const text = await vfs.readText('dir/file.txt');

    expect(normalizeVfsPathMock).toHaveBeenCalledWith('dir/file.txt');
    expect(fsMock.readFile).toHaveBeenCalledWith('ROOT/dir/file.txt', 'utf8');
    expect(text).toBe('hello');
  });

  it('joins to the root when path normalizes to empty', async () => {
    const fsMock = createFsMock({
      readFile: vi.fn(async () => 'x'),
    });
    const vfs = createVfsWithMockFs({ rootPath: '.', fsMock });

    await vfs.readText('/');

    expect(normalizeVfsPathMock).toHaveBeenCalledWith('/');
    expect(fsMock.readFile).toHaveBeenCalledWith('.', 'utf8');
  });
});

describe('NodeFsVfs - writeFile', () => {
  it('creates parent directories and writes string data as utf8', async () => {
    const fsMock = createFsMock();
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT/', fsMock });

    const ok = await vfs.writeFile('deep/nested/file.txt', 'hello');

    expect(ok).toBe(true);
    expect(fsMock.mkdir).toHaveBeenCalledWith('ROOT/deep/nested', { recursive: true });
    expect(fsMock.writeFile).toHaveBeenCalledWith('ROOT/deep/nested/file.txt', 'hello', 'utf8');
  });

  it('writes ArrayBuffer data using Buffer.from without specifying encoding', async () => {
    const fsMock = createFsMock();
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const ab = new Uint8Array([10, 20, 30]).buffer;
    const ok = await vfs.writeFile('ab.bin', ab);

    expect(ok).toBe(true);
    const call = fsMock.writeFile.mock.calls[0];
    expect(call[0]).toBe('ROOT/ab.bin');
    expect(Buffer.isBuffer(call[1])).toBe(true);
    expect([...call[1]]).toEqual([10, 20, 30]);
    expect(call[2]).toBeUndefined();
  });

  it('writes ArrayBuffer views using only the view range (handles byteOffset/byteLength)', async () => {
    const fsMock = createFsMock();
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const ab = new ArrayBuffer(6);
    new Uint8Array(ab).set([0, 1, 2, 3, 4, 5]);
    const view = new Uint8Array(ab, 2, 3); // [2,3,4]
    const ok = await vfs.writeFile('view.bin', view);

    expect(ok).toBe(true);
    const [, data] = fsMock.writeFile.mock.calls[0];
    expect(Buffer.isBuffer(data)).toBe(true);
    expect([...data]).toEqual([2, 3, 4]);
  });

  it('stringifies non-string/non-binary data and writes as utf8', async () => {
    const fsMock = createFsMock();
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    await vfs.writeFile('num.txt', 123);
    expect(fsMock.writeFile).toHaveBeenLastCalledWith('ROOT/num.txt', '123', 'utf8');

    await vfs.writeFile('null.txt', null);
    expect(fsMock.writeFile).toHaveBeenLastCalledWith('ROOT/null.txt', '', 'utf8');

    await vfs.writeFile('undef.txt', undefined);
    expect(fsMock.writeFile).toHaveBeenLastCalledWith('ROOT/undef.txt', '', 'utf8');
  });

  it('uses "." as mkdir target when writing to root with default rootPath', async () => {
    const fsMock = createFsMock();
    const vfs = createVfsWithMockFs({ rootPath: '.', fsMock });

    await vfs.writeFile('file.txt', 'x');

    expect(fsMock.mkdir).toHaveBeenCalledWith('.', { recursive: true });
    expect(fsMock.writeFile).toHaveBeenCalledWith('./file.txt', 'x', 'utf8');
  });
});

describe('NodeFsVfs - writeText', () => {
  it('delegates to writeFile and stringifies non-string input', async () => {
    const vfs = new NodeFsVfs({ rootPath: 'ROOT' });
    const writeFileSpy = vi.spyOn(vfs, 'writeFile').mockResolvedValue(true);

    const ok1 = await vfs.writeText('a.txt', 42);
    const ok2 = await vfs.writeText('b.txt', null);

    expect(ok1).toBe(true);
    expect(ok2).toBe(true);
    expect(writeFileSpy).toHaveBeenNthCalledWith(1, 'a.txt', '42');
    expect(writeFileSpy).toHaveBeenNthCalledWith(2, 'b.txt', '');
  });
});

describe('NodeFsVfs - stat', () => {
  it('returns a stat-like object with size/mtimeMs and isFile/isDirectory delegates', async () => {
    const isFile = vi.fn(() => true);
    const isDirectory = vi.fn(() => false);
    const fsMock = createFsMock({
      stat: vi.fn(async () => ({ size: 12, mtimeMs: 34.5, isFile, isDirectory })),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const st = await vfs.stat('p.txt');

    expect(fsMock.stat).toHaveBeenCalledWith('ROOT/p.txt');
    expect(st.size).toBe(12);
    expect(st.mtimeMs).toBe(34.5);
    expect(st.isFile()).toBe(true);
    expect(st.isDirectory()).toBe(false);
    expect(isFile).toHaveBeenCalledTimes(1);
    expect(isDirectory).toHaveBeenCalledTimes(1);
  });

  it('propagates fs.stat errors', async () => {
    const fsMock = createFsMock({
      stat: vi.fn(async () => {
        throw new Error('stat failed');
      }),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    await expect(vfs.stat('missing')).rejects.toThrow('stat failed');
  });
});

describe('NodeFsVfs - readdir', () => {
  it('passes withFileTypes=false when omitted', async () => {
    const fsMock = createFsMock({
      readdir: vi.fn(async () => ['a', 'b']),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const entries = await vfs.readdir('dir');

    expect(entries).toEqual(['a', 'b']);
    expect(fsMock.readdir).toHaveBeenCalledWith('ROOT/dir', { withFileTypes: false });
  });

  it('passes withFileTypes=true when requested', async () => {
    const fsMock = createFsMock({
      readdir: vi.fn(async () => [createDirent('a.txt', false)]),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const entries = await vfs.readdir('dir', { withFileTypes: true });

    expect(entries[0]).toMatchObject({ name: 'a.txt' });
    expect(fsMock.readdir).toHaveBeenCalledWith('ROOT/dir', { withFileTypes: true });
  });
});

describe('NodeFsVfs - list (legacy)', () => {
  it('maps dirent-like entries to {name, kind} and filters invalid entries', async () => {
    const fsMock = createFsMock({
      readdir: vi.fn(async () => [
        createDirent('a.txt', false),
        createDirent('sub', true),
        { name: 'no-method' },
        { name: 123 },
        null,
        'not-an-object',
      ]),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const items = await vfs.list('dir');

    expect(fsMock.readdir).toHaveBeenCalledWith('ROOT/dir', { withFileTypes: true });
    expect(items).toEqual([
      { name: 'a.txt', kind: 'file' },
      { name: 'sub', kind: 'dir' },
      { name: 'no-method', kind: 'file' },
    ]);
  });

  it('returns empty array when readdir result is not an array', async () => {
    const fsMock = createFsMock({
      readdir: vi.fn(async () => /** @type {any} */ ({ not: 'an array' })),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const items = await vfs.list('dir');
    expect(items).toEqual([]);
  });
});

describe('NodeFsVfs - listFiles', () => {
  it('lists files recursively by default, includes dotfiles, and returns sorted paths', async () => {
    const tree = new Map([
      [
        'ROOT/base',
        [
          createDirent('b.txt', false),
          createDirent('.hidden', false),
          createDirent('sub', true),
          createDirent('a.txt', false),
        ],
      ],
      ['ROOT/base/sub', [createDirent('c.txt', false), createDirent('deep', true)]],
      ['ROOT/base/sub/deep', [createDirent('d.txt', false)]],
    ]);

    const fsMock = createFsMock({
      readdir: vi.fn(async (dir) => tree.get(dir) ?? []),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const files = await vfs.listFiles({ prefix: 'base' });

    expect(files).toEqual(['base/.hidden', 'base/a.txt', 'base/b.txt', 'base/sub/c.txt', 'base/sub/deep/d.txt']);
  });

  it('does not recurse when recursive=false', async () => {
    const tree = new Map([
      ['ROOT/base', [createDirent('b.txt', false), createDirent('sub', true), createDirent('a.txt', false)]],
      ['ROOT/base/sub', [createDirent('c.txt', false)]],
    ]);
    const fsMock = createFsMock({
      readdir: vi.fn(async (dir) => tree.get(dir) ?? []),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const files = await vfs.listFiles({ prefix: 'base', recursive: false });

    expect(files).toEqual(['base/a.txt', 'base/b.txt']);
  });
});

describe('NodeFsVfs - walkFiles', () => {
  it('yields a single file when prefix resolves to a file', async () => {
    const fsMock = createFsMock({
      stat: vi.fn(async () => ({ isFile: () => true })),
      readdir: vi.fn(async () => {
        throw new Error('should not readdir for file');
      }),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const files = await collectAsync(vfs.walkFiles({ prefix: 'one.txt' }));

    expect(fsMock.stat).toHaveBeenCalledWith('ROOT/one.txt');
    expect(files).toEqual(['one.txt']);
    expect(fsMock.readdir).not.toHaveBeenCalled();
  });

  it('yields nothing when prefix does not exist (stat throws)', async () => {
    const fsMock = createFsMock({
      stat: vi.fn(async () => {
        throw new Error('ENOENT');
      }),
      readdir: vi.fn(async () => [createDirent('x.txt', false)]),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const files = await collectAsync(vfs.walkFiles({ prefix: 'missing' }));

    expect(files).toEqual([]);
    expect(fsMock.readdir).not.toHaveBeenCalled();
  });

  it('walks directories recursively, includes dotfiles, and yields sorted paths', async () => {
    const tree = new Map([
      ['ROOT/walk', [createDirent('b.txt', false), createDirent('sub', true), createDirent('.dot', false), createDirent('a.txt', false)]],
      ['ROOT/walk/sub', [createDirent('d.txt', false), createDirent('c.txt', false)]],
    ]);

    const fsMock = createFsMock({
      stat: vi.fn(async () => ({ isFile: () => false })),
      readdir: vi.fn(async (dir) => tree.get(dir) ?? []),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const files = await collectAsync(vfs.walkFiles({ prefix: 'walk' }));

    expect(files).toEqual(['walk/.dot', 'walk/a.txt', 'walk/b.txt', 'walk/sub/c.txt', 'walk/sub/d.txt']);
    expect(files).toEqual([...files].sort((a, b) => a.localeCompare(b)));
  });

  it('does not recurse when recursive=false', async () => {
    const tree = new Map([
      ['ROOT/walk', [createDirent('b.txt', false), createDirent('sub', true), createDirent('a.txt', false)]],
      ['ROOT/walk/sub', [createDirent('c.txt', false)]],
    ]);
    const fsMock = createFsMock({
      stat: vi.fn(async () => ({ isFile: () => false })),
      readdir: vi.fn(async (dir) => tree.get(dir) ?? []),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const files = await collectAsync(vfs.walkFiles({ prefix: 'walk', recursive: false }));

    expect(files).toEqual(['walk/a.txt', 'walk/b.txt']);
  });

  it('throws when AbortSignal is aborted during traversal', async () => {
    const tree = new Map([['ROOT/walk', [createDirent('b.txt', false), createDirent('a.txt', false)]]]);
    const fsMock = createFsMock({
      stat: vi.fn(async () => ({ isFile: () => false })),
      readdir: vi.fn(async (dir) => tree.get(dir) ?? []),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const controller = new AbortController();
    const collected = [];

    await expect(async () => {
      for await (const f of vfs.walkFiles({ prefix: 'walk', signal: controller.signal })) {
        collected.push(f);
        controller.abort();
      }
    }).rejects.toThrow(/aborted/);

    expect(collected.length).toBe(1);
    expect(collected[0]).toBe('walk/a.txt');
  });
});

describe('NodeFsVfs - exists', () => {
  it('returns true when fs.access succeeds and false when it throws', async () => {
    const fsMock = createFsMock({
      access: vi.fn(async () => undefined),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    expect(await vfs.exists('a.txt')).toBe(true);
    expect(fsMock.access).toHaveBeenCalledWith('ROOT/a.txt');

    fsMock.access.mockImplementationOnce(async () => {
      throw new Error('no');
    });
    expect(await vfs.exists('missing.txt')).toBe(false);
  });
});

describe('NodeFsVfs - copy', () => {
  it('creates destination directories and copies the file', async () => {
    const fsMock = createFsMock();
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const ok = await vfs.copy('src.txt', 'dest/dir/out.txt');

    expect(ok).toBe(true);
    expect(fsMock.mkdir).toHaveBeenCalledWith('ROOT/dest/dir', { recursive: true });
    expect(fsMock.copyFile).toHaveBeenCalledWith('ROOT/src.txt', 'ROOT/dest/dir/out.txt');
  });
});

describe('NodeFsVfs - move', () => {
  it('renames when possible and does not fall back to copy+unlink', async () => {
    const fsMock = createFsMock({
      rename: vi.fn(async () => undefined),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const ok = await vfs.move('src.txt', 'dest/out.txt');

    expect(ok).toBe(true);
    expect(fsMock.mkdir).toHaveBeenCalledWith('ROOT/dest', { recursive: true });
    expect(fsMock.rename).toHaveBeenCalledWith('ROOT/src.txt', 'ROOT/dest/out.txt');
    expect(fsMock.copyFile).not.toHaveBeenCalled();
    expect(fsMock.unlink).not.toHaveBeenCalled();
  });

  it('falls back to copy+unlink when rename throws EXDEV', async () => {
    const fsMock = createFsMock({
      rename: vi.fn(async () => {
        const err = new Error('EXDEV');
        err.code = 'EXDEV';
        throw err;
      }),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const ok = await vfs.move('src.txt', 'dest/out.txt');

    expect(ok).toBe(true);
    expect(fsMock.copyFile).toHaveBeenCalledWith('ROOT/src.txt', 'ROOT/dest/out.txt');
    expect(fsMock.unlink).toHaveBeenCalledWith('ROOT/src.txt');
  });

  it('rethrows non-EXDEV errors from rename', async () => {
    const fsMock = createFsMock({
      rename: vi.fn(async () => {
        const err = new Error('EACCES');
        err.code = 'EACCES';
        throw err;
      }),
    });
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    await expect(vfs.move('src.txt', 'dest/out.txt')).rejects.toThrow(/EACCES/);
    expect(fsMock.copyFile).not.toHaveBeenCalled();
    expect(fsMock.unlink).not.toHaveBeenCalled();
  });
});

describe('NodeFsVfs - appendText', () => {
  it('creates parent directories and appends text as utf8 (stringifies non-string input)', async () => {
    const fsMock = createFsMock();
    const vfs = createVfsWithMockFs({ rootPath: 'ROOT', fsMock });

    const ok1 = await vfs.appendText('dir/app.txt', 'hello');
    const ok2 = await vfs.appendText('dir/app.txt', 123);
    const ok3 = await vfs.appendText('dir/app.txt', null);

    expect(ok1).toBe(true);
    expect(ok2).toBe(true);
    expect(ok3).toBe(true);

    expect(fsMock.mkdir).toHaveBeenCalledWith('ROOT/dir', { recursive: true });
    expect(fsMock.appendFile).toHaveBeenNthCalledWith(1, 'ROOT/dir/app.txt', 'hello', 'utf8');
    expect(fsMock.appendFile).toHaveBeenNthCalledWith(2, 'ROOT/dir/app.txt', '123', 'utf8');
    expect(fsMock.appendFile).toHaveBeenNthCalledWith(3, 'ROOT/dir/app.txt', '', 'utf8');
  });
});

