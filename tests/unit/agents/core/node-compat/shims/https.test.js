import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../js/agents/core/node-compat/shims/http.js', () => {
  class ClientRequest {
    constructor() {
      this.writableEnded = false;
      this.end = vi.fn(() => {
        this.writableEnded = true;
        return this;
      });
    }
  }

  return {
    Server: class Server {},
    IncomingMessage: class IncomingMessage {},
    ServerResponse: class ServerResponse {},
    ClientRequest,
    createServer: vi.fn(),
    STATUS_CODES: { 200: 'OK' },
    METHODS: ['GET', 'POST'],
    getServer: vi.fn(),
    getAllServers: vi.fn(() => []),
    setServerListenCallback: vi.fn(),
    setServerCloseCallback: vi.fn(),
    _createClientRequest: vi.fn(() => new ClientRequest()),
    Agent: class Agent {},
    globalAgent: { kind: 'global' },
  };
});

import * as https from '../../../../../../js/agents/core/node-compat/shims/https.js';
import * as http from '../../../../../../js/agents/core/node-compat/shims/http.js';

describe('https shim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports all http module exports', () => {
    expect(https.Server).toBe(http.Server);
    expect(https.IncomingMessage).toBe(http.IncomingMessage);
    expect(https.ServerResponse).toBe(http.ServerResponse);
    expect(https.ClientRequest).toBe(http.ClientRequest);
    expect(https.createServer).toBe(http.createServer);
    expect(https.STATUS_CODES).toBe(http.STATUS_CODES);
    expect(https.METHODS).toBe(http.METHODS);
    expect(https.Agent).toBe(http.Agent);
    expect(https.globalAgent).toBe(http.globalAgent);
  });

  it('request() delegates to _createClientRequest for string URL', () => {
    const req = https.request('https://example.com');
    expect(req).toBeInstanceOf(http.ClientRequest);
    expect(http._createClientRequest).toHaveBeenCalledWith('https://example.com', undefined, undefined, 'https');
  });

  it('request() accepts URL object', () => {
    const url = new URL('https://example.com/path');
    const req = https.request(url);
    expect(req).toBeInstanceOf(http.ClientRequest);
    expect(http._createClientRequest).toHaveBeenCalledWith(url, undefined, undefined, 'https');
  });

  it('request() accepts options object', () => {
    const options = { hostname: 'example.com', port: 443, path: '/' };
    const req = https.request(options);
    expect(req).toBeInstanceOf(http.ClientRequest);
    expect(http._createClientRequest).toHaveBeenCalledWith(options, undefined, undefined, 'https');
  });

  it('request() accepts callback', () => {
    const callback = vi.fn();
    const req = https.request('https://example.com', callback);
    expect(req).toBeInstanceOf(http.ClientRequest);
    expect(http._createClientRequest).toHaveBeenCalledWith('https://example.com', callback, undefined, 'https');
  });

  it('get() creates HTTPS GET request and calls end()', () => {
    const req = https.get('https://example.com');
    expect(req).toBeInstanceOf(http.ClientRequest);
    expect(http._createClientRequest).toHaveBeenCalledWith('https://example.com', undefined, undefined, 'https');
    expect(req.end).toHaveBeenCalledTimes(1);
    expect(req.writableEnded).toBe(true);
  });

  it('get() accepts callback', () => {
    const callback = vi.fn();
    const req = https.get('https://example.com', callback);
    expect(req).toBeInstanceOf(http.ClientRequest);
    expect(http._createClientRequest).toHaveBeenCalledWith('https://example.com', callback, undefined, 'https');
    expect(req.end).toHaveBeenCalledTimes(1);
    expect(req.writableEnded).toBe(true);
  });

  it('default export contains all exports', () => {
    const defaultExport = https.default;
    expect(defaultExport.request).toBe(https.request);
    expect(defaultExport.get).toBe(https.get);
    expect(defaultExport.Server).toBe(https.Server);
    expect(defaultExport.createServer).toBe(https.createServer);
  });
});
