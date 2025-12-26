import { EventBus } from '../../agents/runtime/events/event-bus.js';

const DEFAULT_COALESCE_PATTERN = /\.progress$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEvent(evt) {
  if (!isPlainObject(evt)) {
    const name = typeof evt === 'string' ? evt : '';
    return {
      name,
      record: { payload: evt }
    };
  }

  const base = isPlainObject(evt.record) ? evt.record : evt;
  const name = typeof base.name === 'string' ? base.name : (typeof evt.name === 'string' ? evt.name : '');
  const payload = Object.prototype.hasOwnProperty.call(base, 'payload') ? base.payload : evt.payload;

  return {
    name,
    record: {
      eventId: base.eventId ?? evt.eventId,
      runId: base.runId ?? evt.runId,
      ts: base.ts ?? evt.ts,
      name,
      actor: base.actor ?? evt.actor,
      status: base.status ?? evt.status,
      level: base.level ?? evt.level,
      durationMs: base.durationMs ?? evt.durationMs,
      payload,
      meta: base.meta ?? evt.meta,
    }
  };
}

function isUiEventName(name) {
  return typeof name === 'string' && (
    name === 'iteration.completed' ||
    name.startsWith('compression.') ||
    name.startsWith('deepsearch.') ||
    name.startsWith('design.')
  );
}

export class AgentEventBridge {
  constructor(eventBus, { batchWindowMs = 16, coalescePattern = DEFAULT_COALESCE_PATTERN } = {}) {
    if (!eventBus || (typeof eventBus.subscribe !== 'function' && typeof eventBus.on !== 'function')) {
      throw new TypeError('AgentEventBridge(eventBus): eventBus must implement subscribe/on');
    }

    this._sourceBus = eventBus;
    this._uiBus = new EventBus({ runId: eventBus.runId });
    const isNode = typeof process !== 'undefined' && !!process.versions?.node;
    if (!isNode) {
      this._uiBus.enableBackpressure({ batchWindowMs, coalescePattern });
    }
    this._unsubs = [];
    this._started = false;
    this._handleSourceEvent = (evt) => this._forward(evt);
  }

  start() {
    if (this._started) return;

    if (typeof this._sourceBus.subscribe === 'function') {
      this._unsubs.push(this._sourceBus.subscribe('deepsearch.*', this._handleSourceEvent));
      this._unsubs.push(this._sourceBus.subscribe('design.*', this._handleSourceEvent));
      this._unsubs.push(this._sourceBus.subscribe('iteration.completed', this._handleSourceEvent));
      this._unsubs.push(this._sourceBus.subscribe('compression.*', this._handleSourceEvent));
    } else {
      this._unsubs.push(this._sourceBus.on('*', (evt) => {
        const name = evt?.name;
        if (!isUiEventName(name)) return;
        this._handleSourceEvent(evt);
      }));
    }

    this._started = true;
  }

  stop() {
    for (const off of this._unsubs) {
      try {
        off?.();
      } catch {
        // ignore
      }
    }
    this._unsubs = [];
    this._started = false;
  }

  on(name, handler) {
    return this._uiBus.on(name, handler);
  }

  once(name, handler) {
    return this._uiBus.once(name, handler);
  }

  subscribe(pattern, handler, options) {
    return this._uiBus.subscribe(pattern, handler, options);
  }

  get runId() {
    return this._uiBus.runId;
  }

  _forward(evt) {
    const normalized = normalizeEvent(evt);
    if (!isUiEventName(normalized.name)) return;
    this._uiBus.emit(normalized.name, normalized.record);
  }
}

export function createAgentEventBridge(eventBus, options) {
  const bridge = new AgentEventBridge(eventBus, options);
  bridge.start();
  return bridge;
}
