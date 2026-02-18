import { describe, it, expect, vi } from 'vitest';
import {
  DependencyResolver,
  parseSemver,
  satisfies,
  compareVersions,
} from '../../../../../../js/agents/core/node-compat/npm/resolver.js';

/**
 * @param {Record<string, any>} packages
 * @returns {{ fetchPackageMetadata: ReturnType<typeof vi.fn> }}
 */
function createRegistry(packages) {
  return {
    fetchPackageMetadata: vi.fn(async (name) => {
      if (!packages[name]) throw new Error(`Package not found: ${name}`);
      return JSON.parse(JSON.stringify(packages[name]));
    }),
  };
}

const semverPackages = {
  demo: {
    name: 'demo',
    versions: {
      '0.9.9': { dist: { tarball: 'https://cdn/demo-0.9.9.tgz', shasum: 'x' } },
      '1.0.0': { dist: { tarball: 'https://cdn/demo-1.0.0.tgz', shasum: 'x' } },
      '1.2.0': { dist: { tarball: 'https://cdn/demo-1.2.0.tgz', shasum: 'x' } },
      '1.2.3': { dist: { tarball: 'https://cdn/demo-1.2.3.tgz', shasum: 'x' } },
      '1.2.9': { dist: { tarball: 'https://cdn/demo-1.2.9.tgz', shasum: 'x' } },
      '1.3.0': { dist: { tarball: 'https://cdn/demo-1.3.0.tgz', shasum: 'x' } },
      '2.0.0': { dist: { tarball: 'https://cdn/demo-2.0.0.tgz', shasum: 'x' } },
      '2.1.1': { dist: { tarball: 'https://cdn/demo-2.1.1.tgz', shasum: 'x' } },
    },
    'dist-tags': {
      latest: '2.1.1',
      next: '2.0.0',
    },
  },
};

describe('npm/resolver semver helpers', () => {
  it('parseSemver parses standard version', () => {
    expect(parseSemver('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
      build: [],
    });
  });

  it('parseSemver keeps prerelease/build metadata', () => {
    expect(parseSemver('v1.2.3-beta.1+build.5')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ['beta', '1'],
      build: ['build', '5'],
    });
  });

  it('parseSemver returns null for invalid input', () => {
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('abc')).toBeNull();
  });

  it('compareVersions returns expected ordering', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('compareVersions handles prerelease precedence', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0-beta.2')).toBe(-1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0+build.1', '1.0.0+build.2')).toBe(0);
  });

  it('satisfies exact version range', () => {
    expect(satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('1.2.4', '1.2.3')).toBe(false);
  });

  it('satisfies caret range', () => {
    expect(satisfies('1.9.9', '^1.2.3')).toBe(true);
    expect(satisfies('2.0.0', '^1.2.3')).toBe(false);
  });

  it('satisfies tilde range', () => {
    expect(satisfies('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.3')).toBe(false);
  });

  it('satisfies comparator ranges', () => {
    expect(satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
    expect(satisfies('1.0.0', '>1.0.0')).toBe(false);
  });

  it('satisfies OR ranges', () => {
    expect(satisfies('1.2.0', '1.x || 2.x')).toBe(true);
    expect(satisfies('2.0.0', '1.x || 2.x')).toBe(true);
    expect(satisfies('3.0.0', '1.x || 2.x')).toBe(false);
  });

  it('satisfies wildcard ranges', () => {
    expect(satisfies('4.5.6', '*')).toBe(true);
    expect(satisfies('1.8.0', '1.x')).toBe(true);
    expect(satisfies('1.2.7', '1.2.x')).toBe(true);
    expect(satisfies('1.3.0', '1.2.x')).toBe(false);
  });

  it('satisfies hyphen ranges', () => {
    expect(satisfies('1.5.0', '1.0.0 - 2.0.0')).toBe(true);
    expect(satisfies('2.1.0', '1.0.0 - 2.0.0')).toBe(false);
  });

  it('satisfies prerelease ranges', () => {
    expect(satisfies('1.0.0-beta.2', '^1.0.0-0')).toBe(true);
    expect(satisfies('1.0.0-alpha.1', '^1.0.0-beta.1')).toBe(false);
  });
});

describe('npm/resolver resolve + dependency tree', () => {
  it('resolve returns dist-tags latest when range is latest', async () => {
    const registry = createRegistry(semverPackages);
    const resolver = new DependencyResolver({ registry });
    await expect(resolver.resolve('demo', 'latest')).resolves.toBe('2.1.1');
  });

  it('resolve supports explicit dist-tag names', async () => {
    const registry = createRegistry(semverPackages);
    const resolver = new DependencyResolver({ registry });
    await expect(resolver.resolve('demo', 'next')).resolves.toBe('2.0.0');
  });

  it('resolve chooses highest matching version', async () => {
    const registry = createRegistry(semverPackages);
    const resolver = new DependencyResolver({ registry });
    await expect(resolver.resolve('demo', '^1.2.0')).resolves.toBe('1.3.0');
  });

  it('resolve supports wildcard and OR patterns', async () => {
    const registry = createRegistry(semverPackages);
    const resolver = new DependencyResolver({ registry });
    await expect(resolver.resolve('demo', '1.x || 2.0.x')).resolves.toBe('2.0.0');
  });

  it('resolve supports hyphen ranges', async () => {
    const registry = createRegistry(semverPackages);
    const resolver = new DependencyResolver({ registry });
    await expect(resolver.resolve('demo', '1.0.0 - 1.2.9')).resolves.toBe('1.2.9');
  });

  it('resolve throws when no matching version found', async () => {
    const registry = createRegistry(semverPackages);
    const resolver = new DependencyResolver({ registry });
    await expect(resolver.resolve('demo', '<0.1.0')).rejects.toThrow('No matching version');
  });

  it('resolve throws explicit error for unsupported range protocols', async () => {
    const registry = createRegistry(semverPackages);
    const resolver = new DependencyResolver({ registry });

    await expect(resolver.resolve('demo', 'file:../demo'))
      .rejects
      .toMatchObject({ code: 'ERR_UNSUPPORTED_VERSION_RANGE_PROTOCOL', protocol: 'file' });
    await expect(resolver.resolve('demo', 'workspace:*'))
      .rejects
      .toMatchObject({ code: 'ERR_UNSUPPORTED_VERSION_RANGE_PROTOCOL', protocol: 'workspace' });
  });

  it('buildDependencyTree returns flat transitive list', async () => {
    const packages = {
      app: {
        name: 'app',
        versions: {
          '1.0.0': {
            dist: { tarball: 'https://cdn/app-1.0.0.tgz', shasum: 'x' },
            dependencies: {
              depA: '^1.0.0',
              depB: '~2.0.0',
            },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      },
      depA: {
        name: 'depA',
        versions: {
          '1.1.0': {
            dist: { tarball: 'https://cdn/depA-1.1.0.tgz', shasum: 'x' },
            dependencies: { depC: '1.0.0' },
          },
        },
        'dist-tags': { latest: '1.1.0' },
      },
      depB: {
        name: 'depB',
        versions: {
          '2.0.1': {
            dist: { tarball: 'https://cdn/depB-2.0.1.tgz', shasum: 'x' },
          },
        },
        'dist-tags': { latest: '2.0.1' },
      },
      depC: {
        name: 'depC',
        versions: {
          '1.0.0': {
            dist: { tarball: 'https://cdn/depC-1.0.0.tgz', shasum: 'x' },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      },
    };
    const registry = createRegistry(packages);
    const resolver = new DependencyResolver({ registry });

    const deps = await resolver.buildDependencyTree('app', '1.0.0');
    expect(deps.map((item) => item.name)).toEqual(['app', 'depA', 'depC', 'depB']);
    expect(deps[0].tarballUrl).toBe('https://cdn/app-1.0.0.tgz');
    expect(deps[0].shasum).toBe('x');
  });

  it('buildDependencyTree handles circular dependencies via visited set', async () => {
    const packages = {
      alpha: {
        name: 'alpha',
        versions: {
          '1.0.0': {
            dist: { tarball: 'https://cdn/alpha-1.0.0.tgz', shasum: 'x' },
            dependencies: { beta: '1.0.0' },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      },
      beta: {
        name: 'beta',
        versions: {
          '1.0.0': {
            dist: { tarball: 'https://cdn/beta-1.0.0.tgz', shasum: 'x' },
            dependencies: { alpha: '1.0.0' },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      },
    };
    const registry = createRegistry(packages);
    const resolver = new DependencyResolver({ registry });

    const deps = await resolver.buildDependencyTree('alpha', '1.0.0');
    expect(deps).toHaveLength(2);
    expect(deps.map((item) => item.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('buildDependencyTree handles deep chains without recursive overflow', async () => {
    const depth = 500;
    /** @type {Record<string, any>} */
    const packages = {};
    for (let index = 0; index < depth; index += 1) {
      const name = `pkg-${index}`;
      const next = index + 1 < depth ? `pkg-${index + 1}` : null;
      packages[name] = {
        name,
        versions: {
          '1.0.0': {
            dist: { tarball: `https://cdn/${name}.tgz`, shasum: 'x' },
            dependencies: next ? { [next]: '1.0.0' } : {},
          },
        },
        'dist-tags': { latest: '1.0.0' },
      };
    }
    const registry = createRegistry(packages);
    const resolver = new DependencyResolver({ registry });

    const deps = await resolver.buildDependencyTree('pkg-0', '1.0.0');
    expect(deps).toHaveLength(depth);
    expect(deps[0].name).toBe('pkg-0');
    expect(deps[depth - 1].name).toBe(`pkg-${depth - 1}`);
  });

  it('buildDependencyTree throws when tarball is missing', async () => {
    const packages = {
      bad: {
        name: 'bad',
        versions: {
          '1.0.0': {
            dist: { tarball: '', shasum: 'x' },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      },
    };
    const registry = createRegistry(packages);
    const resolver = new DependencyResolver({ registry });

    await expect(resolver.buildDependencyTree('bad', '1.0.0'))
      .rejects
      .toThrow('Missing tarball URL');
  });

  it('buildDependencyTree throws when shasum is missing', async () => {
    const packages = {
      bad: {
        name: 'bad',
        versions: {
          '1.0.0': {
            dist: { tarball: 'https://cdn/bad-1.0.0.tgz' },
          },
        },
        'dist-tags': { latest: '1.0.0' },
      },
    };
    const registry = createRegistry(packages);
    const resolver = new DependencyResolver({ registry });

    await expect(resolver.buildDependencyTree('bad', '1.0.0'))
      .rejects
      .toThrow('Missing tarball shasum');
  });

  it('constructor throws when registry is invalid', () => {
    expect(() => new DependencyResolver({ registry: /** @type {any} */ ({}) }))
      .toThrow('requires a registry');
  });
});
