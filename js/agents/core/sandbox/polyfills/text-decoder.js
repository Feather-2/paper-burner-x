/**
 * 安装扩展 TextDecoder polyfill。
 * 浏览器原生 TextDecoder 不支持 base64/hex，此 polyfill 补充这些编码。
 * @param {object} [target=globalThis]
 */
export function installTextDecoderPolyfill(target = globalThis) {
  const OriginalDecoder = target.TextDecoder;
  if (!OriginalDecoder) return;

  const EXTRA_ENCODINGS = new Set(['base64', 'base64url', 'hex', 'binary', 'latin1']);

  class ExtendedTextDecoder {
    constructor(encoding = 'utf-8', options = {}) {
      this._encoding = encoding.toLowerCase().replace(/[_-]/g, '');
      this._options = options;
      if (!EXTRA_ENCODINGS.has(this._encoding)) {
        this._native = new OriginalDecoder(encoding, options);
      }
    }

    get encoding() {
      return this._native ? this._native.encoding : this._encoding;
    }

    decode(input, options) {
      if (this._native) return this._native.decode(input, options);
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

      switch (this._encoding) {
        case 'hex':
          return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
        case 'base64': {
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          return btoa(bin);
        }
        case 'base64url': {
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }
        case 'binary':
        case 'latin1': {
          let str = '';
          for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
          return str;
        }
        default:
          throw new Error(`Unsupported encoding: ${this._encoding}`);
      }
    }
  }

  // 只在原生 TextDecoder 不支持 hex 时安装
  try {
    new OriginalDecoder('hex');
    return; // 原生已支持
  } catch (_) {
    // 原生不支持，安装 polyfill
  }

  ExtendedTextDecoder.__polyfill = true;
  target.TextDecoder = ExtendedTextDecoder;
}

export { installTextDecoderPolyfill as default };
