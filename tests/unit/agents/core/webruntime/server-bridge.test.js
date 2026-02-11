import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServerBridge, createFetchHandler } from '../../../../../js/agents/core/webruntime/server-bridge.js';
import { installFetchHandler } from '../../../../../js/agents/core/webruntime/sw-handler.js';

describe('server-bridge', () => {
  /** @type {ReturnType<typeof createServerBridge>} */
  let bridge;

  beforeEach(() => {
    bridge = createServerBridge();
  });

  describe('ServerBridge constructor', () => {
    it('sets default config values', () => {
      expect(bridge.ready).toBe(false);
      expect(bridge._scope).toBe('/__virtual__/');
      expect(bridge._swUrl).toBe('/sw.js');
      expect(bridge._keepaliveInterval).toBe(25000);
    });

    it('accepts custom config', () => {
      const custom = createServerBridge({
        swUrl: '/custom-sw.js',
        scope: '/__custom__/',
        keepaliveInterval: 10000,
      });
      expect(custom._swUrl).toBe('/custom-sw.js');
      expect(custom._scope).toBe('/__custom__/');
      expect(custom._keepaliveInterval).toBe(10000);
    });
  });

  describe('listen', () => {
    it('returns a VirtualServer object', () => {
      const server = bridge.listen(8080);
      expect(server).toHaveProperty('port', 8080);
      expect(server).toHaveProperty('onRequest');
      expect(server).toHaveProperty('close');
      expect(typeof server.onRequest).toBe('function');
      expect(typeof server.close).toBe('function');
    });

    it('registers handler via onRequest', async () => {
      const server = bridge.listen(3000);
      const handler = vi.fn().mockResolvedValue({
        status: 200, headers: {}, body: 'ok',
      });
      server.onRequest(handler);

      const fetch = createFetchHandler(bridge);
      const resp = await fetch(new Request('http://localhost/__virtual__/3000/api'));
      expect(resp.status).toBe(200);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET', url: '/api' }),
      );
    });

    it('removes server on close', async () => {
      const server = bridge.listen(4000);
      server.onRequest(vi.fn().mockResolvedValue({ status: 200, headers: {}, body: '' }));
      server.close();

      const fetch = createFetchHandler(bridge);
      const resp = await fetch(new Request('http://localhost/__virtual__/4000/'));
      expect(resp.status).toBe(404);
    });
  });

  describe('createFetchHandler', () => {
    it('routes to the correct port', async () => {
      const handler1 = vi.fn().mockResolvedValue({ status: 200, headers: {}, body: 'port1' });
      const handler2 = vi.fn().mockResolvedValue({ status: 200, headers: {}, body: 'port2' });
      bridge.listen(5001).onRequest(handler1);
      bridge.listen(5002).onRequest(handler2);

      const fetch = createFetchHandler(bridge);
      const r1 = await fetch(new Request('http://localhost/__virtual__/5001/'));
      const r2 = await fetch(new Request('http://localhost/__virtual__/5002/'));

      expect(await r1.text()).toBe('port1');
      expect(await r2.text()).toBe('port2');
      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });

    it('returns 404 for non-existent port', async () => {
      const fetch = createFetchHandler(bridge);
      const resp = await fetch(new Request('http://localhost/__virtual__/9999/'));
      expect(resp.status).toBe(404);
    });

    it('returns 404 for non-virtual path', async () => {
      const fetch = createFetchHandler(bridge);
      const resp = await fetch(new Request('http://localhost/other/path'));
      expect(resp.status).toBe(404);
    });

    it('forwards custom status and body', async () => {
      bridge.listen(6000).onRequest(async () => ({
        status: 201,
        headers: { 'x-custom': 'yes' },
        body: '{"created":true}',
      }));

      const fetch = createFetchHandler(bridge);
      const resp = await fetch(new Request('http://localhost/__virtual__/6000/items'));
      expect(resp.status).toBe(201);
      expect(resp.headers.get('x-custom')).toBe('yes');
      expect(await resp.json()).toEqual({ created: true });
    });

    it('returns 503 when no handler registered', async () => {
      bridge.listen(7000); // no onRequest

      const fetch = createFetchHandler(bridge);
      const resp = await fetch(new Request('http://localhost/__virtual__/7000/'));
      expect(resp.status).toBe(503);
      expect(await resp.text()).toBe('No handler');
    });
  });

  describe('stop', () => {
    it('clears all servers', async () => {
      bridge.listen(8001);
      bridge.listen(8002);
      await bridge.stop();
      expect(bridge._servers.size).toBe(0);
      expect(bridge.ready).toBe(false);
    });
  });

  describe('multiple ports', () => {
    it('handles concurrent requests to different ports', async () => {
      bridge.listen(9001).onRequest(async (req) => ({
        status: 200, headers: {}, body: 'a:' + req.url,
      }));
      bridge.listen(9002).onRequest(async (req) => ({
        status: 200, headers: {}, body: 'b:' + req.url,
      }));

      const fetch = createFetchHandler(bridge);
      const [r1, r2] = await Promise.all([
        fetch(new Request('http://localhost/__virtual__/9001/x')),
        fetch(new Request('http://localhost/__virtual__/9002/y')),
      ]);

      expect(await r1.text()).toBe('a:/x');
      expect(await r2.text()).toBe('b:/y');
    });
  });
});

describe('sw-handler', () => {
  it('exports installFetchHandler', () => {
    expect(typeof installFetchHandler).toBe('function');
  });
});
