import { describe, it, expect, vi } from 'vitest';
import tls, {
  TLSSocket,
  Server,
  createServer,
  connect,
  createSecureContext,
  getCiphers,
  DEFAULT_ECDH_CURVE,
  DEFAULT_MAX_VERSION,
  DEFAULT_MIN_VERSION,
  rootCertificates,
} from '../../../../../../js/agents/core/node-compat/shims/tls.js';

describe('tls shim', () => {
  it('TLSSocket exposes expected default properties', () => {
    const socket = new TLSSocket();
    expect(socket.authorized).toBe(false);
    expect(socket.encrypted).toBe(true);
  });

  it('TLSSocket methods return browser-safe placeholders', () => {
    const socket = new TLSSocket();
    expect(socket.getPeerCertificate()).toEqual({});
    expect(socket.getCipher()).toBeNull();
    expect(socket.getProtocol()).toBeNull();
    expect(socket.renegotiate()).toBe(false);
    expect(() => socket.setServername('example.com')).not.toThrow();
  });

  it('Server methods return chainable or empty values', () => {
    const server = new Server();
    expect(server.listen(443)).toBe(server);
    expect(server.close()).toBe(server);
    expect(server.address()).toBeNull();
    expect(server.getTicketKeys()).toBeInstanceOf(Uint8Array);
    expect(() => server.setTicketKeys(Buffer.from('abc'))).not.toThrow();
    expect(() => server.setSecureContext({ cert: 'x', key: 'y' })).not.toThrow();
  });

  it('createServer returns Server instance', () => {
    const server = createServer({});
    expect(server).toBeInstanceOf(Server);
  });

  it('connect returns TLSSocket and calls callback asynchronously', async () => {
    const callback = vi.fn();
    const socket = connect({ host: 'example.com', port: 443 }, callback);

    expect(socket).toBeInstanceOf(TLSSocket);
    expect(callback).not.toHaveBeenCalled();

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('connect works without callback', () => {
    const socket = connect({ host: 'example.com', port: 443 });
    expect(socket).toBeInstanceOf(TLSSocket);
  });

  it('createSecureContext returns empty context object', () => {
    expect(createSecureContext({})).toEqual({});
  });

  it('getCiphers returns fixed cipher list', () => {
    expect(getCiphers()).toEqual([
      'TLS_AES_256_GCM_SHA384',
      'TLS_AES_128_GCM_SHA256',
    ]);
  });

  it('exports tls constants and root certificates placeholder', () => {
    expect(DEFAULT_ECDH_CURVE).toBe('auto');
    expect(DEFAULT_MAX_VERSION).toBe('TLSv1.3');
    expect(DEFAULT_MIN_VERSION).toBe('TLSv1.2');
    expect(rootCertificates).toEqual([]);
  });

  it('default export contains all public APIs', () => {
    expect(tls.TLSSocket).toBe(TLSSocket);
    expect(tls.Server).toBe(Server);
    expect(tls.createServer).toBe(createServer);
    expect(tls.connect).toBe(connect);
    expect(tls.createSecureContext).toBe(createSecureContext);
    expect(tls.getCiphers).toBe(getCiphers);
    expect(tls.DEFAULT_ECDH_CURVE).toBe(DEFAULT_ECDH_CURVE);
    expect(tls.DEFAULT_MAX_VERSION).toBe(DEFAULT_MAX_VERSION);
    expect(tls.DEFAULT_MIN_VERSION).toBe(DEFAULT_MIN_VERSION);
    expect(tls.rootCertificates).toBe(rootCertificates);
  });
});
