/**
 * Cross-origin iframe sandbox for browser-level isolation.
 *
 * Uses a blob:-origin iframe with `sandbox="allow-scripts"` to run
 * untrusted code in a separate browsing context. Communication uses
 * structured postMessage with a typed protocol.
 *
 * @module iframe-sandbox
 */

import { normalizeVfsPath } from "../../vfs/path.js";

// ── Types ────────────────────────────────────────────────────

/**
 * @typedef {object} IframeSandboxConfig
 * @property {number}  [timeout=60000] - execution timeout ms
 * @property {number}  [readyTimeout=5000] - ready handshake timeout ms
 * @property {(method: string, args: unknown[]) => void} [onConsole]
 * @property {object}  [vfs] - VFS instance for runFile
 * @property {string|string[]} [allowedOrigins] - explicit allowed origins for guest->host messages
 * @property {string} [targetOrigin='*'] - targetOrigin for host->guest postMessage
 * @property {() => string} [sessionIdFactory] - optional session factory
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

const MSG_EXECUTE = "iframe-sandbox:execute";
const MSG_RESULT = "iframe-sandbox:result";
const MSG_CONSOLE = "iframe-sandbox:console";
const MSG_READY = "iframe-sandbox:ready";

function createSessionId() {
  const uuid = typeof globalThis?.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : null;
  if (uuid) return `iframe_sb_${uuid}`;
  return `iframe_sb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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
 * Build the guest script that runs inside the iframe.
 * @param {{ sessionId?: string }} [options]
 * @returns {string}
 */
export function buildGuestScript(options = {}) {
  const sessionId = typeof options.sessionId === "string" && options.sessionId.trim()
    ? options.sessionId.trim()
    : "__default_session__";

  return `
    var SESSION_ID = ${JSON.stringify(sessionId)};
    var sendToParent = function(payload, origin) {
      var targetOrigin = (typeof origin === 'string' && origin && origin !== 'null') ? origin : '*';
      try { parent.postMessage(payload, targetOrigin); }
      catch(_) { try { parent.postMessage(payload, '*'); } catch(__) {} }
    };

    window.addEventListener('message', function(e) {
      var d = e.data;
      if (!d || d.type !== '${MSG_EXECUTE}') return;
      if (d.session !== SESSION_ID) return;
      var id = d.id;
      try {
        var result = (0, eval)(d.code);
        sendToParent({ type: '${MSG_RESULT}', id: id, ok: true, value: result, session: SESSION_ID }, e.origin);
      } catch (err) {
        sendToParent({ type: '${MSG_RESULT}', id: id, ok: false, error: err && err.message, stack: err && err.stack, session: SESSION_ID }, e.origin);
      }
    });
    ['log','warn','error','info','debug'].forEach(function(m) {
      var orig = console[m];
      console[m] = function() {
        var args = Array.from(arguments);
        try { parent.postMessage({ type: '${MSG_CONSOLE}', method: m, args: args, session: SESSION_ID }, '*'); } catch(_) {}
        if (orig) orig.apply(console, arguments);
      };
    });
    sendToParent({ type: '${MSG_READY}', session: SESSION_ID }, '*');
  `;
}

/**
 * Create an iframe sandbox.
 *
 * Requires a DOM environment (browser). Throws in Node.js.
 *
 * @param {IframeSandboxConfig} [config]
 * @returns {IframeSandbox}
 */
export function createIframeSandbox(config = {}) {
  const { timeout = 60000, onConsole, vfs, targetOrigin = "*" } = config;
  const readyTimeout = Number.isFinite(config?.readyTimeout)
    ? Math.max(1, Number(config.readyTimeout))
    : 5000;

  if (typeof document === "undefined") {
    throw new Error("iframe sandbox requires a DOM environment");
  }

  const sessionId = typeof config?.sessionIdFactory === "function"
    ? String(config.sessionIdFactory() || createSessionId())
    : createSessionId();

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

  let terminated = false;
  let nextId = 1;
  /** @type {Map<number, {resolve: Function, reject: Function, timer: ReturnType<typeof setTimeout>}>} */
  const pending = new Map();

  /** @type {ReturnType<typeof setTimeout> | null} */
  let readyTimer = null;
  let isReady = false;
  let readyResolve = () => {};
  let readyReject = () => {};
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const waitForReady = async () => {
    if (isReady) return;
    return readyPromise;
  };

  const guestCode = buildGuestScript({ sessionId });
  const blob = new Blob([`<html><script>${guestCode}<\/script></html>`], { type: "text/html" });
  const blobUrl = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.sandbox = "allow-scripts";
  iframe.style.display = "none";
  iframe.src = blobUrl;
  document.body.appendChild(iframe);

  readyTimer = setTimeout(() => {
    if (terminated || isReady) return;
    readyReject(new Error(`Iframe sandbox ready timeout after ${readyTimeout}ms`));
  }, readyTimeout);

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
  window.addEventListener("message", onMessage);

  /** @type {IframeSandbox} */
  const sandbox = {
    get terminated() {
      return terminated;
    },

    async execute(code, _filename) {
      if (terminated) return Promise.reject(new Error("Sandbox terminated"));
      try {
        await waitForReady();
      } catch (err) {
        return {
          ok: false,
          error: err?.message || String(err),
          durationMs: 0,
        };
      }

      if (!iframe.contentWindow) {
        return {
          ok: false,
          error: "iframe contentWindow unavailable",
          durationMs: 0,
        };
      }

      const id = nextId++;
      const start = Date.now();

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: "Execution timeout", durationMs: Date.now() - start });
        }, timeout);

        pending.set(id, {
          resolve: (d) =>
            resolve({
              ok: d.ok,
              value: d.value,
              error: d.error,
              stack: d.stack,
              durationMs: Date.now() - start,
            }),
          reject,
          timer,
        });

        iframe.contentWindow.postMessage({ type: MSG_EXECUTE, id, code, session: sessionId }, targetOrigin);
      });
    },

    async runFile(path) {
      if (!vfs) throw new Error("No VFS configured");
      const content = await vfs.readText(normalizeVfsPath(path));
      return sandbox.execute(content, path);
    },

    terminate() {
      if (terminated) return;
      terminated = true;
      if (!isReady) {
        readyReject(new Error("Sandbox terminated before ready"));
      }
      if (readyTimer) clearTimeout(readyTimer);
      readyTimer = null;

      window.removeEventListener("message", onMessage);
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.resolve({ ok: false, error: "Sandbox terminated", durationMs: 0 });
      }
      pending.clear();
      iframe.remove();
      URL.revokeObjectURL(blobUrl);
    },
  };

  return sandbox;
}

export { MSG_EXECUTE, MSG_RESULT, MSG_CONSOLE, MSG_READY };
