/**
 * @file Node.js process shim for browser sandbox.
 * @module process
 */

import { EventEmitter } from './events.js';

/** @typedef {Error & { code?: string }} ProcessShimError */

/**
 * @param {boolean} isWritable
 * @param {Function} [writeImpl]
 */
function createProcessStream(isWritable, writeImpl) {
  const emitter = new EventEmitter();
  return {
    isTTY: false,
    on(e, fn) { emitter.on(e, fn); return this; },
    once(e, fn) { emitter.once(e, fn); return this; },
    off(e, fn) { emitter.off(e, fn); return this; },
    emit(e, ...args) { return emitter.emit(e, ...args); },
    removeAllListeners(e) { emitter.removeAllListeners(e); return this; },
    write: isWritable && writeImpl
      ? (data, enc, cb) => {
          writeImpl(typeof data === 'string' ? data : String(data));
          if (typeof cb === 'function') queueMicrotask(cb);
          return true;
        }
      : () => true,
    end(data, cb) { if (typeof cb === 'function') queueMicrotask(cb); },
    read() { return null; },
    setEncoding() { return this; },
    pause() { return this; },
    resume() { return this; },
  };
}

/**
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {Record<string, string>} [options.env]
 * @param {Function} [options.onExit]
 * @param {(path: string) => boolean} [options.pathExists]
 * @returns {object}
 */
export function createProcess(options = {}) {
  /**
   * @param {string} input
   * @param {string} base
   * @returns {string}
   */
  function normalizeCwd(input, base) {
    if (typeof input !== 'string') {
      throw new TypeError('The "directory" argument must be of type string.');
    }
    if (input.length === 0) {
      const e = /** @type {ProcessShimError} */ (new Error('ENOENT: no such file or directory, chdir'));
      e.code = 'ENOENT';
      throw e;
    }
    if (input.includes('\u0000')) {
      const e = /** @type {ProcessShimError} */ (new Error('EINVAL: path must not contain null bytes'));
      e.code = 'EINVAL';
      throw e;
    }

    const absolute = input.startsWith('/');
    const merged = absolute ? input : `${base}/${input}`;
    const out = [];
    for (const part of merged.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (out.length > 0) out.pop();
        continue;
      }
      out.push(part);
    }
    return '/' + out.join('/');
  }

  const pathExists = typeof options.pathExists === 'function' ? options.pathExists : null;
  let cwd = '/';
  try {
    cwd = normalizeCwd(options.cwd || '/', '/');
    if (pathExists && !pathExists(cwd)) {
      const e = /** @type {ProcessShimError} */ (new Error(`ENOENT: no such file or directory, chdir '${cwd}'`));
      e.code = 'ENOENT';
      throw e;
    }
  } catch {
    cwd = '/';
  }
  const env = options.env || {
    NODE_ENV: 'development',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: '/',
  };
  const emitter = new EventEmitter();
  const startTime = Date.now();
  const nextTickQueue = [];
  let drainingNextTick = false;

  const proc = {
    env,
    cwd: () => cwd,
    chdir(dir) {
      const next = normalizeCwd(dir, cwd);
      if (pathExists && !pathExists(next)) {
        const e = /** @type {ProcessShimError} */ (new Error(`ENOENT: no such file or directory, chdir '${next}'`));
        e.code = 'ENOENT';
        throw e;
      }
      cwd = next;
    },
    platform: 'linux',
    version: 'v20.0.0',
    versions: { node: '20.0.0', v8: '11.3.244.8', uv: '1.44.2' },
    argv: ['node', '/index.js'],
    argv0: 'node',
    execPath: '/usr/local/bin/node',
    execArgv: [],
    pid: 1,
    ppid: 0,
    exitCode: undefined,
    exit(code = 0) {
      const normalizedCode = Number.isFinite(Number(code)) ? Number(code) : 0;
      proc.exitCode = normalizedCode;
      emitter.emit('exit', normalizedCode);
      if (options.onExit) options.onExit(normalizedCode);
    },
    nextTick(fn, ...args) {
      if (typeof fn !== 'function') {
        throw new TypeError('process.nextTick callback must be a function');
      }
      // nextTick should run before microtasks (Promise.then)
      // Use a dedicated queue that drains before each event loop phase
      nextTickQueue.push({ fn, args });
      if (!drainingNextTick) {
        drainingNextTick = true;
        queueMicrotask(() => {
          while (nextTickQueue.length > 0) {
            const task = nextTickQueue.shift();
            try {
              task.fn(...task.args);
            } catch (err) {
              console.error('nextTick error:', err);
            }
          }
          drainingNextTick = false;
        });
      }
    },
    stdout: createProcessStream(true, (data) => { console.log(data); return true; }),
    stderr: createProcessStream(true, (data) => { console.error(data); return true; }),
    stdin: createProcessStream(false),
    hrtime: Object.assign(
      function hrtime(time) {
        const now = performance.now();
        const s = Math.floor(now / 1000);
        const ns = Math.floor((now % 1000) * 1e6);
        if (time) {
          let ds = s - time[0];
          let dn = ns - time[1];
          if (dn < 0) { ds -= 1; dn += 1e9; }
          return [ds, dn];
        }
        return [s, ns];
      },
      { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) }
    ),
    memoryUsage() {
      return {
        rss: 50 * 1024 * 1024,
        heapTotal: 30 * 1024 * 1024,
        heapUsed: 20 * 1024 * 1024,
        external: 1024 * 1024,
        arrayBuffers: 0,
      };
    },
    uptime() { return (Date.now() - startTime) / 1000; },
    cpuUsage() { return { user: 0, system: 0 }; },
    // EventEmitter delegation
    on(e, fn) { emitter.on(e, fn); return proc; },
    once(e, fn) { emitter.once(e, fn); return proc; },
    off(e, fn) { emitter.off(e, fn); return proc; },
    emit(e, ...args) { return emitter.emit(e, ...args); },
    addListener(e, fn) { emitter.addListener(e, fn); return proc; },
    removeListener(e, fn) { emitter.removeListener(e, fn); return proc; },
    removeAllListeners(e) { emitter.removeAllListeners(e); return proc; },
    listeners(e) { return emitter.listeners(e); },
    listenerCount(e) { return emitter.listenerCount(e); },
    eventNames() { return emitter.eventNames(); },
    setMaxListeners(n) { emitter.setMaxListeners(n); return proc; },
    getMaxListeners() { return emitter.getMaxListeners(); },
  };
  return proc;
}

export default createProcess();
