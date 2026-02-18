import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from '../../../../../../js/agents/core/node-compat/shims/ws.js';

class MockNativeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url, protocols) {
    this.url = String(url);
    this.protocol = Array.isArray(protocols) ? (protocols[0] || '') : (protocols || '');
    this.extensions = '';
    this.readyState = MockNativeWebSocket.CONNECTING;
    this.bufferedAmount = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
  }

  send() {}

  close(code = 1000, reason = '') {
    this.readyState = MockNativeWebSocket.CLOSED;
    if (this.onclose) this.onclose({ code, reason });
  }
}

describe('ws shim', () => {
  /** @type {typeof globalThis.WebSocket | undefined} */
  let originalWebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = MockNativeWebSocket;
  });

  afterEach(() => {
    if (originalWebSocket === undefined) {
      delete globalThis.WebSocket;
      return;
    }
    globalThis.WebSocket = originalWebSocket;
  });

  describe('WebSocket', () => {
    it('has correct state constants', () => {
      expect(WebSocket.CONNECTING).toBe(0);
      expect(WebSocket.OPEN).toBe(1);
      expect(WebSocket.CLOSING).toBe(2);
      expect(WebSocket.CLOSED).toBe(3);
    });

    it('creates instance with state constants', () => {
      const ws = new WebSocket('ws://localhost:8080');
      expect(ws.CONNECTING).toBe(0);
      expect(ws.OPEN).toBe(1);
      expect(ws.CLOSING).toBe(2);
      expect(ws.CLOSED).toBe(3);
    });

    it('wraps native WebSocket when available', () => {
      const ws = new WebSocket('ws://localhost:8080');
      expect(ws._ws).toBeInstanceOf(globalThis.WebSocket);
    });

    it('accepts URL object as address', () => {
      const url = new URL('ws://localhost:8080/path');
      const ws = new WebSocket(url);
      expect(ws._ws).toBeInstanceOf(globalThis.WebSocket);
    });

    it('accepts protocols parameter', () => {
      const ws = new WebSocket('ws://localhost:8080', 'protocol1');
      expect(ws._ws).toBeInstanceOf(globalThis.WebSocket);
    });

    it('exposes readyState property', () => {
      const ws = new WebSocket('ws://localhost:8080');
      expect(typeof ws.readyState).toBe('number');
    });

    it('exposes bufferedAmount property', () => {
      const ws = new WebSocket('ws://localhost:8080');
      expect(typeof ws.bufferedAmount).toBe('number');
    });

    it('exposes extensions property', () => {
      const ws = new WebSocket('ws://localhost:8080');
      expect(typeof ws.extensions).toBe('string');
    });

    it('exposes protocol property', () => {
      const ws = new WebSocket('ws://localhost:8080');
      expect(typeof ws.protocol).toBe('string');
    });

    it('exposes url property', () => {
      const ws = new WebSocket('ws://localhost:8080');
      expect(typeof ws.url).toBe('string');
    });

    it('has send method', () => {
      const ws = new WebSocket('ws://localhost:8080');
      expect(typeof ws.send).toBe('function');
    });

    it('has close method', () => {
      const ws = new WebSocket('ws://localhost:8080');
      expect(typeof ws.close).toBe('function');
      ws.close();
    });

    it('has terminate method', () => {
      const ws = new WebSocket('ws://localhost:8080');
      expect(typeof ws.terminate).toBe('function');
    });

    it('has ping and pong methods', () => {
      const ws = new WebSocket('ws://localhost:8080');
      expect(typeof ws.ping).toBe('function');
      expect(typeof ws.pong).toBe('function');
    });

    it('emits open event when connection opens', () => {
      const ws = new WebSocket('ws://localhost:8080');
      const onOpen = vi.fn();
      ws.on('open', onOpen);

      ws._ws.readyState = WebSocket.OPEN;
      ws._ws.onopen({ type: 'open' });

      expect(ws.readyState).toBe(WebSocket.OPEN);
      expect(onOpen).toHaveBeenCalledWith({ type: 'open' });
    });

    it('emits message event when receiving data', () => {
      const ws = new WebSocket('ws://localhost:8080');
      const onMessage = vi.fn();
      ws.on('message', onMessage);

      ws._ws.onmessage({ data: 'test message' });

      expect(onMessage).toHaveBeenCalledWith('test message', false);
    });

    it('emits close event when connection closes', () => {
      const ws = new WebSocket('ws://localhost:8080');
      const onClose = vi.fn();
      ws.on('close', onClose);

      ws._ws.readyState = WebSocket.CLOSED;
      ws._ws.onclose({ code: 1000, reason: 'normal' });

      expect(ws.readyState).toBe(WebSocket.CLOSED);
      expect(onClose).toHaveBeenCalledWith(1000, 'normal');
    });

    it('emits error event on error', () => {
      const ws = new WebSocket('ws://localhost:8080');
      const onError = vi.fn();
      ws.on('error', onError);

      const err = new Error('connection failed');
      ws._ws.onerror({ error: err });

      expect(onError).toHaveBeenCalledWith(err);
    });
  });

  describe('WebSocketServer', () => {
    it('creates server instance', () => {
      const wss = new WebSocketServer({ port: 8080 });
      expect(wss).toBeInstanceOf(WebSocketServer);
    });

    it('stores options', () => {
      const options = { port: 8080, host: 'localhost' };
      const wss = new WebSocketServer(options);
      expect(wss.options).toEqual(options);
    });

    it('has clients set', () => {
      const wss = new WebSocketServer();
      expect(wss.clients).toBeInstanceOf(Set);
    });

    it('has close method', () => {
      const wss = new WebSocketServer();
      expect(typeof wss.close).toBe('function');
    });

    it('close method accepts callback', () => {
      const wss = new WebSocketServer();
      const callback = vi.fn();
      wss.close(callback);
      expect(callback).toHaveBeenCalled();
    });

    it('close method clears clients', () => {
      const wss = new WebSocketServer();
      wss.clients.add('client1');
      wss.close();
      expect(wss.clients.size).toBe(0);
    });

    it('has handleUpgrade stub method', () => {
      const wss = new WebSocketServer();
      expect(typeof wss.handleUpgrade).toBe('function');
    });

    it('shouldHandle defaults to true when no path restriction is configured', () => {
      const wss = new WebSocketServer();
      expect(wss.shouldHandle()).toBe(true);
    });

    it('shouldHandle respects configured path restriction', () => {
      const wss = new WebSocketServer({ path: '/socket' });
      expect(wss.shouldHandle({ url: '/socket' })).toBe(true);
      expect(wss.shouldHandle({ url: '/other' })).toBe(false);
    });

    it('handleUpgrade fail-fast emits unsupported error', () => {
      const wss = new WebSocketServer();
      const errFn = vi.fn();
      const cb = vi.fn();
      wss.on('error', errFn);
      wss.handleUpgrade({ url: '/socket' }, {}, Buffer.from(''), cb);
      expect(errFn).toHaveBeenCalled();
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ code: 'ERR_WS_SERVER_UNSUPPORTED' }));
    });
  });
});
