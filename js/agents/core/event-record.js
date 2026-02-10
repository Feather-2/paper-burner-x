/**
 * Event record helpers with Lamport clock integration.
 */

import * as LamportClockModule from './lamport-clock.js';
import { assertValidEventName, createEventId } from './event-bus-utils.js';

/**
 * @typedef {import('./types.d.ts').LamportClockState} LamportClockState
 * @typedef {import('./types.d.ts').EventRecord} CoreEventRecord
 */

/**
 * 分布式追踪信息
 * @typedef {object} EventTraceInfo
 * @property {string} [traceId] - W3C Trace ID (32 hex chars)
 * @property {string} [spanId] - W3C Span ID (16 hex chars)
 * @property {string} [parentSpanId] - Parent Span ID
 * @property {string} [traceparent] - W3C traceparent header value
 */

/**
 * EventBus 内部使用的结构化事件记录。
 *
 * 说明：
 * - `CoreEventRecord` 来自 `core/types.d.ts`（兼容旧字段：id/type/timestamp/clock）
 * - 本模块同时保留运行时字段：schemaVersion/eventId/runId/ts/name/_clock/seq 等
 * - `trace` 字段用于分布式追踪（可选，与 TraceContext 集成）
 *
 * @typedef {Omit<CoreEventRecord, 'payload'> & { payload?: unknown } & {
 *   schemaVersion: string,
 *   eventId: string,
 *   runId: string | null,
 *   ts: string,
 *   name: string,
 *   actor: string,
 *   level?: string,
 *   durationMs?: number,
 *   meta?: unknown,
 *   status?: string,
 *   trace?: EventTraceInfo,
 *   _clock: LamportClockState,
 *   seq: number,
 * }} EventRecord
 */

/**
 * @typedef {object} CreateEventRecordOptions
 * @property {string | null} [runId]
 * @property {string} [eventId]
 * @property {string} [ts]
 * @property {string} [name]
 * @property {string} [actor]
 * @property {string} [status]
 * @property {unknown} [payload]
 * @property {unknown} [meta]
 * @property {string} [level]
 * @property {number} [durationMs]
 * @property {EventTraceInfo} [trace]
 * @property {LamportClockState} [_clock]
 * @property {string} [id] - legacy alias for eventId
 * @property {string} [type] - legacy alias for name
 * @property {number} [timestamp] - legacy alias for ts (ms)
 * @property {LamportClockState} [clock] - legacy alias for _clock
 */

const SCHEMA_VERSION = '0.1';

/**
 * 创建结构化事件记录
 * @param {CreateEventRecordOptions} [options]
 * @returns {EventRecord}
 */
export function createEventRecord({
  runId,
  eventId,
  ts,
  name,
  actor = 'system',
  status,
  payload,
  meta,
  level,
  durationMs,
  trace,
  _clock,
  // legacy aliases (core/types.d.ts)
  id,
  type,
  timestamp,
  clock: clockInput,
} = {}) {
  // 生成逻辑时钟
  let clock = _clock || clockInput;
  if (!clock || typeof clock.seq !== 'number') {
    clock = LamportClockModule.nextTick();
  } else {
    LamportClockModule.sync(clock.seq);
  }

  const resolvedName = typeof name === 'string' && name
    ? name
    : (typeof type === 'string' && type ? type : 'unknown');

  assertValidEventName(resolvedName);

  const resolvedTs = typeof ts === 'string' && ts
    ? ts
    : (typeof timestamp === 'number' && Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString()
        : new Date().toISOString());

  const resolvedTimestamp = (typeof timestamp === 'number' && Number.isFinite(timestamp))
    ? timestamp
    : (Number.isFinite(Date.parse(resolvedTs)) ? Date.parse(resolvedTs) : Date.now());

  const resolvedEventId = (typeof eventId === 'string' && eventId)
    ? eventId
    : (typeof id === 'string' && id ? id : createEventId(runId, clock.seq));

  /** @type {EventRecord} */
  const record = {
    // core/types.d.ts compatible fields
    id: resolvedEventId,
    type: resolvedName,
    timestamp: resolvedTimestamp,
    clock,

    schemaVersion: SCHEMA_VERSION,
    eventId: resolvedEventId,
    runId: typeof runId === 'string' ? runId : null,
    ts: resolvedTs,
    name: resolvedName,
    actor,
    _clock: clock,
    seq: clock.seq,
  };

  if (level) record.level = level;
  if (status) record.status = status;
  if (typeof durationMs === 'number') record.durationMs = durationMs;
  if (payload !== undefined) record.payload = payload;
  if (meta !== undefined) record.meta = meta;
  if (trace && typeof trace === 'object' && typeof trace.traceId === 'string') record.trace = trace;

  return record;
}

/**
 * @param {number} seq
 * @returns {LamportClockState}
 */
export function createEventBusClock(seq) {
  return {
    seq: LamportClockModule.currentSeq(),
    ts: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    id: `eventbus_${seq}`,
  };
}
