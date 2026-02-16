/**
 * SSE stream event types and EventBus→SSE mapping.
 *
 * Defines Anthropic-compatible and agent-extension event types
 * for the `/v1/run/stream` endpoint.
 *
 * @module sdk/http/stream-events
 */

// ---------------------------------------------------------------------------
// Event type constants
// ---------------------------------------------------------------------------

/** @enum {string} */
export const STREAM_EVENT_TYPES = Object.freeze({
  // Anthropic-compatible
  MESSAGE_START:       'message_start',
  CONTENT_BLOCK_START: 'content_block_start',
  CONTENT_BLOCK_DELTA: 'content_block_delta',
  CONTENT_BLOCK_STOP:  'content_block_stop',
  MESSAGE_DELTA:       'message_delta',
  MESSAGE_STOP:        'message_stop',
  PING:                'ping',

  // Agent extensions
  AGENT_START:              'agent_start',
  AGENT_STOP:               'agent_stop',
  ITERATION_START:          'iteration_start',
  ITERATION_STOP:           'iteration_stop',
  TOOL_EXECUTION_START:     'tool_execution_start',
  TOOL_EXECUTION_OUTPUT:    'tool_execution_output',
  TOOL_EXECUTION_RESULT:    'tool_execution_result',
  ERROR:                    'error',
});

// ---------------------------------------------------------------------------
// EventBus event name → SSE type mapping
// ---------------------------------------------------------------------------

/**
 * Maps EventBus event names to SSE stream event types.
 * Only events listed here are forwarded to the SSE stream.
 *
 * @type {Record<string, string>}
 */
export const BUS_TO_SSE_MAP = Object.freeze({
  // Agent lifecycle
  'agent:start':       STREAM_EVENT_TYPES.AGENT_START,
  'agent:stop':        STREAM_EVENT_TYPES.AGENT_STOP,
  'agent:end':         STREAM_EVENT_TYPES.AGENT_STOP,

  // Iteration
  'run:iteration:start': STREAM_EVENT_TYPES.ITERATION_START,
  'run:iteration:end':   STREAM_EVENT_TYPES.ITERATION_STOP,

  // LLM / content
  'llm:start':         STREAM_EVENT_TYPES.MESSAGE_START,
  'llm:token':         STREAM_EVENT_TYPES.CONTENT_BLOCK_DELTA,
  'llm:complete':      STREAM_EVENT_TYPES.MESSAGE_STOP,

  // Tool execution
  'tool:start':        STREAM_EVENT_TYPES.TOOL_EXECUTION_START,
  'tool:output':       STREAM_EVENT_TYPES.TOOL_EXECUTION_OUTPUT,
  'tool:complete':     STREAM_EVENT_TYPES.TOOL_EXECUTION_RESULT,
  'tool:error':        STREAM_EVENT_TYPES.TOOL_EXECUTION_RESULT,

  // Errors
  'agent:error':       STREAM_EVENT_TYPES.ERROR,
  'run:error':         STREAM_EVENT_TYPES.ERROR,
});

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/**
 * Map an EventBus event to an SSE stream event payload.
 *
 * @param {string} busEventName  EventBus event name (e.g. 'llm:token')
 * @param {*} busEventData       EventBus event data
 * @returns {{ type: string, data: * } | null}  SSE event or null if not mapped
 */
export function mapBusEventToStreamEvent(busEventName, busEventData) {
  const sseType = BUS_TO_SSE_MAP[busEventName];
  if (!sseType) return null;

  return {
    type: sseType,
    ...(busEventData && typeof busEventData === 'object' ? busEventData : { data: busEventData }),
  };
}
