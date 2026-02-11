import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Registry,
  encodePackageName,
  normalizeRegistryUrl,
} from '../../../../../../js/agents/core/node-compat/npm/registry.js';

/**
 * @param {unknown} data
 * @param {{ ok?: boolean, status?: number }} [options]
 * @returns {{ ok: boolean, status: number, json: () => Promise<unknown> }}
 */
function createJsonResponse(data, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    json: vi.fn().mockResolvedValue(data),
  };
}

/**
 * @param {string} name
 * @returns {any}
 */
function makeMetadata(name) {
  return {
    name,
    versions: {
      '1.0.0': {
        dist: { tarball: `https://cdn.example.com/${name}-1.0.0.tgz`, shasum: 'aaa' },
      },
    },
    'dist-tags': {
      latest: '1.0.0',
    },
  };
}

describe('npm/registry', () => {
  let fetchFn;

  beforeEach(() => {
    fetchFn = vi.fn();
  });

  it('encodePackageName keeps @ and encodes slash for scoped package', () => {
    expect(encodePackageName('@scope/pkg')).toBe('@scope%2fpkg');
  });

  it('encodePackageName keeps unscoped package names unchanged', () => {
    expect(encodePackageName('left-pad')).toBe('left-pad');
  });

  it('normalizeRegistryUrl removes trailing slashes', () => {
    expect(normalizeRegistryUrl('https://registry.npmjs.org///')).toBe('https://registry.npmjs.org');
  });

  it('constructor applies defaults', () => {
    const registry = new Registry({ fetchFn });
    expect(registry.registryUrl).toBe('https://registry.npmjs.org');
    expect(registry.maxCacheSize).toBe(100);
    expect(registry._cache.size).toBe(0);
  });

  it('constructor enforces minimum cache size 1', () => {
    const registry = new Registry({ fetchFn, maxCacheSize: 0 });
    expect(registry.maxCacheSize).toBe(1);
  });

  it('fetchPackageMetadata sends install-v1 Accept header', async () => {
    fetchFn.mockResolvedValueOnce(createJsonResponse(makeMetadata('react')));
    const registry = new Registry({ fetchFn });

    await registry.fetchPackageMetadata('react');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [, options] = fetchFn.mock.calls[0];
    expect(options.headers.Accept).toBe('application/vnd.npm.install-v1+json');
  });

  it('fetchPackageMetadata uses normalized registry URL', async () => {
    fetchFn.mockResolvedValueOnce(createJsonResponse(makeMetadata('react')));
    const registry = new Registry({
      fetchFn,
      registryUrl: 'https://registry.npmjs.org/',
    });

    await registry.fetchPackageMetadata('react');
    expect(fetchFn.mock.calls[0][0]).toBe('https://registry.npmjs.org/react');
  });

  it('fetchPackageMetadata encodes scoped package URL path', async () => {
    fetchFn.mockResolvedValueOnce(createJsonResponse(makeMetadata('@scope/pkg')));
    const registry = new Registry({ fetchFn });

    await registry.fetchPackageMetadata('@scope/pkg');
    expect(fetchFn.mock.calls[0][0]).toBe('https://registry.npmjs.org/@scope%2fpkg');
  });

  it('fetchPackageMetadata caches responses by package name', async () => {
    const metadata = makeMetadata('react');
    fetchFn.mockResolvedValueOnce(createJsonResponse(metadata));
    const registry = new Registry({ fetchFn });

    const first = await registry.fetchPackageMetadata('react');
    const second = await registry.fetchPackageMetadata('react');

    expect(first).toEqual(metadata);
    expect(second).toEqual(metadata);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('clearCache removes cached entries', async () => {
    fetchFn.mockResolvedValueOnce(createJsonResponse(makeMetadata('react')));
    fetchFn.mockResolvedValueOnce(createJsonResponse(makeMetadata('react')));
    const registry = new Registry({ fetchFn });

    await registry.fetchPackageMetadata('react');
    registry.clearCache();
    await registry.fetchPackageMetadata('react');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('evicts oldest entry when max cache size is exceeded', async () => {
    fetchFn.mockImplementation(async (url) => {
      const name = String(url).split('/').pop();
      return createJsonResponse(makeMetadata(String(name)));
    });
    const registry = new Registry({ fetchFn, maxCacheSize: 2 });

    await registry.fetchPackageMetadata('a');
    await registry.fetchPackageMetadata('b');
    await registry.fetchPackageMetadata('c');

    expect([...registry._cache.keys()]).toEqual(['b', 'c']);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('updates recency when reading from cache (LRU behavior)', async () => {
    fetchFn.mockImplementation(async (url) => {
      const name = String(url).split('/').pop();
      return createJsonResponse(makeMetadata(String(name)));
    });
    const registry = new Registry({ fetchFn, maxCacheSize: 2 });

    await registry.fetchPackageMetadata('a');
    await registry.fetchPackageMetadata('b');
    await registry.fetchPackageMetadata('a'); // touch a
    await registry.fetchPackageMetadata('c'); // should evict b

    expect([...registry._cache.keys()]).toEqual(['a', 'c']);
  });

  it('throws when package name is empty', async () => {
    const registry = new Registry({ fetchFn });
    await expect(registry.fetchPackageMetadata('')).rejects.toThrow('Package name must be a non-empty string');
  });

  it('throws when fetch returns non-OK status', async () => {
    fetchFn.mockResolvedValueOnce(createJsonResponse({}, { ok: false, status: 404 }));
    const registry = new Registry({ fetchFn });

    await expect(registry.fetchPackageMetadata('missing-pkg'))
      .rejects
      .toThrow('HTTP 404');
  });

  it('throws when metadata shape is invalid', async () => {
    fetchFn.mockResolvedValueOnce(createJsonResponse({ name: 'react' }));
    const registry = new Registry({ fetchFn });

    await expect(registry.fetchPackageMetadata('react'))
      .rejects
      .toThrow('Invalid metadata shape');
  });

  it('throws when fetchFn is not a function', () => {
    expect(() => new Registry({ fetchFn: /** @type {any} */ (null) }))
      .toThrow('Registry fetchFn must be a function');
  });

  it('uses custom registry URL', async () => {
    fetchFn.mockResolvedValueOnce(createJsonResponse(makeMetadata('react')));
    const registry = new Registry({ fetchFn, registryUrl: 'https://registry.example.com' });

    await registry.fetchPackageMetadata('react');
    expect(fetchFn.mock.calls[0][0]).toBe('https://registry.example.com/react');
  });
});
