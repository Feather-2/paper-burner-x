import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createCorsProxy,
  setCorsProxy,
  getCorsProxy,
  buildProxyUrl,
  proxyFetch,
  resetCorsProxy,
} from '../../../../../js/agents/core/node-compat/cors-proxy.js';

describe('cors-proxy', () => {
  // --- Legacy module-level API (backward compat) ---
  describe('legacy module-level API', () => {
    beforeEach(() => {
      setCorsProxy(null);
      resetCorsProxy({ scope: 'tenant-a' });
      resetCorsProxy({ scope: 'tenant-b' });
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

    it('supports scoped legacy proxies without cross-scope leakage', () => {
      setCorsProxy('https://tenant-a.proxy/?', { scope: 'tenant-a' });
      setCorsProxy('https://tenant-b.proxy/?', { scope: 'tenant-b' });

      expect(getCorsProxy({ scope: 'tenant-a' })).toBe('https://tenant-a.proxy/?');
      expect(getCorsProxy({ scope: 'tenant-b' })).toBe('https://tenant-b.proxy/?');
      expect(getCorsProxy()).toBeNull();
      expect(buildProxyUrl('https://example.com', { scope: 'tenant-a' })).toBe(
        'https://tenant-a.proxy/?' + encodeURIComponent('https://example.com'),
      );
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

      it('uses scoped proxy options when provided', async () => {
        setCorsProxy('https://scope.proxy/?', { scope: 'scoped' });
        await proxyFetch('https://example.com', { method: 'GET' }, { scope: 'scoped' });
        expect(mockFetch).toHaveBeenCalledWith(
          'https://scope.proxy/?' + encodeURIComponent('https://example.com'),
          { method: 'GET' },
        );
      });
    });
  });

  // --- createCorsProxy factory ---
  describe('createCorsProxy', () => {
    it('creates instance with null proxy by default', () => {
      const proxy = createCorsProxy();
      expect(proxy.get()).toBeNull();
    });

    it('accepts initialUrl', () => {
      const proxy = createCorsProxy('https://proxy.io/?');
      expect(proxy.get()).toBe('https://proxy.io/?');
    });

    it('set/get round-trips', () => {
      const proxy = createCorsProxy();
      proxy.set('https://proxy.io/?');
      expect(proxy.get()).toBe('https://proxy.io/?');
      proxy.set(null);
      expect(proxy.get()).toBeNull();
    });

    it('buildUrl returns original URL when no proxy', () => {
      const proxy = createCorsProxy();
      expect(proxy.buildUrl('https://example.com')).toBe('https://example.com');
    });

    it('buildUrl returns proxied URL when proxy is set', () => {
      const proxy = createCorsProxy('https://proxy.io/?');
      expect(proxy.buildUrl('https://example.com/path?q=1')).toBe(
        'https://proxy.io/?' + encodeURIComponent('https://example.com/path?q=1'),
      );
    });

    it('instances are isolated from each other', () => {
      const a = createCorsProxy('https://a.io/?');
      const b = createCorsProxy('https://b.io/?');
      a.set('https://changed.io/?');
      expect(a.get()).toBe('https://changed.io/?');
      expect(b.get()).toBe('https://b.io/?');
    });

    it('instance is isolated from module-level default', () => {
      setCorsProxy('https://global.io/?');
      const inst = createCorsProxy();
      expect(inst.get()).toBeNull();
      expect(getCorsProxy()).toBe('https://global.io/?');
      setCorsProxy(null);
    });

    describe('fetch', () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });

      beforeEach(() => {
        vi.stubGlobal('fetch', mockFetch);
        mockFetch.mockClear();
      });

      it('calls fetch with original URL when no proxy', async () => {
        const proxy = createCorsProxy();
        await proxy.fetch('https://example.com');
        expect(mockFetch).toHaveBeenCalledWith('https://example.com', undefined);
      });

      it('calls fetch with proxied URL when proxy is set', async () => {
        const proxy = createCorsProxy('https://proxy.io/?');
        await proxy.fetch('https://example.com', { method: 'POST' });
        expect(mockFetch).toHaveBeenCalledWith(
          'https://proxy.io/?' + encodeURIComponent('https://example.com'),
          { method: 'POST' },
        );
      });
    });
  });
});
