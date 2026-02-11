import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PackageManager,
  EventEmitter,
} from '../../../../../../js/agents/core/node-compat/npm/index.js';

/**
 * @param {string} name
 * @returns {any}
 */
function makeMetadata(name) {
  return {
    name,
    versions: {
      '1.0.0': {
        dist: { tarball: `https://cdn/${name}-1.0.0.tgz`, shasum: 'x' },
      },
    },
    'dist-tags': {
      latest: '1.0.0',
    },
  };
}

/**
 * @returns {{
 *   registry: any,
 *   resolver: any,
 *   tarball: any,
 *   vfs: any
 * }}
 */
function createMocks() {
  const registry = {
    fetchPackageMetadata: vi.fn().mockResolvedValue(makeMetadata('demo')),
  };
  const resolver = {
    resolve: vi.fn().mockResolvedValue('1.0.0'),
    buildDependencyTree: vi.fn().mockResolvedValue([
      { name: 'demo', version: '1.0.0', tarballUrl: 'https://cdn/demo-1.0.0.tgz' },
      { name: 'dep', version: '2.0.0', tarballUrl: 'https://cdn/dep-2.0.0.tgz' },
    ]),
  };
  const tarball = {
    download: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    extract: vi.fn().mockResolvedValue(1),
  };
  const vfs = {
    list: vi.fn().mockResolvedValue([]),
    readdir: vi.fn(),
  };
  return { registry, resolver, tarball, vfs };
}

/**
 * @param {string} name
 * @param {boolean} isDir
 * @returns {{ name: string, isDirectory: () => boolean, isFile: () => boolean }}
 */
function makeDirent(name, isDir) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  };
}

describe('npm/index EventEmitter', () => {
  let emitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  it('on + emit invokes listener', () => {
    const listener = vi.fn();
    emitter.on('install:start', listener);
    emitter.emit('install:start', { name: 'demo', version: '1.0.0' });
    expect(listener).toHaveBeenCalledWith({ name: 'demo', version: '1.0.0' });
  });

  it('off removes listener', () => {
    const listener = vi.fn();
    emitter.on('install:start', listener);
    emitter.off('install:start', listener);
    emitter.emit('install:start', { name: 'demo', version: '1.0.0' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('on returns unsubscribe callback', () => {
    const listener = vi.fn();
    const unsubscribe = emitter.on('install:start', listener);
    unsubscribe();
    emitter.emit('install:start', { name: 'demo', version: '1.0.0' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('emit ignores listener errors and continues', () => {
    const badListener = vi.fn(() => {
      throw new Error('boom');
    });
    const goodListener = vi.fn();
    emitter.on('install:start', badListener);
    emitter.on('install:start', goodListener);
    emitter.emit('install:start', { name: 'demo', version: '1.0.0' });
    expect(badListener).toHaveBeenCalledTimes(1);
    expect(goodListener).toHaveBeenCalledTimes(1);
  });
});

describe('npm/index PackageManager install/list', () => {
  let registry;
  let resolver;
  let tarball;
  let vfs;
  let manager;

  beforeEach(() => {
    ({ registry, resolver, tarball, vfs } = createMocks());
    manager = new PackageManager({ registry, resolver, tarball, vfs });
  });

  it('constructor uses provided dependency instances', () => {
    expect(manager.registry).toBe(registry);
    expect(manager.resolver).toBe(resolver);
    expect(manager.tarball).toBe(tarball);
    expect(manager.vfs).toBe(vfs);
  });

  it('constructor creates defaults when dependencies are omitted', () => {
    const defaultManager = new PackageManager();
    expect(defaultManager.registry).toBeDefined();
    expect(defaultManager.resolver).toBeDefined();
    expect(defaultManager.tarball).toBeDefined();
    expect(defaultManager.vfs).toBeDefined();
  });

  it('install emits install:start with default latest version', async () => {
    const startListener = vi.fn();
    manager.on('install:start', startListener);

    await manager.install('demo');
    expect(startListener).toHaveBeenCalledWith({ name: 'demo', version: 'latest' });
  });

  it('install resolves version and builds dependency tree', async () => {
    await manager.install('demo', { version: '^1.0.0' });
    expect(resolver.resolve).toHaveBeenCalledWith('demo', '^1.0.0');
    expect(resolver.buildDependencyTree).toHaveBeenCalledWith('demo', '1.0.0');
  });

  it('install with includeDeps=false installs only root package', async () => {
    resolver.buildDependencyTree.mockReset();
    registry.fetchPackageMetadata.mockResolvedValueOnce(makeMetadata('demo'));

    await manager.install('demo', { includeDeps: false, version: '1.0.0' });
    expect(resolver.buildDependencyTree).not.toHaveBeenCalled();
    expect(registry.fetchPackageMetadata).toHaveBeenCalledWith('demo');
    expect(tarball.download).toHaveBeenCalledTimes(1);
  });

  it('install emits install:progress for each package', async () => {
    const progress = vi.fn();
    manager.on('install:progress', progress);

    await manager.install('demo');
    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls[0][0]).toEqual({
      name: 'demo',
      version: '1.0.0',
      index: 1,
      total: 2,
    });
  });

  it('install downloads and extracts each dependency', async () => {
    await manager.install('demo');
    expect(tarball.download).toHaveBeenCalledTimes(2);
    expect(tarball.download).toHaveBeenNthCalledWith(1, 'https://cdn/demo-1.0.0.tgz');
    expect(tarball.download).toHaveBeenNthCalledWith(2, 'https://cdn/dep-2.0.0.tgz');
    expect(tarball.extract).toHaveBeenNthCalledWith(
      1,
      expect.any(ArrayBuffer),
      vfs,
      '/node_modules/demo',
    );
    expect(tarball.extract).toHaveBeenNthCalledWith(
      2,
      expect.any(ArrayBuffer),
      vfs,
      '/node_modules/dep',
    );
  });

  it('install emits install:complete with dependency count', async () => {
    const complete = vi.fn();
    manager.on('install:complete', complete);

    await manager.install('demo');
    expect(complete).toHaveBeenCalledWith({ name: 'demo', version: '1.0.0', deps: 1 });
  });

  it('install returns name/version/deps result', async () => {
    const result = await manager.install('demo');
    expect(result).toEqual({ name: 'demo', version: '1.0.0', deps: 1 });
  });

  it('install emits install:error when resolve fails', async () => {
    const error = new Error('resolve failed');
    resolver.resolve.mockRejectedValueOnce(error);
    const onError = vi.fn();
    manager.on('install:error', onError);

    await expect(manager.install('demo')).rejects.toThrow('resolve failed');
    expect(onError).toHaveBeenCalledWith({ name: 'demo', error });
  });

  it('install emits install:error when extract fails', async () => {
    const error = new Error('extract failed');
    tarball.extract.mockRejectedValueOnce(error);
    const onError = vi.fn();
    manager.on('install:error', onError);

    await expect(manager.install('demo')).rejects.toThrow('extract failed');
    expect(onError).toHaveBeenCalledWith({ name: 'demo', error });
  });

  it('list returns empty array when node_modules is missing', async () => {
    vfs.list.mockRejectedValueOnce(new Error('ENOENT'));
    await expect(manager.list()).resolves.toEqual([]);
  });

  it('list reads top-level packages from vfs.list', async () => {
    vfs.list.mockResolvedValueOnce([
      { name: 'react', kind: 'dir' },
      { name: 'left-pad', kind: 'dir' },
    ]);
    await expect(manager.list()).resolves.toEqual(['left-pad', 'react']);
  });

  it('list flattens scoped packages from vfs.list', async () => {
    vfs.list
      .mockResolvedValueOnce([
        { name: '@scope', kind: 'dir' },
        { name: 'react', kind: 'dir' },
      ])
      .mockResolvedValueOnce([
        { name: 'pkg', kind: 'dir' },
      ]);

    await expect(manager.list()).resolves.toEqual(['@scope/pkg', 'react']);
  });

  it('list ignores non-directory entries', async () => {
    vfs.list.mockResolvedValueOnce([
      { name: 'README.md', kind: 'file' },
      { name: 'react', kind: 'dir' },
    ]);
    await expect(manager.list()).resolves.toEqual(['react']);
  });

  it('list falls back to readdir when list is unavailable', async () => {
    delete vfs.list;
    vfs.readdir
      .mockResolvedValueOnce([
        makeDirent('zeta', true),
        makeDirent('alpha', true),
      ]);

    await expect(manager.list()).resolves.toEqual(['alpha', 'zeta']);
  });
});
