import { describe, it, expect } from 'vitest';
import { StringDecoder } from '../../../../../../js/agents/core/node-compat/shims/string_decoder.js';

describe('string_decoder shim', () => {
  it('creates StringDecoder with default utf8 encoding', () => {
    const decoder = new StringDecoder();
    expect(decoder.encoding).toBe('utf8');
  });

  it('creates StringDecoder with specified encoding', () => {
    const decoder = new StringDecoder('utf-16');
    expect(decoder.encoding).toBe('utf-16');
  });

  it('write() decodes buffer to string', () => {
    const decoder = new StringDecoder('utf8');
    const buffer = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const result = decoder.write(buffer);
    expect(result).toBe('Hello');
  });

  it('write() returns empty string for empty buffer', () => {
    const decoder = new StringDecoder();
    expect(decoder.write(new Uint8Array([]))).toBe('');
    expect(decoder.write(null)).toBe('');
  });

  it('end() decodes buffer to string', () => {
    const decoder = new StringDecoder('utf8');
    const buffer = new Uint8Array([87, 111, 114, 108, 100]); // "World"
    const result = decoder.end(buffer);
    expect(result).toBe('World');
  });

  it('end() returns empty string for empty buffer', () => {
    const decoder = new StringDecoder();
    expect(decoder.end(new Uint8Array([]))).toBe('');
    expect(decoder.end(null)).toBe('');
  });

  it('handles multi-byte UTF-8 characters', () => {
    const decoder = new StringDecoder('utf8');
    const buffer = new Uint8Array([0xE4, 0xB8, 0xAD, 0xE6, 0x96, 0x87]); // "中文"
    const result = decoder.write(buffer);
    expect(result).toBe('中文');
  });

  it('write() with stream mode handles partial characters', () => {
    const decoder = new StringDecoder('utf8');
    const part1 = new Uint8Array([0xE4, 0xB8]); // First 2 bytes of "中"
    const part2 = new Uint8Array([0xAD]); // Last byte of "中"

    const result1 = decoder.write(part1);
    const result2 = decoder.write(part2);

    expect(result1 + result2).toBe('中');
  });
});
