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
      if (encoding === 'base64') {
        const bin = atob(input);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
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
   * @returns {Buffer}
   */
  static alloc(size) {
    return Object.setPrototypeOf(new Uint8Array(size), Buffer.prototype);
  }

  /**
   * @param {Buffer[]} list
   * @returns {Buffer}
   */
  static concat(list) {
    const total = list.reduce((sum, b) => sum + b.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const b of list) {
      result.set(b, offset);
      offset += b.length;
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
   * @param {string} [encoding]
   * @returns {string}
   */
  toString(encoding) {
    if (encoding === 'base64') {
      let bin = '';
      for (let i = 0; i < this.length; i++) bin += String.fromCharCode(this[i]);
      return btoa(bin);
    }
    if (encoding === 'hex') {
      return [...this].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return new TextDecoder().decode(this);
  }
}

export default { Buffer };
