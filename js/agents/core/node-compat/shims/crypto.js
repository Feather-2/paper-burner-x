/**
 * @file Node.js crypto shim for browser sandbox.
 * Wraps Web Crypto API with Node.js-compatible interface.
 * @module crypto
 */

import { Buffer } from './buffer.js';

// ============ Random ============

/**
 * @param {number} size
 * @returns {Buffer}
 */
export function randomBytes(size) {
  const arr = new Uint8Array(size);
  crypto.getRandomValues(arr);
  return Buffer.from(arr);
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @param {number} [offset=0]
 * @param {number} [size]
 * @returns {Buffer|Uint8Array}
 */
export function randomFillSync(buffer, offset = 0, size) {
  const len = size !== undefined ? size : buffer.length - offset;
  const view = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, len);
  crypto.getRandomValues(view);
  return buffer;
}

/** @returns {string} */
export function randomUUID() { return crypto.randomUUID(); }

/**
 * @param {number} min
 * @param {number} [max]
 * @returns {number}
 */
export function randomInt(min, max) {
  if (max === undefined) { max = min; min = 0; }
  min = Number(min);
  max = Number(max);
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    const err = new TypeError('randomInt() min and max must be integers');
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
  }
  if (!(max > min)) {
    const err = new RangeError('randomInt() max must be greater than min');
    err.code = 'ERR_OUT_OF_RANGE';
    throw err;
  }
  const range = max - min;
  const maxUint32 = 0x1_0000_0000;
  const limit = Math.floor(maxUint32 / range) * range;
  const arr = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(arr);
    value = arr[0];
  } while (value >= limit);
  return min + (value % range);
}

/**
 * @param {TypedArray} arr
 * @returns {TypedArray}
 */
export function getRandomValues(arr) { return crypto.getRandomValues(arr); }

// ============ Hash internals ============

/** @param {string} alg */
function normalizeAlgorithm(alg) {
  const normalized = String(alg || '').toLowerCase().replace(/-/g, '');
  const map = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };
  if (normalized === 'md5') {
    const err = new Error('[crypto shim] MD5 is not supported by WebCrypto digest APIs.');
    err.code = 'ERR_CRYPTO_UNSUPPORTED_ALGORITHM';
    throw err;
  }
  return map[normalized] || alg;
}


/**
 * @param {Uint8Array} hash
 * @param {string} [encoding]
 * @returns {string|Buffer}
 */
function encodeResult(hash, encoding) {
  if (encoding === 'hex') return [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
  if (encoding === 'base64') {
    let s = '';
    for (let i = 0; i < hash.length; i++) s += String.fromCharCode(hash[i]);
    return btoa(s);
  }
  return Buffer.from(hash);
}

/** @param {Array<Uint8Array>} list */
function concatBuffers(list) {
  const total = list.reduce((s, b) => s + b.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const b of list) { result.set(b, off); off += b.length; }
  return result;
}

// ============ Hash ============

/**
 * @param {string} algorithm
 * @returns {Hash}
 */
export function createHash(algorithm) { return new Hash(algorithm); }

class Hash {
  static _syncDigestWarned = false;

  /** @param {string} algorithm */
  constructor(algorithm) {
    this._algorithm = normalizeAlgorithm(algorithm);
    /** @type {Uint8Array[]} */
    this._data = [];
  }

  /**
   * @param {string|Uint8Array|Buffer} data
   * @param {string} [encoding]
   * @returns {this}
   */
  update(data, encoding) {
    const buf = typeof data === 'string'
      ? (encoding === 'base64' ? Buffer.from(atob(data)) : Buffer.from(data))
      : Buffer.from(data);
    this._data.push(buf);
    return this;
  }

  /**
   * @param {string} [encoding]
   * @returns {string|Buffer}
   */
  digest(encoding) {
    throw new Error(
      '[crypto shim] Hash.digest() is not supported in browser environment. ' +
      'Synchronous hashing cannot be implemented securely without Web Crypto API. ' +
      'Use digestAsync() instead for cryptographically correct results.'
    );
  }

  /**
   * Async digest using Web Crypto (cryptographically correct).
   * @param {string} [encoding]
   * @returns {Promise<string|Buffer>}
   */
  async digestAsync(encoding) {
    const combined = concatBuffers(this._data);
    const ab = new Uint8Array(combined).buffer;
    const hashBuf = await crypto.subtle.digest(this._algorithm, ab);
    return encodeResult(new Uint8Array(hashBuf), encoding);
  }
}

// ============ HMAC ============

/**
 * @param {string} algorithm
 * @param {string|Uint8Array|Buffer} key
 * @returns {Hmac}
 */
export function createHmac(algorithm, key) { return new Hmac(algorithm, key); }

class Hmac {
  constructor(algorithm, key) {
    this._algorithm = normalizeAlgorithm(algorithm);
    this._key = typeof key === 'string' ? Buffer.from(key) : key;
    /** @type {Uint8Array[]} */
    this._data = [];
  }

  /**
   * @param {string|Uint8Array|Buffer} data
   * @returns {this}
   */
  update(data) {
    this._data.push(typeof data === 'string' ? Buffer.from(data) : data);
    return this;
  }

  /**
   * @param {string} [encoding]
   * @returns {string|Buffer}
   */
  digest(encoding) {
    throw new Error(
      '[crypto shim] Hmac.digest() is not supported in browser environment. ' +
      'Synchronous HMAC cannot be implemented securely without Web Crypto API. ' +
      'Use digestAsync() instead for cryptographically correct results.'
    );
  }

  /**
   * Async digest using Web Crypto (cryptographically correct).
   * @param {string} [encoding]
   * @returns {Promise<string|Buffer>}
   */
  async digestAsync(encoding) {
    const combined = concatBuffers(this._data);
    const keyBytes = typeof this._key === 'string' ? new TextEncoder().encode(this._key) : new Uint8Array(this._key);
    const key = await crypto.subtle.importKey('raw', keyBytes.buffer, { name: 'HMAC', hash: this._algorithm }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, combined.buffer);
    return encodeResult(new Uint8Array(sig), encoding);
  }
}

// ============ Sign / Verify ============

function parseKeyAlgorithm(key) {
  if (key && key._wcKey) return key._wcKey;
  throw new Error('Sign/Verify requires a CryptoKey created via wrapKey()');
}

export function createSign(algorithm) { return new Sign(algorithm); }

class Sign {
  constructor(algorithm) {
    this._algorithm = normalizeAlgorithm(algorithm);
    this._data = [];
  }

  update(data, encoding) {
    this._data.push(typeof data === 'string'
      ? (encoding === 'base64' ? Buffer.from(atob(data)) : Buffer.from(data))
      : Buffer.from(data));
    return this;
  }

  async sign(privateKey, outputEncoding) {
    const combined = concatBuffers(this._data);
    const wcKey = parseKeyAlgorithm(privateKey);
    const alg = { ...(privateKey._wcAlg || { name: 'RSASSA-PKCS1-v1_5' }) };
    if (!alg.hash) alg.hash = this._algorithm;
    const sig = await crypto.subtle.sign(alg, wcKey, combined.buffer);
    return encodeResult(new Uint8Array(sig), outputEncoding);
  }
}

export function createVerify(algorithm) { return new Verify(algorithm); }

class Verify {
  constructor(algorithm) {
    this._algorithm = normalizeAlgorithm(algorithm);
    this._data = [];
  }

  update(data, encoding) {
    this._data.push(typeof data === 'string'
      ? (encoding === 'base64' ? Buffer.from(atob(data)) : Buffer.from(data))
      : Buffer.from(data));
    return this;
  }

  async verify(publicKey, signature, inputEncoding) {
    const combined = concatBuffers(this._data);
    const wcKey = parseKeyAlgorithm(publicKey);
    const alg = { ...(publicKey._wcAlg || { name: 'RSASSA-PKCS1-v1_5' }) };
    if (!alg.hash) alg.hash = this._algorithm;
    let sigBytes;
    if (typeof signature === 'string') {
      if (inputEncoding === 'hex') {
        const pairs = signature.match(/.{1,2}/g) || [];
        sigBytes = new Uint8Array(pairs.map(h => parseInt(h, 16)));
      } else if (inputEncoding === 'base64') {
        sigBytes = Buffer.from(atob(signature));
      } else {
        sigBytes = Buffer.from(signature);
      }
    } else {
      sigBytes = new Uint8Array(signature);
    }
    return crypto.subtle.verify(alg, wcKey, sigBytes.buffer, combined.buffer);
  }
}

export function wrapKey(wcKey, algorithm = {}) {
  return { _wcKey: wcKey, _wcAlg: algorithm };
}

// ============ Cipher stubs ============

export function createCipheriv() { throw new Error('createCipheriv not supported in browser sandbox'); }
export function createDecipheriv() { throw new Error('createDecipheriv not supported in browser sandbox'); }

// ============ PBKDF2 ============

/**
 * @param {string|Buffer} password
 * @param {string|Buffer} salt
 * @param {number} iterations
 * @param {number} keylen
 * @param {string} digest
 * @param {Function} callback
 */
export function pbkdf2(password, salt, iterations, keylen, digest, callback) {
  pbkdf2Async(password, salt, iterations, keylen, digest)
    .then(k => callback(null, k)).catch(e => callback(e, Buffer.alloc(0)));
}

async function pbkdf2Async(password, salt, iterations, keylen, digest) {
  const pw = typeof password === 'string' ? new TextEncoder().encode(password) : new Uint8Array(password);
  const s = typeof salt === 'string' ? new TextEncoder().encode(salt) : new Uint8Array(salt);
  const key = await crypto.subtle.importKey('raw', pw.buffer, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: s.buffer, iterations, hash: normalizeAlgorithm(digest) },
    key, keylen * 8
  );
  return Buffer.from(bits);
}

/**
 * Synchronous PBKDF2 - NOT SUPPORTED in browser environment.
 * @param {string|Buffer} password
 * @param {string|Buffer} salt
 * @param {number} iterations
 * @param {number} keylen
 * @param {string} digest
 * @returns {Buffer}
 * @throws {Error} Always throws - use pbkdf2() async version instead
 */
export function pbkdf2Sync(password, salt, iterations, keylen, digest) {
  throw new Error(
    '[crypto shim] pbkdf2Sync() is not supported in browser environment. ' +
    'Synchronous key derivation cannot be implemented securely without Web Crypto API. ' +
    'Use pbkdf2() (async callback version) instead for cryptographically correct results.'
  );
}

/** Web Crypto API reference */
export const webcrypto = globalThis.crypto;

export default {
  randomBytes, randomFillSync, randomUUID, randomInt, getRandomValues,
  createHash, createHmac, createSign, createVerify, wrapKey, createCipheriv, createDecipheriv,
  pbkdf2, pbkdf2Sync, webcrypto,
};
