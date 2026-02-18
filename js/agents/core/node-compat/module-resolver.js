/**
 * @file Module path resolver for CommonJS require in VFS sandbox.
 * Supports package.json `exports` field (Node.js conditional exports).
 */

import { normalizeVfsPath } from '../../vfs/path.js';
import { createLogger } from '../../shared/utils/logger.js';

const logger = createLogger('node-compat/module-resolver');

/** Node.js built-in module names. */
export const BUILTIN_MODULE_NAMES = [
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2',
  'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
  'sys', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
];

const BUILTIN_SET = new Set(BUILTIN_MODULE_NAMES);
const EXTENSIONS = ['.js', '.json', '.mjs'];
const INDEX_FILES = ['index.js', 'index.json'];

/**
 * Condition priority for package.json exports field resolution.
 * Browser-first: prefer browser/module/import over require.
 */
const EXPORT_CONDITIONS = ['browser', 'module', 'import', 'require', 'default'];

/**
 * Resolve a package.json exports entry to a file path by evaluating conditions.
 * Handles string, object (conditional), and nested structures.
 *
 * @param {string|Record<string, any>|null|undefined} entry
 * @returns {string|undefined}
 */
export function resolveExportConditions(entry) {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const result = resolveExportConditions(item);
      if (result) return result;
    }
    return undefined;
  }
  if (typeof entry === 'object' && entry !== null) {
    for (const condition of EXPORT_CONDITIONS) {
      if (condition in entry) {
        const result = resolveExportConditions(entry[condition]);
        if (result) return result;
      }
    }
  }
  return undefined;
}

/**
 * Resolve package.json exports field for a given subpath.
 * Implements Node.js package exports resolution algorithm.
 *
 * @param {Record<string, any>} exports - The exports field from package.json
 * @param {string} subpath - The subpath to resolve (e.g., '.' or './server')
 * @returns {string|undefined} Resolved relative path or undefined
 */
export function resolvePackageExports(exports, subpath) {
  if (!exports) return undefined;

  // Exports is a string -> only matches '.'
  if (typeof exports === 'string') {
    return subpath === '.' ? exports : undefined;
  }

  // Exports is an array -> only matches '.'
  if (Array.isArray(exports)) {
    return subpath === '.' ? resolveExportConditions(exports) : undefined;
  }

  // Exports is an object
  if (typeof exports === 'object' && exports !== null) {
    // Check if any key starts with '.' (path-mapped exports)
    const keys = Object.keys(exports);
    const isPathMap = keys.some((key) => typeof key === 'string' && key.startsWith('.'));

    if (isPathMap) {
      // Direct match
      if (exports[subpath] !== undefined) {
        return resolveExportConditions(exports[subpath]);
      }

      // Pattern match: "./utils/*" -> "./dist/utils/*.js"
      for (const pattern of keys) {
        if (pattern.includes('*')) {
          const prefix = pattern.slice(0, pattern.indexOf('*'));
          const suffix = pattern.slice(pattern.indexOf('*') + 1);
          if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
            const match = suffix
              ? subpath.slice(prefix.length, -suffix.length)
              : subpath.slice(prefix.length);
            const target = resolveExportConditions(exports[pattern]);
            if (target && target.includes('*')) {
              return target.replace('*', match);
            }
            return target;
          }
        }
      }

      return undefined;
    }

    // Not a path map -> conditional exports for '.'
    if (subpath === '.') {
      return resolveExportConditions(exports);
    }
  }

  return undefined;
}

/**
 * Read and cache a package.json file from VFS.
 * @param {string} normPkg - Normalized VFS path to package.json
 * @param {object} vfs
 * @param {Map<string, object|null>} [pkgCache]
 * @param {{ hits: number, misses: number }} [cacheMetrics]
 * @returns {Promise<object|null>}
 */
async function readPkgJson(normPkg, vfs, pkgCache, cacheMetrics) {
  if (pkgCache && pkgCache.has(normPkg)) {
    const cached = pkgCache.get(normPkg);
    pkgCache.delete(normPkg);
    pkgCache.set(normPkg, cached);
    if (cacheMetrics) cacheMetrics.hits += 1;
    return cached;
  }
  if (cacheMetrics) cacheMetrics.misses += 1;
  try {
    const pkg = JSON.parse(await vfs.readText(normPkg));
    if (pkgCache) pkgCache.set(normPkg, pkg);
    return pkg;
  } catch {
    if (pkgCache) pkgCache.set(normPkg, null);
    return null;
  }
}

/**
 * Try to resolve a single file path against VFS, probing extensions.
 * @param {string} basePath
 * @param {object} vfs
 * @param {Map<string, object|null>} [pkgCache]
 * @param {{ hits: number, misses: number }} [cacheMetrics]
 * @returns {Promise<string|null>}
 */
async function resolveFile(basePath, vfs, pkgCache, cacheMetrics) {
  const norm = normalizeVfsPath(basePath);
  if (await vfs.exists(norm)) {
    const s = await vfs.stat(norm);
    if (s.isFile()) return norm;
    if (s.isDirectory()) return resolveDirectory(norm, vfs, pkgCache, cacheMetrics);
  }
  for (const ext of EXTENSIONS) {
    const p = normalizeVfsPath(basePath + ext);
    if (await vfs.exists(p)) return p;
  }
  return resolveDirectory(norm, vfs, pkgCache, cacheMetrics);
}

/**
 * Resolve a directory to its main entry.
 * Checks exports field first, then browser/main, then index files.
 * @param {string} dirPath
 * @param {object} vfs
 * @param {Map<string, object|null>} [pkgCache]
 * @param {{ hits: number, misses: number }} [cacheMetrics]
 * @returns {Promise<string|null>}
 */
async function resolveDirectory(dirPath, vfs, pkgCache, cacheMetrics) {
  const pkgPath = dirPath ? dirPath + '/package.json' : 'package.json';
  const normPkg = normalizeVfsPath(pkgPath);
  if (await vfs.exists(normPkg)) {
    const pkg = await readPkgJson(normPkg, vfs, pkgCache, cacheMetrics);
    if (pkg) {
      try {
        // 1. Try exports['.'] first
        if (pkg.exports) {
          const exportPath = resolvePackageExports(pkg.exports, '.');
          if (exportPath) {
            const entryBase = dirPath
              ? dirPath + '/' + exportPath.replace(/^\.[/\\]/, '')
              : exportPath.replace(/^\.[/\\]/, '');
            const resolved = await resolveFile(entryBase, vfs, pkgCache, cacheMetrics);
            if (resolved) return resolved;
          }
        }

        // 2. Handle browser field object remapping
        if (typeof pkg.browser === 'object' && pkg.browser !== null) {
          const main = pkg.main || 'index.js';
          const mainKey = './' + main;
          const remapped = pkg.browser[mainKey] || pkg.browser[main];
          const entry = remapped !== undefined ? (remapped || 'index.js') : main;
          const entryBase = dirPath ? dirPath + '/' + entry : entry;
          return resolveFile(entryBase, vfs, pkgCache, cacheMetrics);
        }

        // 3. Fall back to browser (string) / main
        const main = pkg.browser || pkg.main || 'index.js';
        const entryBase = dirPath ? dirPath + '/' + main : main;
        return resolveFile(entryBase, vfs, pkgCache, cacheMetrics);
      } catch (err) {
        logger.debug('Failed to resolve directory entry', { dirPath, error: err.message });
      }
    }
  }
  for (const idx of INDEX_FILES) {
    const p = normalizeVfsPath(dirPath ? dirPath + '/' + idx : idx);
    if (await vfs.exists(p)) return p;
  }
  return null;
}

/**
 * Parse a bare specifier into package name and subpath.
 * Handles scoped packages: "@scope/pkg/sub" -> { name: "@scope/pkg", subpath: "sub" }
 * @param {string} specifier
 * @returns {{ name: string, subpath: string }}
 */
function parsePackageSpecifier(specifier) {
  const parts = specifier.split('/');
  if (parts[0].startsWith('@') && parts.length > 1) {
    return {
      name: parts[0] + '/' + parts[1],
      subpath: parts.slice(2).join('/'),
    };
  }
  return {
    name: parts[0],
    subpath: parts.slice(1).join('/'),
  };
}

/**
 * Walk up from fromDir looking for node_modules/name.
 * Supports package.json exports field for subpath resolution.
 * @param {string} specifier - Full specifier (may include subpath)
 * @param {string} fromDir
 * @param {object} vfs
 * @param {Map<string, object|null>} [pkgCache]
 * @param {{ hits: number, misses: number }} [cacheMetrics]
 * @returns {Promise<string|null>}
 */
async function resolveNodeModules(specifier, fromDir, vfs, pkgCache, cacheMetrics) {
  const { name, subpath } = parsePackageSpecifier(specifier);

  let dir = fromDir;
  while (true) {
    const pkgDir = dir ? dir + '/node_modules/' + name : 'node_modules/' + name;

    // Try to read package.json for exports field
    const pkgPath = pkgDir + '/package.json';
    const normPkg = normalizeVfsPath(pkgPath);
    if (await vfs.exists(normPkg)) {
      const pkg = await readPkgJson(normPkg, vfs, pkgCache, cacheMetrics);
      if (pkg) {
        try {
          // If there's a subpath and exports field exists, resolve via exports
          if (subpath && pkg.exports) {
            const exportPath = resolvePackageExports(pkg.exports, './' + subpath);
            if (exportPath) {
              const fullPath = pkgDir + '/' + exportPath.replace(/^\.[/\\]/, '');
              const resolved = await resolveFile(fullPath, vfs, pkgCache, cacheMetrics);
              if (resolved) return resolved;
            }

            // Package explicitly declares exports but subpath is not exported.
            // Do NOT bypass exports by direct file resolution.
            return null;
          }

          // If there's a subpath but no exports match, try direct file resolution
          if (subpath) {
            const directPath = pkgDir + '/' + subpath;
            const resolved = await resolveFile(directPath, vfs, pkgCache, cacheMetrics);
            if (resolved) return resolved;
          }

          // No subpath -> resolve main entry
          if (!subpath) {
            const resolved = await resolveFile(pkgDir, vfs, pkgCache, cacheMetrics);
            if (resolved) return resolved;
          }
        } catch { /* ignore parse errors, fall through */ }
      }
    }

    // Fallback: no package.json or parse error
    const modPath = subpath ? pkgDir + '/' + subpath : pkgDir;
    const resolved = await resolveFile(modPath, vfs, pkgCache, cacheMetrics);
    if (resolved) return resolved;

    if (!dir) break;
    const slash = dir.lastIndexOf('/');
    dir = slash > 0 ? dir.slice(0, slash) : '';
  }
  return null;
}

/**
 * @typedef {object} ResolverConfig
 * @property {object} vfs - VFS instance
 * @property {Record<string, object>} builtinModules - Built-in module map
 */

/**
 * @typedef {object} ResolveResult
 * @property {'builtin'|'file'|'json'} type
 * @property {string} path
 * @property {object} [module]
 */

/**
 * @typedef {object} CachePruneOptions
 * @property {number} [maxSize] - Maximum number of cache entries to keep.
 * @property {RegExp} [pattern] - Pattern matching cache keys to remove.
 */

/**
 * @typedef {object} CacheStats
 * @property {number} size
 * @property {number} hitRate
 * @property {number} missRate
 */

/**
 * Module resolver with package.json cache support.
 */
export class ModuleResolver {
  /**
   * @param {ResolverConfig} config
   */
  constructor(config) {
    const { vfs, builtinModules = {} } = config;

    /** @type {object} */
    this.vfs = vfs;
    /** @type {Record<string, object>} */
    this.builtinModules = builtinModules;
    /** @type {Map<string, object|null>} */
    this._pkgJsonCache = new Map();
    /** @type {number} */
    this._cacheHits = 0;
    /** @type {number} */
    this._cacheMisses = 0;

    this.resolve = this.resolve.bind(this);
    this.clearCache = this.clearCache.bind(this);
    this.pruneCache = this.pruneCache.bind(this);
    this.cacheStats = this.cacheStats.bind(this);
  }

  /**
   * Find package.json by walking up from fromDir.
   * @param {string} fromDir
   * @returns {Promise<string|null>}
   */
  async _findPackageJson(fromDir) {
    let dir = fromDir;
    while (true) {
      const pkgPath = normalizeVfsPath(dir ? dir + '/package.json' : 'package.json');
      if (await this.vfs.exists(pkgPath)) return pkgPath;
      if (!dir) break;
      const slash = dir.lastIndexOf('/');
      dir = slash > 0 ? dir.slice(0, slash) : '';
    }
    return null;
  }

  /**
   * Resolve package-internal imports (#foo).
   * @param {string} specifier
   * @param {Record<string, any>} imports
   * @returns {string|undefined}
   */
  _resolvePackageImports(specifier, imports) {
    if (!imports || typeof imports !== 'object') return undefined;

    // Direct match
    if (imports[specifier] !== undefined) {
      return resolveExportConditions(imports[specifier]);
    }

    // Pattern match with *
    for (const pattern of Object.keys(imports)) {
      if (pattern.includes('*')) {
        const prefix = pattern.slice(0, pattern.indexOf('*'));
        const suffix = pattern.slice(pattern.indexOf('*') + 1);
        if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
          const match = suffix
            ? specifier.slice(prefix.length, -suffix.length)
            : specifier.slice(prefix.length);
          const target = resolveExportConditions(imports[pattern]);
          if (target && target.includes('*')) {
            return target.replace('*', match);
          }
          return target;
        }
      }
    }

    return undefined;
  }

  /**
   * Clear all internal caches and counters.
   * @returns {void}
   */
  clearCache() {
    this._pkgJsonCache.clear();
    this._cacheHits = 0;
    this._cacheMisses = 0;
  }

  /**
   * Prune cache entries by conditions.
   * @param {CachePruneOptions} [options={}]
   * @returns {void}
   */
  pruneCache(options = {}) {
    const { maxSize, pattern } = options;

    if (pattern instanceof RegExp) {
      for (const key of this._pkgJsonCache.keys()) {
        pattern.lastIndex = 0;
        if (pattern.test(key)) {
          this._pkgJsonCache.delete(key);
        }
      }
    }

    if (typeof maxSize === 'number' && Number.isFinite(maxSize)) {
      const targetSize = Math.max(0, Math.floor(maxSize));
      while (this._pkgJsonCache.size > targetSize) {
        const oldestKey = this._pkgJsonCache.keys().next().value;
        if (oldestKey === undefined) break;
        this._pkgJsonCache.delete(oldestKey);
      }
    }
  }

  /**
   * Return cache statistics.
   * @returns {CacheStats}
   */
  cacheStats() {
    const total = this._cacheHits + this._cacheMisses;
    return {
      size: this._pkgJsonCache.size,
      hitRate: total > 0 ? this._cacheHits / total : 0,
      missRate: total > 0 ? this._cacheMisses / total : 0,
    };
  }

  /**
   * @param {string} specifier
   * @param {string} [fromDir='']
   * @returns {Promise<ResolveResult|null>}
   */
  async resolve(specifier, fromDir = '') {
    /** @type {{ hits: number, misses: number }} */
    const cacheMetrics = { hits: 0, misses: 0 };
    try {
      // 1. node: prefix
      if (specifier.startsWith('node:')) {
        const name = specifier.slice(5);
        if (this.builtinModules[name]) {
          return { type: 'builtin', path: specifier, module: this.builtinModules[name] };
        }
        return null;
      }

      // 2. bare builtin name
      if (BUILTIN_SET.has(specifier) && this.builtinModules[specifier]) {
        return { type: 'builtin', path: specifier, module: this.builtinModules[specifier] };
      }

      // 3. package-internal imports (#foo)
      if (specifier.startsWith('#')) {
        const pkgPath = await this._findPackageJson(fromDir);
        if (pkgPath) {
          const pkg = await readPkgJson(pkgPath, this.vfs, this._pkgJsonCache, cacheMetrics);
          if (pkg && pkg.imports) {
            const resolved = this._resolvePackageImports(specifier, pkg.imports);
            if (resolved) {
              const pkgDir = pkgPath.slice(0, pkgPath.lastIndexOf('/'));
              const fullPath = pkgDir + '/' + resolved.replace(/^\.[/\\]/, '');
              const finalPath = await resolveFile(fullPath, this.vfs, this._pkgJsonCache, cacheMetrics);
              if (finalPath) {
                const type = finalPath.endsWith('.json') ? 'json' : 'file';
                return { type, path: finalPath };
              }
            }
          }
        }
        return null;
      }

      // 4. relative or absolute path
      if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
        let base;
        if (specifier.startsWith('/')) {
          base = specifier.slice(1);
        } else if (specifier.startsWith('../')) {
          const parts = fromDir ? fromDir.split('/') : [];
          let spec = specifier;
          while (spec.startsWith('../')) {
            parts.pop();
            spec = spec.slice(3);
          }
          base = parts.length > 0 ? parts.join('/') + '/' + spec : spec;
        } else {
          const rel = specifier.slice(2);
          base = fromDir ? fromDir + '/' + rel : rel;
        }
        const resolved = await resolveFile(base, this.vfs, this._pkgJsonCache, cacheMetrics);
        if (!resolved) return null;
        const type = resolved.endsWith('.json') ? 'json' : 'file';
        return { type, path: resolved };
      }

      // 5. bare module -> node_modules lookup
      const resolved = await resolveNodeModules(
        specifier,
        fromDir,
        this.vfs,
        this._pkgJsonCache,
        cacheMetrics
      );
      if (!resolved) return null;
      const type = resolved.endsWith('.json') ? 'json' : 'file';
      return { type, path: resolved };
    } finally {
      this._cacheHits += cacheMetrics.hits;
      this._cacheMisses += cacheMetrics.misses;
    }
  }
}

/**
 * Create a module resolver.
 * @param {ResolverConfig} config
 * @returns {ModuleResolver}
 */
export function createResolver(config) {
  return new ModuleResolver(config);
}
