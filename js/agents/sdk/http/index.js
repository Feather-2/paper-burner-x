/**
 * Agent HTTP API — unified entry point.
 *
 * Automatically selects Node.js or browser server backend
 * based on platform detection.
 *
 * @module sdk/http
 */

import { Platform } from '../../shared/platform.js';
import { createRequestHandler } from './request-handler.js';

// Re-exports
export { SessionGate, ErrConcurrentExecution } from '../../runtime/session-gate.js';
export { STREAM_EVENT_TYPES, BUS_TO_SSE_MAP, mapBusEventToStreamEvent } from './stream-events.js';
export { SseWriter, SSE_HEADERS } from './sse-writer.js';
export { createRequestHandler } from './request-handler.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {import('./node-server.js').NodeServerOptions & import('./browser-server.js').BrowserServerOptions} ServerOptions
 */

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an Agent HTTP server with automatic platform detection.
 *
 * - Node.js / Bun: uses `http.createServer`
 * - Browser: uses ServerBridge (Service Worker virtual server)
 *
 * @param {import('./request-handler.js').AgentFactory} agentFactory
 * @param {ServerOptions} [options]
 * @returns {Promise<import('./node-server.js').NodeServer | import('./browser-server.js').BrowserServer>}
 */
export async function createAgentServer(agentFactory, options = {}) {
  if (Platform.isNode || Platform.isBun) {
    const { createNodeServer } = await import('./node-server.js');
    return createNodeServer(agentFactory, options);
  }
  const { createBrowserServer } = await import('./browser-server.js');
  return createBrowserServer(agentFactory, options);
}
