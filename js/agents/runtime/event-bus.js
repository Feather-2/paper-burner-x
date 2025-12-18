const SCHEMA_VERSION = "0.1";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function testRegExp(re, value) {
  if (re.global || re.sticky) re.lastIndex = 0;
  return re.test(value);
}

function ensurePersistenceAdapter(persistenceAdapter) {
  if (persistenceAdapter === undefined || persistenceAdapter === null) return null;
  if (!isObject(persistenceAdapter)) {
    throw new TypeError("EventBus({ persistenceAdapter }): persistenceAdapter must be an object");
  }
  if (typeof persistenceAdapter.appendEvents !== "function") {
    throw new TypeError("EventBus({ persistenceAdapter }): persistenceAdapter.appendEvents must be a function");
  }
  if (typeof persistenceAdapter.getEvents !== "function") {
    throw new TypeError("EventBus({ persistenceAdapter }): persistenceAdapter.getEvents must be a function");
  }
  return persistenceAdapter;
}

export function isValidEventName(name) {
  // dot-separated lowercase segments: a-z0-9, must start with a letter/number.
  return typeof name === "string" && /^[a-z0-9]+(\.[a-z0-9]+)*$/.test(name);
}

export function createEventId(runId, seq) {
  const base = runId && typeof runId === "string" ? runId : "run_unknown";
  return `evt_${base}_${seq}`;
}

export function createEventRecord({
  runId,
  eventId,
  ts,
  name,
  actor,
  status,
  payload,
  meta,
  level,
  durationMs,
} = {}) {
  if (!isValidEventName(name)) {
    throw new Error(`Invalid event name: ${String(name)}`);
  }

  const record = {
    schemaVersion: SCHEMA_VERSION,
    eventId,
    runId,
    ts,
    name,
    actor,
  };

  if (level) record.level = level;
  if (status) record.status = status;
  if (typeof durationMs === "number") record.durationMs = durationMs;
  if (payload !== undefined) record.payload = payload;
  if (meta !== undefined) record.meta = meta;

  return record;
}

export class EventBus {
  constructor({ runId, persistenceAdapter } = {}) {
    this.runId = runId;
    this._seq = 0;
    this._listeners = new Map(); // name -> Set(fn)
    this._backpressure = null;
    this._persistenceAdapter = ensurePersistenceAdapter(persistenceAdapter);
  }

  on(name, handler) {
    if (typeof handler !== "function") {
      throw new TypeError("EventBus.on(name, handler): handler must be a function");
    }
    if (name !== "*" && !isValidEventName(name)) {
      throw new Error(`Invalid event name: ${String(name)}`);
    }

    let set = this._listeners.get(name);
    if (!set) {
      set = new Set();
      this._listeners.set(name, set);
    }
    set.add(handler);

    return () => this.off(name, handler);
  }

  once(name, handler) {
    const off = this.on(name, (evt) => {
      off();
      handler(evt);
    });
    return off;
  }

  off(name, handler) {
    const set = this._listeners.get(name);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this._listeners.delete(name);
  }

  enableBackpressure(options = {}) {
    if (options === null || options === undefined) options = {};
    if (!isObject(options)) {
      throw new TypeError("EventBus.enableBackpressure(options): options must be an object");
    }

    const batchWindowMs = options.batchWindowMs ?? 16;
    const coalescePattern = options.coalescePattern ?? /\.progress$/;

    if (typeof batchWindowMs !== "number" || !Number.isFinite(batchWindowMs) || batchWindowMs < 0) {
      throw new TypeError("EventBus.enableBackpressure(options): batchWindowMs must be a non-negative finite number");
    }
    if (!(coalescePattern instanceof RegExp)) {
      throw new TypeError("EventBus.enableBackpressure(options): coalescePattern must be a RegExp");
    }

    if (this._backpressure?.enabled) {
      this._cancelScheduledFlush();
      this._flushBackpressureQueue();
    }

    this._backpressure = {
      enabled: true,
      batchWindowMs,
      coalescePattern,
      scheduled: false,
      timerId: null,
      rafId: null,
      queue: [],
      coalesced: new Map(), // name -> { token, evt }
      token: 0,
    };

    return this;
  }

  disableBackpressure() {
    if (!this._backpressure?.enabled) return this;
    this._cancelScheduledFlush();
    this._flushBackpressureQueue();
    this._backpressure = null;
    return this;
  }

  _cancelScheduledFlush() {
    const bp = this._backpressure;
    if (!bp) return;
    bp.scheduled = false;
    if (bp.timerId !== null) {
      clearTimeout(bp.timerId);
      bp.timerId = null;
    }
    if (bp.rafId !== null && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(bp.rafId);
      bp.rafId = null;
    }
  }

  _scheduleFlush() {
    const bp = this._backpressure;
    if (!bp?.enabled || bp.scheduled) return;
    bp.scheduled = true;

    // Browser: rAF; Node: setTimeout.
    if (typeof globalThis.requestAnimationFrame === "function") {
      bp.rafId = globalThis.requestAnimationFrame(() => this._flushBackpressureQueue());
      return;
    }

    bp.timerId = setTimeout(() => this._flushBackpressureQueue(), bp.batchWindowMs);
  }

  _flushBackpressureQueue() {
    const bp = this._backpressure;
    if (!bp?.enabled) return;

    bp.scheduled = false;
    bp.timerId = null;
    bp.rafId = null;

    if (bp.queue.length === 0) {
      bp.coalesced.clear();
      return;
    }

    const queue = bp.queue;
    const coalesced = bp.coalesced;

    bp.queue = [];
    bp.coalesced = new Map();

    for (const item of queue) {
      if (item.kind === "event") {
        this._dispatch(item.evt);
        continue;
      }

      const latest = coalesced.get(item.name);
      if (latest && latest.token === item.token) this._dispatch(latest.evt);
    }
  }

  _dispatch(evt) {
    const direct = this._listeners.get(evt.name);
    if (direct) {
      for (const fn of [...direct]) fn(evt);
    }
    const any = this._listeners.get("*");
    if (any) {
      for (const fn of [...any]) fn(evt);
    }
  }

  _persistAsync(events) {
    if (!this._persistenceAdapter) return;
    if (!Array.isArray(events) || events.length === 0) return;

    queueMicrotask(() => {
      try {
        const res = this._persistenceAdapter.appendEvents(events);
        if (res && typeof res.then === "function") res.catch(() => {});
      } catch {
        // ignore persistence errors; EventBus is best-effort by default
      }
    });
  }

  emit(name, record = {}) {
    // Allow emit(name, payloadObject) by treating non-EventRecord-shaped objects as payload.
    let partial = record;
    if (!isObject(record)) partial = { payload: record };
    else if (!("payload" in record) && !("actor" in record) && !("status" in record)) {
      partial = { payload: record };
    }

    const runId = partial.runId ?? this.runId;
    const eventId = partial.eventId ?? createEventId(runId, ++this._seq);
    const ts = partial.ts ?? new Date().toISOString();
    const actor = partial.actor ?? "system";

    const evt = createEventRecord({
      ...partial,
      runId,
      eventId,
      ts,
      name,
      actor,
    });

    this._persistAsync([evt]);

    const bp = this._backpressure;
    if (!bp?.enabled) {
      this._dispatch(evt);
      return evt;
    }

    const shouldCoalesce = testRegExp(bp.coalescePattern, name);
    if (shouldCoalesce) {
      const token = ++bp.token;
      bp.coalesced.set(name, { token, evt });
      bp.queue.push({ kind: "coalesce", name, token });
    } else {
      bp.queue.push({ kind: "event", evt });
    }

    this._scheduleFlush();

    return evt;
  }

  async replay(runId) {
    if (!this._persistenceAdapter) {
      throw new Error("EventBus.replay(runId): persistenceAdapter is required");
    }
    if (!runId || typeof runId !== "string") {
      throw new TypeError("EventBus.replay(runId): runId must be a string");
    }

    let events;
    try {
      events = await this._persistenceAdapter.getEvents(runId);
    } catch (err) {
      throw new Error(`EventBus.replay(runId): failed to load events for runId=${runId}: ${String(err?.message || err)}`);
    }

    if (events === null || events === undefined) {
      throw new Error(`EventBus.replay(runId): no events found for runId=${runId}`);
    }
    if (!Array.isArray(events)) {
      throw new TypeError("EventBus.replay(runId): persistenceAdapter.getEvents(runId) must return an array");
    }

    const out = [];
    for (const raw of events) {
      if (!isObject(raw)) continue;
      const mergedMeta = isObject(raw.meta) ? { ...raw.meta, replay: true } : { replay: true };
      const evt = createEventRecord({ ...raw, runId: raw.runId ?? runId, meta: mergedMeta });
      this._dispatch(evt);
      out.push(evt);
    }
    return out;
  }
}

// Example adapter for persisting EventBus events into RunStore without changing RunStore code.
export class RunStoreAdapter {
  constructor(runStore) {
    if (!runStore || typeof runStore.getEvents !== "function") {
      throw new TypeError("RunStoreAdapter(runStore): runStore.getEvents must be a function");
    }
    if (typeof runStore.appendEvents !== "function" && typeof runStore.appendEvent !== "function") {
      throw new TypeError("RunStoreAdapter(runStore): runStore.appendEvents/appendEvent must be a function");
    }
    this.runStore = runStore;
  }

  async appendEvents(events = []) {
    if (!Array.isArray(events)) {
      throw new TypeError("RunStoreAdapter.appendEvents(events): events must be an array");
    }
    if (events.length === 0) return 0;

    const byRunId = new Map();
    for (const evt of events) {
      if (!isObject(evt)) continue;
      const runId = evt.runId;
      if (!runId || typeof runId !== "string") {
        throw new Error("RunStoreAdapter.appendEvents(events): each event must include a string runId");
      }
      const list = byRunId.get(runId) || [];
      list.push(evt);
      byRunId.set(runId, list);
    }

    for (const [runId, list] of byRunId) {
      if (typeof this.runStore.appendEvents === "function") {
        await this.runStore.appendEvents(runId, list);
        continue;
      }
      for (const evt of list) {
        await this.runStore.appendEvent(runId, evt);
      }
    }

    return events.length;
  }

  async getEvents(runId) {
    return this.runStore.getEvents(runId);
  }
}

