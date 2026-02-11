/**
 * @file Iframe Eval Bridge - executes the require wrapper eval chain
 * inside a sandboxed iframe to prevent eval escape to host globalThis.
 *
 * The iframe uses `sandbox="allow-scripts"` (no allow-same-origin),
 * so code inside cannot access the host's DOM, cookies, or localStorage.
 *
 * Communication protocol (postMessage):
 *   Host -> iframe:  { type: 'eval', id, code, filename }
 *   iframe -> Host:   { type: 'eval-result', id, ok, value, error }
 *
 * The eval'd code is expected to be a CommonJS IIFE wrapper string that
 * returns a function. Since functions can't cross the postMessage boundary,
 * the iframe calls the returned function with a mini module system and
 * sends back the serialized module.exports.
 *
 * @module iframe-eval-bridge
 */

// ── Message types ────────────────────────────────────────────
const MSG_EVAL = 'iframe-eval:eval';
const MSG_EVAL_RESULT = 'iframe-eval:result';
const MSG_CONSOLE = 'iframe-eval:console';

/**
 * @typedef {object} IframeEvalBridgeConfig
 * @property {number}  [timeout=30000] - Execution timeout ms
 * @property {(method: string, args: unknown[]) => void} [onConsole]
 */

/**
 * @typedef {object} EvalResult
 * @property {boolean} ok
 * @property {*}       [value]
 * @property {string}  [error]
 */

/**
 * Build the guest script that runs inside the sandboxed iframe.
 * This script:
 * 1. Receives eval requests via postMessage
 * 2. Evals the wrapper code (returns a function)
 * 3. Calls that function with a mini module/exports/require
 * 4. Sends module.exports back serialized
 * @returns {string}
 */
function buildEvalGuestScript() {
  return `
    'use strict';
    window.addEventListener('message', function(e) {
      var d = e.data;
      if (!d || d.type !== '${MSG_EVAL}') return;
      var id = d.id;
      try {
        // The wrapper is an IIFE like:
        // (function(exports, require, module, __filename, __dirname, process, console, Buffer, global, globalThis, __dynamicImport) { ... })
        var fn = (0, eval)(d.code);
        if (typeof fn === 'function') {
          // Create a mini module system inside the iframe
          var mod = { exports: {} };
          // Stub require - modules requiring other modules will be handled
          // by the host-side require chain; this iframe only evals the wrapper
          var stubRequire = function(spec) {
            throw new Error('require() not available inside iframe eval for: ' + spec);
          };
          var stubProcess = { env: {}, cwd: function() { return '/'; }, platform: 'browser', version: 'v0.0.0', versions: {} };
          var stubBuffer = { from: function() { return []; }, alloc: function() { return []; }, isBuffer: function() { return false; } };
          var stubGlobal = typeof self !== 'undefined' ? self : {};

          fn(
            mod.exports, stubRequire, mod,
            d.filename || 'main.js',
            '',
            stubProcess, console, stubBuffer, stubGlobal, stubGlobal,
            function(spec) { return Promise.reject(new Error('dynamic import not available in iframe: ' + spec)); }
          );
          // Serialize module.exports
          var result;
          try {
            result = JSON.parse(JSON.stringify(mod.exports));
          } catch(_) {
            result = String(mod.exports);
          }
          e.source.postMessage({ type: '${MSG_EVAL_RESULT}', id: id, ok: true, value: result }, '*');
        } else {
          // Not a function wrapper - just return the eval result
          var serialized;
          try { serialized = JSON.parse(JSON.stringify(fn)); } catch(_) { serialized = String(fn); }
          e.source.postMessage({ type: '${MSG_EVAL_RESULT}', id: id, ok: true, value: serialized }, '*');
        }
      } catch (err) {
        e.source.postMessage({
          type: '${MSG_EVAL_RESULT}',
          id: id,
          ok: false,
          error: (err && err.message) || String(err)
        }, '*');
      }
    });
    // Intercept console to forward to host
    ['log','warn','error','info','debug'].forEach(function(m) {
      var orig = console[m];
      console[m] = function() {
        var args = [];
        for (var i = 0; i < arguments.length; i++) {
          try { args.push(JSON.parse(JSON.stringify(arguments[i]))); }
          catch(_) { args.push(String(arguments[i])); }
        }
        try { parent.postMessage({ type: '${MSG_CONSOLE}', method: m, args: args }, '*'); } catch(_) {}
        if (orig) orig.apply(console, arguments);
      };
    });
  `;
}

/**
 * Detect if we're in a browser environment with DOM support.
 * @returns {boolean}
 */
function isBrowserWithDOM() {
  return typeof document !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined';
}

/**
 * Create an iframe eval bridge for isolated code evaluation.
 *
 * In browser: creates a sandboxed iframe (allow-scripts only).
 * In Node.js: throws - callers should check isBrowserWithDOM() first.
 *
 * @param {IframeEvalBridgeConfig} [config]
 * @returns {{ evaluate: (code: string, filename?: string) => Promise<EvalResult>, dispose: () => void }}
 */
export function createIframeEvalBridge(config = {}) {
  const { timeout = 30000, onConsole } = config;

  if (!isBrowserWithDOM()) {
    throw new Error('iframe eval bridge requires a DOM environment (browser)');
  }

  let terminated = false;
  let nextId = 1;
  /** @type {Map<number, {resolve: Function, timer: ReturnType<typeof setTimeout>}>} */
  const pending = new Map();

  // Build and mount the iframe
  const guestCode = buildEvalGuestScript();
  const blob = new Blob(
    [`<html><script>${guestCode}<\/script></html>`],
    { type: 'text/html' },
  );
  const blobUrl = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.sandbox = 'allow-scripts'; // No allow-same-origin!
  iframe.style.display = 'none';
  iframe.src = blobUrl;
  document.body.appendChild(iframe);

  /** @param {MessageEvent} e */
  function onMessage(e) {
    const d = e.data;
    if (!d) return;

    if (d.type === MSG_EVAL_RESULT) {
      const p = pending.get(d.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(d.id);
      p.resolve({ ok: d.ok, value: d.value, error: d.error });
      return;
    }

    if (d.type === MSG_CONSOLE && onConsole) {
      onConsole(d.method, d.args);
    }
  }
  window.addEventListener('message', onMessage);

  /**
   * Evaluate code inside the sandboxed iframe.
   * @param {string} code - The wrapper IIFE string
   * @param {string} [filename='main.js']
   * @returns {Promise<EvalResult>}
   */
  function evaluate(code, filename) {
    if (terminated) {
      return Promise.reject(new Error('Iframe eval bridge terminated'));
    }

    const id = nextId++;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: 'Execution timeout' });
      }, timeout);

      pending.set(id, { resolve, timer });

      iframe.contentWindow.postMessage(
        { type: MSG_EVAL, id, code, filename: filename || 'main.js' },
        '*',
      );
    });
  }

  function dispose() {
    if (terminated) return;
    terminated = true;
    window.removeEventListener('message', onMessage);
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: 'Bridge disposed' });
    }
    pending.clear();
    iframe.remove();
    URL.revokeObjectURL(blobUrl);
  }

  return { evaluate, dispose };
}

export { isBrowserWithDOM, buildEvalGuestScript, MSG_EVAL, MSG_EVAL_RESULT, MSG_CONSOLE };
