/**
 * tty shim - Terminal detection utilities
 */

import { Readable, Writable } from './stream.js';

export class ReadStream extends Readable {
  constructor() {
    super();
    this.isTTY = false;
    this.isRaw = false;
  }

  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  }
}

export class WriteStream extends Writable {
  constructor() {
    super();
    this.isTTY = false;
    this.columns = 80;
    this.rows = 24;
  }

  clearLine(dir, callback) {
    if (callback) callback();
    return true;
  }

  clearScreenDown(callback) {
    if (callback) callback();
    return true;
  }

  cursorTo(x, y, callback) {
    if (callback) callback();
    return true;
  }

  moveCursor(dx, dy, callback) {
    if (callback) callback();
    return true;
  }

  getColorDepth(env) {
    return 1;
  }

  hasColors(count, env) {
    return false;
  }

  getWindowSize() {
    return [this.columns, this.rows];
  }
}

export function isatty(fd) {
  return false;
}

export default {
  ReadStream,
  WriteStream,
  isatty,
};
