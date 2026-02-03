import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./js/agents/plugins/analysis/fingerprint.js', () => ({ default: { id: 'mock' } }));

let mod;

beforeEach(async () => {
  vi.resetModules();
  mod = await import('./js/agents/plugins/index.js');
});

describe('repro', () => {
  it('loadPlugin returns mock', async () => {
    const plugin = await mod.loadPlugin('analysis/fingerprint');
    expect(plugin).toEqual({ id: 'mock' });
  });

  it('createPluginLoader + loadPlugin', async () => {
    const loader = mod.createPluginLoader();
    const [a, b] = await Promise.all([
      loader('analysis/fingerprint'),
      mod.loadPlugin('analysis/fingerprint'),
    ]);
    expect([a, b]).toEqual([{ id: 'mock' }, { id: 'mock' }]);
  });
});
