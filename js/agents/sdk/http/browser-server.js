/**
 * Browser HTTP server for the Agent API.
 *
 * Wraps the shared request handler using the existing ServerBridge
 * from core/webruntime for Service Worker-based virtual HTTP.
 *
 * @module sdk/http/browser-server
 */

import { createRequestHandler } from './request-handler.js';
import { SSE_HEADERS } from './sse-writer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {object} BrowserServerOptions
 * @property {number} [port=3000]
 * @property {string} [scope='/__agent__/']
 * @property {import('./request-handler.js').RequestHandlerOptions} [handlerOptions]
 */

/**
 * @typedef {object} BrowserServer
 * @property {() => Promise<void>} listen
 * @property {() => void} close
 */

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function decodeUtf8Bytes(bytes) {
  if (typeof TextDecoder === 'function') {
    return new TextDecoder().decode(bytes);
  }
  const bufferCtor = /** @type {{ from?: (input: Uint8Array) => { toString: (encoding: string) => string } }} */ (globalThis.Buffer);
  if (bufferCtor && typeof bufferCtor.from === 'function') {
    return bufferCtor.from(bytes).toString('utf8');
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

/**
 * Normalize SW/Bridge request body to request-handler's string contract.
 * @param {unknown} body
 * @returns {string}
 */
export function normalizeVirtualRequestBody(body) {
  if (typeof body === 'string') return body;
  if (body == null) return '';
  if (body instanceof ArrayBuffer) {
    return decodeUtf8Bytes(new Uint8Array(body));
  }
  if (ArrayBuffer.isView(body)) {
    const view = /** @type {ArrayBufferView} */ (body);
    return decodeUtf8Bytes(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  if (typeof body === 'object') {
    try {
      return JSON.stringify(body);
    } catch {
      return '';
    }
  }
  return String(body);
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * Create a browser-based server using ServerBridge.
 *
 * @param {import('./request-handler.js').AgentFactory} agentFactory
 * @param {BrowserServerOptions} [options]
 * @returns {Promise<BrowserServer>}
 */
export async function createBrowserServer(agentFactory, options = {}) {
  const { createServerBridge } = await import('../../core/webruntime/server-bridge.js');
  const handler = /** @type {ReturnType<typeof createRequestHandler> & { dispose: () => void }} */ (
    createRequestHandler(agentFactory, options.handlerOptions)
  );
  const scope = options.scope || '/__agent__/';
  const port = options.port || 3000;

  const bridge = createServerBridge({ scope });
  let virtualServer = null;

  return {
    async listen() {
      await bridge.start();
      virtualServer = bridge.listen(port);

      virtualServer.onRequest(async (swReq) => {
        const url = new URL(swReq.url || '/', 'http://localhost');
        const method = (swReq.method || 'GET').toUpperCase();
        const pathname = url.pathname;
        const isStream = pathname === '/v1/run/stream';

        /** @type {import('./request-handler.js').ParsedRequest} */
        const parsed = {
          method,
          pathname,
          headers: swReq.headers || {},
          body: normalizeVirtualRequestBody(swReq.body),
        };

        if (isStream && method === 'POST') {
          const chunks = [];
          /** @type {import('./sse-writer.js').WritableTarget} */
          const target = {
            write: (chunk) => { chunks.push(chunk); },
            end: () => {},
          };
          const result = await handler(parsed, target);
          if (result.status !== 200) {
            return {
              status: result.status,
              headers: result.headers,
              body: result.body || '',
            };
          }
          return {
            status: 200,
            headers: { ...SSE_HEADERS },
            body: chunks.join(''),
          };
        }

        const result = await handler(parsed);
        return {
          status: result.status,
          headers: result.headers,
          body: result.body || '',
        };
      });
    },

    close() {
      handler.dispose();
      if (virtualServer) {
        try { bridge.stop(); } catch { /* intentional: bridge may already be stopped */ }
        virtualServer = null;
      }
    },
  };
}
