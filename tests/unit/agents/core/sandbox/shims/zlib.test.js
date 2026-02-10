import { describe, it, expect } from 'vitest';
import {
  gzipAsync, gunzipAsync,
  deflateAsync, inflateAsync,
  gzipSync,
  constants,
  Z_NO_COMPRESSION, Z_BEST_COMPRESSION,
  createGzip,
} from '../../../../../../js/agents/core/sandbox/shims/zlib.js';

describe('zlib shim', () => {
  it('gzipAsync + gunzipAsync round-trip (text)', async () => {
    const input = new TextEncoder().encode('hello world');
    const compressed = await gzipAsync(input);
    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed.length).toBeGreaterThan(0);
    const decompressed = await gunzipAsync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe('hello world');
  });

  it('gzipAsync + gunzipAsync round-trip (binary)', async () => {
    const input = new Uint8Array([0, 1, 2, 255, 128, 64, 32, 16, 8, 4]);
    const compressed = await gzipAsync(input);
    const decompressed = await gunzipAsync(compressed);
    expect(Array.from(decompressed)).toEqual(Array.from(input));
  });

  it('deflateAsync + inflateAsync round-trip', async () => {
    const text = 'deflate round-trip test data';
    const input = new TextEncoder().encode(text);
    const compressed = await deflateAsync(input);
    expect(compressed).toBeInstanceOf(Uint8Array);
    const decompressed = await inflateAsync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(text);
  });

  it('gzipAsync accepts string input', async () => {
    const compressed = await gzipAsync('string input test');
    expect(compressed).toBeInstanceOf(Uint8Array);
    const decompressed = await gunzipAsync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe('string input test');
  });

  it('gzipSync throws unsupported error', () => {
    expect(() => gzipSync(new Uint8Array([1, 2, 3]))).toThrow(
      'Sync compression not available in browser, use async variant',
    );
  });

  it('constants contains correct values', () => {
    expect(constants).toHaveProperty('Z_NO_COMPRESSION', 0);
    expect(constants).toHaveProperty('Z_BEST_SPEED', 1);
    expect(constants).toHaveProperty('Z_BEST_COMPRESSION', 9);
    expect(constants).toHaveProperty('Z_DEFAULT_COMPRESSION', -1);
  });

  it('Z_NO_COMPRESSION = 0, Z_BEST_COMPRESSION = 9', () => {
    expect(Z_NO_COMPRESSION).toBe(0);
    expect(Z_BEST_COMPRESSION).toBe(9);
  });

  it('createGzip returns object with readable/writable', () => {
    const stream = createGzip();
    expect(stream).toHaveProperty('readable');
    expect(stream).toHaveProperty('writable');
  });

  it('empty Uint8Array round-trip', async () => {
    const input = new Uint8Array(0);
    const compressed = await gzipAsync(input);
    const decompressed = await gunzipAsync(compressed);
    expect(decompressed.length).toBe(0);
  });
});
