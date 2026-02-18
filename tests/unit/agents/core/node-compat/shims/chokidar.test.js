import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import chokidar, {
  setVFS,
  FSWatcher,
  watch,
} from '../../../../../../js/agents/core/node-compat/shims/chokidar.js';

class MockVFS {
  constructor() {
    this.nodes = new Map([['/', 'dir']]);
    this.watchers = [];
  }

  normalize(path) {
    if (!path) return '/';
    let normalized = path.startsWith('/') ? path : `/${path}`;
    if (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }

  addDir(path) {
    const normalized = this.normalize(path);
    const parent = normalized.substring(0, normalized.lastIndexOf('/')) || '/';
    if (!this.nodes.has(parent) && normalized !== '/') {
      this.addDir(parent);
    }
    this.nodes.set(normalized, 'dir');
  }

  addFile(path) {
    const normalized = this.normalize(path);
    const parent = normalized.substring(0, normalized.lastIndexOf('/')) || '/';
    if (!this.nodes.has(parent)) this.addDir(parent);
    this.nodes.set(normalized, 'file');
  }

  remove(path) {
    this.nodes.delete(this.normalize(path));
  }

  existsSync(path) {
    return this.nodes.has(this.normalize(path));
  }

  statSync(path) {
    const normalized = this.normalize(path);
    const kind = this.nodes.get(normalized);
    if (!kind) throw new Error(`ENOENT: ${normalized}`);
    return {
      isDirectory: () => kind === 'dir',
      isFile: () => kind === 'file',
    };
  }

  readdirSync(path) {
    const normalized = this.normalize(path);
    if (this.nodes.get(normalized) !== 'dir') throw new Error(`ENOTDIR: ${normalized}`);
    const prefix = normalized === '/' ? '/' : `${normalized}/`;
    const entries = new Set();

    for (const nodePath of this.nodes.keys()) {
      if (nodePath === normalized || !nodePath.startsWith(prefix)) continue;
      const rest = nodePath.slice(prefix.length);
      entries.add(rest.split('/')[0]);
    }

    return [...entries];
  }

  watch(path, _options, callback) {
    const watcher = { close: vi.fn() };
    this.watchers.push({
      path: this.normalize(path),
      callback,
      watcher,
    });
    return watcher;
  }

  emit(path, eventType, filename) {
    const normalized = this.normalize(path);
    for (const entry of this.watchers) {
      if (entry.path === normalized) {
        entry.callback(eventType, filename);
      }
    }
  }
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('chokidar shim', () => {
  /** @type {MockVFS} */
  let vfs;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});

    vfs = new MockVFS();
    vfs.addDir('/workspace');
    vfs.addDir('/workspace/dir');
    vfs.addDir('/workspace/dir/sub');
    vfs.addFile('/workspace/file.txt');
    vfs.addFile('/workspace/dir/a.txt');
    vfs.addFile('/workspace/dir/sub/b.txt');

    setVFS(vfs);
  });

  afterEach(() => {
    setVFS(null);
  });

  it('throws when VFS has not been initialized', () => {
    setVFS(null);
    expect(() => new FSWatcher()).toThrow('VirtualFS not initialized');
    setVFS(vfs);
  });

  it('normalizes paths and applies ignore patterns', () => {
    const watcher = new FSWatcher({
      cwd: '/workspace',
      ignored: ['/workspace/dir', /\.tmp$/, (path) => path.includes('/fn-ignore')],
    });

    expect(watcher.normalizePath('file.txt')).toBe('/workspace/file.txt');
    expect(watcher.normalizePath('/workspace/file.txt')).toBe('/workspace/file.txt');
    expect(watcher.shouldIgnore('/workspace/dir')).toBe(true);
    expect(watcher.shouldIgnore('/workspace/dir/sub/b.txt')).toBe(true);
    expect(watcher.shouldIgnore('/workspace/test.tmp')).toBe(true);
    expect(watcher.shouldIgnore('/workspace/fn-ignore/file.txt')).toBe(true);
    expect(watcher.shouldIgnore('/workspace/file.txt')).toBe(false);
  });

  it('add emits initial add/ready events for existing file', async () => {
    const watcher = new FSWatcher();
    const onAdd = vi.fn();
    const onReady = vi.fn();
    watcher.on('add', onAdd);
    watcher.on('ready', onReady);

    watcher.add('/workspace/file.txt');
    await nextTick();

    expect(onAdd).toHaveBeenCalledWith('/workspace/file.txt', expect.any(Object));
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(watcher.getWatched()).toEqual({
      '/workspace': ['file.txt'],
    });
  });

  it('add watches parent path when target does not exist', () => {
    const watcher = new FSWatcher();
    watcher.add('/workspace/new-file.txt');

    expect(watcher.getWatched()).toEqual({
      '/': ['workspace'],
    });
  });

  it('add directory scans recursive contents and emits addDir/add', async () => {
    const watcher = new FSWatcher();
    const onAdd = vi.fn();
    const onAddDir = vi.fn();
    watcher.on('add', onAdd);
    watcher.on('addDir', onAddDir);

    watcher.add('/workspace/dir');
    await nextTick();

    expect(onAddDir).toHaveBeenCalledWith('/workspace/dir/sub', expect.any(Object));
    expect(onAdd).toHaveBeenCalledWith('/workspace/dir/a.txt', expect.any(Object));
    expect(onAdd).toHaveBeenCalledWith('/workspace/dir/sub/b.txt', expect.any(Object));
  });

  it('watchPath forwards rename/change events to chokidar-style events', () => {
    const watcher = new FSWatcher();
    const onAdd = vi.fn();
    const onChange = vi.fn();
    const onUnlink = vi.fn();
    watcher.on('add', onAdd);
    watcher.on('change', onChange);
    watcher.on('unlink', onUnlink);

    watcher.watchPath('/workspace/file.txt');

    vfs.emit('/workspace/file.txt', 'rename');
    expect(onAdd).toHaveBeenCalledWith('/workspace/file.txt', expect.any(Object));

    vfs.emit('/workspace/file.txt', 'change');
    expect(onChange).toHaveBeenCalledWith('/workspace/file.txt', expect.any(Object));

    vfs.remove('/workspace/file.txt');
    vfs.emit('/workspace/file.txt', 'rename');
    expect(onUnlink).toHaveBeenCalledWith('/workspace/file.txt');
  });

  it('supports depth-limited recursive watch and unwatch/close lifecycle', async () => {
    const watcher = new FSWatcher({ depth: 0 });
    watcher.watchDirRecursive('/workspace');

    expect(watcher.getWatched()).toEqual({
      '/workspace': ['dir'],
    });

    const closeEvent = vi.fn();
    watcher.on('close', closeEvent);
    const watched = vfs.watchers.find((entry) => entry.path === '/workspace/dir');
    watcher.unwatch('/workspace/dir');
    expect(watched?.watcher.close).toHaveBeenCalledTimes(1);

    watcher.add('/workspace/file.txt');
    const fileWatch = vfs.watchers.find((entry) => entry.path === '/workspace/file.txt');
    await watcher.close();
    expect(fileWatch?.watcher.close).toHaveBeenCalledTimes(1);
    expect(closeEvent).toHaveBeenCalledTimes(1);
    expect(watcher.closed).toBe(true);
  });

  it('add is a no-op when watcher already closed', async () => {
    const watcher = new FSWatcher();
    await watcher.close();
    expect(watcher.add('/workspace/file.txt')).toBe(watcher);
    expect(watcher.getWatched()).toEqual({});
  });

  it('watch helper creates FSWatcher and default export maps APIs', async () => {
    const watcher = watch('/workspace/file.txt', { ignoreInitial: true });
    expect(watcher).toBeInstanceOf(FSWatcher);
    await watcher.close();

    expect(chokidar.watch).toBe(watch);
    expect(chokidar.FSWatcher).toBe(FSWatcher);
    expect(chokidar.setVFS).toBe(setVFS);
  });

  it('supports per-instance VFS to avoid global singleton leakage', async () => {
    const vfsA = new MockVFS();
    vfsA.addDir('/a');
    vfsA.addFile('/a/a.txt');

    const vfsB = new MockVFS();
    vfsB.addDir('/b');
    vfsB.addFile('/b/b.txt');

    const watcherA = new FSWatcher({ vfs: vfsA });
    const watcherB = new FSWatcher({ vfs: vfsB });
    watcherA.add('/a/a.txt');
    watcherB.add('/b/b.txt');
    await nextTick();

    expect(watcherA.getWatched()).toEqual({ '/a': ['a.txt'] });
    expect(watcherB.getWatched()).toEqual({ '/b': ['b.txt'] });

    await watcherA.close();
    await watcherB.close();
  });

  it('is silent by default and only emits debug logs when debug=true', async () => {
    const watcher = new FSWatcher();
    watcher.add('/workspace/file.txt');
    await nextTick();
    expect(console.debug).not.toHaveBeenCalled();

    const debugWatcher = new FSWatcher({ debug: true });
    debugWatcher.add('/workspace/file.txt');
    await nextTick();
    expect(console.debug).toHaveBeenCalled();

    await watcher.close();
    await debugWatcher.close();
  });
});
