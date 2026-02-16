import { describe, it, expect } from 'vitest';
import { EventEmitter } from '../../../../../../js/agents/core/node-compat/shims/events.js';
import http2, {
  Http2Session,
  ClientHttp2Session,
  ServerHttp2Session,
  Http2Stream,
  Http2ServerRequest,
  Http2ServerResponse,
  createServer,
  createSecureServer,
  connect,
  constants,
  getDefaultSettings,
  getPackedSettings,
  getUnpackedSettings,
  sensitiveHeaders,
} from '../../../../../../js/agents/core/node-compat/shims/http2.js';

describe('http2 shim', () => {
  it('Http2Session exposes safe default session state', async () => {
    const session = new Http2Session();
    expect(session.destroyed).toBe(false);
    expect(session.encrypted).toBe(false);
    expect(session.closed).toBe(false);
    expect(session.ping()).toBe(false);
    expect(() => session.destroy(new Error('x'), 0)).not.toThrow();
    expect(() => session.ref()).not.toThrow();
    expect(() => session.unref()).not.toThrow();
    expect(() => session.setTimeout(1000, () => {})).not.toThrow();
    await new Promise((resolve) => session.close(resolve));
  });

  it('subclasses and stream/server stubs can be instantiated', () => {
    expect(new ClientHttp2Session()).toBeInstanceOf(Http2Session);
    expect(new ServerHttp2Session()).toBeInstanceOf(Http2Session);

    const stream = new Http2Stream();
    expect(stream.id).toBe(0);
    expect(stream.pending).toBe(false);
    expect(stream.destroyed).toBe(false);
    expect(stream.closed).toBe(false);
    expect(() => stream.close(0, () => {})).not.toThrow();
    expect(() => stream.priority({ weight: 16 })).not.toThrow();
    expect(() => stream.setTimeout(1000, () => {})).not.toThrow();
    expect(() => stream.end('data', 'utf8', () => {})).not.toThrow();

    expect(new Http2ServerRequest()).toBeInstanceOf(EventEmitter);
    const response = new Http2ServerResponse();
    expect(response.writeHead(200, {})).toBe(response);
    expect(() => response.end('ok')).not.toThrow();
  });

  it('factory functions return EventEmitter/session objects', () => {
    expect(createServer()).toBeInstanceOf(EventEmitter);
    expect(createSecureServer()).toBeInstanceOf(EventEmitter);
    expect(connect('https://example.com')).toBeInstanceOf(ClientHttp2Session);
  });

  it('settings/constants exports return compatibility defaults', () => {
    expect(constants.NGHTTP2_SESSION_SERVER).toBe(0);
    expect(constants.NGHTTP2_SESSION_CLIENT).toBe(1);
    expect(constants.HTTP2_HEADER_STATUS).toBe(':status');
    expect(constants.HTTP_STATUS_OK).toBe(200);
    expect(constants.HTTP_STATUS_NOT_FOUND).toBe(404);

    expect(getDefaultSettings()).toEqual({});
    const packed = getPackedSettings({});
    expect(packed).toBeInstanceOf(Uint8Array);
    expect(packed.length).toBe(0);
    expect(getUnpackedSettings(packed)).toEqual({});
    expect(typeof sensitiveHeaders).toBe('symbol');
  });

  it('default export mirrors named exports', () => {
    expect(http2.Http2Session).toBe(Http2Session);
    expect(http2.ClientHttp2Session).toBe(ClientHttp2Session);
    expect(http2.ServerHttp2Session).toBe(ServerHttp2Session);
    expect(http2.Http2Stream).toBe(Http2Stream);
    expect(http2.Http2ServerRequest).toBe(Http2ServerRequest);
    expect(http2.Http2ServerResponse).toBe(Http2ServerResponse);
    expect(http2.createServer).toBe(createServer);
    expect(http2.createSecureServer).toBe(createSecureServer);
    expect(http2.connect).toBe(connect);
    expect(http2.constants).toBe(constants);
    expect(http2.getDefaultSettings).toBe(getDefaultSettings);
    expect(http2.getPackedSettings).toBe(getPackedSettings);
    expect(http2.getUnpackedSettings).toBe(getUnpackedSettings);
    expect(http2.sensitiveHeaders).toBe(sensitiveHeaders);
  });
});
