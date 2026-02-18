import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryVfs } from '../../../../../js/agents/vfs/vfs.memory.js';
import {
  createResolver,
  ModuleResolver,
  resolveExportConditions,
  resolvePackageExports,
  BUILTIN_MODULE_NAMES,
} from '../../../../../js/agents/core/node-compat/module-resolver.js';

// ── resolveExportConditions ─────────────────────────────────────

describe('resolveExportConditions', () => {
  it('returns string entry directly', () => {
    expect(resolveExportConditions('./dist/index.js')).toBe('./dist/index.js');
  });

  it('returns undefined for null/undefined', () => {
    expect(resolveExportConditions(null)).toBeUndefined();
    expect(resolveExportConditions(undefined)).toBeUndefined();
  });

  it('resolves array by returning first truthy', () => {
    expect(resolveExportConditions(['./a.js', './b.js'])).toBe('./a.js');
  });

  it('skips null entries in array', () => {
    expect(resolveExportConditions([null, './b.js'])).toBe('./b.js');
  });

  it('resolves "browser" condition first', () => {
    const entry = { browser: './browser.js', require: './cjs.js', default: './default.js' };
    expect(resolveExportConditions(entry)).toBe('./browser.js');
  });

  it('resolves "module" when no browser', () => {
    const entry = { module: './esm.js', require: './cjs.js', default: './default.js' };
    expect(resolveExportConditions(entry)).toBe('./esm.js');
  });

  it('resolves "import" condition', () => {
    const entry = { import: './esm.js', require: './cjs.js' };
    expect(resolveExportConditions(entry)).toBe('./esm.js');
  });

  it('resolves "require" condition', () => {
    const entry = { require: './cjs.js' };
    expect(resolveExportConditions(entry)).toBe('./cjs.js');
  });

  it('resolves "default" as fallback', () => {
    const entry = { default: './default.js' };
    expect(resolveExportConditions(entry)).toBe('./default.js');
  });

  it('resolves nested conditional objects', () => {
    const entry = {
      browser: { import: './browser-esm.js', require: './browser-cjs.js' },
      default: './default.js',
    };
    expect(resolveExportConditions(entry)).toBe('./browser-esm.js');
  });

  it('returns undefined for empty object', () => {
    expect(resolveExportConditions({})).toBeUndefined();
  });

  it('returns undefined for object with unknown conditions only', () => {
    expect(resolveExportConditions({ node: './node.js', deno: './deno.js' })).toBeUndefined();
  });
});

// ── resolvePackageExports ───────────────────────────────────────

describe('resolvePackageExports', () => {
  it('returns undefined for falsy exports', () => {
    expect(resolvePackageExports(null, '.')).toBeUndefined();
    expect(resolvePackageExports(undefined, '.')).toBeUndefined();
  });

  // String shorthand: "exports": "./dist/index.js"
  it('string exports matches "." subpath', () => {
    expect(resolvePackageExports('./dist/index.js', '.')).toBe('./dist/index.js');
  });

  it('string exports returns undefined for non-"." subpath', () => {
    expect(resolvePackageExports('./dist/index.js', './server')).toBeUndefined();
  });

  // Array shorthand: "exports": ["./a.js", "./b.js"]
  it('array exports matches "." subpath', () => {
    expect(resolvePackageExports(['./a.js', './b.js'], '.')).toBe('./a.js');
  });

  it('array exports returns undefined for non-"." subpath', () => {
    expect(resolvePackageExports(['./a.js'], './sub')).toBeUndefined();
  });

  // Path-mapped exports
  it('path map direct match on "."', () => {
    const exports = { '.': './dist/index.js', './server': './dist/server.js' };
    expect(resolvePackageExports(exports, '.')).toBe('./dist/index.js');
  });

  it('path map direct match on subpath', () => {
    const exports = { '.': './dist/index.js', './server': './dist/server.js' };
    expect(resolvePackageExports(exports, './server')).toBe('./dist/server.js');
  });

  it('path map with conditional exports', () => {
    const exports = {
      '.': { browser: './dist/browser.js', default: './dist/index.js' },
      './server': { import: './dist/server.mjs', require: './dist/server.cjs' },
    };
    expect(resolvePackageExports(exports, '.')).toBe('./dist/browser.js');
    expect(resolvePackageExports(exports, './server')).toBe('./dist/server.mjs');
  });

  it('path map returns undefined for unmatched subpath', () => {
    const exports = { '.': './dist/index.js' };
    expect(resolvePackageExports(exports, './unknown')).toBeUndefined();
  });

  // Wildcard pattern exports
  it('wildcard pattern match', () => {
    const exports = { './utils/*': './dist/utils/*.js' };
    expect(resolvePackageExports(exports, './utils/foo')).toBe('./dist/utils/foo.js');
  });

  it('wildcard pattern with nested path', () => {
    const exports = { './components/*': './src/components/*/index.js' };
    expect(resolvePackageExports(exports, './components/Button')).toBe('./src/components/Button/index.js');
  });

  // Conditional object (non path-mapped) for '.'
  it('non-path-map conditional object matches "."', () => {
    const exports = { browser: './browser.js', default: './index.js' };
    expect(resolvePackageExports(exports, '.')).toBe('./browser.js');
  });

  it('non-path-map conditional object returns undefined for non-"."', () => {
    const exports = { browser: './browser.js', default: './index.js' };
    expect(resolvePackageExports(exports, './sub')).toBeUndefined();
  });

  // Real-world: convex package
  it('convex-style exports', () => {
    const exports = {
      '.': { browser: './dist/browser/index.js', default: './dist/cjs/index.js' },
      './server': { browser: './dist/browser/server.js', default: './dist/cjs/server.js' },
      './react': { browser: './dist/browser/react.js', default: './dist/cjs/react.js' },
    };
    expect(resolvePackageExports(exports, '.')).toBe('./dist/browser/index.js');
    expect(resolvePackageExports(exports, './server')).toBe('./dist/browser/server.js');
    expect(resolvePackageExports(exports, './react')).toBe('./dist/browser/react.js');
  });

  // Real-world: jose package
  it('jose-style exports', () => {
    const exports = {
      '.': { import: './dist/browser/index.js', require: './dist/node/cjs/index.js' },
      './jwt/sign': { import: './dist/browser/jwt/sign.js' },
    };
    expect(resolvePackageExports(exports, '.')).toBe('./dist/browser/index.js');
    expect(resolvePackageExports(exports, './jwt/sign')).toBe('./dist/browser/jwt/sign.js');
  });
});

// ── createResolver with exports field ───────────────────────────

describe('createResolver exports integration', () => {
  /** @type {MemoryVfs} */
  let vfs;
  let resolver;

  beforeEach(async () => {
    vfs = new MemoryVfs();
    resolver = createResolver({ vfs, builtinModules: {} });
  });

  it('resolves package via exports["."] string shorthand', async () => {
    await vfs.writeText('node_modules/simple/package.json', JSON.stringify({
      exports: './lib/main.js',
    }));
    await vfs.writeText('node_modules/simple/lib/main.js', 'module.exports = 1;');

    const result = await resolver.resolve('simple', '');
    expect(result).toEqual({ type: 'file', path: 'node_modules/simple/lib/main.js' });
  });

  it('resolves package via exports["."] conditional', async () => {
    await vfs.writeText('node_modules/pkg/package.json', JSON.stringify({
      exports: {
        '.': { browser: './dist/browser.js', default: './dist/node.js' },
      },
    }));
    await vfs.writeText('node_modules/pkg/dist/browser.js', 'export default 1;');

    const result = await resolver.resolve('pkg', '');
    expect(result).toEqual({ type: 'file', path: 'node_modules/pkg/dist/browser.js' });
  });

  it('resolves subpath via exports field', async () => {
    await vfs.writeText('node_modules/convex/package.json', JSON.stringify({
      exports: {
        '.': './dist/index.js',
        './server': './dist/server.js',
        './react': './dist/react.js',
      },
    }));
    await vfs.writeText('node_modules/convex/dist/index.js', '');
    await vfs.writeText('node_modules/convex/dist/server.js', '');
    await vfs.writeText('node_modules/convex/dist/react.js', '');

    const r1 = await resolver.resolve('convex', '');
    expect(r1.path).toBe('node_modules/convex/dist/index.js');

    const r2 = await resolver.resolve('convex/server', '');
    expect(r2.path).toBe('node_modules/convex/dist/server.js');

    const r3 = await resolver.resolve('convex/react', '');
    expect(r3.path).toBe('node_modules/convex/dist/react.js');
  });

  it('resolves scoped package subpath via exports', async () => {
    await vfs.writeText('node_modules/@tanstack/react-query/package.json', JSON.stringify({
      exports: {
        '.': { import: './build/modern/index.js', default: './build/legacy/index.js' },
        './devtools': { import: './build/modern/devtools.js' },
      },
    }));
    await vfs.writeText('node_modules/@tanstack/react-query/build/modern/index.js', '');
    await vfs.writeText('node_modules/@tanstack/react-query/build/modern/devtools.js', '');

    const r1 = await resolver.resolve('@tanstack/react-query', '');
    expect(r1.path).toBe('node_modules/@tanstack/react-query/build/modern/index.js');

    const r2 = await resolver.resolve('@tanstack/react-query/devtools', '');
    expect(r2.path).toBe('node_modules/@tanstack/react-query/build/modern/devtools.js');
  });

  it('does not bypass package exports when subpath is not exported', async () => {
    await vfs.writeText('node_modules/pkg/package.json', JSON.stringify({
      exports: { '.': './dist/index.js' },
    }));
    await vfs.writeText('node_modules/pkg/dist/index.js', '');
    await vfs.writeText('node_modules/pkg/utils/helper.js', '');

    const result = await resolver.resolve('pkg/utils/helper', '');
    expect(result).toBeNull();
  });

  it('exports["."] takes priority over main field', async () => {
    await vfs.writeText('node_modules/dual/package.json', JSON.stringify({
      main: 'lib/cjs.js',
      exports: { '.': './dist/esm.js' },
    }));
    await vfs.writeText('node_modules/dual/lib/cjs.js', '');
    await vfs.writeText('node_modules/dual/dist/esm.js', '');

    const result = await resolver.resolve('dual', '');
    expect(result.path).toBe('node_modules/dual/dist/esm.js');
  });

  it('falls back to main when exports resolution fails', async () => {
    await vfs.writeText('node_modules/fallback/package.json', JSON.stringify({
      main: 'lib/index.js',
      exports: { '.': './nonexistent.js' },
    }));
    await vfs.writeText('node_modules/fallback/lib/index.js', '');

    const result = await resolver.resolve('fallback', '');
    expect(result.path).toBe('node_modules/fallback/lib/index.js');
  });

  it('resolves wildcard exports pattern', async () => {
    await vfs.writeText('node_modules/icons/package.json', JSON.stringify({
      exports: { './icons/*': './dist/icons/*.js' },
    }));
    await vfs.writeText('node_modules/icons/dist/icons/arrow.js', '');

    const result = await resolver.resolve('icons/icons/arrow', '');
    expect(result.path).toBe('node_modules/icons/dist/icons/arrow.js');
  });

  it('resolves path-mapped exports independent of object key order', async () => {
    const exportsA = {
      '.': './dist/index.js',
      './client': './dist/client.js',
      browser: './dist/browser.js',
    };
    const exportsB = {
      browser: './dist/browser.js',
      './client': './dist/client.js',
      '.': './dist/index.js',
    };

    expect(resolvePackageExports(exportsA, './client')).toBe('./dist/client.js');
    expect(resolvePackageExports(exportsB, './client')).toBe('./dist/client.js');
  });
});

// ── backward compatibility ──────────────────────────────────────

describe('createResolver backward compat', () => {
  let vfs;
  let resolver;

  beforeEach(async () => {
    vfs = new MemoryVfs();
    resolver = createResolver({ vfs, builtinModules: { fs: { readFile() {} } } });
  });

  it('resolves package.json main field (no exports)', async () => {
    await vfs.writeText('node_modules/foo/package.json', JSON.stringify({ main: 'lib/entry.js' }));
    await vfs.writeText('node_modules/foo/lib/entry.js', '');
    const result = await resolver.resolve('foo', '');
    expect(result.path).toBe('node_modules/foo/lib/entry.js');
  });

  it('resolves package.json browser field (no exports)', async () => {
    await vfs.writeText('node_modules/bar/package.json', JSON.stringify({ browser: 'dist/browser.js' }));
    await vfs.writeText('node_modules/bar/dist/browser.js', '');
    const result = await resolver.resolve('bar', '');
    expect(result.path).toBe('node_modules/bar/dist/browser.js');
  });

  it('resolves node_modules index.js fallback', async () => {
    await vfs.writeText('node_modules/lodash/index.js', '');
    const result = await resolver.resolve('lodash', 'src');
    expect(result.path).toBe('node_modules/lodash/index.js');
  });

  it('BUILTIN_MODULE_NAMES is exported', () => {
    expect(BUILTIN_MODULE_NAMES).toContain('fs');
    expect(BUILTIN_MODULE_NAMES).toContain('path');
    expect(BUILTIN_MODULE_NAMES).toContain('crypto');
  });
});

// ── browser field object remapping ──────────────────────────────

describe('createResolver browser field object remapping', () => {
  let vfs;
  let resolver;

  beforeEach(async () => {
    vfs = new MemoryVfs();
    resolver = createResolver({ vfs, builtinModules: {} });
  });

  it('remaps main entry via browser object', async () => {
    await vfs.writeText('node_modules/pkg/package.json', JSON.stringify({
      main: 'lib/node.js',
      browser: { './lib/node.js': './lib/browser.js' },
    }));
    await vfs.writeText('node_modules/pkg/lib/browser.js', '');
    const result = await resolver.resolve('pkg', '');
    expect(result.path).toBe('node_modules/pkg/lib/browser.js');
  });

  it('falls through to main when browser object has no match', async () => {
    await vfs.writeText('node_modules/pkg/package.json', JSON.stringify({
      main: 'lib/index.js',
      browser: { './other.js': './browser-other.js' },
    }));
    await vfs.writeText('node_modules/pkg/lib/index.js', '');
    const result = await resolver.resolve('pkg', '');
    expect(result.path).toBe('node_modules/pkg/lib/index.js');
  });

  it('browser string field still works', async () => {
    await vfs.writeText('node_modules/pkg/package.json', JSON.stringify({
      browser: 'dist/browser.js',
    }));
    await vfs.writeText('node_modules/pkg/dist/browser.js', '');
    const result = await resolver.resolve('pkg', '');
    expect(result.path).toBe('node_modules/pkg/dist/browser.js');
  });
});

// ── cache management API ────────────────────────────────────────

describe('ModuleResolver cache management', () => {
  let vfs;
  /** @type {ModuleResolver} */
  let resolver;

  beforeEach(async () => {
    vfs = new MemoryVfs();
    resolver = createResolver({ vfs, builtinModules: {} });
  });

  async function writePkg(name) {
    await vfs.writeText(`node_modules/${name}/package.json`, JSON.stringify({ main: 'index.js' }));
    await vfs.writeText(`node_modules/${name}/index.js`, '');
  }

  it('returns ModuleResolver instance for backward compatibility', () => {
    expect(resolver).toBeInstanceOf(ModuleResolver);
    expect(typeof resolver.resolve).toBe('function');
  });

  it('tracks cache hit/miss stats through resolve()', async () => {
    await writePkg('alpha');

    await resolver.resolve('alpha', '');
    await resolver.resolve('alpha', '');

    const stats = resolver.cacheStats();
    expect(stats.size).toBe(1);
    expect(stats.hitRate).toBeGreaterThan(0);
    expect(stats.missRate).toBeGreaterThan(0);
  });

  it('clearCache() clears cache entries and stats counters', async () => {
    await writePkg('alpha');
    await resolver.resolve('alpha', '');

    expect(resolver.cacheStats().size).toBe(1);
    resolver.clearCache();

    const stats = resolver.cacheStats();
    expect(stats).toEqual({ size: 0, hitRate: 0, missRate: 0 });
  });

  it('pruneCache({ pattern }) removes matched cache keys', async () => {
    await writePkg('alpha');
    await writePkg('beta');
    await resolver.resolve('alpha', '');
    await resolver.resolve('beta', '');

    resolver.pruneCache({ pattern: /node_modules\/alpha\/package\.json$/ });

    expect(resolver.cacheStats().size).toBe(1);
    expect(resolver._pkgJsonCache.has('node_modules/alpha/package.json')).toBe(false);
    expect(resolver._pkgJsonCache.has('node_modules/beta/package.json')).toBe(true);
  });

  it('pruneCache({ maxSize }) evicts by LRU order', async () => {
    await writePkg('alpha');
    await writePkg('beta');
    await writePkg('gamma');
    await resolver.resolve('alpha', '');
    await resolver.resolve('beta', '');
    await resolver.resolve('gamma', '');

    await resolver.resolve('alpha', '');

    resolver.pruneCache({ maxSize: 2 });

    expect(resolver.cacheStats().size).toBe(2);
    expect(resolver._pkgJsonCache.has('node_modules/alpha/package.json')).toBe(true);
    expect(resolver._pkgJsonCache.has('node_modules/gamma/package.json')).toBe(true);
    expect(resolver._pkgJsonCache.has('node_modules/beta/package.json')).toBe(false);
  });
});
