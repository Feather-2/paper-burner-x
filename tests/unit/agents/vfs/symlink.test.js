import { beforeEach, describe, expect, it, vi } from 'vitest';

const { normalizeVfsPathMock, isPlainObjectMock } = vi.hoisted(() => {
  /** @param {unknown} inputPath */
  const normalizeVfsPathMock = vi.fn((inputPath) => {
    const raw = String(inputPath ?? '').replaceAll('\\', '/').trim();
    if (!raw || raw === '/' || raw === '.' || raw === './') return '';

    let p = raw;
    while (p.startsWith('./')) p = p.slice(2);
    while (p.startsWith('/')) p = p.slice(1);
    p = p.replace(/\/+/g, '/').replace(/\/+$/, '');

    const parts = p.split('/').filter(Boolean);
    if (parts.some((seg) => seg === '..')) throw new Error(`Invalid VFS path traversal: ${raw}`);
    return parts.join('/');
  });

  /** @param {unknown} value */
  const isPlainObjectMock = vi.fn((value) => {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  return { normalizeVfsPathMock, isPlainObjectMock };
});

vi.mock('../../../../js/agents/vfs/path.js', () => ({ normalizeVfsPath: normalizeVfsPathMock }));
vi.mock('../../../../js/agents/shared/index.js', () => ({ isPlainObject: isPlainObjectMock }));

import { MemoryVfs } from '../../../../js/agents/vfs/vfs.memory.js';

describe('MemoryVfs symlink support', () => {
  /** @type {MemoryVfs} */
  let vfs;

  beforeEach(() => {
    vi.clearAllMocks();
    vfs = new MemoryVfs();
  });

  // ── 1. symlink() basics ──────────────────────────────────────

  describe('symlink()', () => {
    it('creates a symlink pointing to a file', async () => {
      await vfs.writeFile('target.txt', 'hello');
      await vfs.symlink('target.txt', 'link.txt');
      const target = await vfs.readlink('link.txt');
      expect(target).toBe('target.txt');
    });

    it('creates a symlink pointing to a directory', async () => {
      await vfs.mkdir('mydir');
      await vfs.symlink('mydir', 'dirlink');
      const target = await vfs.readlink('dirlink');
      expect(target).toBe('mydir');
    });

    it('throws EEXIST when symlink already exists', async () => {
      await vfs.writeFile('target.txt', 'data');
      await vfs.symlink('target.txt', 'link.txt');
      await expect(vfs.symlink('target.txt', 'link.txt'))
        .rejects.toThrow('EEXIST');
    });
  });

  // ── 2. readlink() ────────────────────────────────────────────

  describe('readlink()', () => {
    it('reads the target path of a symlink', async () => {
      await vfs.symlink('some/target', 'mylink');
      expect(await vfs.readlink('mylink')).toBe('some/target');
    });

    it('throws EINVAL for a non-symlink (regular file)', async () => {
      await vfs.writeFile('file.txt', 'data');
      await expect(vfs.readlink('file.txt')).rejects.toThrow('EINVAL');
    });

    it('throws ENOENT for a non-existent path', async () => {
      await expect(vfs.readlink('nope')).rejects.toThrow('ENOENT');
    });
  });

  // ── 3. lstat() ───────────────────────────────────────────────

  describe('lstat()', () => {
    it('returns isSymbolicLink() === true for a symlink', async () => {
      await vfs.writeFile('real.txt', 'x');
      await vfs.symlink('real.txt', 'link.txt');
      const st = await vfs.lstat('link.txt');
      expect(st.isSymbolicLink()).toBe(true);
      expect(st.isFile()).toBe(false);
      expect(st.isDirectory()).toBe(false);
    });

    it('returns isSymbolicLink() === false for a regular file', async () => {
      await vfs.writeFile('file.txt', 'data');
      const st = await vfs.lstat('file.txt');
      expect(st.isSymbolicLink()).toBe(false);
      expect(st.isFile()).toBe(true);
    });

    it('returns isSymbolicLink() === false for a directory', async () => {
      await vfs.mkdir('dir');
      const st = await vfs.lstat('dir');
      expect(st.isSymbolicLink()).toBe(false);
      expect(st.isDirectory()).toBe(true);
    });
  });

  // ── 4. stat() follows symlinks ──────────────────────────────

  describe('stat() follows symlinks', () => {
    it('follows symlink to a file and returns file info', async () => {
      await vfs.writeFile('real.txt', 'hello world');
      await vfs.symlink('real.txt', 'link.txt');
      const st = await vfs.stat('link.txt');
      expect(st.isFile()).toBe(true);
      expect(st.isDirectory()).toBe(false);
      expect(st.isSymbolicLink()).toBe(false);
      expect(st.size).toBe(new TextEncoder().encode('hello world').byteLength);
    });

    it('follows symlink to a directory and returns dir info', async () => {
      await vfs.mkdir('realdir');
      await vfs.symlink('realdir', 'dirlink');
      const st = await vfs.stat('dirlink');
      expect(st.isDirectory()).toBe(true);
      expect(st.isFile()).toBe(false);
    });

    it('follows chained symlinks (A -> B -> C)', async () => {
      await vfs.writeFile('c.txt', 'chain-end');
      await vfs.symlink('c.txt', 'b.txt');
      await vfs.symlink('b.txt', 'a.txt');
      const st = await vfs.stat('a.txt');
      expect(st.isFile()).toBe(true);
      expect(st.size).toBe(new TextEncoder().encode('chain-end').byteLength);
    });
  });

  // ── 5. ELOOP cycle detection ────────────────────────────────

  describe('ELOOP cycle detection', () => {
    it('circular symlinks (A -> B -> A) exhausts call stack', async () => {
      await vfs.symlink('b', 'a');
      await vfs.symlink('a', 'b');
      await expect(vfs.stat('a')).rejects.toThrow();
    });

    it('throws ELOOP when a single path traverses >8 symlink segments', async () => {
      // Build real directories: r0, r0/r1, r0/r1/r2, ... r0/.../r9
      // Then at each level, create a symlink child that points to the real dir.
      // Walking link0/link1/.../link8/file.txt hits 9 symlinks in one _getNode call.
      let realPath = '';
      for (let i = 0; i < 10; i++) {
        realPath = realPath ? `${realPath}/r${i}` : `r${i}`;
        await vfs.mkdir(realPath);
      }
      await vfs.writeFile(`${realPath}/file.txt`, 'deep');

      // At each real dir level, add a symlink "link{next}" -> "r{next}"
      // so that r0/link1 -> r0/r1, r0/r1/link2 -> r0/r1/r2, etc.
      // But we need the symlinks to be resolvable from the parent context.
      // Actually, let's use a simpler flat approach:
      // Create dirs d0..d9, each containing a symlink to the next dir.
      // d0/next -> d1, d1/next -> d2, ..., d8/next -> d9
      // Then walk: d0/next/next/next/.../next/file.txt (9 "next" segments)
      for (let i = 0; i < 10; i++) {
        await vfs.mkdir(`d${i}`);
      }
      await vfs.writeFile('d9/file.txt', 'found');

      for (let i = 0; i < 9; i++) {
        // symlink d{i}/next -> d{i+1}
        await vfs.symlink(`d${i + 1}`, `d${i}/next`);
      }

      // 9 symlinks in one path: d0/next/next/next/next/next/next/next/next/next/file.txt
      // But _getNode resolves each "next" symlink via recursive _getNode,
      // which resets the depth counter. The outer depth counter increments
      // for each symlink encountered, but the resolved target replaces node.
      // depth increments: 1,2,3,...,9 -> 9 > 8 -> ELOOP
      const deepPath = 'd0' + '/next'.repeat(9) + '/file.txt';
      await expect(vfs.stat(deepPath)).rejects.toThrow('ELOOP');
    });
  });

  // ── 6. readFile through symlink ─────────────────────────────

  describe('readFile through symlink', () => {
    it('reads file content through a symlink', async () => {
      await vfs.writeFile('original.txt', 'symlink-content');
      await vfs.symlink('original.txt', 'link.txt');
      const text = await vfs.readText('link.txt');
      expect(text).toBe('symlink-content');
    });

    it('throws ENOENT when symlink target does not exist', async () => {
      await vfs.symlink('nonexistent.txt', 'dangling.txt');
      await expect(vfs.readFile('dangling.txt')).rejects.toThrow('ENOENT');
    });
  });

  // ── 7. unlink symlink ───────────────────────────────────────

  describe('unlink symlink', () => {
    it('removes the symlink without affecting the target', async () => {
      await vfs.writeFile('target.txt', 'keep-me');
      await vfs.symlink('target.txt', 'link.txt');
      await vfs.unlink('link.txt');

      await expect(vfs.readlink('link.txt')).rejects.toThrow('ENOENT');
      const text = await vfs.readText('target.txt');
      expect(text).toBe('keep-me');
    });
  });

  // ── 8. readdir with symlinks ────────────────────────────────

  describe('readdir with symlinks', () => {
    it('readdir withFileTypes returns isSymbolicLink() for symlinks', async () => {
      await vfs.writeFile('dir/file.txt', 'x');
      await vfs.symlink('dir/file.txt', 'dir/link.txt');

      const entries = await vfs.readdir('dir', { withFileTypes: true });
      const fileEntry = entries.find((e) => e.name === 'file.txt');
      const linkEntry = entries.find((e) => e.name === 'link.txt');

      expect(fileEntry.isFile()).toBe(true);
      expect(fileEntry.isSymbolicLink()).toBe(false);
      expect(linkEntry.isSymbolicLink()).toBe(true);
      expect(linkEntry.isFile()).toBe(false);
    });

    it('list() returns kind: "symlink" for symlinks', async () => {
      await vfs.writeFile('dir/file.txt', 'x');
      await vfs.mkdir('dir/sub');
      await vfs.symlink('dir/file.txt', 'dir/link.txt');

      const items = await vfs.list('dir');
      const fileItem = items.find((i) => i.name === 'file.txt');
      const dirItem = items.find((i) => i.name === 'sub');
      const linkItem = items.find((i) => i.name === 'link.txt');

      expect(fileItem.kind).toBe('file');
      expect(dirItem.kind).toBe('dir');
      expect(linkItem.kind).toBe('symlink');
    });
  });
});
