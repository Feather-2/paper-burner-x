/**
 * Three-level sandbox factory.
 *
 * Provides a unified `Sandbox` interface across WASM, Worker, iframe (stub),
 * and main-thread execution backends.  `level: 'auto'` probes in priority
 * order and falls back to the first available backend.
 *
 * @module create-sandbox
 */

import { validateConfig, AUTO_PRIORITY } from './sandbox-interface.js';
import { isWasmSupported } from './skill-executor-helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a raw execute/terminate pair into the unified Sandbox shape.
 *
 * @param {import('./sandbox-interface.js').SandboxLevel} level
 * @param {import('./sandbox-interface.js').SandboxConfig} cfg
 * @param {(code: string, filename?: string) => Promise<*>} executeFn
 * @param {() => Promise<void>|void} terminateFn
 * @returns {import('./sandbox-interface.js').Sandbox}
 */
function wrapAsSandbox(level, cfg, executeFn, terminateFn) {
  let terminated = false;

  /** @type {import('./sandbox-interface.js').Sandbox} */
  const sandbox = {
    level,

    async execute(code, filename) {
      if (terminated) throw new Error('Sandbox terminated');
      const start = Date.now();
      try {
        const value = await executeFn(code, filename);
        return { ok: true, value, durationMs: Date.now() - start };
      } catch (err) {
        return { ok: false, error: err.message, stack: err.stack, durationMs: Date.now() - start };
      }
    },

    async runFile(path) {
      if (!cfg.vfs) throw new Error('No VFS configured');
      const content = await cfg.vfs.readText(path);
      return sandbox.execute(content, path);
    },
    async terminate() {
      if (terminated) return;
      terminated = true;
      await terminateFn();
    },

    get terminated() { return terminated; },
  };

  return sandbox;
}

// ---------------------------------------------------------------------------
// Backend creators
// ---------------------------------------------------------------------------

/**
 * @param {import('./sandbox-interface.js').SandboxConfig} cfg
 * @returns {Promise<import('./sandbox-interface.js').Sandbox>}
 */
async function createWasmSandbox(cfg) {
  const supported = await isWasmSupported();
  if (!supported) throw new Error('WASM not supported');

  const { createSandbox: createWasm } = await import('./wasm-sandbox.js');
  const wasm = await createWasm({
    capabilities: cfg.capabilities,
    limits: cfg.timeout ? { timeoutMs: cfg.timeout } : undefined,
  });

  return wrapAsSandbox('wasm', cfg,
    async (code) => {
      const r = await wasm.execute(code);
      if (r.ok) return r.value;
      throw new Error(r.error || 'WASM execution failed');
    },
    () => { wasm.dispose(); },
  );
}

/**
 * @param {import('./sandbox-interface.js').SandboxConfig} cfg
 * @returns {Promise<import('./sandbox-interface.js').Sandbox>}
 */
async function createWorkerSandbox(cfg) {
  // Node.js: worker_threads; Browser: Web Worker via Blob URL
  const isNode = typeof globalThis.process !== 'undefined'
    && typeof globalThis.process.versions?.node === 'string';

  if (isNode) {
    throw new Error('Worker sandbox not yet supported in Node.js — use wasm or main');
  }

  if (typeof Worker === 'undefined') {
    throw new Error('Worker API not available');
  }

  const workerCode = [
    'self.onmessage=function(e){',
    '  var d=e.data;',
    '  try{var r=(0,eval)(d.code);self.postMessage({ok:true,value:r})}',
    '  catch(err){self.postMessage({ok:false,error:err.message,stack:err.stack})}',
    '};',
  ].join('');
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  URL.revokeObjectURL(url);

  return wrapAsSandbox('worker', cfg,
    (code) => new Promise((resolve, reject) => {
      const timeoutMs = cfg.timeout || 30000;
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error('Worker execution timeout'));
      }, timeoutMs);

      worker.onmessage = (evt) => {
        clearTimeout(timer);
        if (evt.data.ok) resolve(evt.data.value);
        else reject(new Error(evt.data.error || 'Worker execution failed'));
      };
      worker.onerror = (err) => {
        clearTimeout(timer);
        reject(new Error(err?.message || 'Worker error'));
      };
      worker.postMessage({ code });
    }),
    () => { worker.terminate(); },
  );
}

/**
 * @param {import('./sandbox-interface.js').SandboxConfig} cfg
 * @returns {Promise<import('./sandbox-interface.js').Sandbox>}
 */
async function createIframeSandbox(cfg) {
  if (typeof document === 'undefined') {
    throw new Error('iframe sandbox requires a DOM environment');
  }

  const { createIframeSandbox: createIframe } = await import('./iframe-sandbox.js');
  const iframe = createIframe({
    timeout: cfg.timeout,
    vfs:     cfg.vfs,
  });

  return wrapAsSandbox('iframe', cfg,
    async (code, filename) => {
      const r = await iframe.execute(code, filename);
      if (r.ok) return r.value;
      const err = new Error(r.error || 'iframe execution failed');
      if (r.stack) err.stack = r.stack;
      throw err;
    },
    () => { iframe.terminate(); },
  );
}

/**
 * @param {import('./sandbox-interface.js').SandboxConfig} cfg
 * @returns {Promise<import('./sandbox-interface.js').Sandbox>}
 */
async function createMainSandbox(cfg) {
  if (cfg.mainThreadFallback === false) {
    throw new Error('Main-thread sandbox disabled by config');
  }

  if (cfg.vfs?._isRemote && cfg.mainThreadFallback !== false) {
    throw new Error('Main-thread sandbox with remote VFS will cause synchronous IO deadlock. Use worker/iframe sandbox instead.');
  }

  return wrapAsSandbox('main', cfg,
    async (code) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function('return ' + code);
      return fn();
    },
    () => {},
  );
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const CREATORS = {
  wasm: createWasmSandbox,
  worker: createWorkerSandbox,
  iframe: createIframeSandbox,
  main: createMainSandbox,
};

/**
 * @param {import('./sandbox-interface.js').SandboxLevel} level
 * @param {import('./sandbox-interface.js').SandboxConfig} cfg
 * @returns {Promise<import('./sandbox-interface.js').Sandbox>}
 */
async function createByLevel(level, cfg) {
  const creator = CREATORS[level];
  if (!creator) throw new Error(`Unknown sandbox level: ${level}`);
  return creator(cfg);
}

/**
 * @param {import('./sandbox-interface.js').SandboxConfig} cfg
 * @returns {Promise<import('./sandbox-interface.js').Sandbox>}
 */
async function autoCreate(cfg) {
  const errors = [];
  for (const level of AUTO_PRIORITY) {
    try {
      return await createByLevel(level, cfg);
    } catch (err) {
      errors.push({ level, error: err.message });
    }
  }
  throw new Error(
    'No sandbox backend available: ' + errors.map(e => `${e.level}(${e.error})`).join(', ')
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a sandbox instance with the requested isolation level.
 *
 * @param {Partial<import('./sandbox-interface.js').SandboxConfig>} [config]
 * @returns {Promise<import('./sandbox-interface.js').Sandbox>}
 */
export async function createSandboxFactory(config = {}) {
  const cfg = validateConfig(config);
  if (cfg.level === 'auto') return autoCreate(cfg);
  return createByLevel(cfg.level, cfg);
}
