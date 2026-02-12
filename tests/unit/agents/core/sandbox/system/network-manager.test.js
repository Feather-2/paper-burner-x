/**
 * Tests for network-manager.js — SandboxNetworkManager
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../../js/agents/core/sandbox/system/network-proxy.js', () => ({
  createNetworkProxy: vi.fn(() => ({
    listen: vi.fn(async () => 8888),
    getPort: vi.fn(() => 8888),
    close: vi.fn(async () => {}),
    server: {},
  })),
}));

vi.mock('../../../../../../js/agents/core/sandbox/system/proxy-bridge.js', () => ({
  initBridge: vi.fn(async () => ({
    httpSocketPath: '/tmp/pb-http-test.sock',
    httpBridge: { kill: vi.fn() },
    httpProxyPort: 8888,
    cleanup: vi.fn(),
  })),
}));

vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { SandboxNetworkManager } from '../../../../../../js/agents/core/sandbox/system/network-manager.js';

describe('SandboxNetworkManager', () => {
  let mgr;

  beforeEach(() => {
    mgr = new SandboxNetworkManager({
      policy: {
        allowedDomains: ['*.example.com', 'api.safe.io'],
        deniedDomains: ['evil.example.com'],
      },
    });
  });

  afterEach(() => vi.clearAllMocks());

  describe('filterRequest', () => {
    it('blocks denied domains (priority over allow)', async () => {
      expect(await mgr.filterRequest(443, 'evil.example.com')).toBe(false);
    });

    it('allows matching allowed domains', async () => {
      expect(await mgr.filterRequest(443, 'sub.example.com')).toBe(true);
    });

    it('allows exact match', async () => {
      expect(await mgr.filterRequest(443, 'api.safe.io')).toBe(true);
    });

    it('blocks unmatched domains', async () => {
      expect(await mgr.filterRequest(443, 'unknown.org')).toBe(false);
    });

    it('calls askCallback when no match and callback provided', async () => {
      const ask = vi.fn(async () => true);
      mgr = new SandboxNetworkManager({
        policy: { allowedDomains: ['*.example.com'] },
        askCallback: ask,
      });
      const result = await mgr.filterRequest(443, 'other.org');
      expect(ask).toHaveBeenCalledWith({ host: 'other.org', port: 443 });
      expect(result).toBe(true);
    });

    it('allows all when no policy', async () => {
      mgr = new SandboxNetworkManager({});
      expect(await mgr.filterRequest(80, 'anything.com')).toBe(true);
    });

    it('reports violations via onViolation callback', async () => {
      const onViolation = vi.fn();
      mgr = new SandboxNetworkManager({
        policy: { deniedDomains: ['bad.com'] },
        onViolation,
      });
      await mgr.filterRequest(80, 'bad.com');
      expect(onViolation).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'network', host: 'bad.com', reason: 'denied' }),
      );
    });
  });

  describe('lifecycle', () => {
    it('initialize starts proxy and bridge', async () => {
      await mgr.initialize();
      expect(mgr.getSocketPath()).toBe('/tmp/pb-http-test.sock');
      expect(mgr.getProxyPort()).toBe(8888);
    });

    it('shutdown cleans up', async () => {
      await mgr.initialize();
      await mgr.shutdown();
      expect(mgr.getSocketPath()).toBeNull();
    });

    it('updatePolicy changes filter behavior', async () => {
      expect(await mgr.filterRequest(443, 'new.org')).toBe(false);
      mgr.updatePolicy({ allowedDomains: ['new.org'] });
      expect(await mgr.filterRequest(443, 'new.org')).toBe(true);
    });
  });
});
