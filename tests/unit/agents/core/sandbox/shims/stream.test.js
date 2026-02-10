import { describe, it, expect, vi } from 'vitest';
import { Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished } from '../../../../../../js/agents/core/sandbox/shims/stream.js';

describe('stream shim', () => {
  it('Readable push emits data events', () => {
    const r = new Readable();
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.push('hello');
    r.push('world');
    expect(chunks).toEqual(['hello', 'world']);
  });

  it('Readable push(null) emits end', () => {
    const r = new Readable();
    const fn = vi.fn();
    r.on('end', fn);
    r.push(null);
    expect(fn).toHaveBeenCalled();
  });

  it('Readable.read() returns buffered chunk', () => {
    const r = new Readable();
    r.push('data');
    expect(r.read()).toBe('data');
    expect(r.read()).toBeNull();
  });

  it('Writable.write collects chunks', () => {
    const w = new Writable();
    w.write('a');
    w.write('b');
    expect(w._chunks).toEqual(['a', 'b']);
  });

  it('Writable.end emits finish', () => {
    const w = new Writable();
    const fn = vi.fn();
    w.on('finish', fn);
    w.end();
    expect(fn).toHaveBeenCalled();
    expect(w.writable).toBe(false);
  });

  it('pipe connects Readable to Writable', () => {
    const r = new Readable();
    const w = new Writable();
    r.pipe(w);
    r.push('hello');
    r.push(null);
    expect(w._chunks).toEqual(['hello']);
  });

  it('PassThrough passes data through', () => {
    const pt = new PassThrough();
    const chunks = [];
    pt.on('data', (c) => chunks.push(c));
    pt.push('pass');
    expect(chunks).toEqual(['pass']);
  });

  it('Duplex is both readable and writable', () => {
    const d = new Duplex();
    expect(d.readable).toBe(true);
    expect(d.writable).toBe(true);
    d.write('x');
    d.push('y');
    expect(d._chunks).toEqual(['x']);
  });

  it('destroy emits close on Readable', () => {
    const r = new Readable();
    const fn = vi.fn();
    r.on('close', fn);
    r.destroy();
    expect(fn).toHaveBeenCalled();
    expect(r.readable).toBe(false);
  });

  it('pipeline connects streams', () => {
    const r = new Readable();
    const w = new Writable();
    const cb = vi.fn();
    pipeline(r, w, cb);
    r.push('data');
    r.push(null);
    expect(w._chunks).toEqual(['data']);
  });
});
