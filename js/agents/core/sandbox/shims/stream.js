/**
 * @fileoverview Node.js `stream` module shim for browser sandbox.
 */

import { EventEmitter } from './events.js';

export class Stream extends EventEmitter {
  pipe(dest) {
    this.on('data', (chunk) => dest.write(chunk));
    this.on('end', () => { if (typeof dest.end === 'function') dest.end(); });
    return dest;
  }
}

export class Readable extends Stream {
  constructor() {
    super();
    this.readable = true;
    this._buffer = [];
  }

  push(chunk) {
    if (chunk === null) {
      this.emit('end');
      return false;
    }
    this._buffer.push(chunk);
    this.emit('data', chunk);
    return true;
  }

  read() {
    return this._buffer.shift() || null;
  }

  destroy() {
    this.readable = false;
    this.emit('close');
  }
}

export class Writable extends Stream {
  constructor() {
    super();
    this.writable = true;
    this._chunks = [];
  }

  write(chunk, encoding, cb) {
    this._chunks.push(chunk);
    if (typeof cb === 'function') cb();
    return true;
  }

  end(chunk, encoding, cb) {
    if (chunk != null) this.write(chunk);
    this.writable = false;
    this.emit('finish');
    if (typeof cb === 'function') cb();
    else if (typeof encoding === 'function') encoding();
  }

  destroy() {
    this.writable = false;
    this.emit('close');
  }
}

export class Duplex extends Readable {
  constructor() {
    super();
    this.writable = true;
    this._chunks = [];
  }

  write(chunk, encoding, cb) {
    this._chunks.push(chunk);
    if (typeof cb === 'function') cb();
    return true;
  }

  end(chunk, encoding, cb) {
    if (chunk != null) this.write(chunk);
    this.writable = false;
    this.emit('finish');
    if (typeof cb === 'function') cb();
    else if (typeof encoding === 'function') encoding();
  }
}

export class Transform extends Duplex {
  _transform(chunk, encoding, cb) { cb(null, chunk); }
  _flush(cb) { cb(); }
}

export class PassThrough extends Transform {}

export const pipeline = (source, ...rest) => {
  const cb = typeof rest[rest.length - 1] === 'function' ? rest.pop() : null;
  let current = source;
  for (const dest of rest) current = current.pipe(dest);
  if (cb) {
    current.on('finish', () => cb(null));
    current.on('error', (err) => cb(err));
  }
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
