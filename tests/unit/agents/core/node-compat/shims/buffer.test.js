import { describe, it, expect } from 'vitest';
import { Buffer, SlowBuffer, kMaxLength, INSPECT_MAX_BYTES, constants, transcode } from '../../../../../../js/agents/core/node-compat/shims/buffer.js';

describe('Buffer shim', () => {
  // ── existing tests ──

  it('Buffer.from(string) creates Buffer from UTF-8', () => {
    const buf = Buffer.from('hello');
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf.toString()).toBe('hello');
  });

  it('Buffer.from(array) creates Buffer from byte array', () => {
    const buf = Buffer.from([72, 105]);
    expect(buf.toString()).toBe('Hi');
  });

  it('Buffer.from(Uint8Array) wraps existing typed array', () => {
    const src = new Uint8Array([1, 2, 3]);
    const buf = Buffer.from(src);
    expect(buf.length).toBe(3);
    expect(buf[0]).toBe(1);
  });

  it('Buffer.from(string, "base64") decodes base64', () => {
    const buf = Buffer.from('aGVsbG8=', 'base64');
    expect(buf.toString()).toBe('hello');
  });

  it('toString("base64") encodes to base64', () => {
    const buf = Buffer.from('hello');
    expect(buf.toString('base64')).toBe('aGVsbG8=');
  });

  it('toString("hex") encodes to hex', () => {
    const buf = Buffer.from('hello');
    expect(buf.toString('hex')).toBe('68656c6c6f');
  });

  it('Buffer.alloc(size) creates zero-filled buffer', () => {
    const buf = Buffer.alloc(5);
    expect(buf.length).toBe(5);
    expect([...buf]).toEqual([0, 0, 0, 0, 0]);
  });

  it('Buffer.isBuffer detects Buffer instances', () => {
    expect(Buffer.isBuffer(Buffer.from('x'))).toBe(true);
    expect(Buffer.isBuffer(new Uint8Array(1))).toBe(false);
    expect(Buffer.isBuffer('string')).toBe(false);
  });

  it('Buffer.concat merges multiple buffers', () => {
    const a = Buffer.from('hel');
    const b = Buffer.from('lo');
    const c = Buffer.concat([a, b]);
    expect(c.toString()).toBe('hello');
    expect(c.length).toBe(5);
  });

  it('Buffer inherits Uint8Array indexing', () => {
    const buf = Buffer.from('AB');
    expect(buf[0]).toBe(65);
    expect(buf[1]).toBe(66);
  });

  // ── new tests ──

  it('Buffer.from(hex) decodes hex string', () => {
    const buf = Buffer.from('68656c6c6f', 'hex');
    expect(buf.toString()).toBe('hello');
    expect(buf.length).toBe(5);
  });

  it('Buffer.from(ascii) decodes ascii string', () => {
    const buf = Buffer.from('hello', 'ascii');
    expect(buf.toString('ascii')).toBe('hello');
  });

  it('Buffer.allocUnsafe returns buffer of correct size', () => {
    const buf = Buffer.allocUnsafe(10);
    expect(buf.length).toBe(10);
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  it('Buffer.alloc with fill value', () => {
    const buf = Buffer.alloc(4, 0xab);
    expect([...buf]).toEqual([0xab, 0xab, 0xab, 0xab]);
  });

  it('Buffer.alloc with string fill', () => {
    const buf = Buffer.alloc(3, 'x');
    expect(buf.toString('ascii')).toBe('xxx');
  });

  it('Buffer.byteLength for utf8', () => {
    expect(Buffer.byteLength('hello')).toBe(5);
  });

  it('Buffer.byteLength for hex', () => {
    expect(Buffer.byteLength('68656c6c6f', 'hex')).toBe(5);
  });

  it('Buffer.byteLength for base64', () => {
    expect(Buffer.byteLength('aGVsbG8=', 'base64')).toBe(5);
  });

  it('Buffer.byteLength for ascii', () => {
    expect(Buffer.byteLength('hello', 'ascii')).toBe(5);
  });

  it('Buffer.byteLength for multibyte utf8', () => {
    // Chinese char is 3 bytes in UTF-8
    expect(Buffer.byteLength('\u4f60')).toBe(3);
  });

  it('Buffer.isEncoding recognizes valid encodings', () => {
    expect(Buffer.isEncoding('utf8')).toBe(true);
    expect(Buffer.isEncoding('UTF-8')).toBe(true);
    expect(Buffer.isEncoding('hex')).toBe(true);
    expect(Buffer.isEncoding('base64')).toBe(true);
    expect(Buffer.isEncoding('ascii')).toBe(true);
    expect(Buffer.isEncoding('latin1')).toBe(true);
    expect(Buffer.isEncoding('binary')).toBe(true);
    expect(Buffer.isEncoding('ucs2')).toBe(true);
    expect(Buffer.isEncoding('bogus')).toBe(false);
    expect(Buffer.isEncoding('')).toBe(false);
    expect(Buffer.isEncoding(null)).toBe(false);
  });

  it('write() writes string into buffer at offset', () => {
    const buf = Buffer.alloc(10);
    const written = buf.write('hello', 2);
    expect(written).toBe(5);
    expect(buf.toString('utf8', 2, 7)).toBe('hello');
  });

  it('write() respects length limit', () => {
    const buf = Buffer.alloc(10);
    const written = buf.write('hello', 0, 3);
    expect(written).toBe(3);
    expect(buf.toString('utf8', 0, 3)).toBe('hel');
  });

  it('copy() copies data between buffers', () => {
    const src = Buffer.from('hello world');
    const dst = Buffer.alloc(5);
    const copied = src.copy(dst, 0, 6, 11);
    expect(copied).toBe(5);
    expect(dst.toString()).toBe('world');
  });

  it('copy() with partial overlap', () => {
    const src = Buffer.from('abcdef');
    const dst = Buffer.alloc(3);
    src.copy(dst, 0, 2, 5);
    expect(dst.toString()).toBe('cde');
  });

  it('equals() returns true for identical buffers', () => {
    const a = Buffer.from('abc');
    const b = Buffer.from('abc');
    expect(a.equals(b)).toBe(true);
  });

  it('equals() returns false for different buffers', () => {
    const a = Buffer.from('abc');
    const b = Buffer.from('xyz');
    expect(a.equals(b)).toBe(false);
  });

  it('equals() returns false for different lengths', () => {
    const a = Buffer.from('ab');
    const b = Buffer.from('abc');
    expect(a.equals(b)).toBe(false);
  });

  it('compare() returns 0 for equal buffers', () => {
    expect(Buffer.from('abc').compare(Buffer.from('abc'))).toBe(0);
  });

  it('compare() returns -1 when this < other', () => {
    expect(Buffer.from('abc').compare(Buffer.from('abd'))).toBe(-1);
  });

  it('compare() returns 1 when this > other', () => {
    expect(Buffer.from('abd').compare(Buffer.from('abc'))).toBe(1);
  });

  it('compare() handles different lengths', () => {
    expect(Buffer.from('ab').compare(Buffer.from('abc'))).toBe(-1);
    expect(Buffer.from('abc').compare(Buffer.from('ab'))).toBe(1);
  });

  it('indexOf(number) finds byte value', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5]);
    expect(buf.indexOf(3)).toBe(2);
    expect(buf.indexOf(99)).toBe(-1);
  });

  it('indexOf(string) finds substring', () => {
    const buf = Buffer.from('hello world');
    expect(buf.indexOf('world')).toBe(6);
    expect(buf.indexOf('xyz')).toBe(-1);
  });

  it('indexOf(Buffer) finds buffer', () => {
    const buf = Buffer.from('hello world');
    expect(buf.indexOf(Buffer.from('llo'))).toBe(2);
  });

  it('indexOf with byteOffset', () => {
    const buf = Buffer.from('abcabc');
    expect(buf.indexOf('abc', 1)).toBe(3);
  });

  it('includes() returns boolean', () => {
    const buf = Buffer.from('hello world');
    expect(buf.includes('world')).toBe(true);
    expect(buf.includes('xyz')).toBe(false);
    expect(buf.includes(0x6f)).toBe(true); // 'o'
  });

  it('fill() fills with number', () => {
    const buf = Buffer.alloc(4);
    buf.fill(0xff);
    expect([...buf]).toEqual([0xff, 0xff, 0xff, 0xff]);
  });

  it('fill() fills with string', () => {
    const buf = Buffer.alloc(3);
    buf.fill('a');
    expect(buf.toString()).toBe('aaa');
  });

  it('fill() with offset and end', () => {
    const buf = Buffer.alloc(5);
    buf.fill(0xab, 1, 4);
    expect([...buf]).toEqual([0, 0xab, 0xab, 0xab, 0]);
  });

  it('slice() returns Buffer instance', () => {
    const buf = Buffer.from('hello');
    const s = buf.slice(1, 3);
    expect(Buffer.isBuffer(s)).toBe(true);
    expect(s.toString()).toBe('el');
  });

  it('subarray() returns Buffer instance', () => {
    const buf = Buffer.from('hello');
    const s = buf.subarray(0, 2);
    expect(Buffer.isBuffer(s)).toBe(true);
    expect(s.toString()).toBe('he');
  });

  it('toJSON() returns { type, data }', () => {
    const buf = Buffer.from([1, 2, 3]);
    const json = buf.toJSON();
    expect(json).toEqual({ type: 'Buffer', data: [1, 2, 3] });
  });

  it('toString with start/end range', () => {
    const buf = Buffer.from('hello world');
    expect(buf.toString('utf8', 6, 11)).toBe('world');
    expect(buf.toString('hex', 0, 2)).toBe('6865');
  });

  it('toString("latin1") works', () => {
    const buf = Buffer.from([0xc0, 0xc1, 0xfe]);
    const s = buf.toString('latin1');
    expect(s).toBe('\u00c0\u00c1\u00fe');
  });

  // ── module exports ──

  it('SlowBuffer is alias for Buffer', () => {
    expect(SlowBuffer).toBe(Buffer);
  });

  it('kMaxLength is 2^31-1', () => {
    expect(kMaxLength).toBe(2147483647);
  });

  it('INSPECT_MAX_BYTES is 50', () => {
    expect(INSPECT_MAX_BYTES).toBe(50);
  });

  it('constants has MAX_LENGTH and MAX_STRING_LENGTH', () => {
    expect(constants.MAX_LENGTH).toBe(2147483647);
    expect(constants.MAX_STRING_LENGTH).toBe(536870888);
  });

  it('transcode returns a Buffer copy', () => {
    const src = Buffer.from('hi');
    const out = transcode(src);
    expect(Buffer.isBuffer(out)).toBe(true);
  });
});
