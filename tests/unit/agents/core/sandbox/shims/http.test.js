import { describe, it, expect, vi } from 'vitest';
import {
  IncomingMessage, ServerResponse, Server, ClientRequest, createServer,
  request, get, METHODS, STATUS_CODES,
  setServerListenCallback, setServerCloseCallback, getServer,
} from '../../../../../../js/agents/core/sandbox/shims/http.js';

describe('http shim', () => {
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
    const srv = new Server();
    const fn = vi.fn();
    srv.on('listening', fn);
    srv.listen(7070);
    await new Promise(r => queueMicrotask(r));
    expect(fn).toHaveBeenCalled();
    expect(srv._listening).toBe(true);
    srv.close();
  });

  it('Server.address returns listen address', () => {
    const srv = new Server();
    srv.listen(8080);
    expect(srv.address()).toEqual({ port: 8080, address: '0.0.0.0', family: 'IPv4' });
    srv.close();
  });

  it('Server.close triggers close event', async () => {
    const srv = new Server();
    srv.listen(9090);
    const fn = vi.fn();
    srv.on('close', fn);
    srv.close();
    await new Promise(r => queueMicrotask(r));
    expect(fn).toHaveBeenCalled();
  });

  it('Server.handleRequest returns response', async () => {
    const srv = createServer((req, res) => {
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
    const srv = createServer();
    expect(srv).toBeInstanceOf(Server);
  });

  it('createServer with listener', () => {
    const fn = vi.fn();
    const srv = createServer(fn);
    expect(srv.listenerCount('request')).toBe(1);
  });

  it('request() returns a ClientRequest', () => {
    const req = request({ hostname: 'example.com', path: '/' });
    expect(req).toBeInstanceOf(ClientRequest);
    expect(req._method).toBe('GET');
  });

  it('request() accepts string URL', () => {
    const req = request('http://example.com/api');
    expect(req).toBeInstanceOf(ClientRequest);
    expect(req._url).toBe('http://example.com/api');
  });

  it('request() accepts options with method and headers', () => {
    const req = request({
      hostname: 'example.com', port: 8080, path: '/data',
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    });
    expect(req._method).toBe('POST');
    expect(req._headers['content-type']).toBe('application/json');
    expect(req._url).toBe('http://example.com:8080/data');
  });

  it('get() returns a ClientRequest', () => {
    const req = get({ hostname: 'example.com', path: '/' });
    expect(req).toBeInstanceOf(ClientRequest);
  });

  it('ClientRequest.setHeader / getHeader / removeHeader', () => {
    const req = new ClientRequest({ hostname: 'localhost' });
    req.setHeader('X-Test', 'value');
    expect(req.getHeader('x-test')).toBe('value');
    req.removeHeader('X-Test');
    expect(req.getHeader('x-test')).toBeUndefined();
  });

  it('ClientRequest.abort emits abort event', () => {
    const req = new ClientRequest({ hostname: 'localhost' });
    const fn = vi.fn();
    req.on('abort', fn);
    req.abort();
    expect(fn).toHaveBeenCalled();
    expect(req._aborted).toBe(true);
  });

  it('ClientRequest.write accumulates body', () => {
    const req = new ClientRequest({ hostname: 'localhost', method: 'POST' });
    req.write('hello ');
    req.write('world');
    expect(req._body.length).toBe(2);
  });

  it('ClientRequest.setTimeout stores timeout', () => {
    const req = new ClientRequest({ hostname: 'localhost' });
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
    const cb = vi.fn();
    setServerListenCallback(cb);
    const srv = createServer();
    srv.listen(6060);
    expect(cb).toHaveBeenCalledWith(6060, srv);
    srv.close();
    setServerListenCallback(null);
  });

  it('getServer retrieves server by port', () => {
    const srv = createServer();
    srv.listen(5050);
    expect(getServer(5050)).toBe(srv);
    srv.close();
  });
});
