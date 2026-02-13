const TRACE_VERSION = '00';
const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE = /^[0-9a-f]{16}$/;
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

import { createLogger } from '../../shared/utils/logger.js';

const logger = createLogger('contracts/trace-propagator');

/** @typedef {{ emit: (event: string, payload?: unknown) => unknown }} EventBusLike */
/** @typedef {{ traceId: string, spanId: string, parentSpanId?: string, traceparent: string }} TraceInfo */
/** @typedef {Record<string, unknown>} TraceCarrier */
/** @typedef {{ events?: EventBusLike }} TraceContextPropagatorOptions */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isRecord(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
/** @param {unknown} v @returns {string | null} */
function str(v) { return typeof v === 'string' && v.trim() ? v.trim() : null; }
/** @param {string} hex @returns {boolean} */
function isAllZero(hex) { return /^0+$/.test(hex); }
/** @param {unknown} v @returns {string | null} */
function normalizeTraceId(v) {
  const value = str(v)?.toLowerCase() ?? null;
  return value && TRACE_ID_RE.test(value) && !isAllZero(value) ? value : null;
}
/** @param {unknown} v @returns {string | null} */
function normalizeSpanId(v) {
  const value = str(v)?.toLowerCase() ?? null;
  return value && SPAN_ID_RE.test(value) && !isAllZero(value) ? value : null;
}
/** @param {Record<string, unknown>} obj @param {string} key @returns {unknown} */
function getField(obj, key) {
  if (key in obj) return obj[key];
  const wanted = key.toLowerCase().replace(/[-_]/g, '');
  for (const [k, v] of Object.entries(obj)) if (k.toLowerCase().replace(/[-_]/g, '') === wanted) return v;
  return undefined;
}

/**
 * @param {unknown} header
 * @returns {{ traceId: string, spanId: string, sampled: boolean, traceparent: string } | null}
 */
function parseTraceparentParts(header) {
  const value = str(header);
  if (!value) return null;
  const m = TRACEPARENT_RE.exec(value);
  if (!m) return null;
  const traceId = m[1].toLowerCase();
  const spanId = m[2].toLowerCase();
  const flags = m[3].toLowerCase();
  if (isAllZero(traceId) || isAllZero(spanId)) return null;
  return { traceId, spanId, sampled: (parseInt(flags, 16) & 1) === 1, traceparent: `${TRACE_VERSION}-${traceId}-${spanId}-${flags}` };
}

/** @param {Record<string, unknown>} source @returns {TraceInfo | null} */
function extractFromSource(source) {
  const parsed = parseTraceparentParts(getField(source, 'traceparent'));
  const traceId = normalizeTraceId(getField(source, 'traceId')) || parsed?.traceId || null;
  const spanId = normalizeSpanId(getField(source, 'spanId')) || parsed?.spanId || null;
  const parentSpanId = normalizeSpanId(getField(source, 'parentSpanId')) || undefined;
  if (!traceId || !spanId) return null;
  return { traceId, spanId, ...(parentSpanId ? { parentSpanId } : {}), traceparent: parsed?.traceparent || formatTraceparent(traceId, spanId, true) };
}

/** @param {number} bytes @returns {string} */
function randomHex(bytes) {
  const c = globalThis?.crypto;
  const target = bytes * 2;
  if (typeof c?.randomUUID === 'function') {
    let out = '';
    while (out.length < target) out += c.randomUUID().replace(/-/g, '').toLowerCase();
    return out.slice(0, target);
  }
  if (typeof c?.getRandomValues === 'function') {
    const arr = new Uint8Array(bytes);
    c.getRandomValues(arr);
    return Array.from(arr, (v) => v.toString(16).padStart(2, '0')).join('');
  }
  let out = '';
  for (let i = 0; i < target; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/** @param {string} name @param {string} traceId @param {string | null} parentSpanId @param {boolean} sampled @returns {Record<string, unknown>} */
function createSpanLike(name, traceId, parentSpanId, sampled) {
  const spanId = generateSpanId();
  return {
    spanId,
    traceId,
    parentSpanId,
    name: str(name) || 'operation',
    startTime: Date.now(),
    endTime: null,
    status: 'unset',
    statusMessage: null,
    traceparent: formatTraceparent(traceId, spanId, sampled),
    setStatus(status, message) { if (typeof status === 'string' && status) this.status = status; if (typeof message === 'string') this.statusMessage = message; return this; },
    recordException(error) { this.status = 'error'; this.statusMessage = error instanceof Error ? error.message : String(error ?? 'error'); return this; },
    end() { if (this.endTime === null) this.endTime = Date.now(); if (this.status === 'unset') this.status = 'ok'; return this; },
  };
}

/** @param {{ traceId: string, parentSpanId?: string, sampled?: boolean }} options @returns {Record<string, unknown>} */
function createTraceContextLike({ traceId, parentSpanId, sampled = true }) {
  /** @type {Record<string, unknown>[]} */ const stack = [];
  return {
    traceId,
    parentSpanId: parentSpanId || null,
    startSpan(name, options = {}) {
      const parentFromOption = isRecord(options) && isRecord(options.parentSpan) ? normalizeSpanId(options.parentSpan.spanId) : null;
      const active = stack.length > 0 ? stack[stack.length - 1] : null;
      const nextParent = parentFromOption || (active ? normalizeSpanId(active.spanId) : null) || this.parentSpanId;
      const span = createSpanLike(str(name) || 'operation', traceId, nextParent || null, sampled);
      stack.push(span);
      return span;
    },
    createSpan(name, options = {}) { return this.startSpan(name, options); },
    endSpan(span) {
      const target = isRecord(span) ? span : (stack.length > 0 ? stack[stack.length - 1] : null);
      if (!target) return;
      target.end();
      const idx = stack.lastIndexOf(target);
      if (idx >= 0) stack.splice(idx, 1);
    },
    async withSpan(name, fn, options = {}) {
      const span = this.startSpan(name, options);
      try { return await fn(span); } catch (error) { span.recordException(error); throw error; } finally { this.endSpan(span); }
    },
    getTraceparent() { const active = stack.length > 0 ? stack[stack.length - 1] : null; return active ? String(active.traceparent) : formatTraceparent(traceId, generateSpanId(), sampled); },
    get currentSpan() { return stack.length > 0 ? stack[stack.length - 1] : null; },
  };
}

export class TraceContextPropagator {
  constructor(options = {}) { this._events = options?.events ?? null; }

  inject(traceContext, carrier) {
    const target = isRecord(carrier) ? carrier : {};
    const extracted = this._extractTraceFromContext(traceContext);
    if (!extracted) return target;
    target.traceId = extracted.traceId;
    target.spanId = extracted.spanId;
    if (extracted.parentSpanId) target.parentSpanId = extracted.parentSpanId;
    target.traceparent = extracted.traceparent;
    this._emit('trace:injected', extracted);
    return target;
  }

  extract(carrier) {
    if (!isRecord(carrier)) return null;
    const candidates = [carrier];
    if (isRecord(carrier.trace)) candidates.push(carrier.trace);
    if (isRecord(carrier.metadata)) candidates.push(carrier.metadata);
    if (isRecord(carrier.meta)) candidates.push(carrier.meta);
    if (isRecord(carrier.headers)) candidates.push(carrier.headers);
    if (isRecord(carrier.payload)) candidates.push(carrier.payload);
    if (isRecord(carrier.payload) && isRecord(carrier.payload.trace)) candidates.push(carrier.payload.trace);
    if (isRecord(carrier.meta) && isRecord(carrier.meta.trace)) candidates.push(carrier.meta.trace);
    if (isRecord(carrier.meta) && isRecord(carrier.meta.message) && isRecord(carrier.meta.message.metadata)) candidates.push(carrier.meta.message.metadata);
    for (const source of candidates) {
      const hit = extractFromSource(source);
      if (!hit) continue;
      this._emit('trace:extracted', hit);
      return hit;
    }
    return null;
  }

  createChildContext(parentCarrier, operationName) {
    const parent = this.extract(parentCarrier);
    const sampled = parent ? (parseTraceparentParts(parent.traceparent)?.sampled ?? true) : true;
    const traceContext = createTraceContextLike({ traceId: parent?.traceId || generateTraceId(), parentSpanId: parent?.spanId || parent?.parentSpanId, sampled });
    const span = traceContext.startSpan(str(operationName) || 'agent:operation');
    this._emit('trace:child_created', { traceId: traceContext.traceId, parentSpanId: span.parentSpanId, spanId: span.spanId });
    return { traceContext, span };
  }

  propagateToMessage(traceContext, message) {
    const target = isRecord(message) ? message : {};
    const metadata = isRecord(target.metadata) ? target.metadata : {};
    this.inject(traceContext, metadata);
    target.metadata = metadata;
    this._emit('trace:message_propagated', { traceId: metadata.traceId, spanId: metadata.spanId });
    return target;
  }

  extractFromMessage(message) {
    if (!isRecord(message)) return null;
    if (isRecord(message.metadata)) {
      const fromMetadata = this.extract(message.metadata);
      if (fromMetadata) return fromMetadata;
    }
    return this.extract(message);
  }

  wrapEventData(traceContext, eventData) {
    const trace = this.extract(this.inject(traceContext, {}));
    const base = isRecord(eventData) ? { ...eventData } : { payload: eventData };
    if (!trace) return base;
    this._emit('trace:event_wrapped', { traceId: trace.traceId, spanId: trace.spanId });
    return { ...base, trace };
  }

  extractFromEvent(eventRecord) { return isRecord(eventRecord) ? this.extract(eventRecord) : null; }
  createTraceparent(traceId, spanId, sampled = true) { return formatTraceparent(traceId, spanId, sampled); }
  parseTraceparent(header) { return parseTraceparent(header); }
  generateTraceId() { return generateTraceId(); }
  generateSpanId() { return generateSpanId(); }

  _extractTraceFromContext(traceContext) {
    if (!isRecord(traceContext)) return null;
    const currentSpan = isRecord(traceContext.currentSpan) ? traceContext.currentSpan : null;
    if (currentSpan) { const fromCurrent = this.extract(currentSpan); if (fromCurrent) return fromCurrent; }
    const direct = this.extract(traceContext);
    if (direct) return direct;
    if (typeof traceContext.getTraceparent === 'function') {
      const parsed = parseTraceparent(traceContext.getTraceparent());
      if (parsed) return parsed;
    }
    const traceId = normalizeTraceId(traceContext.traceId);
    if (!traceId) return null;
    const spanId = generateSpanId();
    return { traceId, spanId, traceparent: formatTraceparent(traceId, spanId, true) };
  }

  _emit(event, payload) {
    if (!this._events || typeof this._events.emit !== 'function') return;
    try {
      this._events.emit(event, { actor: 'trace-propagator', status: 'info', payload });
    } catch (err) {
      logger.debug('Event emission failed', { event, error: err.message });
    }
  }
}

export function generateTraceId() { return randomHex(16); }
export function generateSpanId() { return randomHex(8); }
export function formatTraceparent(traceId, spanId, sampled = true) {
  const tid = normalizeTraceId(traceId) || generateTraceId();
  const sid = normalizeSpanId(spanId) || generateSpanId();
  return `${TRACE_VERSION}-${tid}-${sid}-${sampled ? '01' : '00'}`;
}
export function parseTraceparent(header) {
  const parsed = parseTraceparentParts(header);
  return parsed ? { traceId: parsed.traceId, spanId: parsed.spanId, traceparent: parsed.traceparent } : null;
}
export function createTracePropagator(options = {}) { return new TraceContextPropagator(options); }
export function injectTrace(traceContext, carrier) { return defaultPropagator.inject(traceContext, carrier); }
export function extractTrace(carrier) { return defaultPropagator.extract(carrier); }

const defaultPropagator = createTracePropagator();
