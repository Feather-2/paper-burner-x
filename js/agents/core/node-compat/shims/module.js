/**
 * Node.js module shim
 * Provides basic module system functionality.
 */

import pathShim from './path.js';
import urlShim from './url.js';
import querystringShim from './querystring.js';
import utilShim from './util.js';
import osShim from './os.js';
import cryptoShim from './crypto.js';
import streamShim from './stream.js';
import assertShim from './assert.js';
import { EventEmitter } from './events.js';
import { Buffer } from './buffer.js';

/**
 * @typedef {(id: string) => unknown} RequireFunction
 */

/**
 * @typedef {{ readonly unsupported: true, readonly moduleName: string }} UnsupportedBuiltinModule
 */

function makeModuleNotFound(id, filename) {
  const err = new Error(`Cannot find module '${id}' from '${filename}'`);
  err.code = 'MODULE_NOT_FOUND';
  err.path = filename;
  return err;
}

/**
 * @param {string} moduleName
 * @returns {UnsupportedBuiltinModule}
 */
function createUnsupportedBuiltin(moduleName) {
  return Object.freeze({ unsupported: true, moduleName });
}

/** @type {Record<string, unknown>} */
const BUILTIN_REQUIRE_FALLBACKS = Object.freeze({
  assert: assertShim,
  buffer: { Buffer },
  crypto: cryptoShim,
  events: { EventEmitter, default: EventEmitter },
  module: null, // replaced below
  os: osShim,
  path: pathShim,
  querystring: querystringShim,
  stream: streamShim,
  url: urlShim,
  util: utilShim,
});

/**
 * Resolve builtin module fallback for createRequire().
 * @param {string} name
 * @returns {unknown}
 */
function resolveBuiltinFallback(name) {
  if (Object.prototype.hasOwnProperty.call(BUILTIN_REQUIRE_FALLBACKS, name)) {
    return BUILTIN_REQUIRE_FALLBACKS[name];
  }
  // Expose explicit marker instead of throwing for unsupported builtins.
  return createUnsupportedBuiltin(name);
}

/**
 * Create a require function for a given filename.
 * Supports basic builtin fallback for browser/node-compat scenarios.
 * @param {string} filename - The filename to create require for
 * @returns {RequireFunction} A require function
 */
export function createRequire(filename) {
  const from = typeof filename === 'string' && filename ? filename : '<anonymous>';
  return function require(id) {
    const request = typeof id === 'string' ? id : String(id ?? '');
    const bare = request.startsWith('node:') ? request.slice(5) : request;
    if (isBuiltin(bare)) {
      if (bare === 'module') return Module;
      return resolveBuiltinFallback(bare);
    }
    throw makeModuleNotFound(request, from);
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
