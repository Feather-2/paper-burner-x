/**
 * Node.js HTTP server for the Agent API.
 *
 * Wraps the shared request handler with Node's `http.createServer`.
 * Dynamically imports `http` to avoid browser bundler issues.
 *
 * @module sdk/http/node-server
 */

import { createRequestHandler } from './request-handler.js';
import { SSE_HEADERS } from './sse-writer.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 1 << 20; // 1 MB

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {object} NodeServerOptions
 * @property {number} [port=3000]
 * @property {string} [host='0.0.0.0']
 * @property {import('./request-handler.js').RequestHandlerOptions} [handlerOptions]
 */

/**
 * @typedef {object} NodeServer
 * @property {import('http').Server} server
 * @property {(port?: number, host?: string) => Promise<void>} listen
 * @property {() => Promise<void>} close
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read request body with size limit.
 *
 * @param {import('http').IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<string>}
 */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;

    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.destroy();
        reject(new Error(`Request body exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * Create a Node.js HTTP server for the agent API.
 *
 * @param {import('./request-handler.js').AgentFactory} agentFactory
 * @param {NodeServerOptions} [options]
 * @returns {Promise<NodeServer>}
 */
export async function createNodeServer(agentFactory, options = {}) {
  const http = await import('http');
  const handler = createRequestHandler(agentFactory, options.handlerOptions);
  const maxBytes = options.handlerOptions?.maxBodyBytes ?? MAX_BODY_BYTES;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const method = (req.method || 'GET').toUpperCase();
    const pathname = url.pathname;
    const isStream = pathname === '/v1/run/stream';

    try {
      const body = method === 'POST' ? await readBody(req, maxBytes) : '';

      /** @type {import('./request-handler.js').ParsedRequest} */
      const parsed = {
        method,
        pathname,
        headers: /** @type {Record<string, string>} */ (req.headers),
        body,
      };

      if (isStream && method === 'POST') {
        // SSE: write headers immediately, pass res as stream target
        res.writeHead(200, SSE_HEADERS);

        /** @type {import('./sse-writer.js').WritableTarget} */
        const target = {
          write: (chunk) => { res.write(chunk); },
          end: () => { if (!res.writableEnded) res.end(); },
        };

        await handler(parsed, target);
        if (!res.writableEnded) res.end();
        return;
      }

      // Non-streaming
      const result = await handler(parsed);
      res.writeHead(result.status, result.headers);
      if (result.body) res.write(result.body);
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
      }
    }
  });

  return {
    server,

    listen(port, host) {
      const p = port ?? options.port ?? 3000;
      const h = host ?? options.host ?? '0.0.0.0';
      return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(p, h, () => resolve());
      });
    },

    close() {
      return new Promise((resolve, reject) => {
        handler.dispose();
        server.close((err) => err ? reject(err) : resolve());
      });
    },
  };
}
