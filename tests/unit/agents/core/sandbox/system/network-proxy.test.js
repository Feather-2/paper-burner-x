/**
 * Tests for network-proxy.js — HTTP/HTTPS proxy server
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock node:http, node:https, node:net
const mockServer = {
  on: vi.fn(),
  listen: vi.fn((port, host, cb) => { cb?.(); }),
  address: vi.fn(() => ({ port: 9999 })),
  close: vi.fn((cb) => { cb?.(); }),
  once: vi.fn(),
};

vi.mock('node:http', () => ({
  createServer: vi.fn(() => mockServer),
  request: vi.fn(),
}));
vi.mock('node:https', () => ({ request: vi.fn() }));
vi.mock('node:net', () => ({ connect: vi.fn() }));
vi.mock('node:url', () => ({ URL: globalThis.URL }));
vi.mock('../../../../../js/agents/shared/index.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import { createNetworkProxy } from '../../../../../../js/agents/core/sandbox/system/network-proxy.js';

describe('network-proxy', () => {
  afterEach(() => vi.clearAllMocks());

  it('creates a proxy server with listen/getPort/close', async () => {
    const filter = vi.fn(() => true);
    const proxy = createNetworkProxy({ filter });

    expect(proxy.server).toBe(mockServer);
    expect(typeof proxy.listen).toBe('function');
    expect(typeof proxy.getPort).toBe('function');
    expect(typeof proxy.close).toBe('function');
  });

  it('listen returns port from server.address()', async () => {
    const proxy = createNetworkProxy({ filter: () => true });
    const port = await proxy.listen(0, '127.0.0.1');
    expect(port).toBe(9999);
  });

  it('getPort returns port when server is listening', () => {
    const proxy = createNetworkProxy({ filter: () => true });
    expect(proxy.getPort()).toBe(9999);
  });

  it('registers connect and request handlers', () => {
    createNetworkProxy({ filter: () => true });
    const events = mockServer.on.mock.calls.map(c => c[0]);
    expect(events).toContain('connect');
    expect(events).toContain('request');
  });
});
