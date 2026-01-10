/**
 * node:test console silencer
 * Used via `node --import` to keep TAP output readable for noisy modules.
 */

if (!process?.env?.NODE_TEST_VERBOSE && !globalThis.__NODE_TEST_QUIET_INSTALLED) {
  globalThis.__NODE_TEST_QUIET_INSTALLED = true;

  const noop = () => {};
  for (const method of ['debug', 'info', 'log', 'warn']) {
    if (typeof console?.[method] === 'function') {
      console[method] = noop;
    }
  }
}

