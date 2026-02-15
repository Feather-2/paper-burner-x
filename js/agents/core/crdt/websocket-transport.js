import { createLogger, protoSafeReviver } from '../../shared/index.js';
const logger = createLogger('core/crdt/websocket-transport');
const ConnectionState = { CONNECTING: 'CONNECTING', CONNECTED: 'CONNECTED', DISCONNECTING: 'DISCONNECTING', DISCONNECTED: 'DISCONNECTED' };
/** @typedef {{ type: string, [key: string]: unknown }} CRDTSyncMessage */
/** @typedef {(message: CRDTSyncMessage) => void} ReceiveHandler */
/** @typedef {(data?: unknown) => void} TransportHandler */
/** @typedef {{ kind: 'message', message: CRDTSyncMessage } | { kind: 'event', event: string, payload?: unknown } | { kind: 'ping', ts: number } | { kind: 'pong', ts: number }} WireMessage */
/** @typedef {{ url: string, protocols?: string | string[], autoConnect?: boolean, reconnect?: boolean, heartbeatInterval?: number, maxQueueSize?: number, maxMessageSize?: number }} WebSocketCrdtTransportOptions */

export class WebSocketCrdtTransport {
  /** @param {WebSocketCrdtTransportOptions} options */
  constructor(options) {
    if (!options?.url || typeof options.url !== 'string') throw new Error('WebSocketCrdtTransport requires options.url');
    this._url = options.url;
    this._protocols = options.protocols;
    this._reconnect = options.reconnect !== false;
    this._heartbeatInterval = Math.max(1000, options.heartbeatInterval || 30000);
    this._maxQueueSize = Math.max(1, options.maxQueueSize || 500);
    this._maxMessageSize = Math.max(1024, options.maxMessageSize || 256 * 1024);
    this._state = ConnectionState.DISCONNECTED;
    /** @type {WebSocket | null} */ this._socket = null;
    /** @type {number | null} */ this._reconnectTimer = null;
    /** @type {number | null} */ this._heartbeatTimer = null;
    this._reconnectAttempt = 0;
    this._lastPongAt = Date.now();
    this._shouldReconnect = this._reconnect;
    /** @type {Map<string, Set<TransportHandler>>} */ this._handlers = new Map();
    /** @type {Set<ReceiveHandler>} */ this._receiveHandlers = new Set();
    /** @type {string[]} */ this._queue = [];
    this._encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;
    this._decoder = typeof TextDecoder === 'function' ? new TextDecoder() : null;
    if (options.autoConnect !== false) this.connect();
  }
  get state() { return this._state; }
  get connected() { return this._state === ConnectionState.CONNECTED; }
  connect() {
    this._shouldReconnect = this._reconnect;
    if (this.connected || this._state === ConnectionState.CONNECTING) return;
    this._openSocket();
  }
  send(...args) {
    /** @type {WireMessage | null} */ let msg = null;
    if (typeof args[0] === 'string') msg = { kind: 'event', event: args[0], payload: args[1] };
    else if (args[0] && typeof args[0] === 'object') msg = { kind: 'message', message: /** @type {CRDTSyncMessage} */ (args[0]) };
    if (!msg) {
      const argTypes = args.map(v => typeof v);
      logger.warn('Ignored invalid send() call', { argTypes });
      this._emit('transport:invalid-send', { argTypes });
      return;
    }
    this._sendWire(msg, true);
  }
  onReceive(handler) { if (typeof handler === 'function') this._receiveHandlers.add(handler); }
  on(event, handler) {
    if (!event || typeof handler !== 'function') return;
    const set = this._handlers.get(event) || new Set();
    set.add(handler);
    this._handlers.set(event, set);
  }
  off(event, handler) {
    const set = this._handlers.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this._handlers.delete(event);
  }
  close() {
    this._shouldReconnect = false;
    this._clearReconnectTimer();
    this._stopHeartbeat();
    if (!this._socket) return this._setState(ConnectionState.DISCONNECTED);
    this._setState(ConnectionState.DISCONNECTING);
    try {
      this._socket.close();
    } catch (error) {
      logger.warn('Failed to close WebSocket', { error: error?.message });
      this._socket = null;
      this._setState(ConnectionState.DISCONNECTED);
    }
    this._handlers.clear();
    this._receiveHandlers.clear();
    this._queue.length = 0;
  }
  _openSocket() {
    if (this._state === ConnectionState.CONNECTING || this._state === ConnectionState.CONNECTED) return;
    const WS = globalThis.WebSocket;
    if (typeof WS !== 'function') {
      const error = new Error('globalThis.WebSocket is unavailable');
      this._emit('transport:error', error);
      logger.error(error.message);
      return;
    }
    this._setState(ConnectionState.CONNECTING);
    try {
      this._socket = this._protocols ? new WS(this._url, this._protocols) : new WS(this._url);
    } catch (error) {
      this._setState(ConnectionState.DISCONNECTED);
      this._emit('transport:error', error);
      logger.error('WebSocket creation failed', { error: error?.message });
      this._scheduleReconnect();
      return;
    }
    const socket = this._socket;
    socket.addEventListener('open', () => this._handleOpen(socket));
    socket.addEventListener('message', (event) => { void this._handleIncoming(event.data); });
    socket.addEventListener('error', (event) => { this._emit('transport:error', event); logger.warn('WebSocket transport error', { state: this._state }); });
    socket.addEventListener('close', (event) => this._handleClose(socket, event));
  }
  _handleOpen(socket) {
    if (this._socket !== socket) return;
    this._clearReconnectTimer();
    this._reconnectAttempt = 0;
    this._lastPongAt = Date.now();
    this._setState(ConnectionState.CONNECTED);
    this._emit('transport:connected');
    this._startHeartbeat();
    this._flushQueue();
  }
  _handleClose(socket, event) {
    if (this._socket !== socket) return;
    this._socket = null;
    this._stopHeartbeat();
    const manual = this._state === ConnectionState.DISCONNECTING || !this._shouldReconnect;
    this._setState(ConnectionState.DISCONNECTED);
    this._emit('transport:disconnected', { code: event.code, reason: event.reason || '' });
    if (!manual) this._scheduleReconnect();
  }
  async _handleIncoming(raw) {
    const text = await this._toText(raw);
    if (!text) return;
    const inboundSize = this._byteLength(text);
    if (inboundSize > this._maxMessageSize) {
      this._emit('transport:message-too-large', { direction: 'inbound', size: inboundSize, limit: this._maxMessageSize });
      return;
    }
    /** @type {unknown} */ let parsed;
    try { parsed = JSON.parse(text, protoSafeReviver); } catch (error) {
      this._emit('transport:parse-error', { error: error?.message });
      logger.warn('Invalid JSON from peer', { error: error?.message });
      return;
    }
    this._lastPongAt = Date.now();
    if (!parsed || typeof parsed !== 'object') return this._emit('transport:invalid-message', { reason: 'non-object payload' });
    const msg = /** @type {Record<string, unknown>} */ (parsed);
    if (msg.kind === 'ping') return void this._sendWire({ kind: 'pong', ts: Date.now() }, false);
    if (msg.kind === 'pong') return void this._emit('transport:pong', { ts: msg.ts || Date.now() });
    if (msg.kind === 'message' && msg.message && typeof msg.message === 'object') return void this._dispatchCrdt(/** @type {CRDTSyncMessage} */ (msg.message));
    if (msg.kind === 'event' && typeof msg.event === 'string') {
      const eventName = msg.event;
      const payload = msg.payload;
      this._emit(eventName, payload);
      this._emit('transport:event', { event: eventName });
      if (eventName.startsWith('crdt:') && payload && typeof payload === 'object') this._dispatchReceive({ type: eventName, .../** @type {Record<string, unknown>} */ (payload) });
      return;
    }
    if (typeof msg.type === 'string') return void this._dispatchCrdt(/** @type {CRDTSyncMessage} */ (msg));
    this._emit('transport:invalid-message', { reason: 'unknown wire format' });
  }
  _dispatchCrdt(message) {
    this._dispatchReceive(message);
    this._emit('transport:message', message);
    if (typeof message.type === 'string') this._emit(message.type, message);
  }
  _dispatchReceive(message) {
    for (const handler of this._receiveHandlers) {
      try { handler(message); } catch (error) { logger.error('onReceive handler failed', { error: error?.message }); }
    }
  }
  _sendWire(message, queueWhenOffline) {
    const text = this._serialize(message);
    if (!text) return;
    if (this.connected && this._socket) {
      try { this._socket.send(text); return; } catch (error) { logger.warn('WebSocket send failed; enqueuing', { error: error?.message }); }
    }
    if (!queueWhenOffline) return;
    this._queue.push(text);
    if (this._queue.length > this._maxQueueSize) {
      const dropped = this._queue.length - this._maxQueueSize;
      this._queue.splice(0, dropped);
      this._emit('transport:queue-overflow', { dropped });
    }
    if (this._state === ConnectionState.DISCONNECTED && this._shouldReconnect) this.connect();
  }
  _flushQueue() {
    if (!this.connected || !this._socket || this._queue.length === 0) return;
    while (this._queue.length > 0) {
      const item = this._queue.shift();
      if (!item) break;
      try { this._socket.send(item); } catch (error) {
        this._queue.unshift(item);
        logger.warn('Queue flush interrupted', { error: error?.message });
        break;
      }
    }
  }
  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (!this.connected) return;
      if (Date.now() - this._lastPongAt > this._heartbeatInterval * 2) {
        this._emit('transport:heartbeat-timeout');
        this._socket?.close();
        return;
      }
      this._sendWire({ kind: 'ping', ts: Date.now() }, false);
    }, this._heartbeatInterval);
  }
  _stopHeartbeat() {
    if (this._heartbeatTimer !== null) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    this._clearReconnectTimer();
  }
  _scheduleReconnect() {
    if (!this._shouldReconnect || this._reconnectTimer !== null) return;
    const attempt = this._reconnectAttempt + 1;
    const delay = Math.min(1000 * (2 ** this._reconnectAttempt), 16000);
    this._reconnectAttempt = attempt;
    this._emit('transport:reconnect-scheduled', { attempt, delay });
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this._shouldReconnect) return;
      this._openSocket();
    }, delay);
  }
  _clearReconnectTimer() { if (this._reconnectTimer !== null) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; } }
  _serialize(message) {
    let text = '';
    try { text = JSON.stringify(message); } catch (error) {
      this._emit('transport:serialize-error', { error: error?.message });
      logger.warn('Failed to serialize message', { error: error?.message });
      return null;
    }
    const size = this._byteLength(text);
    if (size > this._maxMessageSize) {
      this._emit('transport:message-too-large', { direction: 'outbound', size, limit: this._maxMessageSize });
      return null;
    }
    return text;
  }
  async _toText(raw) {
    if (typeof raw === 'string') return raw;
    if (raw instanceof ArrayBuffer) return this._decode(new Uint8Array(raw));
    if (ArrayBuffer.isView(raw)) return this._decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    if (typeof Blob !== 'undefined' && raw instanceof Blob) return raw.text();
    return null;
  }
  _decode(bytes) {
    if (this._decoder) return this._decoder.decode(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
    return out;
  }
  _byteLength(text) { return this._encoder ? this._encoder.encode(text).length : text.length; }
  _setState(next) {
    if (this._state === next) return;
    const previous = this._state;
    this._state = next;
    this._emit('transport:state', { previous, current: next });
  }
  _emit(event, data) {
    const handlers = this._handlers.get(event);
    if (!handlers?.size) return;
    for (const handler of handlers) {
      try { handler(data); } catch (error) { logger.error(`Transport handler failed: ${event}`, { error: error?.message }); }
    }
  }
}

/** @param {WebSocketCrdtTransportOptions} options @returns {WebSocketCrdtTransport} */
export function createWebSocketTransport(options) { return new WebSocketCrdtTransport(options); }
