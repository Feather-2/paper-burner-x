import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocket, WebSocketServer } from '../../../../../../js/agents/core/node-compat/shims/ws.js';

describe('ws shim', () => {
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

    it('emits open event when connection opens', (done) => {
      const ws = new WebSocket('ws://localhost:8080');
      ws.on('open', () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        done();
      });
      // Simulate open event
      ws._ws.onopen({ type: 'open' });
    });

    it('emits message event when receiving data', (done) => {
      const ws = new WebSocket('ws://localhost:8080');
      ws.on('message', (data, isBinary) => {
        expect(data).toBe('test message');
        expect(isBinary).toBe(false);
        done();
      });
      // Simulate message event
      ws._ws.onmessage({ data: 'test message' });
    });

    it('emits close event when connection closes', (done) => {
      const ws = new WebSocket('ws://localhost:8080');
      ws.on('close', (code, reason) => {
        expect(ws.readyState).toBe(WebSocket.CLOSED);
        expect(code).toBe(1000);
        expect(reason).toBe('normal');
        done();
      });
      // Simulate close event
      ws._ws.onclose({ code: 1000, reason: 'normal' });
    });

    it('emits error event on error', (done) => {
      const ws = new WebSocket('ws://localhost:8080');
      ws.on('error', (error) => {
        expect(error).toBeInstanceOf(Error);
        done();
      });
      // Simulate error event
      ws._ws.onerror({ error: new Error('connection failed') });
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

    it('has shouldHandle stub method', () => {
      const wss = new WebSocketServer();
      expect(wss.shouldHandle()).toBe(false);
    });
  });
});
