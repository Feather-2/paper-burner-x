import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketCrdtTransport, createWebSocketTransport } from '../../../../../js/agents/core/crdt/websocket-transport.js';

class MockWebSocket {
  static instances = [];
  static reset() { MockWebSocket.instances = []; }
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.sentMessages = [];
    this.listeners = new Map();
    this.addEventListener = vi.fn((event, handler) => {
      const handlers = this.listeners.get(event) || [];
      handlers.push(handler);
      this.listeners.set(event, handlers);
    });
    this.send = vi.fn((message) => { this.sentMessages.push(message); });
    this.close = vi.fn(() => { this.triggerClose({ code: 1000, reason: '' }); });
    MockWebSocket.instances.push(this);
  }
  trigger(event, data = {}) {
    const handlers = this.listeners.get(event) || [];
    for (const handler of handlers) handler(data);
  }
  triggerOpen() { this.trigger('open', {}); }
  triggerMessage(data) { this.trigger('message', { data }); }
  triggerClose(event = {}) { this.trigger('close', { code: event.code ?? 1000, reason: event.reason ?? '' }); }
  triggerError(event = {}) { this.trigger('error', event); }
}

const ORIGINAL_WEBSOCKET = globalThis.WebSocket;
const DEFAULT_URL = 'ws://localhost:1234/ws';
const createTransport = (options = {}) => new WebSocketCrdtTransport({ url: DEFAULT_URL, ...options });
const lastSocket = () => MockWebSocket.instances.at(-1);
const parseLastSent = (socket) => JSON.parse(socket.sentMessages.at(-1));
const flushMicrotasks = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  MockWebSocket.reset();
  globalThis.WebSocket = MockWebSocket;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.WebSocket = ORIGINAL_WEBSOCKET;
});

describe('WebSocketCrdtTransport', () => {
  describe('constructor', () => {
    it('requires url option', () => {
      expect(() => new WebSocketCrdtTransport()).toThrow(/requires options\.url/);
      expect(() => new WebSocketCrdtTransport({})).toThrow(/requires options\.url/);
      expect(() => new WebSocketCrdtTransport({ url: 1 })).toThrow(/requires options\.url/);
    });

    it('auto-connects by default', () => {
      const transport = createTransport();
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(lastSocket().url).toBe(DEFAULT_URL);
      expect(transport.state).toBe('CONNECTING');
    });

    it('respects autoConnect false and starts DISCONNECTED', () => {
      const transport = createTransport({ autoConnect: false });
      expect(MockWebSocket.instances).toHaveLength(0);
      expect(transport.state).toBe('DISCONNECTED');
    });
  });

  describe('connection', () => {
    it('connect() creates WebSocket with correct URL', () => {
      const transport = createTransport({ autoConnect: false });
      transport.connect();
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(lastSocket().url).toBe(DEFAULT_URL);
      expect(transport.state).toBe('CONNECTING');
    });

    it('connect() passes protocols to WebSocket constructor', () => {
      const protocols = ['crdt.v1', 'json'];
      const transport = createTransport({ autoConnect: false, protocols });
      transport.connect();
      expect(lastSocket().protocols).toEqual(protocols);
    });

    it('handles open/close events with state transitions', () => {
      const transport = createTransport({ autoConnect: false, reconnect: false });
      transport.connect();
      const socket = lastSocket();
      socket.triggerOpen();
      expect(transport.state).toBe('CONNECTED');
      socket.triggerClose({ code: 1000, reason: 'done' });
      expect(transport.state).toBe('DISCONNECTED');
    });

    it('handles error event and emits transport:error', () => {
      const transport = createTransport({ autoConnect: false });
      const errorHandler = vi.fn();
      transport.on('transport:error', errorHandler);
      transport.connect();
      const socket = lastSocket();
      const event = { message: 'boom' };
      socket.triggerError(event);
      expect(errorHandler).toHaveBeenCalledWith(event);
    });

    it('close() sets DISCONNECTING then DISCONNECTED and prevents auto-reconnect', async () => {
      vi.useFakeTimers();
      const transport = createTransport({ autoConnect: false, reconnect: true });
      const states = [];
      transport.on('transport:state', ({ current }) => states.push(current));
      transport.connect();
      const socket = lastSocket();
      socket.triggerOpen();
      transport.close();
      expect(states).toContain('DISCONNECTING');
      expect(transport.state).toBe('DISCONNECTED');
      await vi.advanceTimersByTimeAsync(20_000);
      expect(MockWebSocket.instances).toHaveLength(1);
    });
  });

  describe('send() - onReceive style', () => {
    it('send(messageObject) wraps in kind:message wire format', () => {
      const transport = createTransport({ autoConnect: false });
      transport.connect();
      const socket = lastSocket();
      socket.triggerOpen();
      transport.send({ type: 'crdt:op', docId: 'doc-1' });
      expect(parseLastSent(socket)).toEqual({ kind: 'message', message: { type: 'crdt:op', docId: 'doc-1' } });
    });

    it('onReceive(handler) dispatches wrapped and raw CRDT messages', async () => {
      const transport = createTransport({ autoConnect: false });
      const receiver = vi.fn();
      transport.onReceive(receiver);
      transport.connect();
      const socket = lastSocket();
      socket.triggerOpen();
      socket.triggerMessage(JSON.stringify({ kind: 'message', message: { type: 'crdt:sync', docId: 'a' } }));
      socket.triggerMessage(JSON.stringify({ type: 'crdt:op', docId: 'b', op: { id: 1 } }));
      await flushMicrotasks();
      expect(receiver).toHaveBeenCalledTimes(2);
      expect(receiver.mock.calls[0][0]).toEqual({ type: 'crdt:sync', docId: 'a' });
      expect(receiver.mock.calls[1][0]).toEqual({ type: 'crdt:op', docId: 'b', op: { id: 1 } });
    });
  });

  describe('send() - EventEmitter style', () => {
    it('send(eventName, payload) wraps in kind:event wire format', () => {
      const transport = createTransport({ autoConnect: false });
      transport.connect();
      const socket = lastSocket();
      socket.triggerOpen();
      transport.send('crdt:op', { docId: 'doc-1', op: { id: 2 } });
      expect(parseLastSent(socket)).toEqual({ kind: 'event', event: 'crdt:op', payload: { docId: 'doc-1', op: { id: 2 } } });
    });

    it('on(event, handler) and off(event, handler) manage handlers', async () => {
      const transport = createTransport({ autoConnect: false });
      const eventHandler = vi.fn();
      transport.on('crdt:op', eventHandler);
      transport.connect();
      const socket = lastSocket();
      socket.triggerOpen();
      socket.triggerMessage(JSON.stringify({ kind: 'event', event: 'crdt:op', payload: { id: 1 } }));
      await flushMicrotasks();
      expect(eventHandler).toHaveBeenCalledWith({ id: 1 });
      transport.off('crdt:op', eventHandler);
      socket.triggerMessage(JSON.stringify({ kind: 'event', event: 'crdt:op', payload: { id: 2 } }));
      await flushMicrotasks();
      expect(eventHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('offline queue', () => {
    it('queues messages while disconnected and flushes on reconnect', () => {
      const transport = createTransport({ autoConnect: false, reconnect: false });
      transport.send({ type: 'crdt:op', id: 1 });
      transport.send({ type: 'crdt:op', id: 2 });
      expect(transport._queue).toHaveLength(2);
      expect(MockWebSocket.instances).toHaveLength(0);
      transport.connect();
      const socket = lastSocket();
      socket.triggerOpen();
      expect(socket.sentMessages).toHaveLength(2);
      expect(socket.sentMessages.map(text => JSON.parse(text))).toEqual([
        { kind: 'message', message: { type: 'crdt:op', id: 1 } },
        { kind: 'message', message: { type: 'crdt:op', id: 2 } },
      ]);
      expect(transport._queue).toHaveLength(0);
    });

    it('drops oldest when queue exceeds maxQueueSize and emits overflow', () => {
      const transport = createTransport({ autoConnect: false, reconnect: false, maxQueueSize: 2 });
      const overflowHandler = vi.fn();
      transport.on('transport:queue-overflow', overflowHandler);
      transport.send({ type: 'crdt:op', id: 1 });
      transport.send({ type: 'crdt:op', id: 2 });
      transport.send({ type: 'crdt:op', id: 3 });
      expect(transport._queue).toHaveLength(2);
      expect(overflowHandler).toHaveBeenCalledWith({ dropped: 1 });
      expect(transport._queue.map(text => JSON.parse(text).message.id)).toEqual([2, 3]);
    });
  });

  describe('heartbeat', () => {
    it('sends ping after heartbeat interval', async () => {
      vi.useFakeTimers();
      const transport = createTransport({ autoConnect: false, reconnect: false, heartbeatInterval: 1000 });
      transport.connect();
      const socket = lastSocket();
      socket.triggerOpen();
      await vi.advanceTimersByTimeAsync(1000);
      expect(parseLastSent(socket).kind).toBe('ping');
      transport.close();
    });

    it('responds to incoming ping with pong', async () => {
      const transport = createTransport({ autoConnect: false, reconnect: false });
      transport.connect();
      const socket = lastSocket();
      socket.triggerOpen();
      socket.triggerMessage(JSON.stringify({ kind: 'ping', ts: 123 }));
      await flushMicrotasks();
      expect(parseLastSent(socket).kind).toBe('pong');
      transport.close();
    });

    it('closes socket on heartbeat timeout when no pong is received', async () => {
      vi.useFakeTimers();
      const transport = createTransport({ autoConnect: false, reconnect: false, heartbeatInterval: 1000 });
      const timeoutHandler = vi.fn();
      transport.on('transport:heartbeat-timeout', timeoutHandler);
      transport.connect();
      const socket = lastSocket();
      socket.triggerOpen();
      await vi.advanceTimersByTimeAsync(3000);
      expect(timeoutHandler).toHaveBeenCalledTimes(1);
      expect(socket.close).toHaveBeenCalledTimes(1);
      expect(transport.state).toBe('DISCONNECTED');
    });
  });

  describe('auto-reconnect', () => {
    it('schedules reconnect after unexpected close', async () => {
      vi.useFakeTimers();
      const transport = createTransport({ autoConnect: false });
      const scheduled = vi.fn();
      transport.on('transport:reconnect-scheduled', scheduled);
      transport.connect();
      const socket = lastSocket();
      socket.triggerOpen();
      socket.triggerClose({ code: 1006, reason: 'abnormal' });
      expect(scheduled).toHaveBeenCalledWith({ attempt: 1, delay: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(MockWebSocket.instances).toHaveLength(2);
      transport.close();
    });

    it('uses exponential backoff (1s, 2s, 4s...)', async () => {
      vi.useFakeTimers();
      const transport = createTransport({ autoConnect: false });
      const delays = [];
      transport.on('transport:reconnect-scheduled', (event) => delays.push(event.delay));
      transport.connect();
      const socket1 = lastSocket();
      socket1.triggerOpen();
      socket1.triggerClose({ code: 1006 });
      await vi.advanceTimersByTimeAsync(1000);
      const socket2 = lastSocket();
      socket2.triggerClose({ code: 1006 });
      await vi.advanceTimersByTimeAsync(2000);
      const socket3 = lastSocket();
      socket3.triggerClose({ code: 1006 });
      expect(delays.slice(0, 3)).toEqual([1000, 2000, 4000]);
      transport.close();
    });

    it('resets reconnect attempt counter on successful connect', async () => {
      vi.useFakeTimers();
      const transport = createTransport({ autoConnect: false });
      const attempts = [];
      transport.on('transport:reconnect-scheduled', (event) => attempts.push(event.attempt));
      transport.connect();
      const socket1 = lastSocket();
      socket1.triggerOpen();
      socket1.triggerClose({ code: 1006 });
      await vi.advanceTimersByTimeAsync(1000);
      const socket2 = lastSocket();
      socket2.triggerOpen();
      socket2.triggerClose({ code: 1006 });
      expect(attempts).toEqual([1, 1]);
      transport.close();
    });
  });

  describe('message validation', () => {
    it('rejects oversized outbound messages and emits transport:message-too-large', () => {
      const transport = createTransport({ autoConnect: false, maxMessageSize: 1024 });
      const oversized = vi.fn();
      transport.on('transport:message-too-large', oversized);
      transport.connect();
      const socket = lastSocket();
      socket.triggerOpen();
      transport.send({ type: 'crdt:op', payload: 'x'.repeat(1400) });
      expect(oversized).toHaveBeenCalledWith(expect.objectContaining({ direction: 'outbound', limit: 1024 }));
      expect(socket.sentMessages).toHaveLength(0);
    });

    it('handles invalid JSON gracefully and emits transport:parse-error', async () => {
      const transport = createTransport({ autoConnect: false });
      const parseError = vi.fn();
      const receiver = vi.fn();
      transport.on('transport:parse-error', parseError);
      transport.onReceive(receiver);
      transport.connect();
      const socket = lastSocket();
      socket.triggerOpen();
      socket.triggerMessage('{invalid json');
      await flushMicrotasks();
      expect(parseError).toHaveBeenCalledTimes(1);
      expect(receiver).not.toHaveBeenCalled();
    });

    it('rejects oversized inbound messages and emits transport:message-too-large', async () => {
      const transport = createTransport({ autoConnect: false, maxMessageSize: 1024 });
      const oversized = vi.fn();
      const receiver = vi.fn();
      transport.on('transport:message-too-large', oversized);
      transport.onReceive(receiver);
      transport.connect();
      const socket = lastSocket();
      socket.triggerOpen();
      socket.triggerMessage('x'.repeat(1300));
      await flushMicrotasks();
      expect(oversized).toHaveBeenCalledWith(expect.objectContaining({ direction: 'inbound', limit: 1024 }));
      expect(receiver).not.toHaveBeenCalled();
    });
  });

  describe('factory function', () => {
    it('createWebSocketTransport returns WebSocketCrdtTransport instance', () => {
      const transport = createWebSocketTransport({ url: DEFAULT_URL, autoConnect: false });
      expect(transport).toBeInstanceOf(WebSocketCrdtTransport);
    });
  });
});
