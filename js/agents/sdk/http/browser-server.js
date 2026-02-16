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
  const handler = createRequestHandler(agentFactory, options.handlerOptions);
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
          body: typeof swReq.body === 'string' ? swReq.body : JSON.stringify(swReq.body || ''),
        };

        if (isStream && method === 'POST') {
          const chunks = [];
          /** @type {import('./sse-writer.js').WritableTarget} */
          const target = {
            write: (chunk) => { chunks.push(chunk); },
            end: () => {},
          };
          await handler(parsed, target);
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
