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

  it('falls back to JSON serialization for plain objects', () => {
    expect(normalizeVirtualRequestBody({ prompt: 'hi' })).toBe('{"prompt":"hi"}');
  });
});
