/**
 * @file Iframe Eval Bridge - executes the require wrapper eval chain
 * inside a sandboxed iframe to prevent eval escape to host globalThis.
 *
 * The iframe uses `sandbox="allow-scripts"` (no allow-same-origin),
 * so code inside cannot access the host's DOM, cookies, or localStorage.
 *
 * Communication protocol (postMessage):
 *   Host -> iframe:  { type: 'eval', id, code, filename, session }
 *   iframe -> Host:  { type: 'result', id, ok, value, error, session }
 *
 * @module iframe-eval-bridge
 */

// ── Message types ────────────────────────────────────────────
const MSG_EVAL = "iframe-eval:eval";
const MSG_EVAL_RESULT = "iframe-eval:result";
const MSG_CONSOLE = "iframe-eval:console";
const MSG_READY = "iframe-eval:ready";

/**
 * @typedef {object} IframeEvalBridgeConfig
 * @property {number}  [timeout=30000] - Execution timeout ms
 * @property {number}  [readyTimeout=5000] - Guest ready handshake timeout ms
 * @property {(method: string, args: unknown[]) => void} [onConsole]
 * @property {string|string[]} [allowedOrigins] - Explicit allowed origins for iframe->host messages
 * @property {string} [targetOrigin='*'] - targetOrigin used by host->iframe postMessage
 * @property {() => string} [sessionIdFactory] - Optional factory for per-bridge session id
 */

/**
 * @typedef {object} EvalResult
 * @property {boolean} ok
 * @property {*}       [value]
 * @property {string}  [error]
 */

/**
 * Build the guest script that runs inside the sandboxed iframe.
 * @param {{ sessionId?: string }} [options]
 * @returns {string}
 */
function buildEvalGuestScript(options = {}) {
  const sessionId = typeof options.sessionId === "string" && options.sessionId.trim()
    ? options.sessionId.trim()
    : "__default_session__";

  return `
    'use strict';
    var SESSION_ID = ${JSON.stringify(sessionId)};
    var sendToParent = function(payload, origin) {
      var targetOrigin = (typeof origin === 'string' && origin && origin !== 'null') ? origin : '*';
      try { parent.postMessage(payload, targetOrigin); }
      catch(_) { try { parent.postMessage(payload, '*'); } catch(__) {} }
    };

    window.addEventListener('message', function(e) {
      var d = e.data;
      if (!d || d.type !== '${MSG_EVAL}') return;
      if (d.session !== SESSION_ID) return;

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
          sendToParent({ type: '${MSG_EVAL_RESULT}', id: id, ok: true, value: result, session: SESSION_ID }, e.origin);
        } else {
          // Not a function wrapper - just return the eval result
          var serialized;
          try { serialized = JSON.parse(JSON.stringify(fn)); } catch(_) { serialized = String(fn); }
          sendToParent({ type: '${MSG_EVAL_RESULT}', id: id, ok: true, value: serialized, session: SESSION_ID }, e.origin);
        }
      } catch (err) {
        sendToParent({
          type: '${MSG_EVAL_RESULT}',
          id: id,
          ok: false,
          error: (err && err.message) || String(err),
          session: SESSION_ID
        }, e.origin);
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
        try { parent.postMessage({ type: '${MSG_CONSOLE}', method: m, args: args, session: SESSION_ID }, '*'); } catch(_) {}
        if (orig) orig.apply(console, arguments);
      };
    });

    // Ready handshake
    sendToParent({ type: '${MSG_READY}', session: SESSION_ID }, '*');
  `;
}

/**
 * Detect if we're in a browser environment with DOM support.
 * @returns {boolean}
 */
function isBrowserWithDOM() {
  return typeof document !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined";
}

function createSessionId() {
  const uuid = typeof globalThis?.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : null;
  if (uuid) return `bridge_${uuid}`;
  return `bridge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {string|string[]|undefined} value
 * @returns {Set<string>}
 */
function normalizeAllowedOrigins(value) {
  const set = new Set();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) set.add(item.trim());
    }
    return set;
  }
  if (typeof value === "string" && value.trim()) {
    set.add(value.trim());
  }
  return set;
}

/**
 * @param {MessageEvent} e
 * @param {HTMLIFrameElement} iframe
 * @param {Set<string>} allowedOrigins
 * @returns {boolean}
 */
function isTrustedMessageEvent(e, iframe, allowedOrigins) {
  if (!e || !iframe) return false;
  if (e.source !== iframe.contentWindow) return false;
  if (!allowedOrigins || allowedOrigins.size === 0) return true;
  return allowedOrigins.has(e.origin);
}

/**
 * Create an iframe eval bridge for isolated code evaluation.
 *
 * @param {IframeEvalBridgeConfig} [config]
 * @returns {{ evaluate: (code: string, filename?: string) => Promise<EvalResult>, dispose: () => void }}
 */
export function createIframeEvalBridge(config = {}) {
  const { timeout = 30000, onConsole, targetOrigin = "*" } = config;
  const readyTimeout = Number.isFinite(config?.readyTimeout)
    ? Math.max(1, Number(config.readyTimeout))
    : 5000;

  if (!isBrowserWithDOM()) {
    throw new Error("iframe eval bridge requires a DOM environment (browser)");
  }

  let terminated = false;
  let nextId = 1;
  const sessionId = typeof config?.sessionIdFactory === "function"
    ? String(config.sessionIdFactory() || createSessionId())
    : createSessionId();

  /** @type {Map<number, {resolve: Function, timer: ReturnType<typeof setTimeout>}>} */
  const pending = new Map();

  const allowedOrigins = normalizeAllowedOrigins(config.allowedOrigins);
  if (allowedOrigins.size === 0) {
    allowedOrigins.add("null");
    try {
      if (typeof globalThis?.location?.origin === "string" && globalThis.location.origin) {
        allowedOrigins.add(globalThis.location.origin);
      }
    } catch {
      // ignore
    }
  }

  /** @type {ReturnType<typeof setTimeout> | null} */
  let readyTimer = null;
  /** @type {(value?: void | PromiseLike<void>) => void} */
  let readyResolve = () => {};
  /** @type {(reason?: unknown) => void} */
  let readyReject = () => {};
  let isReady = false;
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const ensureReady = async () => {
    if (isReady) return;
    return readyPromise;
  };

  // Build and mount the iframe
  const guestCode = buildEvalGuestScript({ sessionId });
  const blob = new Blob([`<html><script>${guestCode}<\/script></html>`], { type: "text/html" });
  const blobUrl = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.sandbox = "allow-scripts"; // No allow-same-origin!
  iframe.style.display = "none";
  iframe.src = blobUrl;
  document.body.appendChild(iframe);

  readyTimer = setTimeout(() => {
    if (isReady || terminated) return;
    readyReject(new Error(`Iframe guest ready timeout after ${readyTimeout}ms`));
  }, readyTimeout);

  /** @param {MessageEvent} e */
  function onMessage(e) {
    if (!isTrustedMessageEvent(e, iframe, allowedOrigins)) return;
    const d = e.data;
    if (!d || d.session !== sessionId) return;

    if (d.type === MSG_READY) {
      if (!isReady) {
        isReady = true;
        if (readyTimer) clearTimeout(readyTimer);
        readyResolve();
      }
      return;
    }

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
  window.addEventListener("message", onMessage);

  /**
   * Evaluate code inside the sandboxed iframe.
   * @param {string} code - The wrapper IIFE string
   * @param {string} [filename='main.js']
   * @returns {Promise<EvalResult>}
   */
  async function evaluate(code, filename) {
    if (terminated) {
      return Promise.reject(new Error("Iframe eval bridge terminated"));
    }

    try {
      await ensureReady();
    } catch (err) {
      return {
        ok: false,
        error: err?.message || String(err),
      };
    }

    if (!iframe.contentWindow) {
      return { ok: false, error: "iframe contentWindow unavailable" };
    }

    const id = nextId++;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: "Execution timeout" });
      }, timeout);

      pending.set(id, { resolve, timer });

      iframe.contentWindow.postMessage(
        { type: MSG_EVAL, id, code, filename: filename || "main.js", session: sessionId },
        targetOrigin
      );
    });
  }

  function dispose() {
    if (terminated) return;
    terminated = true;
    if (!isReady) {
      readyReject(new Error("Bridge disposed before ready"));
    }
    if (readyTimer) clearTimeout(readyTimer);
    readyTimer = null;

    window.removeEventListener("message", onMessage);
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: "Bridge disposed" });
    }
    pending.clear();
    iframe.remove();
    URL.revokeObjectURL(blobUrl);
  }

  return { evaluate, dispose };
}

export { isBrowserWithDOM, buildEvalGuestScript, MSG_EVAL, MSG_EVAL_RESULT, MSG_CONSOLE, MSG_READY };
