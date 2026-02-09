/**
 * EventBus helper utilities.
 */

import { createEventRecord } from './event-record.js';
import { matchPattern } from './event-bus-utils.js';

/**
 * @typedef {import('./types.d.ts').LamportClockState} LamportClockState
 */

export const DEFAULT_BACKPRESSURE_BATCH_WINDOW_MS = 16;
export const DEFAULT_BACKPRESSURE_COALESCE_PATTERN = /\.progress$/;
export const DEFAULT_BACKPRESSURE_DEFER_NON_COALESCED = true;
export const DEFAULT_BACKPRESSURE_MAX_QUEUE_SIZE = 1000;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {RegExp | null | undefined} re
 * @param {string} text
 * @returns {boolean}
 */
export function regexTest(re, text) {
  if (!re || typeof re.test !== 'function') return false;
  // Avoid RegExp.lastIndex footguns with /g and /y.
  if (re.global || re.sticky) re.lastIndex = 0;
  return re.test(text);
}

/**
 * @param {any} runStore
 * @returns {Record<string, unknown>}
 */
export function normalizeRunStore(runStore) {
  return runStore && typeof runStore === 'object' ? runStore : {};
}

/**
 * @param {Record<string, unknown>} store
 * @returns {void}
 */
export function assertRunStoreShape(store) {
  if (typeof store.getEvents !== 'function') {
    throw new TypeError('RunStoreAdapter(runStore): runStore.getEvents must be a function');
  }
  if (typeof store.appendEvents !== 'function' && typeof store.appendEvent !== 'function') {
    throw new TypeError('RunStoreAdapter(runStore): runStore.appendEvents/appendEvent must be a function');
  }
}

/**
 * @param {any[]} events
 * @returns {void}
 */
export function assertRunStoreEvents(events) {
  if (!Array.isArray(events)) {
    throw new TypeError('RunStoreAdapter.appendEvents(events): events must be an array');
  }

  for (const evt of events) {
    if (!isObject(evt) || typeof evt.runId !== 'string' || !evt.runId) {
      throw new TypeError('RunStoreAdapter.appendEvents(events): events must include a string runId');
    }
  }
}

/**
 * @param {any} runStore
 * @param {any[]} events
 * @returns {Promise<number>}
 */
export async function appendEventsToRunStore(runStore, events) {
  assertRunStoreEvents(events);
  if (events.length === 0) return 0;

  const hasBatch = typeof runStore.appendEvents === 'function';
  const total = events.length;

  if (hasBatch) {
    /** @type {Map<string, any[]>} */
    const byRunId = new Map();
    for (const evt of events) {
      const runId = evt.runId;
      const bucket = byRunId.get(runId);
      if (bucket) bucket.push(evt);
      else byRunId.set(runId, [evt]);
    }

    const tasks = [];
    for (const [runId, batch] of byRunId) {
      tasks.push(runStore.appendEvents(runId, batch));
    }
    if (tasks.length === 0) return total;
    await Promise.all(tasks);
    return total;
  }

  const tasks = [];
  for (const evt of events) {
    const runId = evt.runId;
    tasks.push(runStore.appendEvent(runId, evt));
  }
  if (tasks.length === 0) return total;
  await Promise.all(tasks);
  return total;
}

/**
 * @param {unknown} adapter
 * @returns {void}
 */
export function assertPersistenceAdapter(adapter) {
  if (!isObject(adapter)) {
    throw new TypeError('EventBus: persistenceAdapter must be an object');
  }
  if (typeof adapter.appendEvents !== 'function') {
    throw new TypeError('EventBus: persistenceAdapter.appendEvents is required');
  }
  if (typeof adapter.getEvents !== 'function') {
    throw new TypeError('EventBus: persistenceAdapter.getEvents is required');
  }
}

/**
 * @param {{ name: string, payload?: unknown }} evt
 * @returns {{ type: string, payload: unknown, event: string, data: unknown }}
 */
export function toWaitForResult(evt) {
  return {
    type: evt.name,
    payload: evt.payload ?? evt,
    // 兼容旧 API
    event: evt.name,
    data: evt.payload ?? evt,
  };
}

/**
 * @param {{ batchWindowMs?: number, coalescePattern?: RegExp, deferNonCoalesced?: boolean, maxQueueSize?: number }} [options]
 * @returns {{ batchWindowMs: number, coalescePattern: RegExp, deferNonCoalesced: boolean, maxQueueSize: number }}
 */
export function normalizeBackpressureOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('EventBus.enableBackpressure: options must be an object');
  }

  const {
    batchWindowMs = DEFAULT_BACKPRESSURE_BATCH_WINDOW_MS,
    coalescePattern = DEFAULT_BACKPRESSURE_COALESCE_PATTERN,
    deferNonCoalesced = DEFAULT_BACKPRESSURE_DEFER_NON_COALESCED,
    maxQueueSize = DEFAULT_BACKPRESSURE_MAX_QUEUE_SIZE,
  } = options;

  if (typeof batchWindowMs !== 'number' || !Number.isFinite(batchWindowMs) || batchWindowMs < 0) {
    throw new TypeError('EventBus.enableBackpressure: batchWindowMs must be a non-negative finite number');
  }
  if (!(coalescePattern instanceof RegExp)) {
    throw new TypeError('EventBus.enableBackpressure: coalescePattern must be a RegExp');
  }
  if (typeof maxQueueSize !== 'number' || !Number.isFinite(maxQueueSize) || maxQueueSize <= 0) {
    throw new TypeError('EventBus.enableBackpressure: maxQueueSize must be a positive finite number');
  }

  return {
    batchWindowMs,
    coalescePattern,
    deferNonCoalesced,
    maxQueueSize,
  };
}

/**
 * @param {{ batchWindowMs?: number, coalescePattern?: RegExp, deferNonCoalesced?: boolean, maxQueueSize?: number }} options
 * @param {number} generation
 * @returns {{
 *   enabled: boolean,
 *   batchWindowMs: number,
 *   coalescePattern: RegExp,
 *   deferNonCoalesced: boolean,
 *   maxQueueSize: number,
 *   queue: any[],
 *   coalesced: Map<string, { token: number, evt: any }>,
 *   token: number,
 *   scheduled: boolean,
 *   rafId: number | null,
 *   timeoutId: ReturnType<typeof setTimeout> | null,
 *   generation: number,
 * }}
 */
export function createBackpressureState(options, generation) {
  const normalized = normalizeBackpressureOptions(options);
  return {
    enabled: true,
    ...normalized,
    queue: [],
    coalesced: new Map(),
    token: 0,
    scheduled: false,
    rafId: null,
    timeoutId: null,
    generation,
  };
}

/**
 * @param {{ rafId: number | null, timeoutId: ReturnType<typeof setTimeout> | null, scheduled: boolean } | null | undefined} backpressure
 * @returns {void}
 */
export function cancelBackpressureSchedule(backpressure) {
  if (!backpressure) return;
  try {
    if (backpressure.rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(backpressure.rafId);
    }
  } catch {
    // ignore
  }
  try {
    if (backpressure.timeoutId !== null) clearTimeout(backpressure.timeoutId);
  } catch {
    // ignore
  }
  backpressure.rafId = null;
  backpressure.timeoutId = null;
  backpressure.scheduled = false;
}

/**
 * @param {{
 *   queue: any[],
 *   maxQueueSize: number,
 *   coalescePattern: RegExp,
 *   coalesced: Map<string, { token: number, evt: any }>,
 *   token: number,
 *   deferNonCoalesced: boolean,
 * }} backpressure
 * @param {{ name: string }} evt
 * @returns {'queued' | 'dispatch'}
 */
export function enqueueBackpressureEvent(backpressure, evt) {
  if (backpressure.queue.length >= backpressure.maxQueueSize) {
    backpressure.queue.shift();
  }

  const shouldCoalesce = regexTest(backpressure.coalescePattern, evt.name);
  if (shouldCoalesce) {
    backpressure.coalesced.set(evt.name, { token: ++backpressure.token, evt });
    backpressure.queue.push({ kind: 'coalesce', name: evt.name, token: backpressure.token });
    return 'queued';
  }

  if (backpressure.deferNonCoalesced) {
    backpressure.queue.push({ kind: 'event', evt });
    return 'queued';
  }

  return 'dispatch';
}

/**
 * @param {{
 *   scheduled: boolean,
 *   queue: any[],
 *   coalesced: Map<string, { token: number, evt: any }>,
 * }} backpressure
 * @param {(evt: any) => void} dispatch
 * @returns {void}
 */
export function flushBackpressureQueue(backpressure, dispatch) {
  backpressure.scheduled = false;
  const queue = backpressure.queue;
  const coalesced = backpressure.coalesced;

  backpressure.queue = [];
  backpressure.coalesced = new Map();

  for (const item of queue) {
    if (item.kind === 'event') {
      dispatch(item.evt);
    } else if (item.kind === 'coalesce') {
      const latest = coalesced.get(item.name);
      if (latest && latest.token === item.token) {
        dispatch(latest.evt);
      }
    }
  }
}

/**
 * @param {Map<string, Set<any>>} waitersMap
 * @param {string} eventName
 * @returns {{ pattern: string, waiters: any[] }[]}
 */
export function collectMatchingWaiters(waitersMap, eventName) {
  const toResolve = [];

  for (const [pattern, waiters] of waitersMap) {
    if (matchPattern(pattern, eventName)) {
      toResolve.push({ pattern, waiters: [...waiters] });
    }
  }

  return toResolve;
}

/**
 * @param {unknown} data
 * @returns {{
 *   payload: unknown,
 *   meta: unknown,
 *   actor?: string,
 *   status?: string,
 *   level?: string,
 * }}
 */
export function extractEventDataFields(data) {
  let payload = data;
  let meta = undefined;

  if (isObject(data) && ('payload' in data || 'actor' in data || 'status' in data)) {
    payload = data.payload;
    meta = data.meta;
  }

  const actor = isObject(data) && typeof data.actor === 'string' ? data.actor : undefined;
  const status = isObject(data) && typeof data.status === 'string' ? data.status : undefined;
  const level = isObject(data) && typeof data.level === 'string' ? data.level : undefined;

  return { payload, meta, actor, status, level };
}

/**
 * @param {Record<string, any>} raw
 * @returns {LamportClockState | { seq: number } | undefined}
 */
export function deriveReplayClock(raw) {
  if (isObject(raw._clock) && typeof raw._clock.seq === 'number') return raw._clock;
  if (isObject(raw.clock) && typeof raw.clock.seq === 'number') return raw.clock;
  if (typeof raw.seq === 'number') return { seq: raw.seq };
  return undefined;
}

/**
 * @param {Record<string, any>} raw
 * @param {string} runId
 * @returns {ReturnType<typeof createEventRecord>}
 */
export function createReplayEvent(raw, runId) {
  const rawRunId = typeof raw.runId === 'string' ? raw.runId : undefined;
  const rawMeta = isObject(raw.meta) ? raw.meta : undefined;
  const clock = deriveReplayClock(raw);

  return createEventRecord({
    ...raw,
    _clock: /** @type {LamportClockState | undefined} */ (/** @type {unknown} */ (clock)),
    runId: rawRunId ?? runId,
    meta: { ...(rawMeta || {}), replay: true },
  });
}
