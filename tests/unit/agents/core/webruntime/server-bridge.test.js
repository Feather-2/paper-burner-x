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
        scope: '__custom__',
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

    it('throws on duplicate port registration', () => {
      bridge.listen(4123);
      expect(() => bridge.listen(4123)).toThrow(/already exists/);
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

    it('respects bridge scope instead of hardcoded /__virtual__/', async () => {
      const scopedBridge = createServerBridge({ scope: '/__agent__/' });
      scopedBridge.listen(6100).onRequest(async () => ({
        status: 200,
        headers: {},
        body: 'scoped-ok',
      }));

      const fetch = createFetchHandler(scopedBridge);
      const okResp = await fetch(new Request('http://localhost/__agent__/6100/hi'));
      const missResp = await fetch(new Request('http://localhost/__virtual__/6100/hi'));
      expect(await okResp.text()).toBe('scoped-ok');
      expect(missResp.status).toBe(404);
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

    it('optionally unregisters service worker registration on stop', async () => {
      const unregisterBridge = createServerBridge({ unregisterOnStop: true });
      const unregister = vi.fn().mockResolvedValue(true);
      unregisterBridge._registration = { unregister };
      await unregisterBridge.stop();
      expect(unregister).toHaveBeenCalledOnce();
      expect(unregisterBridge._registration).toBeNull();
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

  describe('message forwarding errors', () => {
    it('hides internal handler errors by default', async () => {
      /** @type {Record<string, any>} */
      const listeners = {};
      const serviceWorker = {
        controller: { postMessage: vi.fn() },
        register: vi.fn().mockResolvedValue({}),
        ready: Promise.resolve({}),
        addEventListener: vi.fn((event, handler) => {
          listeners[event] = handler;
        }),
        removeEventListener: vi.fn(),
      };
      vi.stubGlobal('navigator', { serviceWorker });

      const scopedBridge = createServerBridge({ scope: '/__virtual__/' });
      await scopedBridge.start();
      scopedBridge.listen(3210).onRequest(async () => {
        throw new Error('sensitive-details');
      });

      const replyPort = { postMessage: vi.fn() };
      listeners.message({
        data: {
          type: 'virtual-request',
          requestId: 'req-x',
          port: 3210,
          method: 'GET',
          url: '/',
          headers: {},
          body: null,
        },
        ports: [replyPort],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(replyPort.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'virtual-response',
        requestId: 'req-x',
        status: 500,
        body: 'Internal server error',
      }));

      await scopedBridge.stop();
      vi.unstubAllGlobals();
    });

    it('start fails fast when service worker controller is unavailable', async () => {
      /** @type {Record<string, any>} */
      const listeners = {};
      const serviceWorker = {
        controller: null,
        register: vi.fn().mockResolvedValue({}),
        ready: Promise.resolve({}),
        addEventListener: vi.fn((event, handler) => {
          listeners[event] = handler;
        }),
        removeEventListener: vi.fn(),
      };
      vi.stubGlobal('navigator', { serviceWorker });

      const scopedBridge = createServerBridge({
        scope: '/__virtual__/',
        controllerReadyTimeoutMs: 1,
      });
      await expect(scopedBridge.start()).rejects.toThrow(/controller unavailable/);
      vi.unstubAllGlobals();
    });
  });
});

describe('sw-handler', () => {
  it('installs listeners and ignores non-virtual requests', () => {
    /** @type {Record<string, any>} */
    const listeners = {};
    const sw = {
      addEventListener: vi.fn((type, handler) => {
        listeners[type] = handler;
      }),
      clients: {
        get: vi.fn(),
        matchAll: vi.fn(),
      },
    };

    expect(() => installFetchHandler(sw)).not.toThrow();
    expect(sw.addEventListener).toHaveBeenCalledWith('fetch', expect.any(Function));
    expect(sw.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));

    const respondWith = vi.fn();
    listeners.fetch({
      request: new Request('https://example.test/not-virtual/path'),
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
  });

  it('resolves the initiating client via resultingClientId/clientId instead of clients[0]', async () => {
    /** @type {Record<string, any>} */
    const listeners = {};
    const wrongClient = {
      postMessage: vi.fn((_, ports) => {
        ports[0].postMessage({ status: 200, headers: {}, body: 'wrong-client' });
      }),
    };
    const rightClient = {
      postMessage: vi.fn((_, ports) => {
        ports[0].postMessage({ status: 200, headers: {}, body: 'right-client' });
      }),
    };
    const sw = {
      addEventListener: vi.fn((type, handler) => {
        listeners[type] = handler;
      }),
      clients: {
        get: vi.fn().mockResolvedValue(rightClient),
        matchAll: vi.fn().mockResolvedValue([wrongClient]),
      },
    };

    installFetchHandler(sw);

    /** @type {Promise<Response> | undefined} */
    let responsePromise;
    listeners.fetch({
      request: new Request('https://example.test/__virtual__/3000/hello'),
      clientId: 'client-123',
      respondWith: (promise) => {
        responsePromise = promise;
      },
    });

    const response = await responsePromise;
    expect(sw.clients.get).toHaveBeenCalledWith('client-123');
    expect(sw.clients.matchAll).not.toHaveBeenCalled();
    expect(rightClient.postMessage).toHaveBeenCalledOnce();
    expect(wrongClient.postMessage).not.toHaveBeenCalled();
    expect(await response.text()).toBe('right-client');
  });

  it('returns 503 when no clientId and fallback is disabled', async () => {
    /** @type {Record<string, any>} */
    const listeners = {};
    const sw = {
      addEventListener: vi.fn((type, handler) => {
        listeners[type] = handler;
      }),
      clients: {
        get: vi.fn().mockResolvedValue(null),
        matchAll: vi.fn().mockResolvedValue([]),
      },
    };

    installFetchHandler(sw);

    /** @type {Promise<Response> | undefined} */
    let responsePromise;
    listeners.fetch({
      request: new Request('https://example.test/__virtual__/3000/hello'),
      respondWith: (promise) => {
        responsePromise = promise;
      },
    });

    const response = await responsePromise;
    expect(sw.clients.matchAll).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('No client');
  });

  it('supports custom scope and timeout options', async () => {
    vi.useFakeTimers();
    try {
      /** @type {Record<string, any>} */
      const listeners = {};
      const sw = {
        addEventListener: vi.fn((type, handler) => {
          listeners[type] = handler;
        }),
        clients: {
          get: vi.fn().mockResolvedValue({
            postMessage: vi.fn(),
          }),
          matchAll: vi.fn().mockResolvedValue([]),
        },
      };

      installFetchHandler(sw, { scope: '/__agent__/', requestTimeoutMs: 1234 });
      let responsePromise;
      listeners.fetch({
        request: new Request('https://example.test/__agent__/4000/slow'),
        clientId: 'client-timeout',
        respondWith: (promise) => {
          responsePromise = promise;
        },
      });

      await vi.advanceTimersByTimeAsync(1234);
      const response = await responsePromise;
      expect(response.status).toBe(504);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes port1 when request times out', async () => {
    vi.useFakeTimers();
    const OriginalMessageChannel = globalThis.MessageChannel;
    const mockChannel = {
      port1: {
        onmessage: null,
        close: vi.fn(),
      },
      port2: {},
    };
    class MockMessageChannel {
      constructor() {
        this.port1 = mockChannel.port1;
        this.port2 = mockChannel.port2;
      }
    }
    globalThis.MessageChannel = MockMessageChannel;

    try {
      /** @type {Record<string, any>} */
      const listeners = {};
      const sw = {
        addEventListener: vi.fn((type, handler) => {
          listeners[type] = handler;
        }),
        clients: {
          get: vi.fn().mockResolvedValue({
            postMessage: vi.fn(),
          }),
          matchAll: vi.fn().mockResolvedValue([]),
        },
      };
      installFetchHandler(sw);

      /** @type {Promise<Response> | undefined} */
      let responsePromise;
      listeners.fetch({
        request: new Request('https://example.test/__virtual__/4000/slow'),
        clientId: 'client-timeout',
        respondWith: (promise) => {
          responsePromise = promise;
        },
      });

      await vi.advanceTimersByTimeAsync(60000);
      expect(responsePromise).toBeDefined();
      const response = await responsePromise;
      expect(response.status).toBe(504);
      expect(mockChannel.port1.close).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.MessageChannel = OriginalMessageChannel;
      vi.useRealTimers();
    }
  });
});
