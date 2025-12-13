const SCHEMA_VERSION = "0.1";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

  return record;
}

export class EventBus {
  constructor({ runId } = {}) {
    this.runId = runId;
    this._seq = 0;
    this._listeners = new Map(); // name -> Set(fn)
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

    const direct = this._listeners.get(name);
    if (direct) {
      for (const fn of [...direct]) fn(evt);
    }
    const any = this._listeners.get("*");
    if (any) {
      for (const fn of [...any]) fn(evt);
    }

    return evt;
  }
}

