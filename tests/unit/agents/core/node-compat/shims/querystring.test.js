import { describe, it, expect } from 'vitest';
import { stringify, parse, escape, unescape } from '../../../../../../js/agents/core/node-compat/shims/querystring.js';

describe('querystring shim', () => {
  it('stringify converts object to query string', () => {
    expect(stringify({ foo: 'bar', baz: '42' })).toBe('foo=bar&baz=42');
  });

  it('stringify uses custom separators', () => {
    expect(stringify({ a: '1', b: '2' }, ';', ':')).toBe('a:1;b:2');
  });

  it('parse converts query string to object', () => {
    expect(parse('foo=bar&baz=42')).toEqual({ foo: 'bar', baz: '42' });
  });

  it('parse returns empty object for empty string', () => {
    expect(parse('')).toEqual({});
  });

  it('parse handles value with equals sign', () => {
    expect(parse('key=a=b')).toEqual({ key: 'a=b' });
  });

  it('escape encodes URI component', () => {
    expect(escape('hello world')).toBe('hello%20world');
  });

  it('unescape decodes URI component', () => {
    expect(unescape('hello%20world')).toBe('hello world');
  });
});
