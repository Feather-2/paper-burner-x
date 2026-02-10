/**
 * @file Module path resolver for CommonJS require in VFS sandbox.
 */

import { normalizeVfsPath } from '../../vfs/path.js';

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
 * Try to resolve a single file path against VFS, probing extensions.
 * @param {string} basePath
 * @param {object} vfs
 * @returns {Promise<string|null>}
 */
async function resolveFile(basePath, vfs) {
  const norm = normalizeVfsPath(basePath);
  if (await vfs.exists(norm)) {
    const s = await vfs.stat(norm);
    if (s.isFile()) return norm;
    if (s.isDirectory()) return resolveDirectory(norm, vfs);
  }
  for (const ext of EXTENSIONS) {
    const p = normalizeVfsPath(basePath + ext);
    if (await vfs.exists(p)) return p;
  }
  return resolveDirectory(norm, vfs);
}

/**
 * Resolve a directory to its main entry.
 * @param {string} dirPath
 * @param {object} vfs
 * @returns {Promise<string|null>}
 */
async function resolveDirectory(dirPath, vfs) {
  const pkgPath = dirPath ? dirPath + '/package.json' : 'package.json';
  const normPkg = normalizeVfsPath(pkgPath);
  if (await vfs.exists(normPkg)) {
    try {
      const pkg = JSON.parse(await vfs.readText(normPkg));
      const main = pkg.browser || pkg.main || 'index.js';
      const entryBase = dirPath ? dirPath + '/' + main : main;
      return resolveFile(entryBase, vfs);
    } catch { /* ignore parse errors */ }
  }
  for (const idx of INDEX_FILES) {
    const p = normalizeVfsPath(dirPath ? dirPath + '/' + idx : idx);
    if (await vfs.exists(p)) return p;
  }
  return null;
}

/**
 * Walk up from fromDir looking for node_modules/name.
 * @param {string} name
 * @param {string} fromDir
 * @param {object} vfs
 * @returns {Promise<string|null>}
 */
async function resolveNodeModules(name, fromDir, vfs) {
  let dir = fromDir;
  while (true) {
    const modPath = dir ? dir + '/node_modules/' + name : 'node_modules/' + name;
    const resolved = await resolveFile(modPath, vfs);
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
 * Create a module resolver.
 * @param {ResolverConfig} config
 * @returns {{ resolve: (specifier: string, fromDir?: string) => Promise<ResolveResult|null> }}
 */
export function createResolver(config) {
  const { vfs, builtinModules = {} } = config;

  /**
   * @param {string} specifier
   * @param {string} [fromDir='']
   * @returns {Promise<ResolveResult|null>}
   */
  async function resolve(specifier, fromDir = '') {
    // 1. node: prefix
    if (specifier.startsWith('node:')) {
      const name = specifier.slice(5);
      if (builtinModules[name]) {
        return { type: 'builtin', path: specifier, module: builtinModules[name] };
      }
      return null;
    }

    // 2. bare builtin name
    if (BUILTIN_SET.has(specifier) && builtinModules[specifier]) {
      return { type: 'builtin', path: specifier, module: builtinModules[specifier] };
    }

    // 3. relative or absolute path
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
      const resolved = await resolveFile(base, vfs);
      if (!resolved) return null;
      const type = resolved.endsWith('.json') ? 'json' : 'file';
      return { type, path: resolved };
    }

    // 4. bare module -> node_modules lookup
    const resolved = await resolveNodeModules(specifier, fromDir, vfs);
    if (!resolved) return null;
    const type = resolved.endsWith('.json') ? 'json' : 'file';
    return { type, path: resolved };
  }

  return { resolve };
}
