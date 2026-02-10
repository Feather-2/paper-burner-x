import { describe, it, expect, vi } from 'vitest';
import { Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished, Stream } from '../../../../../../js/agents/core/sandbox/shims/stream.js';
import { Buffer } from '../../../../../../js/agents/core/sandbox/shims/buffer.js';

/**
 * Helper: collect all 'data' events from a Readable once it flows.
 * Returns a promise that resolves with the collected chunks after 'end'.
 */
function collect(readable) {
  return new Promise((resolve) => {
    const chunks = [];
    readable.on('data', (c) => chunks.push(c));
    readable.on('end', () => resolve(chunks));
  });
}

describe('stream shim', () => {
  // ── Readable: flowing/paused mode ──

  it('Readable starts in paused mode (readableFlowing=null)', () => {
    const r = new Readable();
    expect(r.readableFlowing).toBeNull();
    expect(r._flowing).toBe(false);
  });

  it('on("data") auto-resumes via microtask and flushes buffer', async () => {
    const r = new Readable();
    r.push('hello');
    r.push('world');
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    // Not yet flushed synchronously
    expect(chunks.length).toBe(0);
    // Wait for microtask
    await new Promise((resolve) => queueMicrotask(resolve));
    // After microtask, should resume and flush
    await new Promise((resolve) => queueMicrotask(resolve));
    expect(r._flowing).toBe(true);
    expect(chunks.length).toBe(2);
  });

  it('resume() flushes buffered chunks', () => {
    const r = new Readable();
    r.push('a');
    r.push('b');
    const chunks = [];
    // Manually attach listener without auto-resume
    EventEmitter_on(r, 'data', (c) => chunks.push(c));
    expect(chunks.length).toBe(0);
    r.resume();
    expect(chunks.length).toBe(2);
    expect(r.readableFlowing).toBe(true);
  });

  it('pause() stops flowing', () => {
    const r = new Readable();
    r.resume();
    expect(r._flowing).toBe(true);
    r.pause();
    expect(r._flowing).toBe(false);
    expect(r.readableFlowing).toBe(false);
  });

  it('push(null) defers end event until buffer drained', async () => {
    const r = new Readable();
    r.push('data');
    r.push(null);
    const endFn = vi.fn();
    const collected = [];
    r.on('data', (c) => collected.push(c));
    r.on('end', endFn);
    // Wait for flowing + flush microtasks
    await new Promise((r) => setTimeout(r, 20));
    expect(collected.length).toBe(1);
    expect(endFn).toHaveBeenCalledOnce();
  });

  it('push converts strings to Buffer', async () => {
    const r = new Readable();
    r.push('hello');
    const chunks = [];
    // Use EventEmitter.prototype.on to avoid auto-resume
    EventEmitter_on(r, 'data', (c) => chunks.push(c));
    r.resume();
    expect(chunks[0]).toBeInstanceOf(Uint8Array);
    expect(chunks[0].toString()).toBe('hello');
  });

  // ── Readable.read(size) ──

  it('read() without size returns all buffered data concatenated', () => {
    const r = new Readable();
    r.push('hello');
    r.push(' world');
    const data = r.read();
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.toString()).toBe('hello world');
  });

  it('read(size) returns partial chunk', () => {
    const r = new Readable();
    r.push('hello world');
    const chunk = r.read(5);
    expect(chunk.toString()).toBe('hello');
    // Remainder stays in buffer
    const rest = r.read();
    expect(rest.toString()).toBe(' world');
  });

  it('read() on empty buffer returns null', () => {
    const r = new Readable();
    expect(r.read()).toBeNull();
  });

  // ── Readable.from() ──

  it('Readable.from(array) creates readable from iterable', async () => {
    const r = Readable.from(['a', 'b', 'c']);
    const chunks = await collect(r);
    expect(chunks.length).toBe(3);
  });

  it('Readable.from(async iterable) works', async () => {
    async function* gen() { yield 'x'; yield 'y'; }
    const r = Readable.from(gen());
    const chunks = await collect(r);
    expect(chunks.length).toBe(2);
  });

  // ── setEncoding ──

  it('setEncoding() causes data events to emit strings', async () => {
    const r = new Readable();
    r.setEncoding('utf8');
    r.push(Buffer.from('hello'));
    const chunks = [];
    EventEmitter_on(r, 'data', (c) => chunks.push(c));
    r.resume();
    expect(typeof chunks[0]).toBe('string');
    expect(chunks[0]).toBe('hello');
  });

  // ── pipe with auto-resume and backpressure ──

  it('pipe auto-resumes and sends data to writable', async () => {
    const r = new Readable();
    const w = new Writable();
    r.push('hello');
    r.push(null);
    r.pipe(w);
    await new Promise((r) => setTimeout(r, 20));
    expect(w._chunks.length).toBe(1);
  });

  it('unpipe removes listeners', () => {
    const r = new Readable();
    const w = new Writable();
    r.pipe(w);
    r.unpipe(w);
    expect(r.listenerCount('data')).toBe(0);
    expect(r.listenerCount('end')).toBe(0);
  });

  // ── Writable ──

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

  it('Writable.write with callback', () => {
    const w = new Writable();
    const cb = vi.fn();
    w.write('x', cb);
    expect(cb).toHaveBeenCalled();
  });

  it('Writable.end with chunk', () => {
    const w = new Writable();
    w.end('final');
    expect(w._chunks).toEqual(['final']);
    expect(w.writable).toBe(false);
  });

  it('Writable.end with callback only', () => {
    const w = new Writable();
    const cb = vi.fn();
    w.end(cb);
    expect(cb).toHaveBeenCalled();
  });

  it('Writable with custom _write', () => {
    const collected = [];
    const w = new Writable({
      write(chunk, enc, cb) {
        collected.push(chunk);
        cb();
      }
    });
    w.write('a');
    w.write('b');
    expect(collected).toEqual(['a', 'b']);
  });

  // ── cork/uncork ──

  it('cork/uncork buffers and flushes writes', () => {
    const w = new Writable();
    w.cork();
    w.write('a');
    w.write('b');
    expect(w._chunks.length).toBe(0);
    w.uncork();
    expect(w._chunks).toEqual(['a', 'b']);
  });

  // ── Duplex ──

  it('Duplex is both readable and writable', () => {
    const d = new Duplex();
    expect(d.readable).toBe(true);
    expect(d.writable).toBe(true);
    d.write('x');
    d.push('y');
    expect(d._chunks).toEqual(['x']);
  });

  // ── PassThrough ──

  it('PassThrough passes data through', async () => {
    const pt = new PassThrough();
    pt.push('pass');
    const chunks = [];
    EventEmitter_on(pt, 'data', (c) => chunks.push(c));
    pt.resume();
    expect(chunks.length).toBe(1);
  });

  // ── destroy ──

  it('destroy emits close on Readable', () => {
    const r = new Readable();
    const fn = vi.fn();
    r.on('close', fn);
    r.destroy();
    expect(fn).toHaveBeenCalled();
    expect(r.readable).toBe(false);
  });

  it('destroy with error emits error then close', () => {
    const r = new Readable();
    const errFn = vi.fn();
    const closeFn = vi.fn();
    r.on('error', errFn);
    r.on('close', closeFn);
    const err = new Error('boom');
    r.destroy(err);
    expect(errFn).toHaveBeenCalledWith(err);
    expect(closeFn).toHaveBeenCalled();
  });

  it('Writable destroy emits close', () => {
    const w = new Writable();
    const fn = vi.fn();
    w.on('close', fn);
    w.destroy();
    expect(fn).toHaveBeenCalled();
    expect(w.writable).toBe(false);
  });

  // ── pipeline ──

  it('pipeline connects streams', async () => {
    const r = new Readable();
    const w = new Writable();
    const cb = vi.fn();
    pipeline(r, w, cb);
    r.push('data');
    r.push(null);
    await new Promise((r) => setTimeout(r, 20));
    expect(w._chunks.length).toBe(1);
  });

  // ── finished ──

  it('finished calls cb on stream end', () => {
    const r = new Readable();
    const cb = vi.fn();
    finished(r, cb);
    r.emit('end');
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('finished calls cb on error', () => {
    const r = new Readable();
    const cb = vi.fn();
    finished(r, cb);
    const err = new Error('fail');
    r.emit('error', err);
    expect(cb).toHaveBeenCalledWith(err);
  });

  // ── Stream base class ──

  it('Stream extends EventEmitter', () => {
    const s = new Stream();
    expect(typeof s.on).toBe('function');
    expect(typeof s.emit).toBe('function');
  });
});

/**
 * Bypass Readable.on override to attach listener without triggering auto-resume.
 * Uses EventEmitter.prototype.on directly.
 */
function EventEmitter_on(emitter, event, fn) {
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(emitter)));
  // Stream -> EventEmitter
  if (proto && proto.on) {
    proto.on.call(emitter, event, fn);
  } else {
    // fallback: just use Map directly
    let list = emitter._events.get(event);
    if (!list) { list = []; emitter._events.set(event, list); }
    list.push(fn);
  }
}
