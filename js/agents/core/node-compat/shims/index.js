/**
 * @file Node.js builtin module registry.
 * Each module is lazily imported on first access.
 */

import pathShim from './path.js';
import { EventEmitter } from './events.js';
import { Buffer } from './buffer.js';
import streamShim from './stream.js';
import urlShim from './url.js';
import qsShim from './querystring.js';
import utilShim from './util.js';
import osShim from './os.js';
import { createFsShim } from './fs.js';
import { createChildProcessShim } from './child-process.js';
import zlibShim from './zlib.js';
import netShim from './net.js';
import { createHttpShim, IncomingMessage, ServerResponse, METHODS, STATUS_CODES } from './http.js';
import cryptoShim from './crypto.js';
import { createProcess } from './process.js';
import assertShim from './assert.js';
import moduleShim from './module.js';
import chokidarShim from './chokidar.js';
import httpsShim from './https.js';

// Stub modules — minimal objects that don't throw on require
const noop = () => {};
const noopStub = new Proxy({}, { get: () => noop });

const STUB_MODULES = {
  assert: assertShim,
  console: globalThis.console,
  constants: {},
  crypto: cryptoShim,
  dgram: noopStub,
  dns: { resolve: noop, lookup: (hostname, cb) => cb?.(null, '127.0.0.1', 4) },
  domain: { create: () => ({ run: (fn) => fn(), on: noop }) },
  http2: noopStub,
  inspector: noopStub,
  module: moduleShim,
  net: netShim,
  perf_hooks: { performance: globalThis.performance || { now: () => Date.now() }, PerformanceObserver: class { observe() {} disconnect() {} } },
  process: createProcess(),
  punycode: { encode: (s) => s, decode: (s) => s, toASCII: (s) => s, toUnicode: (s) => s },
  readline: { createInterface: () => ({ on: noop, close: noop, question: (q, cb) => cb?.('') }) },
  repl: noopStub,
  string_decoder: { StringDecoder: class { write(buf) { return new TextDecoder().decode(buf); } end() { return ''; } } },
  sys: utilShim,
  timers: { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, setImmediate: (fn, ...args) => setTimeout(fn, 0, ...args), clearImmediate: clearTimeout },
  tls: noopStub,
  tty: { isatty: () => false, ReadStream: class {}, WriteStream: class {} },
  v8: noopStub,
  vm: { runInNewContext: (code) => (0, eval)(code), createContext: () => ({}), Script: class { constructor(code) { this._code = code; } runInThisContext() { return (0, eval)(this._code); } } },
  worker_threads: { isMainThread: true, parentPort: null, Worker: class {}, workerData: null },
  async_hooks: { AsyncLocalStorage: class { getStore() { return undefined; } run(store, fn, ...args) { return fn(...args); } enterWith() {} disable() {} }, createHook: () => ({ enable: noop, disable: noop }) },
  diagnostics_channel: { channel: () => ({ subscribe: noop, unsubscribe: noop, publish: noop }), subscribe: noop, unsubscribe: noop },
  cluster: { isMaster: true, isPrimary: true, isWorker: false, fork: noop, on: noop },
};

/**
 * 创建完整的内置模块注册表。
 * @param {object} [config]
 * @param {object} [config.vfs] - VFS 实例（fs/child_process 需要）
 * @param {Function} [config.evaluate] - 代码执行器（child_process 需要）
 * @param {Record<string, string>} [config.env] - 环境变量
 * @param {string} [config.cwd] - 工作目录
 * @returns {Record<string, object>}
 */
export function createBuiltinModules(config = {}) {
  const { vfs, evaluate, env = {}, cwd = '', networkPolicy, violationStore } = config;

  // Build http shim instance with network policy
  const httpShimOptions = {};
  if (networkPolicy || violationStore) {
    const policy = { ...networkPolicy };
    if (violationStore && !policy.onViolation) {
      policy.onViolation = (info) => violationStore.add({
        type: info.type || 'network',
        detail: `Blocked ${info.method || 'request'} to ${info.url}`,
        meta: info,
      });
    }
    httpShimOptions.networkPolicy = policy;
  }
  const httpInstance = createHttpShim(httpShimOptions);

  const modules = {
    path: pathShim,
    events: { EventEmitter, default: EventEmitter },
    buffer: { Buffer },
    stream: streamShim,
    url: urlShim,
    querystring: qsShim,
    util: utilShim,
    os: osShim,
    zlib: zlibShim,
    ...STUB_MODULES,
    http: httpInstance,
    https: httpsShim,
    chokidar: chokidarShim,
  };

  // 动态模块（需要 VFS）
  if (vfs) {
    const fsOptions = {};
    if (config.protectedPaths) fsOptions.protectedPaths = config.protectedPaths;
    if (violationStore) {
      fsOptions.onViolation = (info) => violationStore.add({
        type: info.type || 'fs:write',
        detail: `Blocked ${info.op} on ${info.path}`,
        meta: info,
      });
    }
    modules.fs = createFsShim(vfs, fsOptions);
    modules.child_process = createChildProcessShim({ vfs, evaluate, env, cwd });
  }

  // process — use full shim with config
  modules.process = createProcess({ env, cwd: cwd || '/' });

  return modules;
}

/**
 * 所有已知内置模块名。
 */
export const BUILTIN_MODULE_NAMES = Object.keys({ ...STUB_MODULES, path: 1, events: 1, buffer: 1, stream: 1, url: 1, querystring: 1, util: 1, os: 1, zlib: 1, fs: 1, child_process: 1, http: 1, https: 1, chokidar: 1 });

export default { createBuiltinModules, BUILTIN_MODULE_NAMES };
