/**
 * @file CommonJS require factory bound to VFS.
 */

import { createResolver } from './module-resolver.js';

/**
 * @typedef {object} RequireConfig
 * @property {object} vfs
 * @property {Record<string, object>} [builtinModules={}]
 * @property {(code: string, filename: string) => *} [evaluate] - Code evaluation function
 * @property {number} [cacheLimit=2000]
 */

/**
 * Create a require function bound to VFS.
 * @param {RequireConfig} config
 * @returns {{ require: Function, cache: Map }}
 */
export function createRequire(config) {
  const { vfs, builtinModules = {}, evaluate, cacheLimit = 2000 } = config;
  const cache = new Map();
  const resolver = createResolver({ vfs, builtinModules });

  /**
   * @param {string} specifier
   * @param {string} [fromDir='']
   * @returns {Promise<*>}
   */
  async function require(specifier, fromDir = '') {
    // 1. Resolve path
    const resolved = await resolver.resolve(specifier, fromDir);
    if (!resolved) throw new Error(`Cannot find module '${specifier}' from '${fromDir}'`);

    // 2. Built-in module
    if (resolved.type === 'builtin') return resolved.module;

    // 3. Cache check
    if (cache.has(resolved.path)) return cache.get(resolved.path).exports;

    // 4. JSON file
    if (resolved.type === 'json') {
      const json = JSON.parse(await vfs.readText(resolved.path));
      cache.set(resolved.path, { exports: json });
      return json;
    }

    // 5. JS file
    const code = await vfs.readText(resolved.path);
    const module = { exports: {} };
    // Put in cache early to handle circular dependencies
    cache.set(resolved.path, module);

    // 6. Create child require
    const dirOfFile = resolved.path.includes('/')
      ? resolved.path.slice(0, resolved.path.lastIndexOf('/'))
      : '';
    const childRequire = (spec) => require(spec, dirOfFile);
    childRequire.resolve = (spec) => resolver.resolve(spec, dirOfFile);
    childRequire.cache = cache;

    // 7. Execute code
    if (evaluate) {
      const wrapper = `(function(exports, require, module, __filename, __dirname) { ${code} })`;
      const fn = await evaluate(wrapper, resolved.path);
      await fn(module.exports, childRequire, module, resolved.path, dirOfFile);
    }

    // 8. LRU eviction
    if (cache.size > cacheLimit) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }

    return module.exports;
  }

  require.resolve = (spec, fromDir) => resolver.resolve(spec, fromDir);
  require.cache = cache;

  return { require, cache };
}
