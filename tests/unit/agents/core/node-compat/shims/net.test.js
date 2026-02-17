import { describe, it, expect, vi } from 'vitest';
import {
  Socket, Server, createServer, createConnection, connect,
  isIP, isIPv4, isIPv6,
} from '../../../../../../js/agents/core/node-compat/shims/net.js';

const waitTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('net shim', () => {
  it('Socket constructor does not throw', () => {
    expect(() => new Socket()).not.toThrow();
  });

  it('Socket.connect emits ECONNREFUSED when no server is listening', async () => {
    const s = new Socket();
    const errFn = vi.fn();
    s.on('error', errFn);
    s.connect(8080, 'localhost');
    await waitTick();
    expect(errFn).toHaveBeenCalled();
    expect(errFn.mock.calls[0][0].code).toBe('ECONNREFUSED');
    expect(s.readyState).toBe('closed');
  });

  it('Socket.connect with options object returns error in callback on failure', async () => {
    const s = new Socket();
    const fn = vi.fn();
    s.on('error', () => {}); // prevent unhandled error throw
    s.connect({ port: 3000, host: '10.0.0.1' }, fn);
    await waitTick();
    expect(fn).toHaveBeenCalled();
    expect(fn.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(fn.mock.calls[0][0].code).toBe('ECONNREFUSED');
  });

  it('Socket.connect succeeds when server is listening', async () => {
    const srv = new Server();
    srv.listen(0, '127.0.0.1');
    await waitTick();
    const port = srv.address().port;

    const s = new Socket();
    const onConnect = vi.fn();
    s.on('connect', onConnect);
    s.on('error', () => {});
    s.connect(port, '127.0.0.1');
    await waitTick();

    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(s.readyState).toBe('open');
    expect(s.address()).toEqual(expect.objectContaining({ family: 'IPv4', address: '127.0.0.1' }));
    await new Promise((resolve) => srv.close(resolve));
  });

  it('Socket.address returns null before connect', () => {
    const s = new Socket();
    expect(s.address()).toBeNull();
  });

  it('Socket read/write round-trip works through in-memory server', async () => {
    const srv = new Server();
    let accepted = null;
    srv.on('connection', (socket) => {
      accepted = socket;
      socket.on('data', (chunk) => socket.write(chunk));
    });
    srv.listen(0, '127.0.0.1');
    await waitTick();
    const port = srv.address().port;

    const client = new Socket();
    const received = [];
    client.on('data', (chunk) => received.push(Buffer.from(chunk).toString('utf8')));
    client.on('error', () => {});
    client.connect(port, '127.0.0.1');
    await waitTick();

    client.write('ping');
    await waitTick();

    expect(accepted).toBeInstanceOf(Socket);
    expect(received.join('')).toBe('ping');

    client.end();
    await waitTick();
    await new Promise((resolve) => srv.close(resolve));
  });

  it('Socket chainable methods return this', async () => {
    const srv = new Server();
    srv.listen(0, '127.0.0.1');
    await waitTick();
    const port = srv.address().port;

    const s = new Socket();
    s.on('error', () => {});
    s.connect(port, '127.0.0.1');
    await waitTick();

    expect(s.setEncoding()).toBe(s);
    expect(s.setTimeout(1000)).toBe(s);
    expect(s.setNoDelay()).toBe(s);
    expect(s.setKeepAlive()).toBe(s);
    expect(s.ref()).toBe(s);
    expect(s.unref()).toBe(s);
    await new Promise((resolve) => srv.close(resolve));
  });

  it('Socket.destroy triggers close event', async () => {
    const s = new Socket();
    const fn = vi.fn();
    s.on('close', fn);
    s.destroy();
    await waitTick();
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
    await waitTick();
    expect(closeFn).toHaveBeenCalledWith(true);
  });

  it('Socket.destroy is idempotent', async () => {
    const s = new Socket();
    const fn = vi.fn();
    s.on('close', fn);
    s.destroy();
    s.destroy();
    await waitTick();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Server.listen triggers listening event', async () => {
    const srv = new Server();
    const fn = vi.fn();
    srv.on('listening', fn);
    srv.listen(9090);
    await waitTick();
    expect(fn).toHaveBeenCalled();
    expect(srv.listening).toBe(true);
    await new Promise((resolve) => srv.close(resolve));
  });

  it('Server.listen emits EADDRINUSE for duplicate host/port binding', async () => {
    const srvA = new Server();
    const srvB = new Server();

    srvA.listen(9100, '127.0.0.1');
    await waitTick();

    const errFn = vi.fn();
    srvB.on('error', errFn);
    srvB.listen(9100, '127.0.0.1');
    await waitTick();

    expect(errFn).toHaveBeenCalledTimes(1);
    expect(errFn.mock.calls[0][0].code).toBe('EADDRINUSE');

    await new Promise((resolve) => srvA.close(resolve));
    await new Promise((resolve) => srvB.close(resolve));
  });

  it('Server.address returns port and host', () => {
    const srv = new Server();
    srv.listen(4000, '0.0.0.0');
    const addr = srv.address();
    expect(addr.port).toBe(4000);
    expect(addr.family).toBe('IPv4');
    srv.close();
  });

  it('Server.close triggers close event', async () => {
    const srv = new Server();
    srv.listen(5000);
    const fn = vi.fn();
    srv.on('close', fn);
    srv.close();
    await waitTick();
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

  it('createConnection returns a Socket and can connect to a listening server', async () => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1');
    await waitTick();
    const port = srv.address().port;

    const s = createConnection(port, '127.0.0.1');
    s.on('error', () => {});
    expect(s).toBeInstanceOf(Socket);
    await waitTick();
    expect(s.readyState).toBe('open');

    await new Promise((resolve) => srv.close(resolve));
  });

  it('connect is an alias for createConnection', () => {
    expect(connect).toBe(createConnection);
  });
});
