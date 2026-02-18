import { describe, it, expect } from 'vitest';
import { parse, format, resolve, URL, URLSearchParams } from '../../../../../../js/agents/core/node-compat/shims/url.js';

describe('url shim', () => {
  it('parse returns correct fields', () => {
    const r = parse('https://example.com:8080/path?foo=bar#hash');
    expect(r.protocol).toBe('https:');
    expect(r.hostname).toBe('example.com');
    expect(r.port).toBe('8080');
    expect(r.pathname).toBe('/path');
    expect(r.search).toBe('?foo=bar');
    expect(r.hash).toBe('#hash');
    expect(r.host).toBe('example.com:8080');
  });

  it('parse extracts query params', () => {
    const r = parse('http://x.com/?a=1&b=2');
    expect(r.query).toEqual({ a: '1', b: '2' });
  });

  it('format constructs URL from object', () => {
    const url = format({ protocol: 'https:', hostname: 'example.com', port: '443', pathname: '/p', search: '?q=1', hash: '#h' });
    expect(url).toBe('https://example.com:443/p?q=1#h');
  });

  it('format returns string input unchanged', () => {
    expect(format('https://x.com')).toBe('https://x.com');
  });

  it('resolve resolves relative URL', () => {
    expect(resolve('https://example.com/a/', './b')).toBe('https://example.com/a/b');
    expect(resolve('https://example.com/a/c', '../d')).toBe('https://example.com/d');
  });

  it('re-exports URL constructors with valid bindings', () => {
    const u = new URL('https://example.com/path?a=1');
    expect(u.hostname).toBe('example.com');
    const params = new URLSearchParams('a=1&b=2');
    expect(params.get('b')).toBe('2');
  });
});
