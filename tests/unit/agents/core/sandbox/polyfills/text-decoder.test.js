import { describe, it, expect, beforeEach } from 'vitest';
import { installTextDecoderPolyfill } from '../../../../../../js/agents/core/sandbox/polyfills/text-decoder.js';

describe('installTextDecoderPolyfill', () => {
  let fakeTarget;

  beforeEach(() => {
    fakeTarget = { TextDecoder: globalThis.TextDecoder };
    installTextDecoderPolyfill(fakeTarget);
  });

  it('should decode hex encoding', () => {
    const decoder = new fakeTarget.TextDecoder('hex');
    const input = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(decoder.decode(input)).toBe('deadbeef');
  });

  it('should decode base64 encoding', () => {
    const decoder = new fakeTarget.TextDecoder('base64');
    const input = new TextEncoder().encode('Hello');
    expect(decoder.decode(input)).toBe(btoa('Hello'));
  });

  it('should decode base64url encoding', () => {
    const decoder = new fakeTarget.TextDecoder('base64url');
    // bytes that produce +, / and = in standard base64
    const input = new Uint8Array([251, 239, 190]);
    const result = decoder.decode(input);
    expect(result).not.toMatch(/[+/=]/);
  });

  it('should decode binary/latin1 encoding', () => {
    const decoder = new fakeTarget.TextDecoder('latin1');
    const input = new Uint8Array([72, 101, 108, 108, 111]);
    expect(decoder.decode(input)).toBe('Hello');

    const decoder2 = new fakeTarget.TextDecoder('binary');
    expect(decoder2.decode(input)).toBe('Hello');
  });

  it('should delegate utf-8 to native TextDecoder', () => {
    const decoder = new fakeTarget.TextDecoder('utf-8');
    const input = new TextEncoder().encode('Hello World');
    expect(decoder.decode(input)).toBe('Hello World');
  });

  it('should report correct encoding property', () => {
    const hex = new fakeTarget.TextDecoder('hex');
    expect(hex.encoding).toBe('hex');

    const utf8 = new fakeTarget.TextDecoder('utf-8');
    expect(utf8.encoding).toBe('utf-8');
  });

  it('should handle empty input', () => {
    const decoder = new fakeTarget.TextDecoder('hex');
    expect(decoder.decode(new Uint8Array([]))).toBe('');

    const b64 = new fakeTarget.TextDecoder('base64');
    expect(b64.decode(new Uint8Array([]))).toBe('');

    const latin = new fakeTarget.TextDecoder('latin1');
    expect(latin.decode(new Uint8Array([]))).toBe('');
  });

  it('should skip installation when native supports hex', () => {
    const mockDecoder = class {
      constructor() {}
      decode() { return ''; }
      get encoding() { return 'hex'; }
    };
    const target = { TextDecoder: mockDecoder };
    installTextDecoderPolyfill(target);
    expect(target.TextDecoder).toBe(mockDecoder);
  });

  it('should skip installation when target has no TextDecoder', () => {
    const target = {};
    installTextDecoderPolyfill(target);
    expect(target.TextDecoder).toBeUndefined();
  });

  it('should set __polyfill flag on installed class', () => {
    expect(fakeTarget.TextDecoder.__polyfill).toBe(true);
  });
});
