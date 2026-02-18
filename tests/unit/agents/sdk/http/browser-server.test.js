import { describe, it, expect } from 'vitest';
import { normalizeVirtualRequestBody } from '../../../../../js/agents/sdk/http/browser-server.js';

describe('sdk/http/browser-server normalizeVirtualRequestBody', () => {
  it('returns string body as-is', () => {
    expect(normalizeVirtualRequestBody('{"prompt":"hi"}')).toBe('{"prompt":"hi"}');
  });

  it('decodes ArrayBuffer body as UTF-8 text', () => {
    const bytes = new TextEncoder().encode('{"prompt":"你好"}');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    expect(normalizeVirtualRequestBody(buffer)).toBe('{"prompt":"你好"}');
  });

  it('decodes Uint8Array view body as UTF-8 text', () => {
    const bytes = new TextEncoder().encode('{"prompt":"hello"}');
    expect(normalizeVirtualRequestBody(bytes)).toBe('{"prompt":"hello"}');
  });

  it('decodes typed-array views with non-zero byte offsets', () => {
    const raw = new TextEncoder().encode('xx{"prompt":"offset"}yy');
    const view = new Uint8Array(raw.buffer, 2, raw.byteLength - 4);
    expect(normalizeVirtualRequestBody(view)).toBe('{"prompt":"offset"}');
  });

  it('falls back to JSON serialization for plain objects', () => {
    expect(normalizeVirtualRequestBody({ prompt: 'hi' })).toBe('{"prompt":"hi"}');
  });

  it('returns empty string when object serialization fails', () => {
    const circular = {};
    circular.self = circular;
    expect(normalizeVirtualRequestBody(circular)).toBe('');
  });

  it('coerces primitive non-string bodies to string', () => {
    expect(normalizeVirtualRequestBody(42)).toBe('42');
    expect(normalizeVirtualRequestBody(true)).toBe('true');
    expect(normalizeVirtualRequestBody(null)).toBe('');
  });
});
