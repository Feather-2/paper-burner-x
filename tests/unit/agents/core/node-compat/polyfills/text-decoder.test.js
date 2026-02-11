import { afterEach, describe, expect, it } from 'vitest';
import {
  ExtendedTextDecoder,
  installPolyfill,
} from '../../../../../../js/agents/core/sandbox/polyfills/text-decoder.js';

const OriginalTextDecoder = globalThis.TextDecoder;

afterEach(() => {
  globalThis.TextDecoder = OriginalTextDecoder;
});

describe('ExtendedTextDecoder', () => {
  it('delegates utf-8 decoding to native TextDecoder', () => {
    const decoder = new ExtendedTextDecoder('utf-8');
    const bytes = new TextEncoder().encode('Hello, 世界');
    expect(decoder.decode(bytes)).toBe('Hello, 世界');
  });

  it('supports utf16 aliases and decodes utf-16le bytes', () => {
    const decoder = new ExtendedTextDecoder('utf16');
    const bytes = new Uint8Array([72, 0, 105, 0]);
    expect(decoder.encoding).toBe('utf-16le');
    expect(decoder.decode(bytes)).toBe('Hi');
  });

  it('delegates ascii decoding to native TextDecoder', () => {
    const decoder = new ExtendedTextDecoder('ascii');
    const bytes = new Uint8Array([80, 97, 112, 101, 114]);
    expect(decoder.decode(bytes)).toBe('Paper');
  });

  it('delegates latin1 decoding to native TextDecoder', () => {
    const decoder = new ExtendedTextDecoder('latin1');
    const bytes = new Uint8Array([0xe9, 0x20, 0x61]);
    expect(decoder.decode(bytes)).toBe('é a');
  });

  it('encodes bytes as base64 string', () => {
    const decoder = new ExtendedTextDecoder('base64');
    const bytes = new TextEncoder().encode('hello');
    expect(decoder.decode(bytes)).toBe('aGVsbG8=');
  });

  it('encodes bytes as base64url string', () => {
    const decoder = new ExtendedTextDecoder('base64url');
    const bytes = new Uint8Array([251, 239, 190]);
    expect(decoder.decode(bytes)).toBe('----');
  });

  it('encodes bytes as lowercase hex string', () => {
    const decoder = new ExtendedTextDecoder('hex');
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(decoder.decode(bytes)).toBe('deadbeef');
  });

  it('accepts ArrayBuffer and DataView inputs', () => {
    const source = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const decoder = new ExtendedTextDecoder('hex');

    const fromBuffer = decoder.decode(source.buffer);
    const fromDataView = decoder.decode(new DataView(source.buffer, 1, 2));

    expect(fromBuffer).toBe('01020304');
    expect(fromDataView).toBe('0203');
  });

  it('returns empty string for empty inputs in extended encodings', () => {
    expect(new ExtendedTextDecoder('base64').decode()).toBe('');
    expect(new ExtendedTextDecoder('base64url').decode(new Uint8Array(0))).toBe('');
    expect(new ExtendedTextDecoder('hex').decode(null)).toBe('');
  });

  it('exposes normalized encoding in encoding getter', () => {
    expect(new ExtendedTextDecoder('UTF8').encoding).toBe('utf-8');
    expect(new ExtendedTextDecoder('LATIN-1').encoding).toBe('windows-1252');
    expect(new ExtendedTextDecoder('base64url').encoding).toBe('base64url');
  });

  it('throws for unsupported encoding', () => {
    expect(() => new ExtendedTextDecoder('unsupported-codec')).toThrow(RangeError);
  });

  it('throws when decode input is not ArrayBuffer or view', () => {
    const decoder = new ExtendedTextDecoder('hex');
    expect(() => decoder.decode(/** @type {unknown} */ ('abc'))).toThrow(TypeError);
  });
});

describe('installPolyfill', () => {
  it('installs ExtendedTextDecoder when current implementation lacks base64/hex support', () => {
    class UtfOnlyDecoder {
      constructor(encoding = 'utf-8') {
        if (encoding === 'base64' || encoding === 'base64url' || encoding === 'hex') {
          throw new RangeError('unsupported');
        }
        this.encoding = encoding;
      }

      decode() {
        return '';
      }
    }

    globalThis.TextDecoder = UtfOnlyDecoder;
    const installed = installPolyfill();

    expect(installed).toBe(true);
    expect(globalThis.TextDecoder).toBe(ExtendedTextDecoder);
  });

  it('is idempotent when polyfill already installed', () => {
    globalThis.TextDecoder = ExtendedTextDecoder;
    expect(installPolyfill()).toBe(false);
    expect(globalThis.TextDecoder).toBe(ExtendedTextDecoder);
  });

  it('does not replace decoder if it already supports extended encodings', () => {
    class SupportsExtendedDecoder {
      constructor(encoding = 'utf-8') {
        this.encoding = encoding;
      }

      decode() {
        return '';
      }
    }

    globalThis.TextDecoder = SupportsExtendedDecoder;
    const installed = installPolyfill();

    expect(installed).toBe(false);
    expect(globalThis.TextDecoder).toBe(SupportsExtendedDecoder);
  });

  it('installs polyfill when global TextDecoder is missing', () => {
    globalThis.TextDecoder = undefined;
    const installed = installPolyfill();

    expect(installed).toBe(true);
    expect(globalThis.TextDecoder).toBe(ExtendedTextDecoder);
  });
});
