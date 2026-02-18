/**
 * Shared HTTP request handler for the Agent API.
 *
 * Platform-agnostic: consumed by node-server.js and browser-server.js.
 * Handles routing, body validation, SessionGate integration, and streaming.
 *
 * @module sdk/http/request-handler
 */

import { SessionGate } from '../../runtime/session-gate.js';
import { SseWriter, SSE_HEADERS } from './sse-writer.js';
import { BUS_TO_SSE_MAP, mapBusEventToStreamEvent, STREAM_EVENT_TYPES } from './stream-events.js';
import { makeSecureTimestampedId, protoSafeReviver } from '../../shared/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 1 << 20; // 1 MB
const DEFAULT_TIMEOUT_MS = 120_000; // 2 min
const DEFAULT_SESSION_ID_PREFIX = 'session';
const ERR_REQUEST_TIMEOUT = 'ERR_REQUEST_TIMEOUT';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ParsedRequest
 * @property {string} method
 * @property {string} pathname
 * @property {Record<string, string>} headers
 * @property {string} body  Raw body string
 */

/**
 * @typedef {object} HandlerResponse
 * @property {number} status
 * @property {Record<string, string>} headers
 * @property {string} [body]
 * @property {import('./sse-writer.js').WritableTarget} [stream]  If set, handler manages its own writes
 */

/**
 * @typedef {object} RunRequest
 * @property {string} prompt
 * @property {string} [session_id]
 * @property {number} [timeout_ms]
 */

/**
 * @callback AgentFactory
 * Creates or retrieves an agent instance for the given session.
 * @param {string} sessionId
 * @returns {Promise<{ run: (prompt: string, options?: { signal?: AbortSignal }) => Promise<RunResult>, eventBus?: import('../../core/event-bus.js').EventBus }>}
 */

/**
 * @typedef {object} RunResult
 * @property {string} output
 * @property {string} [stop_reason]
 * @property {{ input_tokens?: number, output_tokens?: number }} [usage]
 * @property {Array<{ id?: string, name?: string, arguments?: *, result?: * }>} [tool_calls]
 */

/**
 * @typedef {object} RequestHandlerOptions
 * @property {number} [maxBodyBytes]
 * @property {number} [defaultTimeoutMs]
 * @property {import('../../runtime/session-gate.js').SessionGateMode} [sessionMode]
 * @property {() => string} [sessionIdFactory]
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @param {number} status
 * @param {string} error
 * @returns {HandlerResponse}
 */
function jsonError(status, error) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error }),
  };
}

/**
 * @param {number} status
 * @param {*} data
 * @returns {HandlerResponse}
 */
function jsonOk(status, data) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

/**
 * @param {string} raw
 * @param {number} maxBytes
 * @returns {{ ok: true, data: RunRequest } | { ok: false, error: string }}
 */
function parseBody(raw, maxBytes) {
  if (typeof raw !== 'string') return { ok: false, error: 'Request body must be a string' };
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    return { ok: false, error: `Request body exceeds ${maxBytes} bytes` };
  }
  try {
    const data = JSON.parse(raw, protoSafeReviver);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'Request body must be a JSON object' };
    }
    if (!data.prompt || typeof data.prompt !== 'string' || !data.prompt.trim()) {
      return { ok: false, error: 'Field "prompt" is required and must be a non-empty string' };
    }
    if (data.session_id !== undefined && (typeof data.session_id !== 'string' || !data.session_id.trim())) {
      return { ok: false, error: 'Field "session_id" must be a non-empty string when provided' };
    }
    return { ok: true, data: /** @type {RunRequest} */ (data) };
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
}

function createDefaultSessionId() {
  try {
    return makeSecureTimestampedId(DEFAULT_SESSION_ID_PREFIX, { allowInsecureFallback: true });
  } catch {
    return `${DEFAULT_SESSION_ID_PREFIX}-${Date.now()}`;
  }
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isRequestTimeoutError(error) {
  return !!(error && typeof error === 'object' && /** @type {{ code?: string }} */ (error).code === ERR_REQUEST_TIMEOUT);
}

/**
 * @param {number} timeoutMs
 * @returns {{ signal: AbortSignal, timeoutPromise: Promise<never>, clear: () => void }}
 */
function createRequestTimeout(timeoutMs) {
  const ac = new AbortController();
  let timer = null;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('Request timeout');
      err.code = ERR_REQUEST_TIMEOUT;
      err.mayContinue = true;
      try {
        ac.abort(err);
      } catch {
        ac.abort();
      }
      reject(err);
    }, timeoutMs);
  });

  return {
    signal: ac.signal,
    timeoutPromise,
    clear() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

function timeoutMessage() {
  return 'Request timeout; downstream execution may continue if abort signal is ignored';
}

// ---------------------------------------------------------------------------
// Public: createRequestHandler
// ---------------------------------------------------------------------------

/**
 * Create a request handler function for the Agent HTTP API.
 *
 * @param {AgentFactory} agentFactory
 * @param {RequestHandlerOptions} [options]
 * @returns {(req: ParsedRequest, streamTarget?: import('./sse-writer.js').WritableTarget) => Promise<HandlerResponse>}
 */
export function createRequestHandler(agentFactory, options = {}) {
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const gate = new SessionGate({ mode: options.sessionMode || 'queue' });
  const sessionIdFactory = typeof options.sessionIdFactory === 'function' ? options.sessionIdFactory : createDefaultSessionId;

  /**
   * @param {ParsedRequest} req
   * @param {import('./sse-writer.js').WritableTarget} [streamTarget]
   * @returns {Promise<HandlerResponse>}
   */
  async function handle(req, streamTarget) {
    const { method, pathname } = req;

    // --- Health check ---
    if (pathname === '/health') {
      if (method !== 'GET' && method !== 'HEAD') {
        return jsonError(405, 'Method not allowed');
      }
      return jsonOk(200, { status: 'ok' });
    }

    // --- Only POST for run endpoints ---
    if (method !== 'POST') {
      return jsonError(405, 'Method not allowed');
    }

    // --- Parse and validate body ---
    const parsed = parseBody(req.body, maxBodyBytes);
    if (!parsed.ok) {
      return jsonError(400, parsed.error);
    }
    const { prompt, session_id, timeout_ms } = parsed.data;
    let sessionId = typeof session_id === 'string' ? session_id.trim() : '';
    if (!sessionId) {
      try {
        sessionId = String(sessionIdFactory() || '').trim() || createDefaultSessionId();
      } catch {
        sessionId = createDefaultSessionId();
      }
    }
    const timeoutMs = (timeout_ms && timeout_ms > 0) ? timeout_ms : defaultTimeoutMs;

    // --- Route ---
    if (pathname === '/v1/run') {
      return handleRun(agentFactory, gate, sessionId, prompt, timeoutMs);
    }
    if (pathname === '/v1/run/stream') {
      if (!streamTarget) {
        return jsonError(500, 'Streaming not supported by this server backend');
      }
      await handleRunStream(agentFactory, gate, sessionId, prompt, timeoutMs, streamTarget);
      return { status: 200, headers: { ...SSE_HEADERS }, stream: streamTarget };
    }

    return jsonError(404, 'Not found');
  }

  /** Expose gate for cleanup */
  handle.dispose = () => gate.dispose();

  return handle;
}

// ---------------------------------------------------------------------------
// /v1/run — Blocking
// ---------------------------------------------------------------------------

/**
 * @param {AgentFactory} agentFactory
 * @param {SessionGate} gate
 * @param {string} sessionId
 * @param {string} prompt
 * @param {number} timeoutMs
 * @returns {Promise<HandlerResponse>}
 */
async function handleRun(agentFactory, gate, sessionId, prompt, timeoutMs) {
  const timeout = createRequestTimeout(timeoutMs);

  try {
    const runPromise = gate.withSession(sessionId, async () => {
      const agent = await agentFactory(sessionId);
      const result = await agent.run(prompt, { signal: timeout.signal });
      return jsonOk(200, {
        session_id: sessionId,
        output: result.output || '',
        stop_reason: result.stop_reason || 'end_turn',
        usage: result.usage || { input_tokens: 0, output_tokens: 0 },
        tool_calls: result.tool_calls || [],
      });
    }, { signal: timeout.signal });
    return await Promise.race([runPromise, timeout.timeoutPromise]);
  } catch (err) {
    if (err.code === 'ERR_CONCURRENT_EXECUTION') {
      return jsonError(409, err.message);
    }
    if (isRequestTimeoutError(err)) {
      return jsonError(504, timeoutMessage());
    }
    return jsonError(502, err.message || 'Agent execution failed');
  } finally {
    timeout.clear();
  }
}

// ---------------------------------------------------------------------------
// /v1/run/stream — SSE
// ---------------------------------------------------------------------------

/**
 * @param {AgentFactory} agentFactory
 * @param {SessionGate} gate
 * @param {string} sessionId
 * @param {string} prompt
 * @param {number} timeoutMs
 * @param {import('./sse-writer.js').WritableTarget} streamTarget
 */
async function handleRunStream(agentFactory, gate, sessionId, prompt, timeoutMs, streamTarget) {
  const writer = new SseWriter(streamTarget);
  const timeout = createRequestTimeout(timeoutMs);

  try {
    const runPromise = gate.withSession(sessionId, async () => {
      const agent = await agentFactory(sessionId);

      // Subscribe to EventBus if available
      /** @type {Array<() => void>} */
      const unsubs = [];
      if (agent.eventBus) {
        for (const busEvent of Object.keys(BUS_TO_SSE_MAP)) {
          const off = agent.eventBus.on(busEvent, (data) => {
            const mapped = mapBusEventToStreamEvent(busEvent, data);
            if (mapped) writer.writeEvent(mapped.type, mapped);
          });
          unsubs.push(off);
        }
      }

      try {
        // Send agent_start
        writer.writeEvent(STREAM_EVENT_TYPES.AGENT_START, { session_id: sessionId });

        const result = await agent.run(prompt, { signal: timeout.signal });

        // Send final message_stop with result
        writer.writeEvent(STREAM_EVENT_TYPES.AGENT_STOP, {
          session_id: sessionId,
          output: result.output || '',
          stop_reason: result.stop_reason || 'end_turn',
          usage: result.usage || { input_tokens: 0, output_tokens: 0 },
        });
      } finally {
        for (const off of unsubs) off();
      }
    }, { signal: timeout.signal });
    await Promise.race([runPromise, timeout.timeoutPromise]);
  } catch (err) {
    if (isRequestTimeoutError(err)) {
      writer.writeError(timeoutMessage());
    } else {
      writer.writeError(err.message || 'Agent execution failed');
    }
  } finally {
    timeout.clear();
    writer.close();
  }
}
