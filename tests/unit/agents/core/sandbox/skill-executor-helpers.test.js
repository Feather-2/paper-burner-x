import { describe, it, expect, vi } from 'vitest';
import {
  normalizeFallbackAllowlist,
  validateFallbackCode,
  createFallbackProxyGlobals,
  createFallbackGlobals,
} from '../../../../../js/agents/core/sandbox/skill-executor-helpers.js';

describe('core/sandbox/skill-executor-helpers', () => {
  it('validateFallbackCode reports explicit deny-all policy reason', () => {
    expect(validateFallbackCode('return 1;')).toEqual({
      valid: false,
      reason: 'Fallback eval is disabled by policy (deny-all)',
    });
  });

  it('validateFallbackCode keeps empty code as valid input', () => {
    expect(validateFallbackCode('')).toEqual({ valid: true });
  });

  it('normalizeFallbackAllowlist filters non-string/blank entries', () => {
    const allowlist = normalizeFallbackAllowlist(['', '  ', 'skill:a', 1, null]);
    expect(allowlist).toBeInstanceOf(Set);
    expect(Array.from(allowlist)).toEqual(['skill:a']);
  });

  it('createFallbackProxyGlobals blocks dangerous global member access', () => {
    const blockedAccesses = new Set();
    const proxy = createFallbackProxyGlobals({}, { blockedAccesses });

    expect(proxy.constructor).toBeUndefined();
    expect(proxy.__proto__).toBeUndefined();
    expect(blockedAccesses.has('constructor')).toBe(true);
    expect(blockedAccesses.has('__proto__')).toBe(true);
  });

  it('createFallbackGlobals does not expose blocked args keys', () => {
    const onLog = vi.fn();
    const onEmit = vi.fn();
    const globals = createFallbackGlobals({
      state: { ok: true },
      args: { safeArg: 1, constructor: 'x', require: 'y' },
      onLog,
      onEmit,
    });

    expect(globals.safeArg).toBe(1);
    expect(globals.constructor).toBeUndefined();
    expect(globals.require).toBeUndefined();
    expect(typeof globals.console.log).toBe('function');
  });
});
