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
  let compatibilityChecker;
  let manager;

  beforeEach(() => {
    ({ registry, resolver, tarball, vfs } = createMocks());
    compatibilityChecker = vi.fn().mockResolvedValue({
      score: 1,
      warnings: [],
      blockers: [],
    });
    manager = new PackageManager({ registry, resolver, tarball, vfs, compatibilityChecker });
  });

  it('constructor uses provided dependency instances', () => {
    expect(manager.registry).toBe(registry);
    expect(manager.resolver).toBe(resolver);
    expect(manager.tarball).toBe(tarball);
    expect(manager.vfs).toBe(vfs);
    expect(manager.compatibilityChecker).toBe(compatibilityChecker);
    expect(manager.compatibilityThreshold).toBe(0.3);
  });

  it('constructor creates defaults when dependencies are omitted', () => {
    const defaultManager = new PackageManager();
    expect(defaultManager.registry).toBeDefined();
    expect(defaultManager.resolver).toBeDefined();
    expect(defaultManager.tarball).toBeDefined();
    expect(defaultManager.vfs).toBeDefined();
  });

  it('constructor supports configurable install concurrency', () => {
    expect(manager.concurrency).toBe(4);

    const customManager = new PackageManager({
      registry,
      resolver,
      tarball,
      vfs,
      concurrency: 2,
    });
    expect(customManager.concurrency).toBe(2);

    const invalidManager = new PackageManager({
      registry,
      resolver,
      tarball,
      vfs,
      concurrency: 0,
    });
    expect(invalidManager.concurrency).toBe(4);
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
    expect(registry.fetchPackageMetadata).toHaveBeenCalledTimes(1);
    expect(registry.fetchPackageMetadata).toHaveBeenCalledWith('demo');
    expect(tarball.download).toHaveBeenCalledTimes(1);
  });

  it('install emits install:compatibility with normalized score and warnings', async () => {
    compatibilityChecker.mockResolvedValueOnce({
      score: 82,
      warnings: ['Uses fs.watch'],
      issues: ['net.createServer'],
    });
    const onCompatibility = vi.fn();
    manager.on('install:compatibility', onCompatibility);

    await manager.install('demo');
    expect(onCompatibility).toHaveBeenCalledWith({
      name: 'demo',
      version: '1.0.0',
      score: 0.82,
      threshold: 0.3,
      warnings: ['Uses fs.watch'],
      blockers: ['net.createServer'],
    });
  });

  it('install warns on low compatibility score without blocking install', async () => {
    compatibilityChecker.mockResolvedValueOnce({
      score: 0.2,
      warnings: ['Needs child_process shim'],
      blockers: ['child_process.spawn'],
    });
    const onCompatibility = vi.fn();
    manager.on('install:compatibility', onCompatibility);

    await expect(manager.install('demo', { compatibilityThreshold: 0.4 })).resolves.toEqual({
      name: 'demo',
      version: '1.0.0',
      deps: 1,
    });
    const payload = onCompatibility.mock.calls[0][0];
    expect(payload.threshold).toBe(0.4);
    expect(payload.score).toBe(0.2);
    expect(payload.blockers).toEqual(['child_process.spawn']);
    expect(payload.warnings.some((warning) => warning.includes('below threshold'))).toBe(true);
    expect(tarball.extract).toHaveBeenCalled();
  });

  it('install continues when compatibility checker throws', async () => {
    compatibilityChecker.mockRejectedValue(new Error('checker failed'));
    const onCompatibility = vi.fn();
    manager.on('install:compatibility', onCompatibility);

    await expect(manager.install('demo')).resolves.toEqual({
      name: 'demo',
      version: '1.0.0',
      deps: 1,
    });
    expect(onCompatibility).toHaveBeenCalledTimes(1);
    expect(onCompatibility.mock.calls[0][0]).toMatchObject({
      name: 'demo',
      version: '1.0.0',
      score: 1,
      threshold: 0.3,
      blockers: [],
    });
    expect(onCompatibility.mock.calls[0][0].warnings[0]).toContain('Compatibility check failed:');
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

  it('install uses dependency layers and installs dependents after dependencies', async () => {
    const metadataByName = {
      demo: {
        name: 'demo',
        versions: {
          '1.0.0': {
            dist: { tarball: 'https://cdn/demo-1.0.0.tgz' },
            dependencies: {
              'dep-a': '^1.0.0',
              'dep-b': '^1.0.0',
            },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      },
      'dep-a': {
        name: 'dep-a',
        versions: {
          '1.0.0': {
            dist: { tarball: 'https://cdn/dep-a-1.0.0.tgz' },
            dependencies: {},
          },
        },
        'dist-tags': { latest: '1.0.0' },
      },
      'dep-b': {
        name: 'dep-b',
        versions: {
          '1.0.0': {
            dist: { tarball: 'https://cdn/dep-b-1.0.0.tgz' },
            dependencies: {},
          },
        },
        'dist-tags': { latest: '1.0.0' },
      },
    };
    const layeredRegistry = {
      fetchPackageMetadata: vi.fn().mockImplementation(async (name) => {
        const metadata = metadataByName[name];
        if (!metadata) throw new Error(`Package "${name}" not found`);
        return metadata;
      }),
    };
    const layeredResolver = {
      resolve: vi.fn().mockResolvedValue('1.0.0'),
      buildDependencyTree: vi.fn().mockResolvedValue([
        { name: 'demo', version: '1.0.0', tarballUrl: 'https://cdn/demo-1.0.0.tgz' },
        { name: 'dep-a', version: '1.0.0', tarballUrl: 'https://cdn/dep-a-1.0.0.tgz' },
        { name: 'dep-b', version: '1.0.0', tarballUrl: 'https://cdn/dep-b-1.0.0.tgz' },
      ]),
    };
    const installOrder = [];
    const layeredTarball = {
      download: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      extract: vi.fn().mockImplementation(async (_buffer, _targetVfs, path) => {
        installOrder.push(path.split('/').pop());
        return 1;
      }),
    };
    const layeredManager = new PackageManager({
      registry: layeredRegistry,
      resolver: layeredResolver,
      tarball: layeredTarball,
      vfs,
      concurrency: 4,
    });

    await layeredManager.install('demo');
    expect(installOrder).toHaveLength(3);
    expect(installOrder[installOrder.length - 1]).toBe('demo');
  });

  it('install honors configured concurrency window inside one layer', async () => {
    const metadataByName = {
      demo: makeMetadata('demo'),
      'dep-a': makeMetadata('dep-a'),
      'dep-b': makeMetadata('dep-b'),
      'dep-c': makeMetadata('dep-c'),
    };
    const limitedRegistry = {
      fetchPackageMetadata: vi.fn().mockImplementation(async (name) => metadataByName[name]),
    };
    const limitedResolver = {
      resolve: vi.fn().mockResolvedValue('1.0.0'),
      buildDependencyTree: vi.fn().mockResolvedValue([
        { name: 'demo', version: '1.0.0', tarballUrl: 'https://cdn/demo-1.0.0.tgz' },
        { name: 'dep-a', version: '1.0.0', tarballUrl: 'https://cdn/dep-a-1.0.0.tgz' },
        { name: 'dep-b', version: '1.0.0', tarballUrl: 'https://cdn/dep-b-1.0.0.tgz' },
        { name: 'dep-c', version: '1.0.0', tarballUrl: 'https://cdn/dep-c-1.0.0.tgz' },
      ]),
    };
    let activeJobs = 0;
    let peakConcurrency = 0;
    const limitedTarball = {
      download: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      extract: vi.fn().mockImplementation(async () => {
        activeJobs += 1;
        peakConcurrency = Math.max(peakConcurrency, activeJobs);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeJobs -= 1;
        return 1;
      }),
    };
    const limitedManager = new PackageManager({
      registry: limitedRegistry,
      resolver: limitedResolver,
      tarball: limitedTarball,
      vfs,
      concurrency: 2,
    });

    await limitedManager.install('demo');
    expect(peakConcurrency).toBeLessThanOrEqual(2);
    expect(peakConcurrency).toBe(2);
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
    tarball.extract.mockRejectedValue(error);
    const onError = vi.fn();
    manager.on('install:error', onError);

    await expect(manager.install('demo')).rejects.toThrow('extract failed');
    expect(onError).toHaveBeenCalledWith({ name: 'demo', error });
  });

  it('install retries recoverable package failures up to two times', async () => {
    const transient = new Error('temporary network error');
    tarball.download
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(transient)
      .mockResolvedValue(new ArrayBuffer(0));

    await manager.install('demo', { includeDeps: false, version: '1.0.0' });
    expect(tarball.download).toHaveBeenCalledTimes(3);
    expect(tarball.extract).toHaveBeenCalledTimes(1);
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

  it('uninstall removes package from vfs', async () => {
    vfs.exists = vi.fn().mockResolvedValue(true);
    vfs.rm = vi.fn().mockResolvedValue(undefined);
    vfs.rmdir = vi.fn();

    await manager.uninstall('demo');
    expect(vfs.exists).toHaveBeenCalledWith('/node_modules/demo');
    expect(vfs.rm).toHaveBeenCalledWith('/node_modules/demo', { recursive: true });
    expect(vfs.rmdir).not.toHaveBeenCalled();
  });

  it('uninstall falls back to rmdir when rm is unavailable', async () => {
    vfs.exists = vi.fn().mockResolvedValue(true);
    vfs.rm = undefined;
    vfs.rmdir = vi.fn().mockResolvedValue(undefined);

    await manager.uninstall('demo');
    expect(vfs.exists).toHaveBeenCalledWith('/node_modules/demo');
    expect(vfs.rmdir).toHaveBeenCalledWith('/node_modules/demo', { recursive: true });
  });

  it('uninstall throws when vfs does not support recursive removal', async () => {
    vfs.exists = vi.fn().mockResolvedValue(true);
    vfs.rm = undefined;
    vfs.rmdir = undefined;

    await expect(manager.uninstall('demo')).rejects.toThrow('VFS does not support recursive removal');
  });

  it('uninstall throws error when package does not exist', async () => {
    vfs.exists = vi.fn().mockResolvedValue(false);
    vfs.rm = vi.fn();

    await expect(manager.uninstall('demo')).rejects.toThrow('Package demo is not installed');
    expect(vfs.exists).toHaveBeenCalledWith('/node_modules/demo');
    expect(vfs.rm).not.toHaveBeenCalled();
  });

  it('uninstall handles scoped packages', async () => {
    vfs.exists = vi.fn().mockResolvedValue(true);
    vfs.rm = vi.fn().mockResolvedValue(undefined);
    vfs.rmdir = vi.fn();

    await manager.uninstall('@scope/pkg');
    expect(vfs.exists).toHaveBeenCalledWith('/node_modules/@scope/pkg');
    expect(vfs.rm).toHaveBeenCalledWith('/node_modules/@scope/pkg', { recursive: true });
    expect(vfs.rmdir).not.toHaveBeenCalled();
  });
});
