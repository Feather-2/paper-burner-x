const EXTENDED_ENCODINGS = new Set(['base64', 'base64url', 'hex']);
const STANDARD_ENCODING_ALIASES = new Map([
  ['utf8', 'utf-8'],
  ['utf-8', 'utf-8'],
  ['utf16', 'utf-16le'],
  ['utf-16', 'utf-16le'],
  ['utf16le', 'utf-16le'],
  ['utf-16le', 'utf-16le'],
  ['ascii', 'ascii'],
  ['us-ascii', 'ascii'],
  ['latin1', 'latin1'],
  ['latin-1', 'latin1'],
  ['iso-8859-1', 'latin1'],
]);

const NativeTextDecoder = globalThis.TextDecoder;
const installedDecoderTargets = new WeakMap();

/**
 * @param {string} [encoding='utf-8']
 * @returns {string}
 */
function normalizeEncoding(encoding = 'utf-8') {
  const normalized = String(encoding || 'utf-8').trim().toLowerCase();
  return STANDARD_ENCODING_ALIASES.get(normalized) || normalized;
}

/**
 * @param {ArrayBuffer|ArrayBufferView|Uint8Array|null|undefined} input
 * @returns {Uint8Array}
 */
function toUint8Array(input) {
  if (input == null) {
    return new Uint8Array(0);
  }

  if (input instanceof Uint8Array) {
    return input;
  }

  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }

  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }

  throw new TypeError('decode() input must be an ArrayBuffer or ArrayBufferView');
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToHex(bytes) {
  let output = '';
  for (let i = 0; i < bytes.length; i += 1) {
    output += bytes[i].toString(16).padStart(2, '0');
  }
  return output;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64(bytes) {
  if (bytes.length === 0) {
    return '';
  }

  if (typeof globalThis.Buffer !== 'undefined') {
    return globalThis.Buffer.from(bytes).toString('base64');
  }

  if (typeof globalThis.btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return globalThis.btoa(binary);
  }

  // Runtime fallback for environments without Buffer/btoa.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;

    const triple = (a << 16) | (b << 8) | c;
    output += chars[(triple >> 18) & 63];
    output += chars[(triple >> 12) & 63];
    output += i + 1 < bytes.length ? chars[(triple >> 6) & 63] : '=';
    output += i + 2 < bytes.length ? chars[triple & 63] : '=';
  }

  return output;
}

/**
 * @param {typeof TextDecoder|undefined} Decoder
 * @param {string} encoding
 * @returns {boolean}
 */
function supportsEncoding(Decoder, encoding) {
  if (typeof Decoder !== 'function') {
    return false;
  }

  try {
    const instance = new Decoder(encoding);
    instance.decode(new Uint8Array(0));
    return true;
  } catch {
    /* intentional: encoding probe */
    return false;
  }
}

/**
 * Extended TextDecoder supporting base64/base64url/hex output.
 */
export class ExtendedTextDecoder {
  /**
   * @param {string} [encoding='utf-8']
   * @param {TextDecoderOptions} [options]
   */
  constructor(encoding = 'utf-8', options = {}) {
    this._encoding = normalizeEncoding(encoding);
    this._options = options;
    this._native = null;

    if (EXTENDED_ENCODINGS.has(this._encoding)) {
      return;
    }

    if (typeof NativeTextDecoder !== 'function') {
      throw new Error(`Native TextDecoder is not available for encoding: ${this._encoding}`);
    }

    try {
      this._native = new NativeTextDecoder(this._encoding, options);
      this._encoding = this._native.encoding || this._encoding;
    } catch {
      throw new RangeError(`Unsupported encoding: ${this._encoding}`);
    }
  }

  /**
   * @returns {string}
   */
  get encoding() {
    return this._encoding;
  }

  /**
   * @param {ArrayBuffer|ArrayBufferView|Uint8Array|null|undefined} [input]
   * @param {TextDecodeOptions} [options]
   * @returns {string}
   */
  decode(input, options) {
    if (this._native) {
      return this._native.decode(input, options);
    }

    const bytes = toUint8Array(input);

    if (this._encoding === 'base64') {
      return bytesToBase64(bytes);
    }

    if (this._encoding === 'base64url') {
      return bytesToBase64(bytes)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
    }

    if (this._encoding === 'hex') {
      return bytesToHex(bytes);
    }

    throw new RangeError(`Unsupported encoding: ${this._encoding}`);
  }
}

ExtendedTextDecoder.__native = NativeTextDecoder;
ExtendedTextDecoder.__polyfill = true;

/**
 * Install the ExtendedTextDecoder as global TextDecoder when needed.
 *
 * @param {{ target?: any }} [options]
 * @returns {boolean} true when global TextDecoder was replaced
 */
export function installPolyfill(options = {}) {
  const target = options && typeof options === 'object' && options.target
    ? options.target
    : globalThis;

  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    throw new TypeError('installPolyfill target must be an object');
  }

  const CurrentDecoder = target.TextDecoder;
  if (CurrentDecoder === ExtendedTextDecoder) {
    return false;
  }

  const needsPolyfill = !supportsEncoding(CurrentDecoder, 'base64')
    || !supportsEncoding(CurrentDecoder, 'base64url')
    || !supportsEncoding(CurrentDecoder, 'hex');

  if (!needsPolyfill) {
    return false;
  }

  if (!installedDecoderTargets.has(target)) {
    installedDecoderTargets.set(target, CurrentDecoder);
  }
  target.TextDecoder = ExtendedTextDecoder;
  return true;
}

/**
 * Restore previously installed TextDecoder for a given target.
 *
 * @param {{ target?: any }} [options]
 * @returns {boolean} true when a restore happened
 */
export function uninstallPolyfill(options = {}) {
  const target = options && typeof options === 'object' && options.target
    ? options.target
    : globalThis;
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    throw new TypeError('uninstallPolyfill target must be an object');
  }
  if (target.TextDecoder !== ExtendedTextDecoder) {
    return false;
  }
  if (!installedDecoderTargets.has(target)) {
    return false;
  }

  const previous = installedDecoderTargets.get(target);
  if (previous === undefined) {
    delete target.TextDecoder;
  } else {
    target.TextDecoder = previous;
  }
  installedDecoderTargets.delete(target);
  return true;
}
