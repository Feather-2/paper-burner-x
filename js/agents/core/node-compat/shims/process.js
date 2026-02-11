/**
 * @file Node.js process shim for browser sandbox.
 * @module process
 */

import { EventEmitter } from './events.js';

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
 * @returns {object}
 */
export function createProcess(options = {}) {
  let cwd = options.cwd || '/';
  const env = options.env || {
    NODE_ENV: 'development',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: '/',
  };
  const emitter = new EventEmitter();
  const startTime = Date.now();

  const proc = {
    env,
    cwd: () => cwd,
    chdir(dir) {
      if (!dir.startsWith('/')) dir = cwd + '/' + dir;
      cwd = dir;
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
    exit(code = 0) {
      emitter.emit('exit', code);
      if (options.onExit) options.onExit(code);
      throw new Error(`Process exited with code ${code}`);
    },
    nextTick(fn, ...args) { queueMicrotask(() => fn(...args)); },
    stdout: createProcessStream(true, (data) => { console.log(data); return true; }),
    stderr: createProcessStream(true, (data) => { console.error(data); return true; }),
    stdin: createProcessStream(false),
    hrtime: Object.assign(
      function hrtime(time) {
        const now = performance.now();
        const s = Math.floor(now / 1000);
        const ns = Math.floor((now % 1000) * 1e6);
        if (time) return [s - time[0], ns - time[1]];
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
