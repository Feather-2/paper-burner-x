/**
 * readline shim - Terminal readline is not available in browser
 * Provides stubs for common usage patterns
 */

import { EventEmitter } from './events.js';

/**
 * @typedef {Object} ReadLineOptions
 * @property {*} [input]
 * @property {*} [output]
 * @property {boolean} [terminal]
 * @property {string} [prompt]
 */

export class Interface extends EventEmitter {
  /**
   * @param {ReadLineOptions} [_options]
   */
  constructor(_options) {
    super();
    this.promptText = _options?.prompt ?? '';
    this.line = '';
    this.cursor = 0;
  }

  prompt(_preserveCursor) {}

  setPrompt(prompt) {
    this.promptText = prompt;
  }

  getPrompt() {
    return this.promptText;
  }

  question(_query, callback) {
    setTimeout(() => callback(''), 0);
  }

  pause() {
    return this;
  }

  resume() {
    return this;
  }

  close() {
    this.emit('close');
  }

  write(_data, _key) {}

  getCursorPos() {
    return { rows: 0, cols: 0 };
  }
}

export function createInterface(options) {
  return new Interface(options);
}

export function clearLine(_stream, _dir, _callback) {
  _callback?.();
  return true;
}

export function clearScreenDown(_stream, _callback) {
  _callback?.();
  return true;
}

export function cursorTo(_stream, _x, _y, _callback) {
  _callback?.();
  return true;
}

export function moveCursor(_stream, _dx, _dy, _callback) {
  _callback?.();
  return true;
}

export function emitKeypressEvents(_stream, _interface) {}

export const promises = {
  createInterface: (options) => {
    const rl = createInterface(options);
    return {
      question: (query) => new Promise((resolve) => {
        rl.question(query, resolve);
      }),
      close: () => rl.close(),
      [Symbol.asyncIterator]: async function* () {},
    };
  },
};

export default {
  Interface,
  createInterface,
  clearLine,
  clearScreenDown,
  cursorTo,
  moveCursor,
  emitKeypressEvents,
  promises,
};
