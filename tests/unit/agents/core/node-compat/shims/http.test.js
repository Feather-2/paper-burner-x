import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  IncomingMessage, ServerResponse, METHODS, STATUS_CODES,
  createHttpShim,
  Agent,
  globalAgent,
  _createClientRequest,
} from '../../../../../../js/agents/core/node-compat/shims/http.js';

describe('http shim', () => {
  it('exports Agent/globalAgent and client-request helper', () => {
    const agent = new Agent({ keepAlive: true });
    expect(agent.keepAlive).toBe(true);
    expect(globalAgent).toBeInstanceOf(Agent);
    expect(typeof _createClientRequest).toBe('function');
  });

  it('IncomingMessage has default properties', () => {
    const msg = new IncomingMessage();
    expect(msg.httpVersion).toBe('1.1');
    expect(msg.headers).toEqual({});
    expect(msg.complete).toBe(false);
    expect(msg.method).toBeUndefined();
  });

  it('IncomingMessage.fromRequest constructs a request', () => {
    const msg = IncomingMessage.fromRequest('POST', '/api', { 'content-type': 'application/json' }, '{"a":1}');
    expect(msg.method).toBe('POST');
    expect(msg.url).toBe('/api');
    expect(msg.headers['content-type']).toBe('application/json');
    expect(msg.complete).toBe(true);
    expect(msg.rawHeaders).toContain('content-type');
  });

  it('IncomingMessage.fromRequest without body', () => {
    const msg = IncomingMessage.fromRequest('GET', '/', {});
    expect(msg.complete).toBe(true);
  });

  it('ServerResponse.setHeader / getHeader / hasHeader', () => {
    const res = new ServerResponse();
    res.setHeader('Content-Type', 'text/html');
    expect(res.getHeader('content-type')).toBe('text/html');
    expect(res.hasHeader('Content-Type')).toBe(true);
    expect(res.hasHeader('X-Missing')).toBe(false);
  });

  it('ServerResponse.removeHeader', () => {
    const res = new ServerResponse();
    res.setHeader('X-Test', 'val');
    res.removeHeader('X-Test');
    expect(res.hasHeader('X-Test')).toBe(false);
  });

  it('ServerResponse.getHeaders and getHeaderNames', () => {
    const res = new ServerResponse();
    res.setHeader('A', '1');
    res.setHeader('B', '2');
    expect(res.getHeaders()).toEqual({ a: '1', b: '2' });
    expect(res.getHeaderNames()).toEqual(['a', 'b']);
  });

  it('ServerResponse.writeHead sets status and headers', () => {
    const res = new ServerResponse();
    res.writeHead(404, 'Not Found', { 'X-Custom': 'yes' });
    expect(res.statusCode).toBe(404);
    expect(res.statusMessage).toBe('Not Found');
    expect(res.getHeader('x-custom')).toBe('yes');
  });

  it('ServerResponse.writeHead with headers object only', () => {
    const res = new ServerResponse();
    res.writeHead(201, { 'Location': '/new' });
    expect(res.statusCode).toBe(201);
    expect(res.getHeader('location')).toBe('/new');
  });

  it('ServerResponse.write + end collects body', async () => {
    const res = new ServerResponse();
    let resolved;
    res._setResolver((val) => { resolved = val; });
    res.write('hello ');
    res.end('world');
    await new Promise(r => queueMicrotask(r));
    expect(res.finished).toBe(true);
    expect(res.headersSent).toBe(true);
    expect(resolved).toBeDefined();
    expect(resolved.statusCode).toBe(200);
    expect(resolved.body.toString()).toBe('hello world');
  });

  it('ServerResponse.end triggers finish', async () => {
    const res = new ServerResponse();
    const fn = vi.fn();
    res.on('finish', fn);
    res.end();
    await new Promise(r => queueMicrotask(r));
    expect(fn).toHaveBeenCalled();
  });

  it('ServerResponse.end with callback', async () => {
    const res = new ServerResponse();
    const fn = vi.fn();
    res.end(fn);
    await new Promise(r => queueMicrotask(r));
    expect(fn).toHaveBeenCalled();
  });

  it('ServerResponse.setHeader throws after headersSent', () => {
    const res = new ServerResponse();
    res.write('data');
    expect(() => res.setHeader('X-Late', 'nope')).toThrow();
  });

  it('ServerResponse.json convenience method', async () => {
    const res = new ServerResponse();
    let resolved;
    res._setResolver((val) => { resolved = val; });
    res.json({ ok: true });
    await new Promise(r => queueMicrotask(r));
    expect(res.getHeader('content-type')).toBe('application/json');
    expect(resolved.body.toString()).toBe('{"ok":true}');
  });

  it('ServerResponse.status sets statusCode', () => {
    const res = new ServerResponse();
    expect(res.status(500)).toBe(res);
    expect(res.statusCode).toBe(500);
  });

  it('Server.listen triggers listening', async () => {
    const shim = createHttpShim();
    const srv = new shim.Server();
    const fn = vi.fn();
    srv.on('listening', fn);
    srv.listen(7070);
    await new Promise(r => queueMicrotask(r));
    expect(fn).toHaveBeenCalled();
    expect(srv._listening).toBe(true);
    srv.close();
  });

  it('Server.address returns listen address', () => {
    const shim = createHttpShim();
    const srv = new shim.Server();
    srv.listen(8080);
    expect(srv.address()).toEqual({ port: 8080, address: '0.0.0.0', family: 'IPv4' });
    srv.close();
  });

  it('Server.close triggers close event', async () => {
    const shim = createHttpShim();
    const srv = new shim.Server();
    srv.listen(9090);
    const fn = vi.fn();
    srv.on('close', fn);
    srv.close();
    await new Promise(r => queueMicrotask(r));
    expect(fn).toHaveBeenCalled();
  });

  it('Server.handleRequest returns response', async () => {
    const shim = createHttpShim();
    const srv = shim.createServer((req, res) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe('/test');
      res.writeHead(200);
      res.end('ok');
    });
    const result = await srv.handleRequest('GET', '/test', {});
    expect(result.statusCode).toBe(200);
    expect(result.body.toString()).toBe('ok');
  });

  it('createServer returns a Server', () => {
    const shim = createHttpShim();
    const srv = shim.createServer();
    expect(srv).toBeDefined();
    expect(srv._listening).toBe(false);
  });

  it('createServer with listener', () => {
    const shim = createHttpShim();
    const fn = vi.fn();
    const srv = shim.createServer(fn);
    expect(srv.listenerCount('request')).toBe(1);
  });

  it('request() returns a ClientRequest', () => {
    const shim = createHttpShim();
    const req = shim.request({ hostname: 'example.com', path: '/' });
    expect(req).toBeDefined();
    expect(req._method).toBe('GET');
  });

  it('request() accepts string URL', () => {
    const shim = createHttpShim();
    const req = shim.request('http://example.com/api');
    expect(req._url).toBe('http://example.com/api');
  });

  it('request() accepts options with method and headers', () => {
    const shim = createHttpShim();
    const req = shim.request({
      hostname: 'example.com', port: 8080, path: '/data',
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    });
    expect(req._method).toBe('POST');
    expect(req._headers['content-type']).toBe('application/json');
    expect(req._url).toBe('http://example.com:8080/data');
  });

  it('get() returns a ClientRequest', () => {
    const shim = createHttpShim();
    const req = shim.get({ hostname: 'example.com', path: '/' });
    expect(req).toBeDefined();
  });

  it('ClientRequest.setHeader / getHeader / removeHeader', () => {
    const shim = createHttpShim();
    const req = new shim.ClientRequest({ hostname: 'localhost' });
    req.setHeader('X-Test', 'value');
    expect(req.getHeader('x-test')).toBe('value');
    req.removeHeader('X-Test');
    expect(req.getHeader('x-test')).toBeUndefined();
  });

  it('ClientRequest.abort emits abort event', () => {
    const shim = createHttpShim();
    const req = new shim.ClientRequest({ hostname: 'localhost' });
    const fn = vi.fn();
    req.on('abort', fn);
    req.abort();
    expect(fn).toHaveBeenCalled();
    expect(req._aborted).toBe(true);
  });

  it('ClientRequest.write accumulates body', () => {
    const shim = createHttpShim();
    const req = new shim.ClientRequest({ hostname: 'localhost', method: 'POST' });
    req.write('hello ');
    req.write('world');
    expect(req._body.length).toBe(2);
  });

  it('ClientRequest.setTimeout stores timeout', () => {
    const shim = createHttpShim();
    const req = new shim.ClientRequest({ hostname: 'localhost' });
    const fn = vi.fn();
    req.setTimeout(5000, fn);
    expect(req._timeout).toBe(5000);
  });

  it('STATUS_CODES includes common codes', () => {
    expect(STATUS_CODES[200]).toBe('OK');
    expect(STATUS_CODES[404]).toBe('Not Found');
    expect(STATUS_CODES[500]).toBe('Internal Server Error');
  });

  it('METHODS includes standard methods', () => {
    expect(METHODS).toContain('GET');
    expect(METHODS).toContain('POST');
    expect(METHODS).toContain('DELETE');
  });

  it('setServerListenCallback is called on listen', async () => {
    const shim = createHttpShim();
    const cb = vi.fn();
    shim.setServerListenCallback(cb);
    const srv = shim.createServer();
    srv.listen(6060);
    expect(cb).toHaveBeenCalledWith(6060, srv);
    srv.close();
    shim.setServerListenCallback(null);
  });

  it('getServer retrieves server by port', () => {
    const shim = createHttpShim();
    const srv = shim.createServer();
    srv.listen(5050);
    expect(shim.getServer(5050)).toBe(srv);
    srv.close();
  });
});

describe('http shim > network policy', () => {
  it('allows all requests when no policy is set', () => {
    const shim = createHttpShim();
    const req = new shim.ClientRequest({ hostname: 'example.com', path: '/' });
    expect(req._url).toBe('http://example.com/');
  });

  it('blocks requests to domains not in allowedDomains', async () => {
    const shim = createHttpShim({ networkPolicy: { allowedDomains: ['api.example.com'] } });
    const req = new shim.ClientRequest({ hostname: 'evil.com', path: '/' });
    const errorFn = vi.fn();
    req.on('error', errorFn);
    req.end();
    await new Promise(r => setTimeout(r, 50));
    expect(errorFn).toHaveBeenCalled();
    expect(errorFn.mock.calls[0][0].code).toBe('ERR_NETWORK_POLICY');
  });

  it('allows requests to domains in allowedDomains', async () => {
    const shim = createHttpShim({ networkPolicy: { allowedDomains: ['registry.npmjs.org'] } });
    const req = new shim.ClientRequest({ hostname: 'registry.npmjs.org', path: '/' });
    const errorFn = vi.fn();
    req.on('error', errorFn);
    req.end();
    await new Promise(r => setTimeout(r, 50));
    if (errorFn.mock.calls.length > 0) {
      expect(errorFn.mock.calls[0][0].code).not.toBe('ERR_NETWORK_POLICY');
    }
  });

  it('deniedDomains takes precedence over allowedDomains', async () => {
    const shim = createHttpShim({
      networkPolicy: {
        allowedDomains: ['*.example.com'],
        deniedDomains: ['evil.example.com'],
      },
    });
    const req = new shim.ClientRequest({ hostname: 'evil.example.com', path: '/' });
    const errorFn = vi.fn();
    req.on('error', errorFn);
    req.end();
    await new Promise(r => setTimeout(r, 50));
    expect(errorFn).toHaveBeenCalled();
    expect(errorFn.mock.calls[0][0].code).toBe('ERR_NETWORK_POLICY');
  });

  it('wildcard domain pattern matches subdomains', async () => {
    const shim = createHttpShim({ networkPolicy: { allowedDomains: ['*.npmjs.org'] } });
    const req = new shim.ClientRequest({ hostname: 'registry.npmjs.org', path: '/' });
    const errorFn = vi.fn();
    req.on('error', errorFn);
    req.end();
    await new Promise(r => setTimeout(r, 50));
    if (errorFn.mock.calls.length > 0) {
      expect(errorFn.mock.calls[0][0].code).not.toBe('ERR_NETWORK_POLICY');
    }
  });

  it('wildcard does not match the base domain itself', async () => {
    const shim = createHttpShim({ networkPolicy: { allowedDomains: ['*.example.com'] } });
    const req = new shim.ClientRequest({ hostname: 'example.com', path: '/' });
    const errorFn = vi.fn();
    req.on('error', errorFn);
    req.end();
    await new Promise(r => setTimeout(r, 50));
    expect(errorFn).toHaveBeenCalled();
    expect(errorFn.mock.calls[0][0].code).toBe('ERR_NETWORK_POLICY');
  });

  it('onViolation callback is invoked on blocked request', async () => {
    const violationFn = vi.fn();
    const shim = createHttpShim({
      networkPolicy: { allowedDomains: ['safe.com'], onViolation: violationFn },
    });
    const req = new shim.ClientRequest({ hostname: 'blocked.com', path: '/secret' });
    req.on('error', () => {});
    req.end();
    await new Promise(r => setTimeout(r, 50));
    expect(violationFn).toHaveBeenCalledWith({
      type: 'network',
      url: 'http://blocked.com/secret',
      method: 'GET',
    });
  });

  it('deniedDomains only blocks without allowedDomains = allow rest', async () => {
    const shim = createHttpShim({ networkPolicy: { deniedDomains: ['evil.com'] } });
    const req = new shim.ClientRequest({ hostname: 'safe.com', path: '/' });
    const errorFn = vi.fn();
    req.on('error', errorFn);
    req.end();
    await new Promise(r => setTimeout(r, 50));
    if (errorFn.mock.calls.length > 0) {
      expect(errorFn.mock.calls[0][0].code).not.toBe('ERR_NETWORK_POLICY');
    }
  });

  it('empty allowedDomains blocks everything', async () => {
    const shim = createHttpShim({ networkPolicy: { allowedDomains: [] } });
    const req = new shim.ClientRequest({ hostname: 'anything.com', path: '/' });
    const errorFn = vi.fn();
    req.on('error', errorFn);
    req.end();
    await new Promise(r => setTimeout(r, 50));
    expect(errorFn).toHaveBeenCalled();
    expect(errorFn.mock.calls[0][0].code).toBe('ERR_NETWORK_POLICY');
  });

  it('setNetworkPolicy can update policy after creation', async () => {
    const shim = createHttpShim();
    shim.setNetworkPolicy({ allowedDomains: ['api.example.com'] });
    const req = new shim.ClientRequest({ hostname: 'evil.com', path: '/' });
    const errorFn = vi.fn();
    req.on('error', errorFn);
    req.end();
    await new Promise(r => setTimeout(r, 50));
    expect(errorFn).toHaveBeenCalled();
    expect(errorFn.mock.calls[0][0].code).toBe('ERR_NETWORK_POLICY');
  });
});

describe('http shim > askCallback', () => {
  it('askCallback approves request not in allowedDomains', async () => {
    const askCb = vi.fn().mockResolvedValue(true);
    const shim = createHttpShim({
      networkPolicy: { allowedDomains: ['safe.com'] },
      askCallback: askCb,
    });
    const req = new shim.ClientRequest({ hostname: 'unknown.com', path: '/data' });
    const errorFn = vi.fn();
    req.on('error', errorFn);
    req.end();
    await new Promise(r => setTimeout(r, 50));
    expect(askCb).toHaveBeenCalledWith({
      url: 'http://unknown.com/data',
      hostname: 'unknown.com',
      method: 'GET',
    });
    if (errorFn.mock.calls.length > 0) {
      expect(errorFn.mock.calls[0][0].code).not.toBe('ERR_NETWORK_POLICY');
    }
  });

  it('askCallback denies request not in allowedDomains', async () => {
    const askCb = vi.fn().mockResolvedValue(false);
    const shim = createHttpShim({
      networkPolicy: { allowedDomains: ['safe.com'] },
      askCallback: askCb,
    });
    const req = new shim.ClientRequest({ hostname: 'unknown.com', path: '/' });
    const errorFn = vi.fn();
    req.on('error', errorFn);
    req.end();
    await new Promise(r => setTimeout(r, 50));
    expect(errorFn).toHaveBeenCalled();
    expect(errorFn.mock.calls[0][0].code).toBe('ERR_NETWORK_POLICY');
  });

  it('askCallback is not called for allowed domains', async () => {
    const askCb = vi.fn().mockResolvedValue(true);
    const shim = createHttpShim({
      networkPolicy: { allowedDomains: ['safe.com'] },
      askCallback: askCb,
    });
    const req = new shim.ClientRequest({ hostname: 'safe.com', path: '/' });
    const errorFn = vi.fn();
    req.on('error', errorFn);
    req.end();
    await new Promise(r => setTimeout(r, 50));
    expect(askCb).not.toHaveBeenCalled();
  });

  it('askCallback is not called for denied domains', async () => {
    const askCb = vi.fn().mockResolvedValue(true);
    const shim = createHttpShim({
      networkPolicy: { allowedDomains: ['safe.com'], deniedDomains: ['evil.com'] },
      askCallback: askCb,
    });
    const req = new shim.ClientRequest({ hostname: 'evil.com', path: '/' });
    const errorFn = vi.fn();
    req.on('error', errorFn);
    req.end();
    await new Promise(r => setTimeout(r, 50));
    expect(askCb).not.toHaveBeenCalled();
    expect(errorFn).toHaveBeenCalled();
    expect(errorFn.mock.calls[0][0].code).toBe('ERR_NETWORK_POLICY');
  });

  it('askCallback receives correct method for POST requests', async () => {
    const askCb = vi.fn().mockResolvedValue(true);
    const shim = createHttpShim({
      networkPolicy: { allowedDomains: ['safe.com'] },
      askCallback: askCb,
    });
    const req = new shim.ClientRequest({ hostname: 'unknown.com', path: '/api', method: 'POST' });
    req.on('error', () => {});
    req.end();
    await new Promise(r => setTimeout(r, 50));
    expect(askCb).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST' }));
  });
});

describe('http shim > domain pattern validation', () => {
  it('rejects bare wildcard *', () => {
    expect(() => createHttpShim({ networkPolicy: { allowedDomains: ['*'] } })).toThrow('too broad');
  });

  it('rejects *.com (TLD-only wildcard)', () => {
    expect(() => createHttpShim({ networkPolicy: { allowedDomains: ['*.com'] } })).toThrow('too broad');
  });

  it('rejects *.org (TLD-only wildcard)', () => {
    expect(() => createHttpShim({ networkPolicy: { deniedDomains: ['*.org'] } })).toThrow('too broad');
  });

  it('accepts *.example.com (two segments after wildcard)', () => {
    expect(() => createHttpShim({ networkPolicy: { allowedDomains: ['*.example.com'] } })).not.toThrow();
  });

  it('rejects pattern with protocol', () => {
    expect(() => createHttpShim({ networkPolicy: { allowedDomains: ['https://example.com'] } })).toThrow('protocol');
  });

  it('rejects pattern with port', () => {
    expect(() => createHttpShim({ networkPolicy: { allowedDomains: ['example.com:8080'] } })).toThrow('port');
  });

  it('rejects pattern with path', () => {
    expect(() => createHttpShim({ networkPolicy: { allowedDomains: ['example.com/api'] } })).toThrow('path');
  });

  it('rejects empty string', () => {
    expect(() => createHttpShim({ networkPolicy: { allowedDomains: [''] } })).toThrow('empty');
  });

  it('accepts localhost', () => {
    expect(() => createHttpShim({ networkPolicy: { allowedDomains: ['localhost'] } })).not.toThrow();
  });

  it('accepts plain domain', () => {
    expect(() => createHttpShim({ networkPolicy: { allowedDomains: ['api.example.com'] } })).not.toThrow();
  });

  it('setNetworkPolicy also validates patterns', () => {
    const shim = createHttpShim();
    expect(() => shim.setNetworkPolicy({ allowedDomains: ['*'] })).toThrow('too broad');
  });
});
