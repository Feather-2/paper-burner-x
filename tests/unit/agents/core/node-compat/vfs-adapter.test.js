import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryVfs } from '../../../../../js/agents/vfs/vfs.memory.js';
import { createVfsAdapter } from '../../../../../js/agents/core/node-compat/vfs-adapter.js';

describe('createVfsAdapter', () => {
  /** @type {MemoryVfs} */
  let vfs;
  /** @type {ReturnType<typeof createVfsAdapter>} */
  let fs;

  beforeEach(() => {
    vfs = new MemoryVfs();
    fs = createVfsAdapter({ vfs });
  });

  it('readFile returns Uint8Array by default', async () => {
    await vfs.writeText('hello.txt', 'world');
    const result = await fs.readFile('hello.txt');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result)).toBe('world');
  });

  it('readFile with utf8 encoding returns string', async () => {
    await vfs.writeText('hello.txt', 'world');
    const result = await fs.readFile('hello.txt', 'utf8');
    expect(typeof result).toBe('string');
    expect(result).toBe('world');
  });

  it('writeFile + readFile round-trip', async () => {
    await fs.writeFile('data.bin', new Uint8Array([1, 2, 3]));
    const bytes = await fs.readFile('data.bin');
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('writeFile with string delegates to writeText', async () => {
    await fs.writeFile('note.txt', 'hello string');
    const text = await fs.readFile('note.txt', 'utf8');
    expect(text).toBe('hello string');
  });

  it('appendFile appends content', async () => {
    await fs.writeFile('log.txt', 'line1');
    await fs.appendFile('log.txt', '\nline2');
    const text = await fs.readFile('log.txt', 'utf8');
    expect(text).toBe('line1\nline2');
  });

  it('stat returns correct size and isFile/isDirectory', async () => {
    await fs.writeFile('f.txt', 'abc');
    const s = await fs.stat('f.txt');
    expect(s.size).toBe(3);
    expect(s.isFile()).toBe(true);
    expect(s.isDirectory()).toBe(false);
    expect(s.mode).toBe(0o666);
    expect(s.atime).toBeInstanceOf(Date);
  });

  it('mkdir + readdir', async () => {
    await fs.mkdir('dir/sub', { recursive: true });
    await fs.writeFile('dir/a.txt', 'a');
    await fs.writeFile('dir/b.txt', 'b');
    const entries = await fs.readdir('dir');
    expect(entries).toContain('a.txt');
    expect(entries).toContain('b.txt');
    expect(entries).toContain('sub');
  });

  it('rm removes a file', async () => {
    await fs.writeFile('tmp.txt', 'x');
    await fs.rm('tmp.txt');
    await expect(fs.readFile('tmp.txt')).rejects.toThrow();
  });

  it('rm with recursive removes a directory', async () => {
    await fs.mkdir('dir');
    await fs.writeFile('dir/a.txt', 'a');
    await fs.rm('dir', { recursive: true });
    await expect(fs.readdir('dir')).rejects.toThrow();
  });

  it('cp copies a file', async () => {
    await fs.writeFile('src.txt', 'data');
    await fs.cp('src.txt', 'dst.txt');
    const text = await fs.readFile('dst.txt', 'utf8');
    expect(text).toBe('data');
  });

  it('cp with recursive copies a directory', async () => {
    await fs.mkdir('srcdir');
    await fs.writeFile('srcdir/a.txt', 'aa');
    await fs.writeFile('srcdir/b.txt', 'bb');
    await fs.cp('srcdir', 'dstdir', { recursive: true });
    const a = await fs.readFile('dstdir/a.txt', 'utf8');
    const b = await fs.readFile('dstdir/b.txt', 'utf8');
    expect(a).toBe('aa');
    expect(b).toBe('bb');
  });

  it('mv moves a file', async () => {
    await fs.writeFile('old.txt', 'content');
    await fs.mv('old.txt', 'new.txt');
    const text = await fs.readFile('new.txt', 'utf8');
    expect(text).toBe('content');
    await expect(fs.readFile('old.txt')).rejects.toThrow();
  });

  it('chmod is a no-op and does not throw', async () => {
    await fs.writeFile('f.txt', 'x');
    await expect(fs.chmod('f.txt', 0o755)).resolves.toBeUndefined();
  });

  it('realpath normalizes the path', async () => {
    const result = await fs.realpath('./foo/bar');
    expect(result).toBe('foo/bar');
  });

  it('getAllPaths returns all file paths', async () => {
    await fs.writeFile('a.txt', '1');
    await fs.writeFile('dir/b.txt', '2');
    await fs.writeFile('dir/c.txt', '3');
    const paths = await fs.getAllPaths();
    expect(paths).toEqual(['a.txt', 'dir/b.txt', 'dir/c.txt']);
  });

  it('path normalization resolves leading dot segments', async () => {
    await fs.writeFile('./bar', 'val');
    const text = await fs.readFile('bar', 'utf8');
    expect(text).toBe('val');
  });

  it('lstat delegates to stat', async () => {
    await fs.writeFile('x.txt', 'hi');
    const s = await fs.lstat('x.txt');
    expect(s.isFile()).toBe(true);
    expect(s.size).toBe(2);
  });

  it('symlink + readlink round-trip', async () => {
    await fs.symlink('/some/target', 'link.txt');
    const target = await fs.readlink('link.txt');
    expect(target).toBe('/some/target');
  });

  it('link copies the file', async () => {
    await fs.writeFile('orig.txt', 'data');
    await fs.link('orig.txt', 'hard.txt');
    const text = await fs.readFile('hard.txt', 'utf8');
    expect(text).toBe('data');
  });

  it('utimes is a no-op and does not throw', async () => {
    await fs.writeFile('f.txt', 'x');
    await expect(fs.utimes('f.txt', Date.now(), Date.now())).resolves.toBeUndefined();
  });
});
