import { describe, it, expect } from 'vitest';
import { Buffer } from '../../../../../../js/agents/core/sandbox/shims/buffer.js';

describe('Buffer shim', () => {
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
});
