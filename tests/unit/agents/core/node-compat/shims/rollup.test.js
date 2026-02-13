import { describe, it, expect } from 'vitest';
import rollupShim, {
  VERSION,
  rollup,
  watch,
  getPackageBase,
} from '../../../../../../js/agents/core/node-compat/shims/rollup.js';

describe('rollup shim', () => {
  it('exposes static version and empty package base', () => {
    expect(VERSION).toBe('4.9.0');
    expect(getPackageBase()).toBe('');
  });

  it('rollup() rejects in browser environment', async () => {
    await expect(rollup({ input: 'index.js' })).rejects.toThrow(
      'Rollup bundling is not supported in browser environment'
    );
  });

  it('watch() rejects in browser environment', async () => {
    await expect(watch({ input: 'index.js' })).rejects.toThrow(
      'Rollup watch is not supported in browser environment'
    );
  });

  it('default export mirrors named exports', () => {
    expect(rollupShim.VERSION).toBe(VERSION);
    expect(rollupShim.rollup).toBe(rollup);
    expect(rollupShim.watch).toBe(watch);
    expect(rollupShim.getPackageBase).toBe(getPackageBase);
  });
});
