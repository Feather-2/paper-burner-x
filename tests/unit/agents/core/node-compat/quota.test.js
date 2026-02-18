import { describe, expect, it } from 'vitest';
import { QuotaEnforcer } from '../../../../../js/agents/core/node-compat/quota.js';

describe('node-compat/quota', () => {
  it('supports memory release semantics and tracks peak usage', () => {
    const quota = new QuotaEnforcer({ maxMemoryMB: 10 });

    quota.trackMemory(2 * 1024 * 1024);
    quota.trackMemory(-1 * 1024 * 1024);
    quota.trackMemory(-5 * 1024 * 1024);

    const stats = quota.getStats();
    expect(stats.memoryMB).toBe(0);
    expect(stats.memoryPeakMB).toBe(2);
  });

  it('throws when current memory exceeds limit', () => {
    const quota = new QuotaEnforcer({ maxMemoryMB: 1 });
    expect(() => quota.trackMemory(2 * 1024 * 1024)).toThrow('Memory quota exceeded');
  });
});
