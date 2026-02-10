/**
 * Cross-origin iframe sandbox for browser-level isolation.
 *
 * Uses a blob:-origin iframe with `sandbox="allow-scripts"` to run
 * untrusted code in a separate browsing context.  Communication uses
 * structured postMessage with a typed protocol.
 *
 * NOTE: Requires a DOM environment (browser).  In Node.js the factory
 * throws immediately so the module can still be imported safely.
 *
 * @module iframe-sandbox
 */

import { normalizeVfsPath } from '../../vfs/path.js';

// ── Types ────────────────────────────────────────────────────

/**
 * @typedef {object} IframeSandboxConfig
 * @property {string}  [origin]    - iframe origin URL (blob: or data:)
 * @property {number}  [timeout=60000] - execution timeout ms
 * @property {(method: string, args: unknown[]) => void} [onConsole]
 * @property {object}  [vfs]       - VFS instance for runFile
 */

/**
 * @typedef {object} IframeSandboxResult
 * @property {boolean} ok
 * @property {*}       [value]
 * @property {string}  [error]
 * @property {string}  [stack]
 * @property {number}  durationMs
 */

/**
 * @typedef {object} IframeSandbox
 * @property {(code: string, filename?: string) => Promise<IframeSandboxResult>} execute
 * @property {(path: string) => Promise<IframeSandboxResult>} runFile
 * @property {() => void} terminate
 * @property {boolean} terminated
 */

// ── Internal message protocol ────────────────────────────────

const MSG_EXECUTE = 'iframe-sandbox:execute';
const MSG_RESULT  = 'iframe-sandbox:result';
const MSG_CONSOLE = 'iframe-sandbox:console';

/**
 * Build the guest script that runs inside the iframe.
 * @returns {string}
 */
export function buildGuestScript() {
  return `
    window.addEventListener('message', function(e) {
      var d = e.data;
      if (!d || d.type !== '${MSG_EXECUTE}') return;
      var id = d.id;
      try {
        var result = (0, eval)(d.code);
        e.source.postMessage({ type: '${MSG_RESULT}', id: id, ok: true, value: result }, '*');
      } catch (err) {
        e.source.postMessage({ type: '${MSG_RESULT}', id: id, ok: false, error: err.message, stack: err.stack }, '*');
      }
    });
    ['log','warn','error','info','debug'].forEach(function(m) {
      var orig = console[m];
      console[m] = function() {
        var args = Array.from(arguments);
        try { parent.postMessage({ type: '${MSG_CONSOLE}', method: m, args: args }, '*'); } catch(_) {}
        if (orig) orig.apply(console, arguments);
      };
    });
  `;
}

/**
 * Create an iframe sandbox.
 *
 * Requires a DOM environment (browser).  Throws in Node.js.
 *
 * @param {IframeSandboxConfig} [config]
 * @returns {IframeSandbox}
 */
export function createIframeSandbox(config = {}) {
  const { timeout = 60000, onConsole, vfs } = config;

  if (typeof document === 'undefined') {
    throw new Error('iframe sandbox requires a DOM environment');
  }

  let terminated = false;
  let nextId = 1;
  /** @type {Map<number, {resolve: Function, reject: Function, timer: number}>} */
  const pending = new Map();

  const guestCode = buildGuestScript();
  const blob = new Blob(
    [`<html><script>${guestCode}<\/script></html>`],
    { type: 'text/html' },
  );
  const blobUrl = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.sandbox = 'allow-scripts';
  iframe.style.display = 'none';
  iframe.src = blobUrl;
  document.body.appendChild(iframe);

  function onMessage(e) {
    const d = e.data;
    if (!d) return;

    if (d.type === MSG_RESULT) {
      const p = pending.get(d.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(d.id);
      p.resolve(d);
      return;
    }

    if (d.type === MSG_CONSOLE && onConsole) {
      onConsole(d.method, d.args);
    }
  }
  window.addEventListener('message', onMessage);

  /** @type {IframeSandbox} */
  const sandbox = {
    get terminated() { return terminated; },

    execute(code, _filename) {
      if (terminated) return Promise.reject(new Error('Sandbox terminated'));
      const id = nextId++;
      const start = Date.now();

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: 'Execution timeout', durationMs: Date.now() - start });
        }, timeout);

        pending.set(id, {
          resolve: (d) => resolve({
            ok: d.ok,
            value: d.value,
            error: d.error,
            stack: d.stack,
            durationMs: Date.now() - start,
          }),
          reject,
          timer,
        });

        iframe.contentWindow.postMessage({ type: MSG_EXECUTE, id, code }, '*');
      });
    },

    async runFile(path) {
      if (!vfs) throw new Error('No VFS configured');
      const content = await vfs.readText(normalizeVfsPath(path));
      return sandbox.execute(content, path);
    },

    terminate() {
      if (terminated) return;
      terminated = true;
      window.removeEventListener('message', onMessage);
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.resolve({ ok: false, error: 'Sandbox terminated', durationMs: 0 });
      }
      pending.clear();
      iframe.remove();
      URL.revokeObjectURL(blobUrl);
    },
  };

  return sandbox;
}
