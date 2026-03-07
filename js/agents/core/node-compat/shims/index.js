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

// Stub modules — minimal objects that don't throw on require
const noop = () => {};
const noopStub = new Proxy({}, { get: () => noop });

/**
 * Best-effort optional shim loader to avoid one broken shim taking down all builtins.
 * @param {string} modulePath
 * @param {any} fallback
 * @returns {Promise<any>}
 */
async function loadOptionalDefault(modulePath, fallback = noopStub) {
  try {
    const mod = await import(modulePath);
    return mod?.default ?? mod;
  } catch {
    return fallback;
  }
}

const [
  chokidarShim,
  httpsShim,
  wsShim,
  esbuildShim,
  dnsShim,
  readlineShim,
  tlsShim,
  ttyShim,
  vmShim,
  workerThreadsShim,
  http2Shim,
  perfHooksShim,
  v8Shim,
  inspectorShim,
  dgramShim,
  domainShim,
  clusterShim,
  asyncHooksShim,
  diagnosticsChannelShim,
  stringDecoderShim,
  timersShim,
] = await Promise.all([
  loadOptionalDefault('./chokidar.js'),
  loadOptionalDefault('./https.js'),
  loadOptionalDefault('./ws.js'),
  loadOptionalDefault('./esbuild.js'),
  loadOptionalDefault('./dns.js'),
  loadOptionalDefault('./readline.js'),
  loadOptionalDefault('./tls.js'),
  loadOptionalDefault('./tty.js'),
  loadOptionalDefault('./vm.js'),
  loadOptionalDefault('./worker_threads.js'),
  loadOptionalDefault('./http2.js'),
  loadOptionalDefault('./perf_hooks.js'),
  loadOptionalDefault('./v8.js'),
  loadOptionalDefault('./inspector.js'),
  loadOptionalDefault('./dgram.js'),
  loadOptionalDefault('./domain.js'),
  loadOptionalDefault('./cluster.js'),
  loadOptionalDefault('./async_hooks.js'),
  loadOptionalDefault('./diagnostics_channel.js'),
  loadOptionalDefault('./string_decoder.js'),
  loadOptionalDefault('./timers.js'),
]);

const STUB_MODULES = {
  assert: assertShim,
  console: globalThis.console,
  constants: {},
  crypto: cryptoShim,
  dns: dnsShim,
  module: moduleShim,
  net: netShim,
  process: createProcess(),
  punycode: { encode: (s) => s, decode: (s) => s, toASCII: (s) => s, toUnicode: (s) => s },
  readline: readlineShim,
  repl: noopStub,
  sys: utilShim,
  tls: tlsShim,
  tty: ttyShim,
  vm: vmShim,
};

/**
 * 创建完整的内置模块注册表。
 * @param {{ vfs?: object, evaluate?: (code: string, filename: string) => Promise<any>, env?: Record<string, string>, cwd?: string, networkPolicy?: object, violationStore?: { add: (entry: { type: string, detail: string, meta: object }) => void }, protectedPaths?: string[] }} [config]
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

  /** @type {Record<string, object> & { fs?: object, child_process?: object }} */
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
    ws: wsShim,
    esbuild: esbuildShim,
    worker_threads: workerThreadsShim,
    http2: http2Shim,
    perf_hooks: perfHooksShim,
    v8: v8Shim,
    inspector: inspectorShim,
    dgram: dgramShim,
    domain: domainShim,
    cluster: clusterShim,
    async_hooks: asyncHooksShim,
    diagnostics_channel: diagnosticsChannelShim,
    string_decoder: stringDecoderShim,
    timers: timersShim,
  };

  // 动态模块（需要 VFS）
  if (vfs) {
    /** @type {{ protectedPaths?: string[], onViolation?: (info: { type?: string, op?: string, path?: string }) => void }} */
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
export const BUILTIN_MODULE_NAMES = Object.keys({ ...STUB_MODULES, path: 1, events: 1, buffer: 1, stream: 1, url: 1, querystring: 1, util: 1, os: 1, zlib: 1, fs: 1, child_process: 1, http: 1, https: 1, chokidar: 1, ws: 1, esbuild: 1, dns: 1, readline: 1, tls: 1, tty: 1, vm: 1 });

export default { createBuiltinModules, BUILTIN_MODULE_NAMES };
