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
import wsShim from './ws.js';
import esbuildShim from './esbuild.js';
import dnsShim from './dns.js';
import readlineShim from './readline.js';
import tlsShim from './tls.js';
import ttyShim from './tty.js';
import vmShim from './vm.js';
import workerThreadsShim from './worker_threads.js';
import http2Shim from './http2.js';
import perfHooksShim from './perf_hooks.js';
import v8Shim from './v8.js';
import inspectorShim from './inspector.js';
import dgramShim from './dgram.js';
import domainShim from './domain.js';
import clusterShim from './cluster.js';
import asyncHooksShim from './async_hooks.js';
import diagnosticsChannelShim from './diagnostics_channel.js';
import punycodeShim from './punycode.js';
import stringDecoderShim from './string_decoder.js';
import timersShim from './timers.js';

// Stub modules — minimal objects that don't throw on require
const noop = () => {};
const noopStub = new Proxy({}, { get: () => noop });

const STUB_MODULES = {
  assert: assertShim,
  console: globalThis.console,
  constants: {},
  crypto: cryptoShim,
  dns: dnsShim,
  module: moduleShim,
  net: netShim,
  process: createProcess(),
  readline: readlineShim,
  repl: noopStub,
  sys: utilShim,
  tls: tlsShim,
  tty: ttyShim,
  vm: vmShim,
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
    punycode: punycodeShim,
    string_decoder: stringDecoderShim,
    timers: timersShim,
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
export const BUILTIN_MODULE_NAMES = Object.keys({ ...STUB_MODULES, path: 1, events: 1, buffer: 1, stream: 1, url: 1, querystring: 1, util: 1, os: 1, zlib: 1, fs: 1, child_process: 1, http: 1, https: 1, chokidar: 1, ws: 1, esbuild: 1, dns: 1, readline: 1, tls: 1, tty: 1, vm: 1 });

export default { createBuiltinModules, BUILTIN_MODULE_NAMES };
