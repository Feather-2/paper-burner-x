import { describe, expect, it, vi } from 'vitest';

import { ulid } from '../../../../../js/agents/plugins/context/io.js';

describe('plugins/context/io', () => {
  it('ulid uses shared non-crypto fallback bytes when crypto is unavailable', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T03:04:05.000Z'));

    try {
      const first = ulid();
      const second = ulid();

      expect(first).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(second).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(second).not.toBe(first);
      expect(first.slice(0, 10)).toBe(second.slice(0, 10));
    } finally {
      vi.useRealTimers();
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'crypto', originalDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'crypto');
      }
    }
  });
});
