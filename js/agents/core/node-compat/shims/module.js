/**
 * Node.js module shim
 * Provides basic module system functionality
 */

/**
 * @typedef {(id: string) => unknown} RequireFunction
 */

/**
 * Create a require function for a given filename
 * @param {string} filename - The filename to create require for
 * @returns {RequireFunction} A require function
 */
export function createRequire(filename) {
  return function require(id) {
    throw new Error(`Cannot find module '${id}' from '${filename}'`);
  };
}

export const builtinModules = [
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
];

/**
 * Check if a module name is a builtin module
 * @param {string} moduleName - The module name to check
 * @returns {boolean} True if the module is builtin
 */
export function isBuiltin(moduleName) {
  const name = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;
  return builtinModules.includes(name);
}

/** @type {Record<string, unknown>} */
export const _cache = {};

/** @type {Record<string, unknown>} */
export const _extensions = {
  '.js': () => {},
  '.json': () => {},
  '.node': () => {},
};

/** @type {Record<string, string>} */
export const _pathCache = {};

/**
 * Sync builtin ESM exports (no-op in browser)
 */
export function syncBuiltinESMExports() {
  // No-op in browser
}

export const Module = {
  createRequire,
  builtinModules,
  isBuiltin,
  _cache,
  _extensions,
  _pathCache,
  syncBuiltinESMExports,
};

export default Module;
