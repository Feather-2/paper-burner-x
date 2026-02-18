/**
 * @fileoverview Node.js `stream` module shim for browser sandbox.
 */

import { EventEmitter } from './events.js';
import { Buffer } from './buffer.js';

export class Stream extends EventEmitter {
  pipe(dest) {
    this.on('data', (chunk) => dest.write(chunk));
    this.on('end', () => { if (typeof dest.end === 'function') dest.end(); });
    return dest;
  }
}

export class Readable extends Stream {
  constructor(opts) {
    super();
    this.readable = true;
    this.readableFlowing = null;
    this._buffer = [];
    this._flowing = false;
    this._ended = false;
    this._endEmitted = false;
    this._encoding = null;
    this._readableState = {
      highWaterMark: (opts && opts.highWaterMark) || 16384, // 16KB default
      length: 0,
      needReadable: false,
      reading: false
    };
    if (opts && typeof opts.read === 'function') this._read = opts.read;
  }

  on(event, listener) {
    super.on(event, listener);
    if (event === 'data' && !this._flowing) {
      queueMicrotask(() => {
        if (this.listenerCount('data') > 0 && !this._flowing) this.resume();
      });
    }
    return this;
  }

  push(chunk) {
    if (chunk === null) {
      this._ended = true;
      this.readable = false;
      if (this._flowing && this._buffer.length === 0 && !this._endEmitted) {
        this._endEmitted = true;
        queueMicrotask(() => this.emit('end'));
      }
      return false;
    }
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    this._buffer.push(buf);
    this._readableState.length += buf.length;

    // Backpressure: return false if buffer exceeds highWaterMark
    const shouldContinue = this._readableState.length < this._readableState.highWaterMark;

    if (this._flowing) queueMicrotask(() => this._flushBuffer());
    return shouldContinue;
  }

  _flushBuffer() {
    while (this._buffer.length > 0 && this._flowing) {
      const chunk = this._buffer.shift();
      this._readableState.length -= chunk.length;
      this.emit('data', this._encoding ? chunk.toString(this._encoding) : chunk);
    }
    if (this._ended && this._buffer.length === 0 && !this._endEmitted) {
      this._endEmitted = true;
      this.emit('end');
    }
  }

  read(size) {
    if (!this._buffer.length) return null;
    if (size === undefined || size === null) {
      if (this._buffer.length === 1) {
        const single = this._buffer.shift();
        this._readableState.length -= single.length;
        return single;
      }
      const all = Buffer.concat(this._buffer);
      this._buffer = [];
      this._readableState.length = 0;
      return all;
    }
    // size-aware read
    const first = this._buffer[0];
    if (first.length <= size) {
      this._readableState.length -= first.length;
      return this._buffer.shift();
    }
    const slice = first.slice(0, size);
    this._buffer[0] = first.slice(size);
    this._readableState.length -= slice.length;
    return slice;
  }

  resume() {
    this._flowing = true;
    this.readableFlowing = true;
    this._flushBuffer();
    return this;
  }

  pause() {
    this._flowing = false;
    this.readableFlowing = false;
    return this;
  }

  pipe(dest) {
    this.on('data', (c) => {
      const ok = dest.write(c);
      if (ok === false && typeof this.pause === 'function') this.pause();
    });
    this.on('end', () => { if (typeof dest.end === 'function') dest.end(); });
    if (dest.on) {
      dest.on('drain', () => this.resume());
    }
    this.resume();
    return dest;
  }

  unpipe(dest) {
    this.removeAllListeners('data');
    this.removeAllListeners('end');
    return this;
  }

  setEncoding(enc) {
    this._encoding = enc;
    return this;
  }

  destroy(err) {
    this._buffer = [];
    this._ended = true;
    this.readable = false;
    if (err) this.emit('error', err);
    this.emit('close');
    return this;
  }

  /** @param {Iterable|AsyncIterable} iterable */
  static from(iterable) {
    const r = new Readable();
    if (iterable[Symbol.asyncIterator]) {
      (async () => {
        try {
          for await (const chunk of iterable) r.push(chunk);
          r.push(null);
        } catch (err) { r.destroy(err); }
      })();
    } else {
      for (const chunk of iterable) r.push(chunk);
      r.push(null);
    }
    return r;
  }
}

export class Writable extends Stream {
  constructor(opts) {
    super();
    this.writable = true;
    this._chunks = [];
    this._corked = 0;
    this._corkBuffer = [];
    this._writableState = {
      highWaterMark: (opts && opts.highWaterMark) || 16384, // 16KB default
      length: 0,
      needDrain: false,
      writing: false
    };
    this._pendingWrites = 0;
    this._ending = false;
    this._finished = false;
    this._endingCallbacks = [];
    if (opts && typeof opts.write === 'function') this._write = opts.write;
  }

  write(chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (!this.writable || this._ending) {
      const err = new Error('write after end');
      err.code = 'ERR_STREAM_WRITE_AFTER_END';
      if (typeof cb === 'function') cb(err);
      this.emit('error', err);
      return false;
    }
    if (this._corked > 0) {
      this._corkBuffer.push({ chunk, encoding, cb });
      return false;
    }

    const len = chunk.length || 0;
    this._writableState.length += len;
    this._pendingWrites += 1;
    const shouldContinue = this._writableState.length < this._writableState.highWaterMark;
    if (!shouldContinue) this._writableState.needDrain = true;

    let doneCalled = false;
    const done = (err) => {
      if (doneCalled) return;
      doneCalled = true;
      this._pendingWrites = Math.max(0, this._pendingWrites - 1);
      this._writableState.length = Math.max(0, this._writableState.length - len);
      if (err) this.emit('error', err);
      if (typeof cb === 'function') cb(err);

      // Emit drain if buffer was full and now below highWaterMark
      if (this._writableState.needDrain && this._writableState.length < this._writableState.highWaterMark) {
        this._writableState.needDrain = false;
        this.emit('drain');
      }

      this._maybeFinish();
    };

    if (this._write) {
      try {
        this._write(chunk, encoding || 'utf8', done);
      } catch (err) {
        done(err);
      }
    } else {
      this._chunks.push(chunk);
      done();
    }
    return shouldContinue;
  }

  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = null; }
    else if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (typeof cb === 'function') this._endingCallbacks.push(cb);
    if (chunk != null) this.write(chunk, encoding);
    this._ending = true;
    this.writable = false;
    if (this._corked === 0 && this._corkBuffer.length > 0) {
      this.uncork();
    }
    this._maybeFinish();
    return this;
  }

  _maybeFinish() {
    if (!this._ending || this._finished) return;
    if (this._pendingWrites > 0) return;
    if (this._corked > 0) return;
    if (this._corkBuffer.length > 0) {
      this.uncork();
      if (this._pendingWrites > 0) return;
    }
    this._finished = true;
    queueMicrotask(() => {
      this.emit('finish');
      const callbacks = this._endingCallbacks.splice(0);
      for (const callback of callbacks) callback();
    });
  }

  cork() { this._corked++; }

  uncork() {
    this._corked--;
    if (this._corked <= 0) {
      this._corked = 0;
      const pending = this._corkBuffer.splice(0);
      for (const { chunk, encoding, cb } of pending) this.write(chunk, encoding, cb);
    }
  }

  destroy(err) {
    this.writable = false;
    if (err) this.emit('error', err);
    this.emit('close');
    return this;
  }
}

export class Duplex extends Readable {
  constructor(opts) {
    super(opts);
    this.writable = true;
    this._chunks = [];
    this._corked = 0;
    this._corkBuffer = [];
    this._writableState = {
      highWaterMark: (opts && opts.highWaterMark) || 16384,
      length: 0,
      needDrain: false,
      writing: false
    };
    this._pendingWrites = 0;
    this._ending = false;
    this._finished = false;
    this._endingCallbacks = [];
    if (opts && typeof opts.write === 'function') this._write = opts.write;
  }

  write(chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (!this.writable || this._ending) {
      const err = new Error('write after end');
      err.code = 'ERR_STREAM_WRITE_AFTER_END';
      if (typeof cb === 'function') cb(err);
      this.emit('error', err);
      return false;
    }
    if (this._corked > 0) {
      this._corkBuffer.push({ chunk, encoding, cb });
      return false;
    }

    const len = chunk.length || 0;
    this._writableState.length += len;
    this._pendingWrites += 1;
    const shouldContinue = this._writableState.length < this._writableState.highWaterMark;
    if (!shouldContinue) this._writableState.needDrain = true;

    let doneCalled = false;
    const done = (err) => {
      if (doneCalled) return;
      doneCalled = true;
      this._pendingWrites = Math.max(0, this._pendingWrites - 1);
      this._writableState.length = Math.max(0, this._writableState.length - len);
      if (err) this.emit('error', err);
      if (typeof cb === 'function') cb(err);

      if (this._writableState.needDrain && this._writableState.length < this._writableState.highWaterMark) {
        this._writableState.needDrain = false;
        this.emit('drain');
      }
      this._maybeFinish();
    };

    if (this._write) {
      try {
        this._write(chunk, encoding || 'utf8', done);
      } catch (err) {
        done(err);
      }
    } else {
      this._chunks.push(chunk);
      done();
    }
    return shouldContinue;
  }

  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = null; }
    else if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (typeof cb === 'function') this._endingCallbacks.push(cb);
    if (chunk != null) this.write(chunk, encoding);
    this._ending = true;
    this.writable = false;
    if (this._corked === 0 && this._corkBuffer.length > 0) {
      this.uncork();
    }
    this._maybeFinish();
    return this;
  }

  _maybeFinish() {
    if (!this._ending || this._finished) return;
    if (this._pendingWrites > 0) return;
    if (this._corked > 0) return;
    if (this._corkBuffer.length > 0) {
      this.uncork();
      if (this._pendingWrites > 0) return;
    }
    this._finished = true;
    queueMicrotask(() => {
      this.emit('finish');
      const callbacks = this._endingCallbacks.splice(0);
      for (const callback of callbacks) callback();
    });
  }

  cork() { this._corked++; }
  uncork() {
    this._corked--;
    if (this._corked <= 0) {
      this._corked = 0;
      const pending = this._corkBuffer.splice(0);
      for (const { chunk, encoding, cb } of pending) this.write(chunk, encoding, cb);
    }
  }
}

export class Transform extends Duplex {
  constructor(opts = {}) {
    super(opts);
    if (typeof opts.transform === 'function') {
      this._transform = opts.transform;
    }
    if (typeof opts.flush === 'function') {
      this._flush = opts.flush;
    }
  }

  _transform(chunk, encoding, cb) { cb(null, chunk); }
  _flush(cb) { cb(); }

  _write(chunk, encoding, cb) {
    let settled = false;
    const done = (err, output) => {
      if (settled) return;
      settled = true;
      if (err) {
        cb(err);
        return;
      }
      if (output !== undefined && output !== null) {
        this.push(output);
      }
      cb();
    };

    try {
      const maybe = this._transform(chunk, encoding, done);
      if (maybe && typeof maybe.then === 'function') {
        maybe.then((output) => done(null, output), done);
      }
    } catch (err) {
      done(err);
    }
  }
}

export class PassThrough extends Transform {}

export const pipeline = (source, ...rest) => {
  const cb = typeof rest[rest.length - 1] === 'function' ? rest.pop() : null;
  const streams = [source, ...rest];
  let current = source;
  let destroyed = false;

  const cleanup = () => {
    if (destroyed) return;
    destroyed = true;
    for (const stream of streams) {
      if (stream && typeof stream.destroy === 'function') {
        stream.destroy();
      }
    }
  };

  const onError = (err) => {
    if (destroyed) return;
    cleanup();
    if (cb) cb(err);
  };

  const onFinish = () => {
    if (destroyed) return;
    if (cb) cb(null);
  };

  // Connect streams with proper error propagation
  for (let i = 0; i < rest.length; i++) {
    const dest = rest[i];
    current.on('error', onError);
    dest.on('error', onError);
    current = current.pipe(dest);
  }

  // Listen for completion on the last stream
  current.on('finish', onFinish);
  current.on('end', onFinish);

  return current;
};

export const finished = (stream, cb) => {
  const done = (err) => { cleanup(); cb(err); };
  const onFinish = () => done(null);
  const onError = (err) => done(err);
  const cleanup = () => {
    stream.off('finish', onFinish);
    stream.off('end', onFinish);
    stream.off('error', onError);
  };
  stream.on('finish', onFinish);
  stream.on('end', onFinish);
  stream.on('error', onError);
};

export default {
  Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished,
};
