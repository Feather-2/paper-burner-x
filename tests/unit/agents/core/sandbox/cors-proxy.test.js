import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setCorsProxy,
  getCorsProxy,
  buildProxyUrl,
  proxyFetch,
} from '../../../../../js/agents/core/sandbox/cors-proxy.js';

describe('cors-proxy', () => {
  beforeEach(() => {
    setCorsProxy(null);
  });

  it('getCorsProxy returns null by default', () => {
    expect(getCorsProxy()).toBeNull();
  });

  it('setCorsProxy sets the proxy URL', () => {
    setCorsProxy('https://corsproxy.io/?');
    expect(getCorsProxy()).toBe('https://corsproxy.io/?');
  });

  it('setCorsProxy(null) disables the proxy', () => {
    setCorsProxy('https://corsproxy.io/?');
    setCorsProxy(null);
    expect(getCorsProxy()).toBeNull();
  });

  it('buildProxyUrl returns original URL when no proxy', () => {
    expect(buildProxyUrl('https://example.com')).toBe('https://example.com');
  });

  it('buildProxyUrl returns proxied URL when proxy is set', () => {
    setCorsProxy('https://corsproxy.io/?');
    const result = buildProxyUrl('https://example.com/path?q=1');
    expect(result).toBe(
      'https://corsproxy.io/?' + encodeURIComponent('https://example.com/path?q=1'),
    );
  });

  describe('proxyFetch', () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
      mockFetch.mockClear();
    });

    it('calls fetch with original URL when no proxy', async () => {
      await proxyFetch('https://example.com');
      expect(mockFetch).toHaveBeenCalledWith('https://example.com', undefined);
    });

    it('calls fetch with proxied URL when proxy is set', async () => {
      setCorsProxy('https://corsproxy.io/?');
      await proxyFetch('https://example.com', { method: 'POST' });
      const expected =
        'https://corsproxy.io/?' + encodeURIComponent('https://example.com');
      expect(mockFetch).toHaveBeenCalledWith(expected, { method: 'POST' });
    });
  });
});
