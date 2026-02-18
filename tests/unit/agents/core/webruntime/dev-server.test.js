import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryVfs } from '../../../../../js/agents/vfs/vfs.memory.js';
import { DevServer, MIME_TYPES } from '../../../../../js/agents/core/webruntime/dev-server.js';

describe('DevServer', () => {
  /** @type {MemoryVfs} */
  let vfs;
  /** @type {DevServer} */
  let server;

  beforeEach(async () => {
    vfs = new MemoryVfs();
    await vfs.writeFile('index.html', '<html><body>Hello</body></html>');
    await vfs.writeFile('style.css', 'body { margin: 0; }');
    await vfs.writeFile('app.js', 'console.log("hi")');
    await vfs.writeFile('data.json', '{"key":"value"}');
    await vfs.writeFile('sub/index.html', '<html>Sub</html>');
    server = new DevServer({ vfs });
  });

  it('returns 200 with correct file content', async () => {
    const res = await server.handleRequest('/app.js');
    expect(res.status).toBe(200);
    const text = typeof res.body === 'string'
      ? res.body
      : new TextDecoder().decode(res.body);
    expect(text).toBe('console.log("hi")');
  });

  it('returns text/html for .html files', async () => {
    const res = await server.handleRequest('/index.html');
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html');
  });

  it('returns application/javascript for .js files', async () => {
    const res = await server.handleRequest('/app.js');
    expect(res.headers['Content-Type']).toBe('application/javascript');
  });

  it('returns 404 for non-existent files', async () => {
    const res = await server.handleRequest('/missing.txt');
    expect(res.status).toBe(404);
    expect(res.body).toBe('Not Found');
    expect(String(res.body)).not.toContain('missing.txt');
  });

  it('auto-resolves index.html for root path', async () => {
    const res = await server.handleRequest('/');
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html');
  });

  it('resolves paths with root config', async () => {
    await vfs.writeFile('docs/page.html', '<html>Docs</html>');
    const srv = new DevServer({ vfs, root: 'docs' });
    const res = await srv.handleRequest('/page.html');
    expect(res.status).toBe(200);
    const text = typeof res.body === 'string'
      ? res.body
      : new TextDecoder().decode(res.body);
    expect(text).toBe('<html>Docs</html>');
  });

  it('applies mimeOverrides over defaults', async () => {
    await vfs.writeFile('custom.xyz', 'data');
    const srv = new DevServer({ vfs, mimeOverrides: { '.xyz': 'text/x-custom' } });
    const res = await srv.handleRequest('/custom.xyz');
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/x-custom');
  });

  it('sets correct Content-Length', async () => {
    const res = await server.handleRequest('/app.js');
    const body = res.body;
    const len = typeof body === 'string' ? new TextEncoder().encode(body).byteLength : body.byteLength;
    expect(res.headers['Content-Length']).toBe(String(len));
    expect(res.headers['Cache-Control']).toBe('no-cache');
    expect(res.headers.ETag).toMatch(/^W\/"/);
  });

  it('returns 304 when If-None-Match matches ETag', async () => {
    const first = await server.handleRequest('/app.js');
    const second = await server.handleRequest('/app.js', { 'If-None-Match': first.headers.ETag });
    expect(second.status).toBe(304);
    expect(second.headers.ETag).toBe(first.headers.ETag);
  });

  it('onHmr / emitHmr triggers listener', () => {
    const listener = vi.fn();
    server.onHmr(listener);
    const event = { type: 'update', path: '/app.js', timestamp: Date.now() };
    server.emitHmr(event);
    expect(listener).toHaveBeenCalledWith(event);
  });

  it('offHmr removes the listener', () => {
    const listener = vi.fn();
    server.onHmr(listener);
    server.offHmr(listener);
    server.emitHmr({ type: 'update', path: '/app.js', timestamp: Date.now() });
    expect(listener).not.toHaveBeenCalled();
  });

  it('start/stop manages state correctly', () => {
    expect(server.started).toBe(false);
    server.start(8080);
    expect(server.started).toBe(true);
    expect(server.port).toBe(8080);
    server.stop();
    expect(server.started).toBe(false);
  });

  it('HMR event contains type, path, and timestamp', () => {
    const listener = vi.fn();
    server.onHmr(listener);
    const ts = Date.now();
    server.emitHmr({ type: 'full-reload', path: '/style.css', timestamp: ts });
    const evt = listener.mock.calls[0][0];
    expect(evt.type).toBe('full-reload');
    expect(evt.path).toBe('/style.css');
    expect(evt.timestamp).toBe(ts);
  });

  it('directory request resolves to index.html', async () => {
    const res = await server.handleRequest('/sub');
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html');
  });

  it('directory without index.html returns 404', async () => {
    await vfs.mkdir('empty');
    const res = await server.handleRequest('/empty');
    expect(res.status).toBe(404);
  });

  it('does not leak internal error details in 500 response body', async () => {
    const brokenVfs = {
      exists: vi.fn().mockRejectedValue(new Error('disk exploded')),
    };
    const brokenServer = new DevServer({ vfs: brokenVfs });
    const res = await brokenServer.handleRequest('/x');
    expect(res.status).toBe(500);
    expect(res.body).toBe('Internal Server Error');
    expect(String(res.body)).not.toContain('disk exploded');
  });

  it('MIME_TYPES export includes common types', () => {
    expect(MIME_TYPES['.html']).toBe('text/html');
    expect(MIME_TYPES['.css']).toBe('text/css');
    expect(MIME_TYPES['.js']).toBe('application/javascript');
    expect(MIME_TYPES['.json']).toBe('application/json');
    expect(MIME_TYPES['.png']).toBe('image/png');
    expect(MIME_TYPES['.svg']).toBe('image/svg+xml');
    expect(MIME_TYPES['.wasm']).toBe('application/wasm');
  });
});
