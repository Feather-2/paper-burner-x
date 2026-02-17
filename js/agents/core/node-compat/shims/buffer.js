/**
 * @fileoverview Node.js `Buffer` shim for browser sandbox.
 * Wraps Uint8Array with common Buffer methods.
 */

export class Buffer extends Uint8Array {
  /**
   * @param {string|ArrayBuffer|Uint8Array|number[]} input
   * @param {string} [encoding]
   * @returns {Buffer}
   */
  static from(input, encoding) {
    if (typeof input === 'string') {
      const enc = (encoding || 'utf8').toLowerCase();
      if (enc === 'base64' || enc === 'base64url') {
        const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
        const bin = atob(normalized);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return Object.setPrototypeOf(arr, Buffer.prototype);
      }
      if (enc === 'hex') {
        const bytes = new Uint8Array(input.length / 2);
        for (let i = 0; i < input.length; i += 2) {
          bytes[i / 2] = parseInt(input.substr(i, 2), 16);
        }
        return Object.setPrototypeOf(bytes, Buffer.prototype);
      }
      if (enc === 'ascii' || enc === 'latin1' || enc === 'binary') {
        const arr = new Uint8Array(input.length);
        for (let i = 0; i < input.length; i++) arr[i] = input.charCodeAt(i) & 0xff;
        return Object.setPrototypeOf(arr, Buffer.prototype);
      }
      const bytes = new TextEncoder().encode(input);
      return Object.setPrototypeOf(bytes, Buffer.prototype);
    }
    if (input instanceof ArrayBuffer) {
      return Object.setPrototypeOf(new Uint8Array(input), Buffer.prototype);
    }
    if (ArrayBuffer.isView(input) || Array.isArray(input)) {
      return Object.setPrototypeOf(new Uint8Array(input), Buffer.prototype);
    }
    return Object.setPrototypeOf(new Uint8Array(0), Buffer.prototype);
  }

  /**
   * @param {number} size
   * @param {number|string} [fill]
   * @param {string} [encoding]
   * @returns {Buffer}
   */
  static alloc(size, fill, encoding) {
    const buf = Object.setPrototypeOf(new Uint8Array(size), Buffer.prototype);
    if (fill !== undefined) buf.fill(fill);
    return buf;
  }

  /**
   * @param {number} size
   * @returns {Buffer}
   */
  static allocUnsafe(size) {
    return Buffer.alloc(size);
  }

  /**
   * @param {Buffer[]} list
   * @param {number} [totalLength]
   * @returns {Buffer}
   */
  static concat(list, totalLength) {
    const total = totalLength ?? list.reduce((sum, b) => sum + b.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const b of list) {
      if (offset >= total) break;
      const len = Math.min(b.length, total - offset);
      result.set(b.length === len ? b : b.subarray(0, len), offset);
      offset += len;
    }
    return Object.setPrototypeOf(result, Buffer.prototype);
  }

  /**
   * @param {*} obj
   * @returns {boolean}
   */
  static isBuffer(obj) {
    return obj instanceof Buffer;
  }

  /**
   * @param {string} string
   * @param {string} [encoding]
   * @returns {number}
   */
  static byteLength(string, encoding) {
    if (typeof string !== 'string') return string.length || 0;
    const enc = (encoding || 'utf8').toLowerCase();
    if (enc === 'hex') return string.length / 2;
    if (enc === 'base64' || enc === 'base64url') {
      let padding = 0;
      if (string.endsWith('==')) padding = 2;
      else if (string.endsWith('=')) padding = 1;
      return Math.floor((string.length * 3) / 4) - padding;
    }
    if (enc === 'ascii' || enc === 'latin1' || enc === 'binary') return string.length;
    return new TextEncoder().encode(string).length;
  }

  /**
   * @param {string} enc
   * @returns {boolean}
   */
  static isEncoding(enc) {
    return [
      'utf8', 'utf-8', 'hex', 'base64', 'base64url', 'ascii',
      'latin1', 'binary', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le',
    ].includes((enc || '').toLowerCase());
  }

  /**
   * @param {string} string
   * @param {number} [offset]
   * @param {number} [length]
   * @param {string} [encoding]
   * @returns {number}
   */
  write(string, offset = 0, length, encoding = 'utf8') {
    const bytes = new TextEncoder().encode(string);
    const len = Math.min(bytes.length, length ?? (this.length - offset));
    this.set(bytes.subarray(0, len), offset);
    return len;
  }

  /**
   * @param {Buffer|Uint8Array} target
   * @param {number} [targetStart]
   * @param {number} [sourceStart]
   * @param {number} [sourceEnd]
   * @returns {number}
   */
  copy(target, targetStart = 0, sourceStart = 0, sourceEnd = this.length) {
    const src = this.subarray(sourceStart, sourceEnd);
    const len = Math.min(src.length, target.length - targetStart);
    target.set(src.subarray(0, len), targetStart);
    return len;
  }

  /**
   * @param {Buffer} other
   * @returns {boolean}
   */
  equals(other) {
    if (this.length !== other.length) return false;
    for (let i = 0; i < this.length; i++) {
      if (this[i] !== other[i]) return false;
    }
    return true;
  }

  /**
   * @param {Buffer} other
   * @returns {number}
   */
  compare(other) {
    const len = Math.min(this.length, other.length);
    for (let i = 0; i < len; i++) {
      if (this[i] < other[i]) return -1;
      if (this[i] > other[i]) return 1;
    }
    return this.length < other.length ? -1 : this.length > other.length ? 1 : 0;
  }

  /**
   * @param {string|number|Buffer} value
   * @param {number} [byteOffset]
   * @returns {number}
   */
  indexOf(value, byteOffset = 0) {
    if (typeof value === 'number') {
      for (let i = byteOffset; i < this.length; i++) {
        if (this[i] === (value & 0xff)) return i;
      }
      return -1;
    }
    const needle = typeof value === 'string' ? Buffer.from(value) : value;
    if (needle.length === 0) return byteOffset;
    outer: for (let i = byteOffset; i <= this.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (this[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  /**
   * @param {string|number|Buffer} value
   * @param {number} [byteOffset]
   * @returns {boolean}
   */
  includes(value, byteOffset) {
    return this.indexOf(value, byteOffset) !== -1;
  }

  /**
   * @param {number|string} value
   * @param {number} [offset]
   * @param {number} [end]
   * @returns {this}
   */
  fill(value, offset = 0, end = this.length) {
    if (typeof value === 'string') {
      if (value.length === 0) return this;
      if (value.length === 1) {
        const v = value.charCodeAt(0) & 0xff;
        for (let i = offset; i < end; i++) this[i] = v;
      } else {
        const bytes = new TextEncoder().encode(value);
        for (let i = offset; i < end; i++) this[i] = bytes[(i - offset) % bytes.length];
      }
    } else {
      const v = value & 0xff;
      for (let i = offset; i < end; i++) this[i] = v;
    }
    return this;
  }

  /**
   * @param {number} [start]
   * @param {number} [end]
   * @returns {Buffer}
   */
  slice(start, end) {
    const sliced = super.slice(start, end);
    return Object.setPrototypeOf(sliced, Buffer.prototype);
  }

  /**
   * @param {number} [start]
   * @param {number} [end]
   * @returns {Buffer}
   */
  subarray(start, end) {
    const sub = super.subarray(start, end);
    return Object.setPrototypeOf(sub, Buffer.prototype);
  }

  /** @returns {{ type: string, data: number[] }} */
  toJSON() {
    return { type: 'Buffer', data: Array.from(this) };
  }

  /**
   * @param {string} [encoding]
   * @param {number} [start]
   * @param {number} [end]
   * @returns {string}
   */
  toString(encoding = 'utf8', start = 0, end = this.length) {
    const slice = start === 0 && end === this.length ? this : this.subarray(start, end);
    switch ((encoding || 'utf8').toLowerCase()) {
      case 'hex':
        return [...slice].map(b => b.toString(16).padStart(2, '0')).join('');
      case 'base64': {
        let bin = '';
        for (let i = 0; i < slice.length; i++) bin += String.fromCharCode(slice[i]);
        return btoa(bin);
      }
      case 'ascii':
      case 'latin1':
      case 'binary': {
        let s = '';
        for (let i = 0; i < slice.length; i++) s += String.fromCharCode(slice[i]);
        return s;
      }
      default:
        return new TextDecoder().decode(slice);
    }
  }
}

export const SlowBuffer = Buffer;
export const kMaxLength = 2147483647;
export const INSPECT_MAX_BYTES = 50;
export const constants = { MAX_LENGTH: kMaxLength, MAX_STRING_LENGTH: 536870888 };
export function transcode(source) { return Buffer.from(source); }

export default { Buffer, SlowBuffer, kMaxLength, INSPECT_MAX_BYTES, constants, transcode };
