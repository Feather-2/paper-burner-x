import { describe, it, expect, vi } from 'vitest';
import {
  Socket, Server, createServer, createConnection, connect,
  isIP, isIPv4, isIPv6,
} from '../../../../../../js/agents/core/node-compat/shims/net.js';

describe('net shim', () => {
  it('Socket constructor does not throw', () => {
    expect(() => new Socket()).not.toThrow();
  });

  it('Socket.connect emits error (not supported in browser shim)', async () => {
    const s = new Socket();
    const errFn = vi.fn();
    s.on('error', errFn);
    s.connect(8080, 'localhost');
    await new Promise(r => setTimeout(r, 10));
    expect(errFn).toHaveBeenCalled();
    expect(errFn.mock.calls[0][0].code).toBe('ERR_NOT_SUPPORTED');
    expect(s.readyState).toBe('closed');
  });

  it('Socket.connect with options object emits error', async () => {
    const s = new Socket();
    const fn = vi.fn();
    s.on('error', () => {}); // prevent unhandled error throw
    s.connect({ port: 3000, host: '10.0.0.1' }, fn);
    await new Promise(r => setTimeout(r, 10));
    expect(fn).toHaveBeenCalled();
    expect(fn.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('Socket.address returns null (connect not supported)', () => {
    const s = new Socket();
    expect(s.address()).toBeNull();
  });

  it('Socket.destroy triggers close event', async () => {
    const s = new Socket();
    const fn = vi.fn();
    s.on('close', fn);
    s.destroy();
    await new Promise(r => queueMicrotask(r));
    expect(fn).toHaveBeenCalledWith(false);
    expect(s.destroyed).toBe(true);
    expect(s.readyState).toBe('closed');
  });

  it('Socket.destroy with error emits error then close', async () => {
    const s = new Socket();
    const errFn = vi.fn();
    const closeFn = vi.fn();
    s.on('error', errFn);
    s.on('close', closeFn);
    const err = new Error('boom');
    s.destroy(err);
    expect(errFn).toHaveBeenCalledWith(err);
    await new Promise(r => queueMicrotask(r));
    expect(closeFn).toHaveBeenCalledWith(true);
  });

  it('Socket.destroy is idempotent', async () => {
    const s = new Socket();
    const fn = vi.fn();
    s.on('close', fn);
    s.destroy();
    s.destroy();
    await new Promise(r => queueMicrotask(r));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Socket chainable methods return this', () => {
    const s = new Socket();
    expect(s.setEncoding()).toBe(s);
    expect(s.setTimeout(1000)).toBe(s);
    expect(s.setNoDelay()).toBe(s);
    expect(s.setKeepAlive()).toBe(s);
    expect(s.ref()).toBe(s);
    expect(s.unref()).toBe(s);
  });

  it('Server.listen triggers listening event', async () => {
    const srv = new Server();
    const fn = vi.fn();
    srv.on('listening', fn);
    srv.listen(9090);
    await new Promise(r => queueMicrotask(r));
    expect(fn).toHaveBeenCalled();
    expect(srv.listening).toBe(true);
  });

  it('Server.address returns port and host', () => {
    const srv = new Server();
    srv.listen(4000, '0.0.0.0');
    const addr = srv.address();
    expect(addr.port).toBe(4000);
    expect(addr.family).toBe('IPv4');
  });

  it('Server.close triggers close event', async () => {
    const srv = new Server();
    srv.listen(5000);
    const fn = vi.fn();
    srv.on('close', fn);
    srv.close();
    await new Promise(r => queueMicrotask(r));
    expect(fn).toHaveBeenCalled();
    expect(srv.listening).toBe(false);
  });

  it('Server.getConnections returns count', () => {
    const srv = new Server();
    return new Promise((resolve) => {
      srv.getConnections((err, count) => {
        expect(err).toBeNull();
        expect(count).toBe(0);
        resolve();
      });
    });
  });

  it('isIP returns 4 for IPv4', () => {
    expect(isIP('127.0.0.1')).toBe(4);
    expect(isIP('192.168.1.1')).toBe(4);
  });

  it('isIP returns 6 for IPv6', () => {
    expect(isIP('::1')).toBe(6);
    expect(isIP('fe80::1')).toBe(6);
  });

  it('isIP returns 0 for non-IP', () => {
    expect(isIP('hello')).toBe(0);
    expect(isIP('')).toBe(0);
  });

  it('isIPv4 and isIPv6 helpers', () => {
    expect(isIPv4('10.0.0.1')).toBe(true);
    expect(isIPv4('::1')).toBe(false);
    expect(isIPv6('::1')).toBe(true);
    expect(isIPv6('10.0.0.1')).toBe(false);
  });

  it('createServer returns a Server', () => {
    const srv = createServer();
    expect(srv).toBeInstanceOf(Server);
  });

  it('createConnection returns a Socket', () => {
    const s = createConnection(8080);
    s.on('error', () => {}); // suppress expected shim error
    expect(s).toBeInstanceOf(Socket);
  });

  it('connect is an alias for createConnection', () => {
    expect(connect).toBe(createConnection);
  });
});
