/**
 * Rollup shim - Stub for browser environment
 * Provides minimal API surface for compatibility
 */

export const VERSION = '4.9.0';

export async function rollup(_options) {
  throw new Error('Rollup bundling is not supported in browser environment');
}

export async function watch(_options) {
  throw new Error('Rollup watch is not supported in browser environment');
}

export function getPackageBase() {
  return '';
}

export default {
  VERSION,
  rollup,
  watch,
  getPackageBase,
};
