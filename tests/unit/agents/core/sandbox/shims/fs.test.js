import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryVfs } from '../../../../../../js/agents/vfs/vfs.memory.js';
import { createFsShim } from '../../../../../../js/agents/core/sandbox/shims/fs.js';

describe('createFsShim', () => {
  /** @type {MemoryVfs} */
  let vfs;
  /** @type {ReturnType<typeof createFsShim>} */
  let fs;

  beforeEach(() => {
    vfs = new MemoryVfs();
    fs = createFsShim(vfs);
  });

  describe('promises.readFile', () => {
    it('returns Uint8Array without encoding', async () => {
      await vfs.writeFile('hello.txt', 'hello world');
      const data = await fs.promises.readFile('hello.txt');
      expect(data).toBeInstanceOf(Uint8Array);
    });

    it('returns string with encoding', async () => {
      await vfs.writeFile('hello.txt', 'hello world');
      const data = await fs.promises.readFile('hello.txt', 'utf-8');
      expect(data).toBe('hello world');
    });

    it('returns string with encoding object', async () => {
      await vfs.writeFile('hello.txt', 'content');
      const data = await fs.promises.readFile('hello.txt', { encoding: 'utf-8' });
      expect(data).toBe('content');
    });
  });

  describe('promises.writeFile + readFile round-trip', () => {
    it('writes and reads back', async () => {
      await fs.promises.writeFile('test.txt', 'round-trip');
      const data = await fs.promises.readFile('test.txt', 'utf-8');
      expect(data).toBe('round-trip');
    });
  });

  describe('promises.appendFile', () => {
    it('appends content', async () => {
      await fs.promises.writeFile('log.txt', 'line1');
      await fs.promises.appendFile('log.txt', '\nline2');
      const data = await fs.promises.readFile('log.txt', 'utf-8');
      expect(data).toBe('line1\nline2');
    });
  });

  describe('promises.stat', () => {
    it('returns Stats object for file', async () => {
      await vfs.writeFile('f.txt', 'abc');
      const s = await fs.promises.stat('f.txt');
      expect(s).toBeInstanceOf(fs.Stats);
      expect(s.size).toBe(3);
      expect(typeof s.mtimeMs).toBe('number');
    });

    it('stat.isFile() / isDirectory()', async () => {
      await vfs.writeFile('f.txt', 'x');
      await vfs.mkdir('d');
      const sf = await fs.promises.stat('f.txt');
      const sd = await fs.promises.stat('d');
      expect(sf.isFile()).toBe(true);
      expect(sf.isDirectory()).toBe(false);
      expect(sd.isFile()).toBe(false);
      expect(sd.isDirectory()).toBe(true);
    });
  });

  describe('promises.mkdir + readdir', () => {
    it('creates directory and lists contents', async () => {
      await fs.promises.mkdir('mydir', { recursive: true });
      await vfs.writeFile('mydir/a.txt', 'a');
      await vfs.writeFile('mydir/b.txt', 'b');
      const entries = await fs.promises.readdir('mydir');
      expect(entries).toEqual(['a.txt', 'b.txt']);
    });
  });

  describe('promises.readdir with withFileTypes', () => {
    it('returns Dirent[]', async () => {
      await vfs.mkdir('dir');
      await vfs.writeFile('dir/file.txt', 'x');
      await vfs.mkdir('dir/sub');
      const entries = await fs.promises.readdir('dir', { withFileTypes: true });
      expect(entries.length).toBe(2);
      const file = entries.find(e => e.name === 'file.txt');
      const sub = entries.find(e => e.name === 'sub');
      expect(file).toBeDefined();
      expect(file.isFile()).toBe(true);
      expect(file.isDirectory()).toBe(false);
      expect(sub).toBeDefined();
      expect(sub.isFile()).toBe(false);
      expect(sub.isDirectory()).toBe(true);
    });
  });

  describe('promises.unlink', () => {
    it('deletes a file', async () => {
      await vfs.writeFile('rm.txt', 'bye');
      await fs.promises.unlink('rm.txt');
      const exists = await vfs.exists('rm.txt');
      expect(exists).toBe(false);
    });
  });

  describe('promises.rmdir', () => {
    it('removes directory recursively', async () => {
      await vfs.mkdir('parent/child');
      await vfs.writeFile('parent/child/f.txt', 'x');
      await fs.promises.rmdir('parent', { recursive: true });
      const exists = await vfs.exists('parent');
      expect(exists).toBe(false);
    });
  });

  describe('promises.rename', () => {
    it('renames a file', async () => {
      await vfs.writeFile('old.txt', 'data');
      await fs.promises.rename('old.txt', 'new.txt');
      const exists = await vfs.exists('old.txt');
      expect(exists).toBe(false);
      const data = await vfs.readText('new.txt');
      expect(data).toBe('data');
    });
  });

  describe('promises.copyFile', () => {
    it('copies a file', async () => {
      await vfs.writeFile('src.txt', 'copy-me');
      await fs.promises.copyFile('src.txt', 'dst.txt');
      const data = await vfs.readText('dst.txt');
      expect(data).toBe('copy-me');
      const srcStill = await vfs.exists('src.txt');
      expect(srcStill).toBe(true);
    });
  });

  describe('promises.access', () => {
    it('resolves for existing file', async () => {
      await vfs.writeFile('exists.txt', 'x');
      await expect(fs.promises.access('exists.txt')).resolves.toBeUndefined();
    });

    it('rejects for non-existent file', async () => {
      await expect(fs.promises.access('nope.txt')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });
  });

  describe('promises.realpath', () => {
    it('normalizes path', async () => {
      const rp = await fs.promises.realpath('foo/bar');
      expect(rp).toBe('/foo/bar');
    });
  });

  describe('existsSync', () => {
    it('returns true for existing node', async () => {
      await vfs.writeFile('sync.txt', 'data');
      expect(fs.existsSync('sync.txt')).toBe(true);
    });

    it('returns false for non-existent node', () => {
      expect(fs.existsSync('ghost.txt')).toBe(false);
    });
  });

  describe('ENOENT error code', () => {
    it('throws with code ENOENT for missing file', async () => {
      try {
        await fs.promises.readFile('missing.txt');
        expect.unreachable();
      } catch (err) {
        expect(err.code).toBe('ENOENT');
        expect(err.path).toBe('missing.txt');
      }
    });
  });

  describe('constants', () => {
    it('includes F_OK, R_OK, W_OK, X_OK', () => {
      expect(fs.constants.F_OK).toBe(0);
      expect(fs.constants.R_OK).toBe(4);
      expect(fs.constants.W_OK).toBe(2);
      expect(fs.constants.X_OK).toBe(1);
    });
  });

  // --- Sync API tests ---

  describe('readFileSync', () => {
    it('reads file content synchronously from MemoryVfs', async () => {
      await vfs.writeFile('sync-read.txt', 'sync content');
      const data = fs.readFileSync('sync-read.txt', 'utf-8');
      expect(data).toBe('sync content');
    });

    it('returns Uint8Array without encoding', async () => {
      await vfs.writeFile('bin.dat', 'binary');
      const data = fs.readFileSync('bin.dat');
      expect(data).toBeInstanceOf(Uint8Array);
    });

    it('throws ENOENT for missing file', () => {
      expect(() => fs.readFileSync('nope.txt', 'utf-8')).toThrow();
    });
  });

  describe('writeFileSync', () => {
    it('writes and reads back synchronously', async () => {
      await vfs.mkdir('syncdir');
      fs.writeFileSync('syncdir/out.txt', 'written sync');
      const data = await vfs.readText('syncdir/out.txt');
      expect(data).toBe('written sync');
    });
  });

  describe('appendFileSync', () => {
    it('appends content synchronously', async () => {
      await vfs.writeFile('append.txt', 'A');
      fs.appendFileSync('append.txt', 'B');
      const data = await vfs.readText('append.txt');
      expect(data).toBe('AB');
    });
  });

  describe('mkdirSync', () => {
    it('creates directory synchronously', () => {
      fs.mkdirSync('newdir', { recursive: true });
      expect(fs.existsSync('newdir')).toBe(true);
    });
  });

  describe('readdirSync', () => {
    it('lists directory contents synchronously', async () => {
      await vfs.mkdir('lsdir');
      await vfs.writeFile('lsdir/a.txt', 'a');
      await vfs.writeFile('lsdir/b.txt', 'b');
      const entries = fs.readdirSync('lsdir');
      expect(entries).toEqual(['a.txt', 'b.txt']);
    });
  });

  describe('statSync', () => {
    it('returns Stats for file', async () => {
      await vfs.writeFile('st.txt', 'abc');
      const s = fs.statSync('st.txt');
      expect(s).toBeInstanceOf(fs.Stats);
      expect(s.isFile()).toBe(true);
      expect(s.size).toBe(3);
    });
  });

  describe('unlinkSync', () => {
    it('removes a file synchronously', async () => {
      await vfs.writeFile('del.txt', 'x');
      fs.unlinkSync('del.txt');
      expect(fs.existsSync('del.txt')).toBe(false);
    });
  });

  describe('renameSync', () => {
    it('renames synchronously', async () => {
      await vfs.writeFile('old-s.txt', 'data');
      fs.renameSync('old-s.txt', 'new-s.txt');
      expect(fs.existsSync('old-s.txt')).toBe(false);
      const data = fs.readFileSync('new-s.txt', 'utf-8');
      expect(data).toBe('data');
    });
  });

  describe('copyFileSync', () => {
    it('copies synchronously', async () => {
      await vfs.writeFile('csrc.txt', 'cp');
      fs.copyFileSync('csrc.txt', 'cdst.txt');
      const data = fs.readFileSync('cdst.txt', 'utf-8');
      expect(data).toBe('cp');
    });
  });

  describe('accessSync', () => {
    it('does not throw for existing file', async () => {
      await vfs.writeFile('acc.txt', 'x');
      expect(() => fs.accessSync('acc.txt')).not.toThrow();
    });

    it('throws ENOENT for missing file', () => {
      expect(() => fs.accessSync('missing.txt')).toThrow(/ENOENT/);
    });
  });

  describe('realpathSync', () => {
    it('returns normalized path', () => {
      expect(fs.realpathSync('foo/bar')).toBe('/foo/bar');
    });
  });

  describe('rmSync', () => {
    it('removes directory recursively', async () => {
      await vfs.mkdir('rmdir/sub');
      await vfs.writeFile('rmdir/sub/f.txt', 'x');
      fs.rmSync('rmdir', { recursive: true });
      expect(fs.existsSync('rmdir')).toBe(false);
    });
  });

  // --- fd operations ---

  describe('fd operations', () => {
    it('openSync / readSync / closeSync round-trip', async () => {
      await vfs.writeFile('fd.txt', 'hello fd');
      const fd = fs.openSync('fd.txt', 'r');
      expect(typeof fd).toBe('number');
      const buf = new Uint8Array(20);
      const n = fs.readSync(fd, buf, 0, 20);
      expect(n).toBeGreaterThan(0);
      fs.closeSync(fd);
    });

    it('openSync / writeSync / closeSync round-trip', async () => {
      const fd = fs.openSync('wfd.txt', 'w');
      const written = fs.writeSync(fd, 'write via fd');
      expect(written).toBe('write via fd'.length);
      fs.closeSync(fd);
      const data = await vfs.readText('wfd.txt');
      expect(data).toBe('write via fd');
    });

    it('closeSync throws for bad fd', () => {
      expect(() => fs.closeSync(999)).toThrow(/EBADF/);
    });
  });

  // --- createReadStream / createWriteStream ---

  describe('createReadStream', () => {
    it('emits data and end events', async () => {
      await vfs.writeFile('stream.txt', 'stream data');
      const stream = fs.createReadStream('stream.txt', 'utf-8');
      const chunks = [];
      await new Promise((resolve, reject) => {
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      expect(chunks.join('')).toBe('stream data');
    });
  });

  describe('createWriteStream', () => {
    it('writes data and emits finish', async () => {
      const stream = fs.createWriteStream('wstream.txt');
      stream.write('hello ');
      await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
        stream.end('world');
      });
      const data = await vfs.readText('wstream.txt');
      expect(data).toBe('hello world');
    });
  });

  // --- watch ---

  describe('watch', () => {
    it('returns an EventEmitter-like object', () => {
      const watcher = fs.watch('somedir');
      expect(typeof watcher.on).toBe('function');
      expect(typeof watcher.close).toBe('function');
    });

    it('emits close on close()', () => {
      const watcher = fs.watch('somedir');
      let closed = false;
      watcher.on('close', () => { closed = true; });
      watcher.close();
      expect(closed).toBe(true);
    });
  });
});
