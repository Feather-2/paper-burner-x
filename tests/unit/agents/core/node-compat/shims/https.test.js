import { describe, it, expect, vi } from 'vitest';
import * as https from '../../../../../../js/agents/core/node-compat/shims/https.js';
import * as http from '../../../../../../js/agents/core/node-compat/shims/http.js';

describe('https shim', () => {
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

  it('request() creates HTTPS request', () => {
    const req = https.request('https://example.com');
    expect(req).toBeInstanceOf(http.ClientRequest);
  });

  it('request() accepts URL object', () => {
    const url = new URL('https://example.com/path');
    const req = https.request(url);
    expect(req).toBeInstanceOf(http.ClientRequest);
  });

  it('request() accepts options object', () => {
    const req = https.request({ hostname: 'example.com', port: 443, path: '/' });
    expect(req).toBeInstanceOf(http.ClientRequest);
  });

  it('request() accepts callback', () => {
    const callback = vi.fn();
    const req = https.request('https://example.com', callback);
    expect(req).toBeInstanceOf(http.ClientRequest);
  });

  it('get() creates HTTPS GET request and calls end()', () => {
    const req = https.get('https://example.com');
    expect(req).toBeInstanceOf(http.ClientRequest);
    // Verify that end() was called by checking the request is ended
    expect(req.writableEnded).toBe(true);
  });

  it('get() accepts callback', () => {
    const callback = vi.fn();
    const req = https.get('https://example.com', callback);
    expect(req).toBeInstanceOf(http.ClientRequest);
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
